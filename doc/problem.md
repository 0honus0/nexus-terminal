# Nexus Agent 复查记录（代码 / 设计 / 模块关系 / UI）

> 状态：持续维护的 Review / 闭环记录；已完成项保留历史证据并标记关闭，开放项按当前代码事实继续复核。
> 复查对象：当前工作区里新增的 Agent 功能（Backend `modules/agent` + `infrastructure/agent`、Frontend `features/agent`、`packages/agent-runner`）。
> 基准文档：`doc/AGENT.md`、`doc/architecture/FRONTEND.md`、`doc/software-requirements/requirements/agent.md`。
> 复核方式：静态阅读 + 计数 + 构建产物核对 + **第二轮起在真实环境用 CDP 浏览器截图 / 读计算样式实测**（方法见文末「附录 A」）。
> 实测环境（2026-09-21）：后端 `tsx src/index.ts`（:3001，dev）+ 前端 vite（:9998）+ 反代 `https://api.honus.top`，账号 `honus`。
> 浏览器窗口：第一~三轮为 **1620×953 / dpr 1**；**第四轮实测时浏览器的真实窗口已是 1600×773 / dpr 1**（本轮起未做任何改动，Hub 窗口沿用持久化的 1600×711）。全文标注了每轮实测所用的尺寸，跨轮数字不要直接互相比较。
> Git 状态可用；闭环过程以 `dev` 分支实际提交、静态门禁与真实 CDP 验收为准。
>
> **当前实施状态（2026-09-23）**：已关闭 §7.12（空态 pager 命中区）、§7.13-d（会话列表缩放入口/重置）、§6.2 批 1/2（设置区主/次/危险/图标按钮收敛到 Gen2 `UiButton`）、§7.20（设置区 27 处原生 checkbox 收敛到 Gen2 `UiCheckbox`）、§7.21（Hub 模型弹层恢复"真毛玻璃 + 无盒选项行"）、§7.22（Provider / 设置写完立即刷新主界面）、§7.23（玻璃配方上收到 Gen2 通用层）、§7.13-e（11 个稳态禁用按钮补齐原因文案）、§7.2（骨架：最小高度 380 → 480 + 矮窗口 composer 压缩、侧栏可折叠、窗口状态持久化、列宽复核、顶栏双击最大化）、§7.24-a（「Agent 功能」卡片瘦身）与 §7.24-b/-c（16 张卡的长句迁入通用 `UiInfoHint`，设置区可见说明 2145 → 1209 字；Hub 侧补 2 处弹层头部说明）、§7.2-g（停靠态侧栏折叠/展开补 200ms 列宽过渡 + 淡出，修掉"闪一下跳到展开位置"）、§6.2 第三批（Agent 设置区分组导航胶囊 `115×36 r12` → `115×32 r8`，并在同轮抓到 `添加备用模型` 触发器误用 comfortable 密度 `137×36 fs13` → `133×32 fs12`）、§7.25（设置区「一层卡片」重构：模块卡并入分组卡、模块内分组框降级为 inset 并把分组导航改为粘性，叶子的带边框祖先 3 层 → 1 层）、§7.26（Composer 配置弹层首帧错位：测量前解除占位尺寸 + 未定位不绘制，模型/思考强度/App 切换器首帧即终值）、§7.27（**Agent 设置区布局重构**：宽屏常驻左栏分区导航 240px + 17 个锚点跳转 + 滚动联动，窄屏保留顶部胶囊；同轮修掉粘性导航被顶栏吞掉、模块 `z-20` 压过导航条、`v-show` 因双根失效、`UiInfoHint` 漏 import 四个真实缺陷）、§7.28（设置区空态统一到 Gen2 `UiEmptyState`，10 处；`dense` 档实测 950×38 / 卡片档 950×143）、§7.29（设置区面板头部摘要去「标签: 数值」方块化，改图标 + 标签/数值两行）、§7.30（**Agent 设置区信息密度与窄屏**：16 条模块标题带去底色消除斑马纹、标题与动作簇 `gap` 12 → `12px 16px`、工具条 `gap-1.5` → `gap-2.5`，414px 下动作簇改为整行下移左对齐，同轮修掉插件仓库输入框的窄屏横向溢出）。、§7.31（**设置区 8 处独立「保存」按钮语义分级**：无未保存变更时由浅紫实心主按钮降为 `soft`/`neutral` + 禁用 + 原因 `title`，并给 Browser / ACP / Subagent 三处补上 dirty 快照比对，§7.15-c 整条关闭）。、§7.32（**设置区 22 处原生 `<select>` 全部收敛到 Gen2 `UiSelect`**：新增 `pickOption()` / `NONE_OPTION`，`UiSelect` 的 v-model 收窄为「可空进、非空出」，实测三组可见 10 处、残留原生 0、414px 无溢出）。默认模型仍是 Gen2 `UiCombobox`（§7.6 / §7.18，trigger / panel 共用同一 glass fill / blur / border）。、§7.33（`QuantityInput` 单位药丸 18×20 → 24×24）、§7.34（模型行 11px 纯文字按钮 → Gen2 `UiButton` + 「一键取消」补确认弹窗）、§7.35（Workspace 运行时 5 处原生 `<select>` → `UiSelect`，`features/agent/**` 原生 select 归零）、§7.36（TaskRail「最近事实」改 `dl` 投影 + 原始 payload 折进二级 `<details>`）、§7.38（**§2.8 收口**：Launcher 改长按拖动 + 「重置位置」，虚拟列表行高改量探针行）、§7.37（**Agent 错误横幅补失败域与重试入口**：9 个失败域 + 读「重试」/ 写「重新同步」，机器码不再直接当兜底文案，§2.9 收口）、§7.39（**工具结果摘要的「模型证据 / 用户投影」拆分**：`ToolResult.userSummary` 在 `projectToolResult` 被剥离、ledger payload 旁路携带、`ConversationMessage.vue` 优先渲染并回退历史 `summary`；`tools/host/**` 16 文件 52 处 + 4 条 state-commit 失败摘要接入，新增三语 `agent.conversation.toolSummary.*`（72 句 + 39 枚举标签），§1.8 / §3.6 的"工具摘要英文硬编码"整条关闭）、§7.40（**i18n 死 key 收口**：`scripts/check-agent-i18n.mjs` 新增第 4 条"key 可达性"守卫，三语字典删除 75×3 条不可达文案，1,467 → 1,392，§3.5 收口）。每条闭环均带真实 CDP 实测数据 + 类型检查；**§0 速览表的开放项已只剩 2 条、且都带明确结论**：设置区顶部 Tab 36px（跨页 chrome，按约定不动）、
> 巨型 UI 文件拆分（§3.1；2026-09-23 已复核并**按约定延后**——该条无隐藏的用户可见缺陷，拆分需搬迁约 30 props + 15 emit，
> 正确验收依赖 Provider CRUD / Run 详情两条主路径的逐控件回归，本环境 `runner_not_configured` 无法覆盖，详见 §3.1 的复核块）；**§3.5 的"i18n 死 key"已于本轮关闭**（§7.40：新增可达性门禁 + 清掉 75×3 条不可达文案，字典 1,467 → 1,392）；**"后端工具结果摘要英文硬编码" 本轮已关闭**，仅剩 `mcp-tools.ts`（远端不可信内容，刻意排除）、`execution-errors.ts` 前缀与 `command.reason` 三处非 UI 残余并入 §3.6 跟踪；主界面骨架 §7.2 已整节关闭（最小高度、侧栏折叠、状态持久化、列宽复核、顶栏双击）。本文件现在作为唯一进度/问题状态来源，原 `doc/progress.md` 不再维护。

> **历史提交完整复核补充（2026-09-23）**：`b0d7b220..862a458` 按 Git 左开区间语义的 **66/66 个提交**已逐个回看“改动文件 → 对应 Problem 闭环 → 当前 HEAD 实现”；收尾又把左边界 `b0d7b220` 本身单独补审，因此从 `b0d7b220`（含）到当前 HEAD `97560f1` 共 **73/73 个提交**已有明确 commit→Problem/纯文档结论。首轮 / 第一遍完整复核确认 §7.41–§7.51；随后继续做跨切面反向审计（状态机、异步 generation、跨账号/session、持久化、i18n、a11y/命中区、Gen2 公共层、跨 tab、frontend/backend 契约、mutation commit boundary、分页、terminal、plugin/KeepAlive 生命周期、Plugin 安装链、Runner runtime/reconcile、Workspace checkpoint、SQLite migration 与 backup/restore），现已审计到 §7.153，其中确认 **51 条**新增开放项；另有 §7.53–§7.79 / §7.81–§7.100 / §7.117 已在真实复现后修复并验证；§7.80 / §7.124 经跨组件或真实 caller 复核已排除。新增高风险包括 App Tab / version cache 泄漏（§7.73）、失败域共用 error slot（§7.75）、create 类 mutation 的 caller-stable identity 缺口（§7.78）、enabled-but-failed App 仍允许 Send（§7.81）、Settings optimistic conflict 不 reconcile（§7.82）、Provider 拉取模型旧请求跨 modal 污染（§7.83）、Provider “测试连接”提前持久化（§7.84）、Workspace restart 的 Runner Plugin 半失败状态（§7.85）、toolchain switch 的 delete unknown/failed 可把 workspace 长期留在 stopping（§7.86）、Host Runner 异常重启后的 detached child orphan（§7.87）、Plugin upgrade draining continuation 易失（§7.88）、runtime cleanup 可在 ACP/Terminal 尚未退出时删 workspace（§7.89）、checkpoint capture 不冻结 live Workspace writer（§7.90）、checkpoint restore 在目录 rename 中点崩溃后无法 startup reconcile（§7.91）、Terminal/ACP 外部 writer 可穿透 file patch 的 SHA precondition 并被静默覆盖（§7.92）、Workspace lifecycle 不等待 background job 真正退出就成功（§7.93），toolchain switch 可在旧 generation ACP/Terminal 仍存活时启动新 generation（§7.94），普通 restart 也会在旧 ACP/Terminal 未退出时重新激活 runtime/plugin（§7.95），手动 checkpoint resume 在 Workspace restore 失败后可留下已提交的新 Run、重试再建一个 Run（§7.96），同一 Workspace 的不同 lifecycle action 可用同一个 expectedVersion 并发通过（§7.97），全局 `/opt/nexus/packs/<family>/<version>` canonical symlink 会让不同 digest 的 frozen Workspace 互相改写长寿命进程的 toolchain 解析（§7.98），Safety Network 一次连接加载失败后即使共享 store 后来恢复仍会永久卡失败态（§7.99），Agent migration #23/#34 能把 partial schema 错标成“已完成迁移”（§7.100），“完整备份”遗漏全部 Agent/AI 表与权威 Artifact/Plugin 文件，恢复后形成跨时点混合状态（§7.101），backup 文件目录 swap 的 rollback/crash recovery 不能保证恢复前数据（§7.102），Memory import confirmation 与最终副作用不原子、unknown outcome 后可重复导入（§7.103），Root Scheduler 出队后 async preflight 失败会永久丢 Run（§7.104），Host durable event outbox 没有 retention、会按用户永久增长（§7.105），Plugin stage 没有 TTL/delete 生命周期、可永久累积大体积 staging 目录（§7.106），Artifact 上传 rename→ready commit 竞态可留下未计费 orphan blob（§7.107），AppStorage 只按 value bytes 计 quota、可被海量小值+长 key 绕过实际磁盘限制（§7.108），Backup export/import 缺一致性 snapshot 与全局串行化（§7.109），Plugin AppStorage 可直接改写 Host-owned Execution/Subagent Policy（§7.110），Manual checkpoint 缺 delete/retention、可长期锁住 Artifact quota（§7.111），Provider model discovery 的 response-size 限制在全量缓冲后才检查（§7.112），Plugin 成功 upgrade 后旧 immutable version 无 owner 仍永久留盘（§7.113），Plugin upgrade 在 quiesce 前 capture AppStorage、可静默覆盖并发写（§7.114），Host durable event 的内存 wake 丢失后在线订阅不会自愈（§7.115），Backend Plugin child→Host protocol limit 在无换行 stdout 下无法约束父进程缓冲（§7.116），Runner journal unknown evidence 无 retention（§7.118）、builtin Toolchain command-scoped download cache 缺 owner 自动回收（§7.119），Runner admin pack install/uninstall 缺资源级串行化（§7.120），ACP WebSocket→child stdin 缺 aggregate backpressure（§7.121），Runner Plugin generation HOME 没有 cleanup owner（§7.122），Workspace Job output 在执行/wire/journal 三层上限不一致（§7.123），Workspace lifecycle durable postcondition 与 command unknown 缺权威重同步（§7.125）、JobRunner byte-budget 截断破坏 UTF-8（§7.126），Runner Toolchain install crash 可留下无 owner `.staging` 大树（§7.127），Runner `/storage` Workspace collection 与 Backend decoder 上限不一致（§7.128），corrupt Runner journal 在 supervisor restart loop 中会重复复制 forensic evidence、持续放大磁盘占用（§7.129），Runner terminal journal 写失败会把已成功副作用反写成 failed（§7.130），Project Instructions omission producer/decoder 上限不一致（§7.131），Workspace provision failure 会把 Runner owner 永久留在 creating、官方 cleanup 持续 skip（§7.132），Runner catalog 合法最大 collection 会被 Backend 独立 1MB transport cap 提前拒绝（§7.133），Backend Plugin async line handler 可把 malformed protocol 升级成主进程 unhandled rejection（§7.134），以及 Host→Plugin child response path 缺 aggregate backpressure（§7.135）；继续覆盖后续增量提交到当前 HEAD `97560f1` 后，又确认默认模型 optimistic identity 丢 Provider（§7.136）、`a6371f9` 重新打开 Launcher 长按拖动闭环（§7.137）、Provider“导入全部”与 100-model hard cap 分叉（§7.138）、Settings `?tab=` 与 KeepAlive 路由状态脱节（§7.142）、隐藏 Settings 分组取消 lazy mount 后提前发起网络请求/错误（§7.143）、Agent tab 的 `aria-controls` 目标被重构删除（§7.144）、Settings ARIA tab 键盘模型历史缺口（§7.145）、`a6371f9` 用 dummy i18n literal 绕过 §7.40 dead-key 门禁（§7.146）；`97560f1` 又确认 MCP 时间单位回归（§7.147）、子组件提前宣告 async 保存成功（§7.148）、Browser/ACP/MCP 既有配置编辑入口被移除（§7.149）、Plugin catalog 分组 provenance 错配（§7.150）、ACP command-string tokenizer 静默改写 argv（§7.151）；最终反向复核又确认移动端 Settings 总览副标题误接 Agent 文案（§7.152）与非默认 Provider 抽屉泄漏全局默认模型（§7.153）。因此任何早期“只剩 N 条开放项”的描述都只是当时快照；**当前新增开放项为 §7.133–§7.153；§7.80 / §7.124 明确标为排除项，§7.53–§7.79 / §7.81–§7.132 已修复**。`97560f1` 落地后一度 clean，但收尾审计期间工作树又出现并行的未提交 Settings UI 施工；本轮所有增量结论均重新以 committed HEAD `97560f1` / 对应 commit diff 取证，未把 dirty 状态归因到 commit。

复查规模（行数统计）：

| 区域                            | 规模                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------- |
| Backend `modules/agent`         | ~39,900 行 / 187 个文件                                                          |
| Backend `infrastructure/agent`  | ~23,800 行 / 77 个文件                                                           |
| Backend `interfaces/http/agent` | 3,348 行 / 约 128 处路由声明                                                     |
| Frontend `features/agent`       | ~28,600 行 / 70 个文件                                                           |
| `packages/agent-runner`         | ~7,900 行 / 27 个文件                                                            |
| 后端 Agent scenarios            | `runner.ts` 258 行编排器 + 71 个独立 `*.scenario.ts` 文件（2026-09-22 收尾复核） |

---

## 0. 结论速览

按「影响正确性/可直接复现」→「设计明显不合理」→「优化项」排序：

| 级别                                      | 问题                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 关键位置                                                                                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0 · ✅ 已关闭 2026-09-23**             | 设计 token 已补齐并接入 Tailwind：`--color-card / border-hover / primary-hover / warning-foreground` 均有真实规则；CDP `.bg-card` 计算背景为 `rgba(246,247,249,.92)`                                                                                                                                                                                                                                                                                                                                                                                                             | `app/styles/tokens.css`（见 §1.1）                                                                                                                   |
| **P0 · ✅ 已关闭 2026-09-23**             | `agent.ui.saveFailed` 已补齐 en-US / ja-JP / zh-CN 且保存失败路径真实引用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `settings/ModelProviderSettings.vue`、`i18n/*.json`（见 §1.2）                                                                                       |
| **P0 · ✅ 已关闭 2026-09-23**             | Agent Hub 模态边界已闭环：打开聚焦 Hub、背景 `#app.inert=true`、Tab/Shift+Tab 限制在 Hub 与 Hub-owned portal、Escape 关闭、关闭后焦点回 Launcher                                                                                                                                                                                                                                                                                                                                                                                                                                 | `host/AgentHubWindow.vue`（CDP 复验见 §7.13-c）                                                                                                      |
| **P0 · ✅ 已关闭 2026-09-23**             | 玻璃层已固化为唯一 `.glass-surface`：token-based 半透明 fill + blur(16px) + 弱边框/阴影；Gallery CDP 实测 alpha≈0.7544                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `app/styles/global.css`、`foundation/ui/UiPopover.vue`（见 §7.1）                                                                                    |
| **P1 · ✅ 已关闭 2026-09-23**             | **默认模型选择框「文字背景 ≠ 框背景」已关闭**：`UiCombobox` 输入框不再被全局未分层表单规则涂成纯白，trigger / panel / 输入区共用同一 glass fill                                                                                                                                                                                                                                                                                                                                                                                                                                  | `foundation/ui/uiGen2.css`（见 §7.18）                                                                                                               |
| **✅ 已确认保留模态 2026-09-23**          | 「模态遮罩 + 浮动窗口」经产品确认是**有意设计**（背景不可交互，避免两边操作冲突；使用 Hub 时不需要同时看终端）；遮罩点击已收敛为真正 no-op，不再有 400ms「闪烁」                                                                                                                                                                                                                                                                                                                                                                                                                 | `host/AgentHubWindow.vue`（见 §2.1、§2.2）                                                                                                           |
| **P1 · ✅ 已关闭 2026-09-23**             | **字号：实测推翻了"563 处 ≤11px 不可读"的整体判断**（181 处 ≤9px 里 95 处是图标；默认首屏只有 6 个 <11px 文本节点）。仍按"阅读文本 ≥11px"全量收敛：两轮共 33 文件 / 274 行，现 `<11px` 只剩图标字形与 5 个 14–16px 圆内计数/勾选，无任何阅读文字低于 11px                                                                                                                                                                                                                                                                                                                        | `features/agent/**`（见 §2.3）                                                                                                                       |
| **P1 · ✅ 已关闭 2026-09-23**             | **点击目标：** 关闭 App 标签 `16×16`→`24×24` 常显 + pointer；窄容器纯图标 Run 配置 `25px`→`28px`、字号 `10/10.5px`→`11px`；审批卡按钮追加 `min-h-8`（32px）                                                                                                                                                                                                                                                                                                                                                                                                                      | `host/AgentHubWindow.vue`、`host/AgentAppSurface.vue`、`runtime/ApprovalCard.vue`（见 §2.4）                                                         |
| **P1 · ✅ 已关闭 2026-09-23**             | 调色板类 **182 → 0**：新增 `info` 语义 token，其余收敛到 `success/warning/error/primary`；硬编码阴影 / Hub 窗口阴影 / 遮罩改为从 token 推导。CDP 证明改 theme 变量后计算色跟随                                                                                                                                                                                                                                                                                                                                                                                                   | `app/styles/tokens.css`、`features/appearance/config/default-theme.ts`、`features/agent/**`（见 §2.7）                                               |
| **P1 · ✅ 已关闭 2026-09-23**             | 设置区控件风格分裂**已收口**：按钮档位（主/次/危险/图标四档 Gen2 `UiButton`，`32px / fs12 / r8`，§6.2 批 1/2）、原生 checkbox（27 处 → `UiCheckbox`，§7.20）、原生 `<select>`（22 处 → `UiSelect`，§7.32）、`QuantityInput` 单位命中区（18×20 → 24×24，§7.33）、添加/移除模型行的 11px 纯文字按钮（→ `UiButton` soft+compact，§7.34）全部闭环。**仍开放**：顶部 Tab 仍是 36px（跨页 chrome，按约定本轮不动）                                                                                                                                                                     | `features/agent/settings/**`（见 §6.2、§6.3、§7.20、§7.32–§7.34）                                                                                    |
| **P1 · ✅ 已关闭 2026-09-23**             | 设置区模板与能力清单里的硬编码中文（能力名称/描述、存储、插件、预算、数值单位）已全部接入词典；中英日三语键位对齐                                                                                                                                                                                                                                                                                                                                                                                                                                                                | `features/agent/settings/**`（见 §6.5、§7.14-c）                                                                                                     |
| **P1 · ✅ 已关闭 2026-09-23**             | `bg-card` 族已恢复真实 surface；助手气泡改为有效 `bg-card`，TaskRail/空态卡继续使用已生效的 card token                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `ai/ConversationMessage.vue`、`ai/AgentConversation.vue`、`runtime/TaskRail.vue`                                                                     |
| **P1 · ✅ 已关闭 2026-09-23**             | Composer 改为自身 container query + 单行 compact；560px Hub CDP 实测 controls `462/462`，无静默裁切，思考等级优先靠前                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`（见 §7.3）                                                                                    |
| **P1 · ✅ 已关闭 2026-09-23**             | 「回到最新」已移到 Composer 上方状态行右侧；token 状态同排左侧，仅真实 token>0 时显示                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ai/AgentConversation.vue`（见 §7.4）                                                                                                                |
| **P1 · ✅ 已关闭 2026-09-23**             | 主界面三层 chrome 压扁消息区：`MIN_HEIGHT` 380 → 480，并在矮窗口下把 composer 压成两行；CDP 实测最小高度时会话区 **94 → 227px**（§7.2 列宽 / 体感已复核，见 §7.2-b、§7.2-f；停靠态折叠闪烁见 §7.2-g）                                                                                                                                                                                                                                                                                                                                                                            | `host/window-manager.ts`、`host/AgentHubWindow.vue`、`ai/AgentConversation.vue`（见 §7.2-a）                                                         |
| **P2 · ✅ 已关闭 2026-09-23**             | Agent 内无效 spacing utility 已清零；`py-0.2 / py-0.8 / py-1.8` 当前源码扫描残留 0                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `features/agent/**`（见 §7.8）                                                                                                                       |
| **P1 · ✅ 已关闭 2026-09-23**             | 多处「不可发现 / 与产品整体不一致」的交互**已全部闭环**：会话列表 Ctrl+滚轮缩放（§7.13-d 面板化 + 重置）、任务栏卡片拖拽排序（§7.14-b 独立把手 + 方向键 + 恢复默认顺序）、Launcher 6px 阈值拖拽（§7.38 长按拖动 + 重置位置）、虚拟列表固定行高（§7.38 探针行实测）；§2.6 的空态轮播此前已关闭                                                                                                                                                                                                                                                                                    | `host/AgentThreadSidebar.vue:132-146`、`runtime/TaskRail.vue:107-160`（见 §2.8 / §7.38）                                                             |
| **P1 · ✅ 已关闭 2026-09-23**             | Composer 的 Send / Cancel Run 已拆成两个独立按钮（停止按钮图标-only + 错误色，运行中才出现）；`sendHint` 已渲染；空草稿按 Enter 不再误取消 Run                                                                                                                                                                                                                                                                                                                                                                                                                                   | `ai/AgentConversation.vue`（见 §2.5）                                                                                                                |
| **P1 · ✅ 已关闭 2026-09-22**             | **切换 App / Files 不再卸载 Agent surface，断线也不再清空已展示 partial text**：Hub 使用持续存在的 `<KeepAlive>`，真正结束 Run / 切线程 / 停止订阅时才清理 streaming presentation                                                                                                                                                                                                                                                                                                                                                                                                | `host/AgentHubWindow.vue`、`host/AgentAppSurface.vue`（见 §1.7）                                                                                     |
| **P1 · ✅ 已关闭 2026-09-22**             | **Nexus 前后端真实 transport contract 已统一到 `packages/protocol`**：HTTP / Workspace WS / Agent HTTP / Agent event WS / Agent terminal WS 均由 canonical DTO/event contract 单一来源约束，并已接入 transport architecture guard；当前 HEAD 收尾复核再次通过 guard、Agent ESLint、Backend/Agent Runner typecheck、Frontend `vue-tsc + vite build` 与 Agent scenario suite **71/71**                                                                                                                                                                                             | `packages/protocol/**`、`scripts/check-transport-contract-boundaries.mjs`（见 §3.2）                                                                 |
| **P1 · ✅ 已关闭 2026-09-22**             | **Agent scenario runner 已模块化并支持受控并发**：`runner.ts` 从 22k+ 行降至 258 行，当前 71 个独立 scenario 文件；默认按批次并发、仅显式 `SERIAL_SCENARIOS` 保持串行；当前扫描未发现通过 `readFileSync` 读取 `packages/*/src` 做 source-shape 架构断言                                                                                                                                                                                                                                                                                                                          | `tests/backend/agent-scenarios/**`（见 §3.6）                                                                                                        |
| **P2 · ✅ 已关闭 2026-09-23**             | 274/1148（约 24%）i18n key 已无引用，且三种语言各存一份 → **升级成常驻门禁并清零**：`scripts/check-agent-i18n.mjs` 新增"key 可达性"守卫（字面量 / 模板拼接前缀 / 后端构造的投影 key 都算可达），三语字典 1,467 → 1,392 个叶子 key，删除 75×3 条不可达文案；CDP 走完 20 个设置分区 0 处原始 key、0 条 intlify 告警（见 §3.5 / §7.40）                                                                                                                                                                                                                                             | `features/agent/i18n/*.json`                                                                                                                         |
| **P2 · ✅ 基础门禁已关闭 2026-09-22**     | **Agent review 范围已接入 ESLint flat config**：`no-unused-vars` + Vue `v-if/v-for` 规则成为 error；首跑发现并清理 47 个真实 unused 符号。自定义 i18n / 设计 token 规则仍开放                                                                                                                                                                                                                                                                                                                                                                                                    | `eslint.config.mjs`、`package.json` scripts                                                                                                          |
| **P2 · ⏸ 已评估 · 按约定延后 2026-09-23** | 巨型文件问题**仍主要集中在 UI**（2026-09-23 复核：UI TOP 为 `AgentAppSurface.vue` 2,915 / `ModelProviderSettings.vue` 2,201 / `AgentSettingsPanel.vue` 1,447；非 UI owner 均已拆完。**本轮不拆**：该条已无隐藏的用户可见缺陷，而按职责拆需要搬迁约 30 props + 15 emit，正确验收依赖 Provider CRUD 与 Run 详情两条主路径的逐控件回归，本环境 `runner_not_configured` 无法覆盖 ⇒ 风险高于收益）；非 UI owner 已完成一轮拆分：`agent-api.ts` 791 行、`runner-http.adapter.ts` 770 行、`native-agent-backend.ts` 722 行，原 1k+ 行 state-commit 聚合文件已拆为细分 transition owners | 见 §3.1                                                                                                                                              |
| **P2 · ✅ 已关闭 2026-09-23**             | 工具结果摘要为英文硬编码，直接展示在中文/日文 UI 里 → **「模型可见证据 / 用户可见摘要」拆分**：`ToolResult.userSummary` 在 `projectToolResult` 被剥离（模型侧零变化），ledger payload 旁路携带，`ConversationMessage.vue` 优先渲染、缺失回退原 `summary`（历史数据零迁移）；`tools/host/**` 16 文件 52 处 + 4 条 state-commit 失败摘要全部接入，三语 `toolSummary.*`（72 句 + 39 标签）齐平；CDP 双语言实测通过                                                                                                                                                                  | `modules/agent/tools/host/*.ts`（见 §1.8 / §7.39）                                                                                                   |
| **P1 · ✅ 已关闭 2026-09-22**             | **历史 Run 的 `GET /runs/:id/approvals` 稳定 500（`AGENT_DURABLE_STATE_INVALID`）**：已由 migration #45 将 legacy `inspection_json.target.kind = "machine"` 规范化为 canonical SSH target；真实数据库副本验证 26 条 legacy tool call → 0、25 条受影响 approval 全部可解码                                                                                                                                                                                                                                                                                                        | `sqlite-migrations.ts` migration #45、`tests/backend/agent-scenarios/runner.ts`（见 §1.9）                                                           |
| **P0 · ✅ 已关闭 2026-09-23**             | 全局 form font/cursor reset 已移入 `@layer base`；CDP 设置页 `text-xs` 按钮均恢复为 12px（旧实测为 16px）                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `app/styles/global.css:27-46`（见 §7.10）                                                                                                            |
| **P1 · ✅ 已关闭 2026-09-23**             | 设置区「Agent」页在英文界面下的硬编码中文：三个子页可见中文文本节点 **29 → 0**（数值+单位改由 `use-quantity-labels` 注入）                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `features/agent/settings/**`（见 §6.5、§7.11、§7.14-c）                                                                                              |
| **P1 · ✅ 已关闭 2026-09-23**             | 备用模型链已改为 `1..N` 有序列表 + 上移/下移/移除；Add 使用可搜索 Gen2 `UiPopover`，排除默认/已选并限制最多 8 项                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `settings/ModelProviderSettings.vue`（见 §7.11）                                                                                                     |
| **P1 · ✅ 已关闭 2026-09-23**             | 设置区按钮规格已收敛到四档：主操作 `solid/primary`、次操作 `soft/neutral`、危险 `soft/danger`、图标 `ghost/icon-only(28×28)`；实测动作按钮统一 `×32 fs12 r8`，禁用态为中性填充（旧值：`添加 Provider` 144×38 fs16、`立即更新` 77×28 fs11 r6、`模型与测试` 117×26、`添加配置档` 86×34 r6）                                                                                                                                                                                                                                                                                        | 见 §7.11                                                                                                                                             |
| **P2 · ✅ 已关闭 2026-09-23**             | 空态 pager 命中区 **12×16 / 20×16 → 28×32 / 36×32**：透明伪元素外扩，可视圆点与布局不变；每个圆点独占互不重叠的命中格                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `ai/AgentConversation.vue:472-486`（实测见 §7.12）                                                                                                   |
| **P1 · ✅ 已关闭 2026-09-23**             | 弹层已改为优先按 Hub 窗口 clamp，并限制 maxWidth/maxHeight、跟随 Hub resize；560px Hub 下附件弹层实测四边均在窗口内                                                                                                                                                                                                                                                                                                                                                                                                                                                              | `files/AgentConfigPopover.vue`、`host/AgentAppSwitcher.vue`（见 §7.13-a）                                                                            |
| **P0 · ✅ 已关闭 2026-09-23**             | Hub 键盘模态边界已修复并 CDP 复验：初始焦点进入 Hub、背景 inert、连续 35 次 Tab 0 次逃逸、Escape 关闭且焦点回 Launcher                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `host/AgentHubWindow.vue`（见 §7.13-c）                                                                                                              |
| **P2 · ✅ 已关闭 2026-09-23**             | 会话列表缩放（Ctrl+滚轮）现在有可见入口与重置：侧栏头部 `100%` 胶囊（点击展开 放大/缩小/重置为 100%，含边界禁用）；缩放系数改由根节点 `--agent-thread-scale` 驱动，内联 `font-size` 归零                                                                                                                                                                                                                                                                                                                                                                                         | `host/AgentThreadSidebar.vue:64/127/310`（见 §7.13-d）                                                                                               |
| **P0 · ✅ 核心缺陷已关闭 2026-09-22**     | **Run 详情不再被单个辅助接口失败整体阻断**：`getRun` 成功即打开详情；checkpoints / approvals / subagents 独立 settled 回填，失败项仍走现有错误横幅。分区重试与错误本地化仍作为 UI 子项开放                                                                                                                                                                                                                                                                                                                                                                                       | `host/AgentAppSurface.vue`（见 §1.10）                                                                                                               |
| **P0 · ✅ 已关闭 2026-09-23**             | **Composer 裁切已关闭**：container query 改为 composer 自身，工具条保持单行；560px Hub 实测 controls clientWidth=scrollWidth，无静默裁切                                                                                                                                                                                                                                                                                                                                                                                                                                         | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`（见 §7.14-a）                                                                                 |
| **P1 · ✅ 已关闭 2026-09-23**             | 任务栏 6 个「拖动排序」把手补上键盘路径：↑/↓ 与相邻可见卡片交换（`aria-keyshortcuts` + `title`），焦点跟随卡片                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `runtime/TaskRail.vue`（见 §7.14-b）                                                                                                                 |
| **P2 · ✅ 已关闭 2026-09-23**             | 任务栏：目标卡改用连接名（ID 退到 `title`）、Run 历史改为 8 条起步 + 「显示更早的 Run」增量展开、卡片顺序新增「重置卡片顺序」入口（顺序一致时隐藏）                                                                                                                                                                                                                                                                                                                                                                                                                              | `runtime/TaskRail.vue`（见 §7.14-b）                                                                                                                 |
| **P2 · ✅ 已关闭 2026-09-23**             | 审批卡：`risk` 枚举已本地化（新增 `agent.approvals.risk.*`）；「`审批状态：approved`」由 §1.4/§7.15-a 关闭（`status` 映射）；「剩余 300s」改为 `agent.approvals.expiresIn`（中/日文为「300 秒」）；「批准」按钮由 `bg-warning text-black` 改成品牌主色 `bg-primary text-white`                                                                                                                                                                                                                                                                                                   | `runtime/ApprovalCard.vue`（见 §7.14-b）                                                                                                             |
| **P1 · ✅ 已关闭 2026-09-23**             | Hub 窗口几何补上键盘路径（标题栏/缩放热区方向键 16px、Shift 64px，`aria-keyshortcuts` + `tabindex`），并新增全局 `prefers-reduced-motion` 基线（未分层），Hub 内 60 个带过渡的元素降级为 0                                                                                                                                                                                                                                                                                                                                                                                       | `host/AgentHubWindow.vue`、`app/styles/global.css`（见 §2.10）                                                                                       |
| **P1 · ✅ 已关闭 2026-09-23**             | 前端 agent 区非注释硬编码中文 **116 行 → 0**：能力清单、会话用量、错误解释、存储/插件/预算文案全部走词典（中英日三语）                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `features/agent/**`（见 §7.14-c）                                                                                                                    |
| **P1 · ✅ 已关闭 2026-09-23**             | `zh-CN` 词典与 en-US 完全相同的 key 由 35 → 22、整句英文由 15 → 5（`ja` 49 → 31 / 20 → 5），剩 5 条是品牌与协议名（白名单）；枚举不再插进本地化句子（`审批状态：approved` / `当前状态：enabled` 走 `status` / `stateLabels` 映射）；新增 `pnpm lint:agent-i18n` 防回归                                                                                                                                                                                                                                                                                                           | `i18n/zh-CN.json`、`ApprovalCard.vue`、`AgentFeatureSettings.vue`（见 §7.15-a）                                                                      |
| **P1 · ✅ 已关闭 2026-09-23**             | 未本地化枚举/内部标识：Subagent 状态与失败模式、审批 `risk`、Workspace 命令 `action`/`status` 全部改为查表（新增 `agent.subagents.status/failureMode`、`agent.approvals.risk`、`workspaceRuntime.commandAction/commandState`）；原始值只保留在折叠的「规范化操作」调试区                                                                                                                                                                                                                                                                                                         | `runtime/SubagentCard.vue`、`runtime/ApprovalCard.vue`、`settings/WorkspaceRuntimeSettings.vue`（见 §1.4）                                           |
| **P2 · ✅ 已关闭 2026-09-23**             | 设置区「运行与环境」页实测 **3825px 高、8 个独立「保存」按钮**且多为禁用态、无粘性分区导航 → 粘性分区导航与嵌套框收口（§7.25，3423px）、保存按钮按 dirty 分级（§7.31，无改动时降级为禁用 + 原因 `title`）、面板头摘要与信息密度收口（§7.29 / §7.30）                                                                                                                                                                                                                                                                                                                             | `settings/**`（见 §7.15-c）                                                                                                                          |
| **P2 · ✅ 已关闭 2026-09-23**             | 设置区空态是左对齐一行纯文本（`尚未配置 MCP Integration。`）→ 新增 Gen2 `UiEmptyState` 并在设置区 10 处接入（图标 + 标题 + 说明 + 可选动作，`dense` 档实测 950×38、卡片档 950×143，见 §7.28）                                                                                                                                                                                                                                                                                                                                                                                    | `settings/McpIntegrationSettings.vue` 等（见 §7.15-d）                                                                                               |
| **P1 · ✅ 已关闭 2026-09-23**             | 设置区不再把后端原始原因码当"不可用原因"渲染：已知码（`runner_not_configured` / `runner_unavailable` / `runtime_not_configured`）映射成中/英/日文说明，未知码退回通用说明并把原始值放进 `title` 与「后端原因代码」行                                                                                                                                                                                                                                                                                                                                                             | `settings/WorkspaceRuntimeSettings.vue`（见 §7.15-b）                                                                                                |
| **P2 · ✅ 已关闭 2026-09-23**             | 禁用态主按钮**已改为中性填充**（§6.2 批 1/2：`保存` / `预览导入` / `卸载` 等实测 `bg rgb(243,244,246)` + 中性描边，不再是品牌色 × 0.5）；**已补**：11 个稳态禁用按钮全部带原因 `title`（没有未保存的修改 / 没有待预览的改动 / 请先填写必填项 / 请先选择来源与目标 / 请先填写仓库地址，三语齐全）                                                                                                                                                                                                                                                                                 | `features/agent/settings/**`（实测见 §7.13-e）                                                                                                       |
| **P1 · ✅ 已关闭 2026-09-23**             | Composer 配置弹层（模型 / 思考强度）**首帧位置错乱**：定位时面板仍是占位尺寸（`max-width:0`/`max-height:300`），首帧算到 `(470,472)` 等错位值、下一帧才跳到 `(426,667.5)`（上偏 195px）→ 改为测量前解除占位上限 + 未定位不绘制；App 切换器同源一并修（见 §7.26）                                                                                                                                                                                                                                                                                                                 | `files/AgentConfigPopover.vue`、`host/AgentAppSwitcher.vue`（见 §7.26）                                                                              |
| **P1 · ✅ 已关闭 2026-09-23**             | Agent 设置区**嵌套框 3~4 层**：叶子控件往上数有 3 层带边框的祖先（面板卡 → 模块卡 → 模块内分组框）→ 收到 **1 层**（只留分组卡），模块间改用细分隔线、模块内分组框降级为无边框 inset；同轮把分组导航改成**粘性**（滚 807px 后停 y=0），`运行与环境` 全页 3625 → 3423px（见 §7.25）                                                                                                                                                                                                                                                                                                | `settings/AgentSettingsPanel.vue` + 14 个 `*Settings.vue`（见 §7.25）                                                                                |
| **P1 · ✅ 已关闭 2026-09-23**             | Agent 的界面与设置里**提示性文字过多**：新增通用 `UiInfoHint`（`ⓘ`/`⚠` 悬浮说明），设置区 16 张卡的长句已全部收起 —— CDP 三组分区实测可见说明 **2145 → 1209 字（-43.6%）**，`ⓘ` 由 1 个增至 16 个；Hub 侧实测常驻版面已无长句，仅补了 2 处弹层头部说明                                                                                                                                                                                                                                                                                                                           | `foundation/ui/UiInfoHint.vue`、`features/agent/settings/**`（见 §7.24）                                                                             |
| **P2 · ✅ 已关闭 2026-09-23**             | 主操作（Composer 发送按钮）禁用态从「品牌色 + `opacity .2`」改为「中性填充 + 保留描边 + `opacity .5` + `title` 说明原因」，并把全仓禁用态不透明度收敛到单一值 `0.5`（原 20/25/35/40/45 五种）                                                                                                                                                                                                                                                                                                                                                                                    | `ai/AgentConversation.vue` 等 9 个文件（见 §7.17-c）                                                                                                 |
| **P1 · ✅ 已关闭 2026-09-23**             | 图标颜色：未分层的 `i/.fas/.far/.fab { color: var(--icon-color) }` 压过 `@layer utilities`，132 个带 `text-primary/success/warning/error/foreground` 的图标一律渲染成 `#666`（`!text-white` 是既有绕过写法）                                                                                                                                                                                                                                                                                                                                                                     | `app/styles/global.css:91-110`（见 §7.19）                                                                                                           |
| **P1 · ✅ 已关闭 2026-09-23**             | 空态便当卡自动轮播已可中断：悬停/焦点暂停、手动分页后固定、`prefers-reduced-motion` 时彻底不轮播（hover 位移与脉冲也一起关掉）                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `ai/AgentConversation.vue`（见 §2.6）                                                                                                                |
| **P1 · ✅ 已关闭 2026-09-23**             | **Agent 设置区「17 个模块一条长流」的布局**：宽屏新增常驻左栏分区导航（3 分组 + 17 锚点，粘在全局顶栏下），点击跳转 + 滚动联动高亮；窄屏保留顶部胶囊。跨分组跳转落点误差 0px（修复前实停 1766 / 目标 2352）                                                                                                                                                                                                                                                                                                                                                                      | `settings/AgentSettingsPanel.vue`（见 §7.27）                                                                                                        |
| **P2 · ✅ 已关闭 2026-09-23**             | **设置区空态与主界面两套语言**：新增 Gen2 `UiEmptyState`（`dense` / 卡片两档），设置区 10 处空态统一（7 处行内 `950×38` + 3 处卡片 `950×143`）；`foundation/ui` 里首次有可复用的空态原语                                                                                                                                                                                                                                                                                                                                                                                         | `foundation/ui/UiEmptyState.vue`、`features/agent/settings/**`（见 §7.28）                                                                           |
| **P2 · ✅ 已关闭 2026-09-23**             | 设置区面板头部三块摘要（默认模型 / 活跃 App / 沙箱）是「标签: 数值」小方块，读起来像调试输出：改为图标 + 标签/数值两行的无框统计（实测 3 项同行 `337×29`，414px 下折成两行仍 `337×29` 单行不换行溢出）                                                                                                                                                                                                                                                                                                                                                                           | `settings/AgentSettingsPanel.vue`（见 §7.29）                                                                                                        |
| **P2 · ✅ 已关闭 2026-09-23**             | **设置区 8 处独立「保存」按钮语义分级**（§7.15-c 收口）：原本 8 处全写死浅紫实心主按钮、无变更时只是 disabled， 现统一为「有未保存变更 → `solid`+`primary`；无变更 → `soft`+`neutral`+`disabled`+原因 `title`」， 并给 Browser / ACP / Subagent 三处**原本没有 dirty 概念**的按钮补上快照比对（实测 8 处全 `rgb(243,244,246)`， 改一个值后仅该模块转 `rgb(160,108,213)` 可用）                                                                                                                                                                                                   | `features/agent/settings/**`（见 §7.31）                                                                                                             |
| **P1 · ✅ 已关闭 2026-09-23**             | **设置区 22 处原生 `<select>` 收敛到 Gen2 `UiSelect`**：原先 4 种规格并存（`h-6 text-[11px]` … `h-9 text-xs`）且展开是浏览器原生下拉， 现全部走 Reka listbox（玻璃面板 `z-index:85` / `blur(6px)`）；`UiSelect` 的 v-model 收窄为「可空进、非空出」， 新增 `NONE_OPTION` 哨兵（4 处「不选择」项）与 `pickOption()`（8 个窄联合字段）， CDP 实测三组共 10 处可见、残留原生 0、414px 无横向溢出，e2e 的 `selectOption` 断言同步改为 listbox 交互                                                                                                                                   | `features/agent/settings/**`、`foundation/ui/UiSelect.vue`、`tests/e2e/specs/agent/host.spec.ts`（见 §7.32）                                         |
| **P1 · ✅ 已关闭 2026-09-23**             | **`QuantityInput` 单位药丸命中区 `18×20` → `24×24`**：高度 `h-5` → `h-6` 并补 `min-w-6`， 输入框预留内边距 `pr-20` → `pr-24`（字节型有 3 枚药丸，旧值已压到边）；实测 10 枚药丸全部 `24×24`                                                                                                                                                                                                                                                                                                                                                                                      | `features/agent/settings/QuantityInput.vue`（见 §7.33）                                                                                              |
| **P1 · ✅ 已关闭 2026-09-23**             | **模型列表的「取消添加 / 一键取消」收敛 + 补确认**（§6.3 / §6.7 收口）：11px 裸文字按钮 → Gen2 `UiButton` （`soft` + `compact`，可移除 `danger` / 不可移除 `neutral` + 原因 `title`，实测 11 个 `85×28`）；批量移除改为先弹确认 （实测文案含「将移除 newapi 下 10 个可移除模型；默认主力模型或首个基础模型会保留。」）。至此 §6.2 控件清单只剩跨页 chrome 的顶部 Tab 36px（按约定不动）                                                                                                                                                                                          | `settings/ModelProviderSettings.vue`（见 §7.34）                                                                                                     |
| **P2 · ✅ 已关闭 2026-09-23**             | **Workspace 运行时 5 处原生 `<select>` 同批收敛**（§7.32 遗留）：空值语义用 `NONE_OPTION` 承载， 工具版本项跟随 `pinnedVersion()` 条件展开；收敛后 `features/agent/**` 原生 `<select>` 计数 **0** （该批只有模板编译 + `vue-tsc`，环境 `runner_not_configured` 导致卡片不渲染，已显式记录）                                                                                                                                                                                                                                                                                      | `features/agent/runtime/Workspace{Create,Toolchain,ArtifactTransfer}*.vue`（见 §7.35）                                                               |
| **P1 · ✅ 已关闭 2026-09-23**             | **TaskRail「最近事实」不再默认 dump JSON**（§2.9 收口）：改成一行一个字段的 `dl` 投影（长值截断 120 字符）， 原始 payload 折进二级 `<details>`（新增 `agent.tasks.rawPayload`）；本环境没有可打开的 Run 详情， 故只有模板编译 + `vue-tsc` 验证 + 「`JSON.stringify(entry.payload` 仅存在于二级折叠内」的静态确认                                                                                                                                                                                                                                                                 | `features/agent/runtime/TaskRail.vue`（见 §7.36）                                                                                                    |
| **P1 · ✅ 已关闭 2026-09-23**             | **设置区模块标题带的斑马纹与动作簇拥挤**：16 条 `bg-header/40` 灰底标题带统一去底色（`990×64` 实测）， 标题与动作簇 `gap` 12 → `12px 16px`、工具条 `gap-1.5` → `gap-2.5`；414px 下动作簇由右对齐改为整行下移左对齐 （末位控件距右缘 20 → 248px），同轮修掉插件仓库输入框 `min-w` 硬撑导致的窄屏横向溢出                                                                                                                                                                                                                                                                          | `settings/AgentSettingsPanel.vue`、`ModelProviderSettings.vue`、`PluginManagementSettings.vue`（见 §7.30）                                           |
| **P1 · ✅ 已关闭 2026-09-23**             | **设置区粘性分组导航此前形同失效**：`sticky top-0` 恰好落在 56px 全局顶栏之下（z-30 盖住 z-20），滚起来就被吞掉；现已对齐 `top-14`，并让导航条压在自带 `z-20` 的模块之上（`z-index: 29`），移动端不再被内容穿透                                                                                                                                                                                                                                                                                                                                                                  | `settings/AgentSettingsPanel.vue`（见 §7.27）                                                                                                        |
| **P1 · ✅ 已关闭 2026-09-23**             | **`v-show` 在 Agent 设置面板上完全失效**：SFC 是 `section + BaseModal` 双根，父级 `v-show` 落到「非元素根」被 Vue 忽略——切到「工作区」等其它 Tab 后，整块 Agent 设置仍留在页面下方（实测 top 1852 / 高 1584）；已包一层无样式 div 收成单根                                                                                                                                                                                                                                                                                                                                       | `settings/AgentSettingsPanel.vue`（见 §7.27）                                                                                                        |
| **P2 · ✅ 已关闭 2026-09-23**             | `AppManagementSettings.vue` 用了 `<UiInfoHint>` 却漏 import，被当成未知元素渲染（`agent.settings.apps.description` 提示整条丢失 + Vue 运行时警告）；已补 import，实测 `data-ui="info-hint"` 正常输出                                                                                                                                                                                                                                                                                                                                                                             | `settings/AppManagementSettings.vue`（见 §7.27）                                                                                                     |
| **P1 · 🟠 开放 2026-09-23**               | **错误横幅仍有一条写路径直接重放原 mutation**：`createThread()` 失败后把「重试」绑定回同一个 `POST /threads`；该接口只有 CSRF header、没有 caller-stable `Idempotency-Key`，后端又为每次请求生成新 UUID。若服务端已提交但响应丢失，用户点击「重试」会创建第二条会话，和 §7.37 声明的“写失败只重新同步、不重放”不一致。                                                                                                                                                                                                                                                           | `host/AgentAppSurface.vue:902-916`、`api/agent-api.ts:364-374`（见 §7.41）                                                                           |
| **P2 · 🟠 开放 2026-09-23**               | **侧栏 / TaskRail 的“按用户持久化”在账号切换时会串状态**：`30fa0ed` 把 `threadSidebarVisible` / `taskRailVisible` 写入每用户 localStorage，但 `agentWindowManager.reset()` 没重置这两个字段；登出 A 后若 B 没有已存布局，`restoreForUser(B)` 直接返回，B 会继承 A 的内存开关状态。                                                                                                                                                                                                                                                                                               | `host/window-manager.ts:161-218,258-268`、`host/AgentSurfaceHost.vue:191-211`（见 §7.42）                                                            |
| **P2 · 🟠 开放 2026-09-23**               | **两类 UI 偏好仍跨账号共用**：TaskRail 顺序和线程列表缩放都使用全局 localStorage key；已有“重置”入口但没有 user scope，同一浏览器换账号会继承上一账号偏好。                                                                                                                                                                                                                                                                                                                                                                                                                      | `runtime/TaskRail.vue`、`host/AgentThreadSidebar.vue`（见 §7.43）                                                                                    |
| **P1 · 🟠 开放 2026-09-23**               | **命中区 floor 未完全收口**：Hub resize 仍 16×16；插件仓库删除和 AppSwitcher 关闭仍 20×20。pager 的透明伪元素命中区仍正常，不在本条。                                                                                                                                                                                                                                                                                                                                                                                                                                            | `host/AgentHubWindow.vue`、`settings/PluginManagementSettings.vue`、`host/AgentAppSwitcher.vue`（见 §7.44）                                          |
| **P2 · 🟠 开放 2026-09-23**               | **AppExecutionPolicy dirty-state 有 false positive**：对象 overrides 用 `JSON.stringify` 比较，关闭再恢复同一个 override 会改变 key 插入顺序，即使值完全一致也被判 dirty。                                                                                                                                                                                                                                                                                                                                                                                                       | `settings/AppExecutionPolicySettings.vue`（见 §7.45）                                                                                                |
| **P1 · 🟠 开放 2026-09-23**               | **4 条 state-commit 工具失败摘要的 `userSummary` 层级错误**：被 stringify 进模型 `payload.text`，UI sibling 反而为空；用户继续看到英文，模型侧却看到 i18n key。                                                                                                                                                                                                                                                                                                                                                                                                                  | `infrastructure/agent/runtime/state-commit/{approval,input,run}-transitions.ts`（见 §7.46）                                                          |
| **P1 · 🟠 开放 2026-09-23**               | **Run 处于 `cancelling` 时 Send 仍可点击**：前端把 cancelling 算作可追加输入的 nonTerminal，backend 明确返回 `RUN_NOT_ACCEPTING_INPUT`。                                                                                                                                                                                                                                                                                                                                                                                                                                         | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`、backend `input-transitions.ts`（见 §7.47）                                                   |
| **P1 · 🟠 开放 2026-09-23**               | **11px 阅读文字 floor 被后续 commit 回归**：模型选项说明 `modelOptionHint` 当前是 `text-[9px]`；全量非 icon 小文本扫描确认这一处仍在。                                                                                                                                                                                                                                                                                                                                                                                                                                           | `host/AgentAppSurface.vue`（见 §7.48）                                                                                                               |
| **P2 · 🟠 开放 2026-09-23**               | **源码英文 UI literal 仍有漏网**：ACP create/update/delete toast + fallback、Provider 测试 badge 的 `Tools`、App capability target 的 `Workspace` 都绕过 i18n。                                                                                                                                                                                                                                                                                                                                                                                                                  | `settings/AcpRuntimeSettings.vue`、`ModelProviderSettings.vue`、`AppManagementSettings.vue`（见 §7.49）                                              |
| **P2 · 🟠 开放 2026-09-23**               | **Provider / Settings 写后刷新只覆盖同 tab**：跨标签页 BroadcastChannel 只刷新 host summary，不触发另一 tab 的 run configuration；AgentSettingsPanel 自身也不订阅跨 tab 事件，因此 apps/providers/settings/denylist 与 revision/version 全部 stale，后续 Save 还会撞 §7.82 conflict。                                                                                                                                                                                                                                                                                            | `host/AgentSurfaceHost.vue`、`host/agent-host-events.ts`、`settings/AgentSettingsPanel.vue`（见 §7.50）                                              |
| **P2 · 🟠 开放 2026-09-23**               | **Gen2 `foundation/ui/**` 没有正确 ESLint 覆盖**：直接 lint `UiSelect.vue` 会报 TS parsing error；公共组件已进入大量 Agent 主路径，不能继续只靠模板编译 + vue-tsc。                                                                                                                                                                                                                                                                                                                                                                                                              | `eslint.config.mjs`、`packages/frontend/src/foundation/ui/**`（见 §7.51）                                                                            |
| **P1 · ✅ 已修复 2026-09-24**              | **per-App 设置 selector 旧响应跨写对象竞态已关闭**：Execution Policy / Subagent Profiles 现在都捕获 appId + request generation，并把 loaded appId 与 draft/version 绑定；切换 App 后，旧 GET / mutation 响应都不能再覆盖当前 selector 的状态。                                                                                                                                                                                                                                                                                                                          | `settings/AppExecutionPolicySettings.vue`、`SubagentSettings.vue`（见 §7.53）                                                                       |
| **P1 · ✅ 已修复 2026-09-24**              | **共享父状态变化不再静默覆盖其它卡片/其它 App 的未保存 draft**：8 个 settings 卡现在用本地 baseline 判断 dirty，仅在 clean 或远端已等于当前 draft（自己的保存成功）时重同步；App Management 自动 reload grants 遇到 dirty draft 时同时保留旧 policy baseline，避免既丢草稿又绕过 revision 冲突。                                                                                                                                                                                                                                              | `settings/{BudgetContext,Performance,StorageArtifact,HardLimits,BrowserRuntime,AcpRuntime,Subagent,WorkspaceRuntime,AppManagement}*.vue`（见 §7.54） |
| **P1 · ✅ 已修复 2026-09-24**              | **authenticated=true 的 A→B 用户切换已显式 teardown A 的 Agent user scope**：Host 在 attach B 前会持久化 A 布局、失效 summary generation、abort Host stream，并同步清 summary / CSRF / window / surface session，再 restore/refresh B；A 的 module-level draft/thread/model state 不再直接撞到 B。                                                                                                                                                                                                                                                              | `host/AgentSurfaceHost.vue`（见 §7.55；普通 Surface HTTP stale response 继续由 §7.56 处理）                                                           |
| **P1 · ✅ 已修复 2026-09-24**              | **Run configuration / authorization refresh 已做代际仲裁**：configuration 先把两阶段结果完整拉进 locals，只有最新 generation 才一次性 commit；denylist 另用 authorization generation 仲裁 configuration/focus/event 三个 writer；unmount 会失效两类请求，因此未真正 abort 的旧 HTTP completion 也不能再回写 Surface/session。                                                                                                                                                                                                                    | `host/AgentAppSurface.vue`（见 §7.56）                                                                                                               |
| **P2 · ✅ 已修复 2026-09-24**              | **长说明 / 禁用原因已具备键盘与触屏可发现路径**：当前 `UiInfoHint` 已是真实 Reka tooltip，支持 focus + Enter/Space + click/tap；剩余 9 处 disabled reason 已从不可聚焦 button 的 `title` 移到相邻可聚焦 `UiInfoHint`，不再依赖 native title。                                                                                                                                                                                                                                                                                      | `foundation/ui/UiInfoHint.vue`、Agent settings（见 §7.57）                                                                                           |
| **P2 · ✅ 已修复 2026-09-24**              | **机器码不再从这三条 UI 路径直出**：Execution Policy / Subagent 的 load/save 统一走 `formatAgentApiError`，机器码回退到本地化 request-failed 文案；ArtifactPicker 的 10 附件上限改为三语 `agent.attachments.limitReached`。原始 HTTP cause 仍交给 operation feedback / diagnostics。                                                                                                                                                                                                                                                          | `settings/AppExecutionPolicySettings.vue`、`SubagentSettings.vue`、`files/ArtifactPicker.vue`、Agent i18n（见 §7.58）                                |
| **P2 · ✅ 已修复 2026-09-24**              | **Launcher 会随 viewport 重新 clamp，同时保留用户偏好位置**：window-manager 现在分离 preferred launcher position 与当前 render position；Launcher 自身监听 resize，Hub 的 clamp 也同步重算。临时缩窄只保证可见性，重新放宽会从 preferred 恢复原位置；用户在窄屏主动拖动才会更新 preferred。                                                                                                                                                                                                                                                      | `host/window-manager.ts`、`AgentLauncher.vue`（见 §7.59）                                                                                            |
| **P2 · ✅ 已修复 2026-09-24**              | **条件态 icon button / checkbox 已有可访问名，复合 label 结构已拆正**：线程搜索清空与 API Key 显隐补动态本地化 `aria-label`；capability/target/connection 三类 checkbox 复用其可见对象名；Provider credential 与两个 capability 数字字段改为唯一 `id` + 显式 `for`，action button 不再嵌在 label 内。                                                                                                                                                                                                                                              | `host/AgentThreadSidebar.vue`、`settings/{ModelProvider,AppManagement,SafetyNetwork}Settings.vue`、`ModelCapabilityEditor.vue`、Agent i18n（见 §7.60） |
| **P2 · ✅ 已修复 2026-09-24**              | **Artifact 查询已按 query/filter generation 仲裁**：Library 整页 load 捕获完整 filter snapshot 并递增 generation；分页捕获同代 filter + cursor，筛选变化后的旧页不能再 append。Picker 同样按 query snapshot/generation 保护整页与分页；过期请求的 success/error/finally 都不会覆盖新一代状态或提前清除新请求 busy。                                                                                                                                                                                                                           | `files/ArtifactLibraryView.vue`、`ArtifactPicker.vue`（见 §7.61）                                                                                    |
| **P1 · ✅ 已修复 2026-09-24**              | **权威 commit 与后续同步已拆开**：Settings/Provider、Run/Approval/Checkpoint/Thread、Workspace Runtime、Artifact、Plugin 等前端路径在主 mutation 成功后先保留返回态并标记成功，后续 refresh 失败只提示“已保存但后续同步未完成”；Backend Provider/Approval/Host lifecycle/Workspace Artifact/Plugin stage finalization 的 post-commit 失败改为日志/重同步，不再反转已持久化结果。                                                                                                                                                                                                     | `settings/AgentSettingsPanel.vue`、`host/AgentAppSurface.vue`、Workspace Runtime、backend Provider/Checkpoint services（见 §7.62）                   |
| **P2 · ✅ 已修复 2026-09-24**              | **MCP / ACP Integration 已跟随 `agentAvailable` 生命周期重同步**：两个组件用 immediate watch 在可用时自动加载、不可用时立即清空；每次 load 都递增 generation，旧请求不能跨 availability/manual refresh 回写。MCP mutation 全面受 unavailable 禁用；ACP 仅对 Integration 区使用 `integrationDisabled`，Profile 设置保持原独立可编辑语义。                                                                                                                                                                                                                                                                                                                           | `settings/McpIntegrationSettings.vue`、`AcpRuntimeSettings.vue`（见 §7.63）                                                                          |
| **P1 · ✅ 已修复 2026-09-24**              | **Memory 权威刷新改为 baseline-aware merge，并保留有效导入选择**：clean candidate 随服务器更新；dirty draft 保留，若远端同时变化则显示 conflict 并允许显式“使用最新版本”。source refresh 不再预清 selection/preview；只有 source App 真切换、所选 Memory 消失/过期，或 preview 的 source version 已失效时才清。                                                                                                                                                                                                                                                                                                                                               | `settings/MemorySettings.vue`（见 §7.64）                                                                                                            |
| **P1 · ✅ 已修复 2026-09-24**              | **Run 详情 approvals/snapshot 已纳入独立 generation 仲裁**：每次 detail approval refresh 都递增 generation，并在提交前同时校验 generation、detail visible 与 runId；open-detail 初始 approvals 也共用同一 generation，后续 stream/mutation refresh 胜出后，旧 open 请求不能再覆盖或上报 stale failure；close/open 都会 invalidate 旧代。                                                                                                                                                                                                                                                                                                                                                                    | `host/AgentAppSurface.vue:1284-1292`（见 §7.65）                                                                                                     |
| **P2 · ✅ 已修复 2026-09-24**              | **Thread pagination 已纳入统一 list generation / cursor 仲裁**：first-page replacement 与本地 create/delete/delete-all 成功都会 invalidate 旧分页 epoch；`loadMoreThreads()` 捕获 generation + cursor，提交、报错与 finally 前都校验当前 epoch，旧页不能再 append 已删除 thread、回退 nextCursor 或清掉新一代 loading 状态。                                                                                                                                                                                                                                                                                                                                                                                                         | `host/AgentAppSurface.vue:881-945`（见 §7.66）                                                                                                       |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin frontend bridge 已具备 post-handshake disconnect / iframe reload 自愈**：transport/protocol 异常统一走 notifying disconnect，主动 `close()` 不触发重连；`PluginAppFrame` 收到断线后按 generation/bridge identity 完整 `load()` 重建 descriptor/iframe/bridge，外部 iframe reload 也通过 frame-load token 触发安全重握手。                                                                                                                                                                                                                                                                                                                                                                                       | `host/PluginAppFrame.vue`、`plugin-sdk/host-bridge.ts`（见 §7.67）                                                                                   |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin mutation timeout 已改为 outcome-unknown + stable operation id**：Host bridge 显式区分 read/mutation，mutation deadline 立即回 `HOST_RPC_OUTCOME_UNKNOWN` 并携带 operationId，不再把客户端 abort 当作 server rollback；Plugin SDK 同步保留 operationId 并允许显式复用。Run/Approval 复用现有 Idempotency-Key，Thread create / AppIntent create 用 operationId 作为 durable identity 并校验 replay payload；其余 mutation 超时只声明结果未知，要求先 reconcile。                                                                                                                                                                                                                                                                                                     | `plugin-sdk/host-bridge.ts`、`agent-dispatcher.ts`、backend `app-intent.service.ts`（见 §7.68）                                                      |
| **P2 · ✅ 已修复 2026-09-24**              | **Workspace Runtime / Model Registry async load 已建立 generation 与统一 mutation owner**：Workspace catalog/storage 只允许最新 availability generation 提交；Model Registry 初始 GET、refresh、auto-update mutation 互相 invalidate 旧 generation。Backend Registry refresh / auto-update 统一串行，store 每次 save 使用唯一 temp path，消除同 owner 并发写导致的 stale UI 与 false-failure。                                                                                                                                                                                                                                                                     | `settings/WorkspaceRuntimeSettings.vue`、`ModelProviderSettings.vue`、backend model capability registry service/store（见 §7.69）                    |
| **P2 · ✅ 已修复 2026-09-24**              | **稳定枚举已统一走集中 i18n 映射**：Run goal / ledger kind、Workspace recipe/profile kind 与 pack status、Subagent message kind/status 不再裸显示协议值；新增 `enum-labels.ts` 作为唯一映射 owner，已知值走三语文案，未知未来值统一降级为带 raw value 的“技术状态”，避免把机器枚举伪装成产品文案。                                                                                                                                                                                                                                                                                     | `enum-labels.ts`、`runtime/TaskRail.vue`、`WorkspaceRuntimePanel.vue`、`MessageExchangePanel.vue`、`settings/WorkspaceRuntimeSettings.vue`（见 §7.70） |
| **P2 · ✅ 已修复 2026-09-24**              | **Agent UI 日期/数字格式已统一跟随当前 UI locale**：新增集中 `locale-format.ts`，Artifact / Memory / MCP / Provider / Subagent / Conversation 全部显式传 `locale.value`；`quantity-format.ts` 通过 `QuantityLabels.locale` 统一格式化 exact bytes/seconds/tokens/count 与可见数量，原硬编码 `Tokens` 也进入三语字典。                                                                                                                                                                                                                                                                                                              | `locale-format.ts`、Artifact/Memory/MCP/Provider/Subagent/Conversation/quantity-format 等（见 §7.71）                                               |
| **P2 · ✅ 已修复 2026-09-24**              | **Workspace Terminal 终态已同步回 UI，transport 机器码不再直出**：自然 close 会原子清 `channel/opened`，Workspace 仍 running 时立即恢复“打开终端”；协议/attach/重连/input queue/session-change 错误统一映射三语文案，未知码回退通用错误。malformed ready JSON 也改为真正进入 protocol-invalid 终态，不再留下 dead-but-open channel。                                                                                                                                                                                                                                              | `runtime/AgentWorkspaceTerminal.vue`、`agent-workspace-terminal-channel.ts`、`workspace-terminal-errors.ts`（见 §7.72）                             |
| **P1 · ✅ 已修复 2026-09-24**              | **App surface lifetime 与 Plugin frontend authority 已按版本收口**：Hub 不再依赖不可精确 prune 的裸 KeepAlive，而只常驻“已访问且仍打开”的 surface；普通切换用 `v-show` 保留 partial state，close / disable / surface 变化 / activeVersion 替换都会真实 unmount 旧实例。Plugin descriptor version 同时进入 frontend RPC capability identity，backend 对 installation + activeVersion 双重校验并拒绝 stale bridge；Agent/binary RPC 也在 dispatch 前执行同一 version fence。                                                                                                                                                                         | `host/AgentHubWindow.vue`、`PluginAppFrame.vue`、`plugin-sdk/host-bridge.ts`、frontend/backend plugin RPC contract（见 §7.73）                     |
| **P2 · ✅ 已修复 2026-09-24**              | **App Tab 切换 / 关闭已拆成 sibling 原生按钮**：视觉 tab 改由非交互容器承载，switch button 与 close button 不再嵌套；close 使用原生 button 自带 Enter/Space 语义，并保留 `click.stop` / accessible name，Chrome-style active surface 与状态徽标布局保持原视觉层。                                                                                                                                                                                                                                                                                                                             | `host/AgentHubWindow.vue`（见 §7.74）                                                                                                                |
| **P1 · ✅ 已修复 2026-09-24**              | **失败域已拥有独立 error slot**：`AgentAppSurface` 改为按 domain 保存 message/code/retry，横幅只投影最近失败；同域新失败替换自己的 slot，dismiss/retry/成功只清所属 domain。线程切换仅清旧 transcript/run/stream/checkpoint/approval/detail/mutation 上下文，不再擦 configuration/threads 列表失败；初始化 config/thread 并发可同时保留错误与各自 retry。                                                                                                                                                                                                                                                              | `host/AgentAppSurface.vue`、`agent-surface-failures.ts`（见 §7.75）                                                                                  |
| **P2 · ✅ 已修复 2026-09-24**              | **Agent API HTTP 错误不再把 backend 英文 message 当 UI copy**：`formatAgentApiError()` 现在按稳定 `error.code` 语义分类为 validation / not-found / conflict / unavailable / forbidden / quota / too-large / timeout / auth / busy 并走三语 i18n；无法安全分类的 HTTP 错误回退调用方本地化 fallback，原始 backend message 仅保留在 `AgentApiError` 诊断对象。                                                                                                                                                                                                                                  | frontend `agent-api-error.ts` + 全部 Agent `formatAgentApiError()` caller（见 §7.76）                                                               |
| **P1 · ✅ 已修复 2026-09-24**              | **Host 首次 summary 请求失败已具备 leader 内自恢复**：cross-tab leader 在持有 lock 期间对 initial summary GET 做可取消指数退避重试，成功后再进入既有 host WebSocket reconnect loop；auth attach 不再额外并发发起第二次 initial refresh，消除 stale generation 抢写。                                                                                                                                                                                                                                                                                                                        | `host/AgentSurfaceHost.vue`（见 §7.77）                                                                                                              |
| **P1 · ✅ 已修复 2026-09-24**              | **Run / Integration / AppIntent create 已具备 caller-stable identity**：Run submission 以完整 create payload fingerprint 持有 Idempotency-Key，失败重试复用同 key；MCP/ACP modal submission 同理。Integration HTTP create 强制 Idempotency-Key，并以 key 作为 durable integration UUID，SQLite replay 校验 configuration/enabled/credential；AppIntent HTTP create 强制 key 并复用 §7.68 已有 receipt/grant durable replay。                                                                                                                                            | `AgentAppSurface.vue`、MCP/ACP settings、Integration/AppIntent API/routes/services/repositories（见 §7.78）                                          |
| **P1 · ✅ 已修复 2026-09-24**              | **ACP Integration / Workspace Delete 已补 destructive confirmation**：ACP 删除确认展示 Integration 名称与绑定 Profile；Workspace 删除确认绑定点击时的 workspace，并明确会停止作业/runtime 进程、移除运行环境且不可撤销。未确认不会进入真实 DELETE / runtime remove。                                                                                                                                                                                                                                                                                                    | `settings/AcpRuntimeSettings.vue`、`runtime/WorkspaceRuntimePanel.vue` + 三语 i18n（见 §7.79）                                                     |
| **P1 · ✅ 已修复 2026-09-24**              | **App 执行能力已与 backend health 契约对齐**：集中 `canExecuteAgentApp()` 只把 enabled + healthy/degraded 视为可执行；默认 App 优先可执行项，failed App 仍可打开查看历史。Hub 将 health/reason 传入 AgentAppSurface，发送区对非 healthy/degraded 禁止 create/append/goal 等运行态 mutation，并展示不可执行原因。                                                                                                                                                                                                                                                          | `app-availability.ts`、`host/AgentSurfaceHost.vue`、`AgentHubWindow.vue`、`AgentAppSurface.vue`（见 §7.81）                                         |
| **P2 · ✅ 已修复 2026-09-24**              | **Settings optimistic conflict 已按锁域自动 reconcile**：`execute()` 遇到 HTTP 409 会按 settings/providers/apps/denylist lock 定向刷新 authoritative snapshot；Hard Limit preview 同时作废。§7.54 已修复的设置卡继续保留 dirty draft，Safety Network 也补了 baseline/dirty merge，denylist revision 刷新不再吃掉未保存选择/原因。                                                                                                                                                                                                                                                        | `settings/AgentSettingsPanel.vue`、`SafetyNetworkSettings.vue` + 三语 i18n（见 §7.82）                                                             |
| **P1 · ✅ 已修复 2026-09-24**              | **Provider “拉取模型”已用 modal/request generation 隔离 stale response**：open/close 都 invalidate；请求捕获 modal generation、request generation、baseUrl、credential、modelId，只有 modal 仍打开且 identity 完全一致时才能写 `pulledModels` / `applyPulledModel()`。旧请求的 finally 也不能清掉新请求 busy 状态。                                                                                                                                                                                                                                                        | `settings/ModelProviderSettings.vue`（见 §7.83）                                                                                                     |
| **P1 · ✅ 已修复 2026-09-24**              | **Provider “测试连接”已改为无持久化 transient probe**：新建弹窗直接调用现有 endpoint discovery，以临时 baseUrl/credential 验证连通与认证并计算 latency；不再 `createProvider()`，也删除 `createdProviderId` 分支。测试失败/取消不会留下 Provider，测试后继续编辑再“保存并添加”会按当前表单真实创建。                                                                                                                                                                                                                                                    | `settings/ModelProviderSettings.vue:testInModal()/submitModal()`（见 §7.84）                                                                         |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace restart 失败已收敛到 failed，而不是继续伪装 running**：restart 在 runtime restart / Runner Plugin activate 任一步失败后会清理部分激活插件、best-effort stop runtime、将 Runner workspace journal 标为 `failed` 再让 command 失败；Backend 对 failed restart 同步 projection=`failed`。                                                                                                                                                                                                                                                                              | `agent-runner/controller/server.ts`、backend `workspace-runtime.service.ts`（见 §7.85）                                                             |
| **P2 · ✅ 已修复 2026-09-24**              | **toolchain/version switch 的 delete reservation 已持久化 rollback intent**：runtime command view 现在保留 durable `request_json`；switch delete 写入 `transition.kind=toolchainSwitch + previousStatus`。后台 reconcile 若最终 failed 会恢复冻结的 ready/running/stopped；若到 deadline 仍不可证明，则显式把 workspace 投影为 `failed`，不再无限卡在 stopping。                                                                                                                                                                                                                     | backend `workspace-runtime.service.ts`、`sqlite-workspace.repository.ts`、runtime command types（见 §7.86）                                        |
| **P1 · ✅ 已修复 2026-09-24**              | **Host Runner detached owner 现在有 durable process-group registry 与 startup reap**：job / ACP / Runner Plugin spawn 后记录 PID + Linux starttime + owner；controller 启动时先验证 start identity 再整组 SIGKILL 旧 owner，防 PID reuse。SIGTERM/SIGINT 也会关闭接入并 await 当前 managed groups 清理。                                                                                                                                                                                                                                                                        | `agent-runner/{managed-process,index,job-runner,acp-process-runtime,plugin-runner-runtime}.ts`（见 §7.87）                                           |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin upgrade draining continuation 已有 durable owner**：新增 pending-upgrade 表持久化 app/from/to/stage/package hash/state version；upgrade drain 前写入并在 CAS 后刷新 expectedVersion。后端提供 list/cancel API，Settings mount 会恢复 candidate/继续升级状态；cancel 在 activeVersion 仍匹配时恢复 `acceptNewRuns=true`。成功/rollback 都清理 continuation。                                                                                                                                                                                                                     | backend Plugin install coordinator/repository/routes + frontend `PluginManagementSettings.vue`（见 §7.88）                                         |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace lifecycle 现在等待 ACP/Terminal owner 真正退出再进入 stopped/deleted**：两类 `closeWorkspace()` 改为 awaitable drain barrier；ACP 只有 `terminateManagedProcess()` 完成后才从 active owner set 移除，Terminal 只有 child `close` 后才移除。TERM→KILL 后仍不退出会抛 owner-drain timeout，使 lifecycle command 失败并保持原 active workspace 状态，因此 runtime cleanup 无法趁 closing window 删除根目录。                                                                                                                                                  | Runner `{managed-process,acp-process-runtime,workspace-terminal-runtime,server}.ts`（见 §7.89）                                                       |
| **P1 · ✅ 已修复 2026-09-24**              | **Checkpoint capture 已具备 durable-job + live-writer 双重 owner gate**：user/recovery checkpoint 都先解析 durable background job，`unknown/pending/running/query failure` fail closed；Runner Engine 新增 snapshot lease 与 workspace writer registry，Terminal / ACP acquire writer owner，archive capture 与新 writer/job 互斥，活跃 writer 存在时直接拒绝 checkpoint。                                                                                                                                                                                                                                 | backend `checkpoint.service.ts` + Runner `workspace-runtime-engine.ts` / Terminal / ACP runtime（见 §7.90）                                          |
| **P1 · ✅ 已修复 2026-09-24**              | **Checkpoint restore 目录切换已具备 durable transaction + startup recovery**：切换前原子写 `restore-transaction.json`，记录 token/phase；startup reconcile 先恢复未决 transaction，再读取 runtime state。任一 rename 间崩溃都会回滚到 frozen backup；如果 durable record 存在但 workRoot/backup 均丢失则直接 failed。ready/running/stopped 但 workRoot 不存在也不再继续映射成健康状态。                                                                                                                                            | Runner `workspace-checkpoint-archive.ts`、`workspace-runtime-engine.ts:reconcile()`（见 §7.91）                                                       |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace governed file mutation 已纳入统一 live-writer lease**：Engine 对 write/move/delete/non-dry-run patch 在实际文件操作前原子检查 active jobs、ACP/Terminal writer、checkpoint lease 与其它 mutation lease；任一 writer 活跃都返回 `WORKSPACE_WRITER_ACTIVE_CONFLICT`。Mutation 执行期间持有 workspace mutation lease，新 ACP/Terminal writer 与新 job 也不能进入，因此 SHA final recheck→rename 窗口不再能被已登记外部 writer 穿透。                                                                                                                           | Runner `workspace-runtime-engine.ts` + ACP/Terminal writer registry（见 §7.92）                                                                      |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace lifecycle 已等待 background job process-group 真正退出**：Engine 保存每个 active job 的 controller + completion promise；stop/restart/remove 进入 generation job-drain gate，abort 全部 job 后 await `JobRunner.run()` 直到 child `close`，再提交 runtime state。live owner 不再提前从 `jobs` Map 删除，drain 期间新 job 也会被拒绝，因此 restart/delete 的成功边界不再早于 TERM→KILL 回收完成。                                                                                                                                                | Runner `workspace-runtime-engine.ts` / `job-runner.ts`（见 §7.93）                                                                                   |
| **P1 · ✅ 已修复 2026-09-24**              | **toolchain switch 的 old-generation delete 已成为完整 generation owner barrier**：Runner 非 start lifecycle 在关闭任何 owner 前先 claim `workspaceLifecycleDrains`，拒绝新的旧代 Job/ACP/Terminal/file mutation/checkpoint；delete 同时等待 ACP/Terminal、Runner Plugin 与 background job 真正退出后才 remove + succeeded。Backend 仍只在 delete=`succeeded` 后 reconfigure/provision/start g+1，因此旧代 writer 无法跨过新代 admission 边界。                                                                                                                             | backend `workspace-runtime.service.ts:switchToolVersions()` + Runner `server.ts` / `workspace-runtime-engine.ts`（见 §7.94）                          |
| **P1 · ✅ 已修复 2026-09-24**              | **普通 Workspace restart 已收敛到统一 owner-drain barrier**：restart 先 claim lifecycle admission gate，随后 await ACP/Terminal 真正 close、关闭 Browser、dispose Runner Plugin；`runtimeEngine.restart()` 内再 drain background jobs。只有这些旧 owner 全部退出后才 restart runtime、activate 新 Plugin 并 commit running；drain 期间新 writer/job/mutation/checkpoint 也无法进入。                                                                                                                                                                                               | Runner `server.ts:workspaceAction(restart)`、ACP/Terminal runtime、`workspace-runtime-engine.ts`（见 §7.95）                                         |
| **P1 · ✅ 已修复 2026-09-24**              | **手动 checkpoint resume 现在持有 caller-stable 恢复意图 identity**：UI 以 source run id + checkpoint id + source version 生成一次 Idempotency-Key，失败/unknown outcome 后保留并复用；只有收到成功的 resumed Run 才清除。API/facade 不再为 resume 现场生成 key。由于 Backend `createRun` 已按该 key replay，Workspace restore 失败或响应丢失后的重试会回到同一个 committed Run 并再次 restore，不会再创建第二个 resumed Run。                                                                                                                   | backend `checkpoint.service.ts:resume()`、frontend `agent-api.ts` / `run-facade.ts` / `AgentAppSurface.vue`（见 §7.96）                              |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace lifecycle 的 expectedVersion 已升级为原子 lifecycle claim**：action 在 dispatch 前用 repository CAS 把 Workspace 推到 `starting/stopping/deleting` 并 version+1；command request 绑定 claimed version + previous status。并发不同 action 基于同一旧 version 时只有一个能 claim，另一个在创建 runtime command 前 `STATE_CONFLICT`。completion projection 也只能提交到其 claimed version，旧 command 无法跨 epoch 覆盖新状态；Runner lifecycle gate 同时扩展到 start 作为第二道物理串行防线。                                                                                         | backend `workspace-runtime.service.ts:action()/syncWorkspaceStatus()`、Runner `server.ts:workspaceAction()`（见 §7.97）                              |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace Toolchain 执行已脱离全局 canonical alias，改为 digest-scoped immutable execution view**：已验证的 source pack 仍按 catalog 既有 canonical-normalized bytes 校验 contentDigest；首次执行为具体 digest 原子生成 `.runtime/<family>/<version>/<digest>` 只读 view，并把 pack 内 canonical 绝对前缀重写到该 view。Job/ACP/Terminal PATH 只引用 execution view，因此其它 Workspace/代际切换 canonical alias 或使用同 family/version 的另一 digest 都不会改变长寿命进程后续解析。canonical alias 若显式更新也改成 rename-over-symlink 原子替换，无 `rm→rename` 缺口；卸载 pack 同步回收对应 runtime view。 | Runner `toolchain-store.ts:executionPath()/activate()`、`workspace-runtime-manager.ts:prepareExecution()`（见 §7.98）                                 |
| **P2 · ✅ 已修复 2026-09-24**              | **Safety Network 的连接加载状态已绑定共享 Connections store 权威状态**：完整列表是否 resolved 直接跟随 `store.loaded`，不再以 items 非空推断；本地失败后若其它页面成功 load/revalidate，共享 `loaded=true` 会自动清除 `connectionLoadFailed` 并恢复列表/空态/orphan 判定。失败卡同时提供显式强制 Retry，mount 与 Retry 共用同一 load 路径。                                                                                                                                                                                                 | `settings/SafetyNetworkSettings.vue`、`features/connections/store/connections.store.ts`（见 §7.99）                                                  |
| **P1 · ✅ 已修复 2026-09-24**              | **Agent migration #23/#34 已按完整 schema postcondition 恢复 partial state**：两条 migration 使用专用 `apply/verify`，#23 逐列补齐 `source_model_step_id / batch_index / batch_size` 并确保 lineage index，#34 逐列补齐 `kind / inspection_json`；不再把整段多 ALTER SQL 交给 duplicate-column 容错。写 `migrations` 记录前必须 verify，目标表存在但任一 postcondition 缺失即回滚。目标表根本不存在的旧库仍保持历史 no-op 兼容。                                                                                                                 | `sqlite-migrations.ts:runMigrations()`、migration #23/#34（见 §7.100）                                                                               |
| **P1 · ✅ 已修复 2026-09-24**              | **Full backup 已覆盖 canonical Agent/AI 数据与权威文件**：全部 `agent_*/ai_*` 持久表按 FK-safe 顺序纳入 snapshot，Provider/Integration credential 走 plaintext-in-envelope → 目标实例重加密；Artifact object 与 Plugin immutable package tree 同步进入文件快照，目标实例旧 Agent 数据不再与来源快照混合。                                                                                                                                                                                                                              | backup `sqlite-backup-snapshot.adapter.ts`、`BackupService`、Agent Artifact/Plugin stores（见 §7.101）                                               |
| **P1 · ✅ 已修复 2026-09-24**              | **Backup restore 已具备 durable swap journal 与 startup recovery**：破坏性 rename 前持久化 intent，DB transaction 以独立 commit token 区分 rollback / roll-forward；启动阶段在 Agent runtime 初始化前恢复未完成 restore，cleanup failure 不再把已 commit 的 DB 与旧文件反向混合。                                                                                                                                                                                                                                                | backup `sqlite-backup-snapshot.adapter.ts`、composition root（见 §7.102）                                                                             |
| **P1 · ✅ 已修复 2026-09-24**              | **Memory import confirmation 与目标 Memory 已收敛到单一原子 commit point**：source recheck、稳定目标 id 插入、`memory.changed` 与 confirmation consume 同事务完成；响应丢失后重放同一 confirmation 返回同一 durable Memory，不会再烧掉 token 或重复导入。                                                                                                                                                                                                                                                     | `memory.service.ts:confirmImport()`、`sqlite-memory.repository.ts`（见 §7.103）                                                                        |
| **P1 · ✅ 已修复 2026-09-24**              | **Root Scheduler dequeue 后的 async fault 已有保留式自动 retry**：settings/capacity/start 前异常与 backend recovery commit 瞬时失败都会保留同一 Run 并指数退避重试；cancel/quiesce 会清 retry timer，外部 pump 统一收口 rejection，不再留下 durable 假 running。                                                                                                                                                                                                                                                   | `runtime/scheduling/scheduler.ts`、`bootstrap/agent/compose-agent.ts`（见 §7.104）                                                                   |
| **P2 · ✅ 已修复 2026-09-24**              | **Host durable outbox 已改为 bounded delta window**：每用户最多保留最近 2048 条事件并持久化 `oldest_cursor`；过旧 cursor 明确返回 `CURSOR_EXPIRED`，Frontend 重新拉当前 summary/high-water 后续订阅，summary resync 瞬时失败会退避重试而不会让 Host 协调流永久退出。                                                                                                                                                                                                                                    | `events/host-event-outbox.ts`、`sqlite-run.repository.ts`、`agent-protocol.session.ts`、frontend `agent-events.ts`（见 §7.105）                     |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin stage 已有 Backend-owned retention 生命周期**：installed stage 完成磁盘清理后立即删除 row；其余 staged/verified/failed 若 24h 无活动且不被 pending upgrade 引用，会在启动 reconciliation 或下一次 stage 前同时清理 staging 目录与 DB row。磁盘删除失败则保留 row 作为重试证据，不再依赖浏览器离页 cleanup。                                                                                                                                                                                                                         | plugin `plugin-package-install-coordinator.ts`、`sqlite-plugin-install.repository.ts`、`tar-package-verifier.adapter.ts`（见 §7.106）                |
| **P2 · ✅ 已修复 2026-09-24**              | **Artifact staging Delete 已与活跃 writer / durable cleanup 收口**：`activeWrites` 持有期间 Delete 返回 `ARTIFACT_UPLOAD_BUSY`，因此 rename→ready 窗口不能把 staging row 提前释放；无活跃 writer 的 staging Delete 先 CAS 到现有 `deleting` 状态，再统一删除 tmp/object 并按 `reserved_bytes` 释放 quota，崩溃后由既有 reconcile 继续收口。                                                                                                                                                                                                       | `artifacts/local-artifact-store.ts`、`tests/backend/agent-artifact-staging-delete-race.regression.ts`（见 §7.107）                                    |
| **P2 · ✅ 已修复 2026-09-24**              | **AppStorage quota 已覆盖 entry/key/row 成本**：每 App 最多 4096 entries；16MB 写入门禁按 value bytes + UTF-8 key bytes + 128B/row 保守 overhead 计费，snapshot restore 复用同一套 entry/charged-byte 约束。原 `bytes` 字段与 stats 仍保持 value-bytes 兼容口径，无需迁移旧行。                                                                                                                                                                                                                                               | `sqlite-app-storage.repository.ts`、`tests/backend/agent-app-storage-quota.regression.ts`（见 §7.108）                                               |
| **P1 · ✅ 已修复 2026-09-24**              | **Backup capture/restore 已建立一致性与串行化边界**：全部表 + 权威文件在同一 `DatabaseAdapter.transaction()` 独占调度窗口内 capture，文件树通过 before/after inventory 验证稳定性，不稳定则重试/失败；`BackupService` 用单一 operation lane 串行 export/import，两个 restore 不能再交叉 filesystem swap 与 DB commit。                                                                                                                                                                                              | `backup.service.ts`、`sqlite-backup-snapshot.adapter.ts`、`tests/backend/backup-consistency-serialization.regression.ts`（见 §7.109）                |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin AppStorage 已建立 Host-owned key ownership boundary**：Execution/Subagent policy key 集中定义为 reserved；Plugin Frontend/Backend storage get/put/delete 统一拒绝，upgrade migrate 只能看到 plugin-owned snapshot，restore 会合并当下 Host rows；卸载后的“删除保留数据”也只删除 plugin-owned rows，Host policy 不再被 Plugin SDK / migrate / cleanup 路径读取、覆盖或清除。                                                                                                                                            | `app-storage-ownership.ts`、`plugin-data-manager.ts`、`local-plugin-backend-runtime.adapter.ts`（见 §7.110）                                        |
| **P2 · ✅ 已修复 2026-09-24**              | **Manual checkpoint 已有有界 retention 与显式 owner delete**：每 Run 最多保留最近 32 个 user checkpoints；第 33 条起在同一 checkpoint transaction 内删除最老 rows，并仅在没有其它 checkpoint 继续引用时释放 `role='checkpoint'` Artifact links / Workspace retained manifest owner。Backend 同时新增 scoped user-checkpoint delete API，列表上限 50 已高于理论最大 32+1 recovery，不再存在隐藏 owner。                                                                                                                      | `checkpoint.service.ts`、`sqlite-checkpoint.repository.ts`、`app-runtime.routes.ts`、checkpoint Workspace regression（见 §7.111）                  |
| **P2 · ✅ 已修复 2026-09-24**              | **Provider model discovery 的 1MB limit 已在读取阶段生效**：OpenAI-compatible `/models` 与 model registry 共用 chunked `readBoundedResponse()`；`Content-Length` 仍可 fast-fail，无长度/虚假长度时每个 chunk 累计 bytes，首次越界立即 `reader.cancel()` 并停止读取，JSON 仅从已受限 bytes 解码，不再先构造无界 string。                                                                                                                                                                                                                   | `providers/bounded-response.ts`、`openai-provider.adapter.ts`、bounded-response regression（见 §7.112）                                             |
| **P2 · ✅ 已修复 2026-09-24**              | **Plugin immutable version 已按 installation ownership 回收**：成功 upgrade / uninstall 都在 authoritative installation commit 后检查旧版本 owner count；为 0 时删除 installed tree、version status→removed，并从 App registry/frontend hook 移除。startup 还会在 runtime 初始化前扫描 `status=installed && countInstalled=0` 的历史 orphan 并重试 cleanup；cleanup 失败保留 installed 状态，下次启动继续重试而不是永久失联。                                                                                                                         | `plugin-package-install-coordinator.ts`、`app-registry.service.ts`、version-retention regression（见 §7.113）                                       |
| **P1 · ✅ 已修复 2026-09-24**              | **Plugin upgrade 已建立统一 mutation fence**：`acceptNewRuns=false` 后 Frontend mutating RPC 在副作用前重读 durable state，并与 migration 共用 per-App mutation lane；old Backend 先 quiesce+dispose，且 dispose 等待已在途 Host operation 结算后才 capture。migration 临时 Backend process 的 live storage/intent mutation 被禁用，只能基于传入 snapshot 返回变换结果；因此旧写要么先完成并进入 snapshot，要么明确收到 `AGENT_APP_DRAINING`，不再双方成功后丢数据。                                                                                         | `plugin-data-manager.ts`、`plugin-package-install-coordinator.ts`、`local-plugin-backend-runtime.adapter.ts`（见 §7.114）                            |
| **P2 · ✅ 已修复 2026-09-24**              | **Host durable subscription 已能从丢失 wake 中自愈**：内存 `onHostWake` 仍作为低延迟 hint，但每个 Host WebSocket subscription 同时以 2s 低频 poll durable `hostCursor()`；发现 high-water 超过本地 cursor 就复用既有 bounded drain。poll 查询失败只记录并在下一周期重试，unsubscribe/session close 会清 timer，因此单次 post-commit wake query 失败不再让在线 UI 无限期停旧状态。                                                                                                                                                    | `agent-protocol.session.ts`、`agent-host-event-wake-recovery.regression.ts`（见 §7.115）                                                            |
| **P2 · ✅ 已修复 2026-09-24**              | **Backend Plugin child→Host stdout 已使用真正的 bounded frame parser**：不再交给 `readline` 无界拼行；父进程按 chunk 扫描换行，未完成 frame 的 retained buffer 始终不超过 20MB，下一 chunk 一旦越界就在 append 前抛 `PLUGIN_BACKEND_RESPONSE_TOO_LARGE` 并 SIGKILL child；完整 `\n/\r\n` frame 继续按原 protocol decoder 处理。                                                                                                                                                                                                                              | `local-plugin-backend-runtime.adapter.ts`、bounded-stdout regression（见 §7.116）                                                                    |
| **P1 · ✅ 已修复 2026-09-24**             | **Jump SSH 中间 hop 的 keepalive timeout 会触发 Backend uncaughtException**：握手 helper 在 ready 后移除临时 `error` listener，direct/proxy final client 后续会被 transport 接管，但 jump intermediate client 无长期 owner。现已统一为 `ConnectedSshClient + SshClientRoute` 全链 ownership；任一 hop error/close 会关闭整条 route 并传播正常 transport failure，不再杀 Backend。                                                                                                                                                                                                | SSH `ssh-client.connector.ts` / `ssh-jump.connector.ts` / `ssh-transport.adapter.ts` / regression（见 §7.117）                                       |
| **P2 · ✅ 已修复 2026-09-24**              | **Runner journal unknown evidence 已有界并可从旧超限状态恢复**：command/job 的 `unknown` 现作为 terminal forensic evidence 参与 retention；超过安全水位时优先裁最老 terminal evidence。commands/jobs decoder 只开放有限 recovery window，让旧版刚超过 16,384 的 journal 先解码后 compact 回安全范围；新 begin 在 hard limit 前做容量保护，若全是 nonterminal 则 fail-closed 为 `RUNNER_JOURNAL_CAPACITY_EXCEEDED`，不再落盘下一次必坏的 journal。                                                                                  | `agent-runner/controller/journal.ts`、unknown-retention regression（见 §7.118）                                                                       |
| **P2 · ✅ 已修复 2026-09-24**              | **Runner builtin Toolchain 的 command-scoped download cache 已绑定 command owner**：`ensure(commandId)` 外层 `finally` 无论成功/失败都删除 `cache/download/<commandId>`；PackInstaller startup 还会先清整个历史 `download` root，再创建空目录，回收上次进程异常中断遗留的 command copies。dependency packs 仍可在同一 ensure 内共享 commandId，但 owner 结束后 archive 不再留盘。                                                                                                                                                             | `agent-runner/controller/pack-installer.ts`、download-cache regression（见 §7.119）                                                                  |
| **P1 · ✅ 已修复 2026-09-24**              | **Runner Toolchain mutation 已有共享串行化与 admin conflict fence**：Workspace provision / pack ensure / uninstall / cacheCleanup 共用一个 Toolchain mutation coordinator，底层 filesystem/cache mutation 不再重叠；admin plane 同时只允许一个 Toolchain mutation，第二条并发 install/uninstall/cache command 明确失败为 `RUNNER_TOOLCHAIN_MUTATION_BUSY`。uninstall 的 in-use recheck 与 remove 位于同一 admin owner 内，install/uninstall 成功前还验证最终 installed postcondition。                                                                                          | `toolchain-mutation-coordinator.ts`、`server.ts`、`pack-installer.ts`、`cleanup-planner.ts`、serialization regression（见 §7.120）                    |
| **P2 · ✅ 已修复 2026-09-24**              | **ACP WebSocket→child stdin 已接入 Writable backpressure**：合法 binary frame 写入 `child.stdin` 返回 false 时立即 `websocket.pause()`；仅在后续 `stdin 'drain'`、session 未关闭、stdin 仍 writable 且 WebSocket 仍 OPEN 时 `resume()`。close/error/child exit 期间不会错误恢复已关闭输入流，因此单帧 256KB 上限之外也有累计 queue 流控。                                                                                                                                                                                                 | `agent-runner/controller/acp-process-runtime.ts`、ACP stdin backpressure regression（见 §7.121）                                                     |
| **P2 · ✅ 已修复 2026-09-24**              | **Runner Plugin generation HOME 已纳入 Workspace owner 生命周期**：delete action 在 runtime remove 后清当前 generation HOME；runtimeCleanup 先 dispose Plugin process，再删除整个 `plugin-processes/<workspace>`；startup 根据最终 journal workspace generation/status sweep 无 owner、deleted 与旧 generation 目录。SpaceReporter 的 `byWorkspace.runtimeBytes` / reclaimable bytes 同时计入对应 Plugin HOME，不再出现总 runtime 有占用但 Workspace preview 无法归因。                                                                                              | `plugin-runner-runtime.ts`、`cleanup-planner.ts`、`reconciler.ts`、`space-reporter.ts`、Plugin HOME regression（见 §7.122）                           |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace Job output contract 已统一为 1MB durable/wire bound**：JobRunner 仍允许 stdout+stderr 合计最多 1MB；Runner journal 对 Job output 使用独立 1MB decoder，并在 `succeedJob()` 写盘前验证 combined bytes，避免 writer 写出 reader 拒绝的状态；Backend Job decoder 同样接受 1MB output，但其它 protocol string 仍保持 16KB。Job start/query/wait/cancel 使用 2MB JSON transport envelope，覆盖 1MB payload + metadata。                                                                                                    | Runner `journal.ts` + Backend `runner-http-protocol.ts` / `runner-http.adapter.ts`、Job output contract regression（见 §7.123）                      |
| **❌ 排除 2026-09-24**                    | **`terminateManagedProcess()` helper 单独只等 leader，但真实 ACP / Runner Plugin caller 会在 child `exit` 时对整个 detached group 补 SIGKILL**：探针能复现 helper 单独返回时 grandchild 仍活，但产品 caller 在 leader `close` 前已经 force-kill group；剩余短 drain 窗口并入 §7.94/§7.95，不计独立缺陷。                                                                                                                                                                                                                                                                         | `agent-runner/{managed-process,acp-process-runtime,plugin-runner-runtime}.ts`（见 §7.124）                                                           |
| **P1 · ✅ 已修复 2026-09-24**              | **Workspace lifecycle 的 crash-window 已有权威重同步**：Runner startup 先收敛 Workspace runtime state，再对仍 running 的 lifecycle command按 `provision→ready / start|restart→running / stop→stopped / delete→deleted` 校验 postcondition；已成立则补写 succeeded，否则才 unknown。Runner 新增 generation-bound Workspace status API；Backend 遇到普通 lifecycle unknown 时查询该 authoritative projection并更新本地状态，历史 unknown 也可自愈；Toolchain-switch 自有 reconciliation 状态机保持不变。                                                       | Runner `reconciler.ts` / `server.ts` + Backend controller/HTTP adapter/`workspace-runtime.service.ts`、authoritative reconcile regression（见 §7.125） |
| **P2 · ✅ 已修复 2026-09-24**              | **JobRunner 的 UTF-8 截断已按 raw byte budget 保持字符完整性**：stdout/stderr 不再逐 chunk `toString()`，而是复制保留被 budget 接受的原始 bytes，进程结束后按 stream 拼接并只解码到最后一个完整 UTF-8 code point；跨 pipe chunk 的多字节字符可正确重组，budget 截在字符中间时丢弃不完整尾字节并保持 `truncated=true`，不会生成 `�`，重新编码后的结果也不会反向超过原 byte budget。                                                                                                                       | Runner `worker/job-runner.ts`、Job UTF-8 truncation regression（见 §7.126）                                                                           |
| **P2 · ✅ 已修复 2026-09-24**              | **Runner Toolchain `.staging` 已绑定 transient command owner**：ToolchainStore startup 在接收任何新 command 前清空旧 `.staging`，回收上次进程中断遗留 tree；`PackInstaller.ensure(commandId)` 的 `finally` 会清该 command 的所有 dependency staging，再清 download cache。Storage report 新增 `stagingPackBytes` 并贯通 Backend/protocol DTO，使当前 transient staging 不再隐藏在 Pack 总占用里。                                                                                                                                                                                   | `toolchain-store.ts`、`pack-installer.ts`、`space-reporter.ts`、Storage protocol/DTO、staging-retention regression（见 §7.127）                       |
| **P2 · ✅ 已修复 2026-09-24**              | **Runner `/storage` 的 Workspace collection contract 已对齐到 16,384**：`byPack` 仍保持 4,096 上限；`byWorkspace` 使用与 Runner journal 相同的 16,384 上限。Backend `/storage` HTTP path 同时使用 8MB route-specific response envelope，避免合法长期实例在 decode 前被通用 1MB transport 拒绝。回归覆盖 4,096 / 4,097 / 10,000 / 16,384 全部可解码，16,385 明确 protocol invalid。                                                                                                                                                         | Backend `runner-http-protocol.ts` / `runner-http.adapter.ts`、Storage collection contract regression（见 §7.128）                                    |
| **P2 · ✅ 已修复 2026-09-24**              | **Corrupt Runner journal evidence 已改成一次性 fail-closed quarantine**：首次 corruption 将主 journal 原子 rename 为唯一 forensic evidence并写 `.corrupt-marker`；后续 supervisor restart 看到 marker 直接 `RUNNER_JOURNAL_INVALID`，不再复制原内容。不同显式 recovery/corruption 事件的 evidence 只保留最近 4 份，避免长期无限积累，同时至少保留完整最新证据。                                                                                                                                                                                                                   | `agent-runner/controller/journal.ts`、corrupt evidence retention regression（见 §7.129）                                                            |
| **P1 · ✅ 已修复 2026-09-24**              | **Runner terminal persistence 已与业务副作用边界分离**：Journal mutation 改成 copy-on-write，只有 temp write/fsync/rename/parent fsync 全部成功后才替换内存 state；因此 terminal flush 失败不会先把内存推进到 succeeded。Workspace/Admin/Job executor 的业务阶段与 terminal commit 分开：已成功副作用若 `succeed*()` 持久化失败只尝试写 `unknown(RUNNER_TERMINAL_PERSISTENCE_FAILED)`，绝不反写 `failed`；三个 fire-and-forget executor 都有显式 `.catch()` owner。                                                                                           | Runner `journal.ts` / `server.ts`、terminal persistence boundary regression（见 §7.130）                                                             |
| **P2 · ✅ 已修复 2026-09-24**              | **Project Instructions omission evidence 已在 producer 端按 wire contract 有界**：Runner 新增 `MAX_OMISSION_DETAILS=32`，所有 `source_too_large / invalid_utf8 / total_budget / too_many_files` 都统一经过 bounded recorder；前 16 个合法 instruction 不受影响，后续 omission detail 最多 32 条。`PROJECT_INSTRUCTION_LIMITS` 同时公开该限制。深层 64 级项目回归得到 16 instructions + 32 omissions，并可通过 Backend 真实 decoder。                                                                                                                     | Runner `project-instructions.ts`、Project instruction omission contract regression（见 §7.131）                                                     |
| **P2 · ✅ 已修复 2026-09-24**              | **Workspace provision 失败会立即闭合 Runner owner 状态**：`provision()` 对 runtime create / Plugin prepare 失败显式把 workspace durable 标 `failed`，best-effort 删除当前 generation partial runtime 与 Plugin HOME 后再让 command 失败。CleanupPlanner 也不再把所有 `creating` 永久视为 active：只有存在 `pending/running provision` command owner 的 creating workspace 才 skip；历史/terminal-failed creating 可直接回收，无需重启 Runner。                                                                                                               | Runner `server.ts:provision()` / `cleanup-planner.ts`、provision failure owner regression（见 §7.132）                                             |
| **P2 · 🟠 开放 2026-09-24**               | **Runner catalog/Backend decoder 都允许 4,096 packs，但 HTTP adapter 默认只收 1MB**：真实合法 catalog 探针 4,096 packs 在 Runner load 与 Backend decode 都 PASS，wire JSON 约 3.40MB；`catalog()` 未设 route-specific cap，会在 decode 前被通用 1MB transport 限制拒绝。                                                                                                                                                                                                                                                                                                         | Runner `workspace-runtime-catalog/server` + Backend `runner-http.adapter.ts` / protocol decoder（见 §7.133）                                         |
| **P1 · 🟠 开放 2026-09-24**               | **Backend Plugin async line handler 无 Promise owner**：readline 用 `void handleLine()`；合法 JSON 但非法 lifecycle/storage/intent protocol 字段会让 decoder 抛错并形成 unhandled rejection，可把单个动态插件错误升级为 Backend 进程 fatal。                                                                                                                                                                                                                                                                                                                                     | `local-plugin-backend-runtime.adapter.ts:BackendPluginProcess.handleLine()`（见 §7.134）                                                             |
| **P2 · 🟠 开放 2026-09-24**               | **Backend Plugin Host→child response path 忽略 stdin backpressure**：storage/intent/lifecycle response 都直接 `child.stdin.write()`，不看 false、不等 drain、无 aggregate queue/concurrency limit；插件停读 stdin 但持续发合法小请求时，可让主 Backend Writable queue 持续增长。                                                                                                                                                                                                                                                                                                 | `local-plugin-backend-runtime.adapter.ts:BackendPluginProcess`（见 §7.135）                                                                          |
| **P1 · 🟠 开放 2026-09-24**               | **默认模型 optimistic identity 丢失 Provider 维度**：`af543606` 只缓存 `defaultModelId`，同名模型跨 Provider 时会把当前默认项解析成列表中第一个同 ID 模型；Provider 改变但 modelId 不变时 watcher 也不会重算，失败写入还不会 rollback。错误 key 同时参与 fallback 过滤，可隐藏错误候选并放出真实默认项。                                                                                                                                                                                                                                                                         | `settings/ModelProviderSettings.vue:optimisticDefaultModelId/defaultModelKey`（见 §7.136）                                                           |
| **P1 · 🟠 重新打开 2026-09-24**           | **Launcher §7.38 闭环被连续回退**：`a6371f9` 把已实测的“长按 320ms 才拖动”改回 4px 位移即拖动；`97560f1` 又删除拖动后出现的可见“重置位置”气泡，只剩右键 `contextmenu` 还原。轻微手抖再次可移动 Launcher，触屏/键盘用户也失去显式恢复入口。                                                                                                                                                                                                                                                                                                                                       | `host/AgentLauncher.vue`、`host/window-manager.ts`（见 §7.137）                                                                                      |
| **P2 · 🟠 开放 2026-09-24**               | **Provider“导入全部/一键添加全部”与 Backend 100-model hard cap 不一致**：discovery 最多返回 1,000 个模型，前端会把全部 discovered models 直接用于 create/test/update；只要端点返回 >100 个，或现有模型 + 新模型 >100，UI 提供的合法操作就稳定得到 `VALIDATION_FAILED`。                                                                                                                                                                                                                                                                                                          | `openai-provider.adapter.ts`、`provider.service.ts`、`settings/ModelProviderSettings.vue`（见 §7.138）                                               |
| **P2 · 🟠 开放 2026-09-24**               | **Runner coding projection 在主动截断后仍可声称结果完整**：`workspace_repo_map` 会在相关性排序前按路径顺序提前 break，后面的高相关文件根本不进入候选；symbol budget 耗尽也不必置 `truncated`。 `workspace_code_intel` 的 symbols/diagnostics/definition/references 都先裁到 `maxResults`，随后再用 `results.length > maxResults` 判断截断，计数上限触发时条件天然为 false。                                                                                                                                                                                                      | Runner `workspace-code-intelligence.ts` + Backend `workspace-coding-tools.ts`（见 §7.139）                                                           |
| **P2 · 🟠 开放 2026-09-24**               | **MCP 的 10MB output limit 在底层 HTTP/SSE 完整解码之后才检查**：`SafeMcpFetch` 的 undici Agent 未配置 `maxResponseSize`；SDK 对 JSON 直接 `response.json()`，SSE 也先累积完整 event.data 再 `JSON.parse`；Nexus 到 `jsonValue()` 才 stringify 并检查 10MB。异常/恶意 MCP endpoint 可先让 Backend 接收/解析远超声明上限的数据。                                                                                                                                                                                                                                                  | `safe-mcp-fetch.ts`、`mcp.adapter.ts`、`@modelcontextprotocol/client` transport（见 §7.140）                                                         |
| **P1 · 🟠 开放 2026-09-24**               | **Provider version 推进会把已保存 Subagent Profile 的模型引用变成“隐藏且无法正常修复”的 stale ref**：Profile 冻结 `configurationVersion`，当前 UI 只渲染最新 Provider version；旧 allowed/default ref 不再显示选中。用户重新勾同名模型只会追加新版本 ref，隐藏旧 ref 仍留在数组，保存时 Backend 逐条校验并稳定报 `SUBAGENT_MODEL_UNAVAILABLE`。                                                                                                                                                                                                                                  | `settings/SubagentSettings.vue`、backend `subagent-policy.ts` / `subagent.service.ts`（见 §7.141）                                                   |
| **P2 · 🟠 开放 2026-09-24**               | **Settings `?tab=` deep-link 与 KeepAlive 本地状态脱节**：`a6371f9` 只在 `onMounted` 读取一次 `route.query.tab`；`/settings` 又按 route name `Settings` 缓存。切本地 tab 不更新 URL，同页 query 变化/离开后返回也不会重跑 mount，因此地址栏可写 `?tab=agent` 而页面长期停在其它 section。                                                                                                                                                                                                                                                                                        | `app/pages/settings/SettingsPage.vue`、`app/App.vue`、`app/router/index.ts`（见 §7.142）                                                             |
| **P2 · 🟠 开放 2026-09-24**               | **Agent Settings 取消 lazy mount 后，未访问的隐藏分组也会立即发请求**：`a6371f9` 删除 `visitedGroups.has(...)` 的 template `v-if`，四组只剩 `v-show`。首次停在 Models 也会 mount Plugin/MCP/ACP/Workspace/Safety；Plugin 甚至请求 official + 全部 remote catalogs，失败会在当前模型页弹全局错误。                                                                                                                                                                                                                                                                                | `settings/AgentSettingsPanel.vue` + request-owning child settings（见 §7.143）                                                                       |
| **P2 · 🟠 开放 2026-09-24**               | **Agent Settings tab 的 `aria-controls` 指向不存在的 panel**：`a6371f9` 删除了 `AgentSettingsPanel` 根节点原有的 `id="settings-panel-agent"`，父页仍生成 `aria-controls="settings-panel-agent"`，但没有补 wrapper/id。                                                                                                                                                                                                                                                                                                                                                           | `SettingsPage.vue`、`AgentSettingsPanel.vue`（见 §7.144）                                                                                            |
| **P2 · 🟠 开放 2026-09-24**               | **Settings 导航声明为 ARIA tabs，却没有 tab widget 键盘模型**：历史 `413f2e99` 起就有 `role=tablist/tab`，当前 mobile/desktop 两套导航仍无方向键、roving tabindex、tabpanel 关系；desktop 纵向 rail 也未声明 vertical orientation。该历史提交早于 66-commit 审计起点。                                                                                                                                                                                                                                                                                                           | `app/pages/settings/SettingsPage.vue`（见 §7.145）                                                                                                   |
| **P2 · 🟠 开放 2026-09-24**               | **`a6371f9` 用无运行语义的 dummy literal 绕过 §7.40 i18n dead-key 门禁**：真实 Settings 分组已不再使用 `agent.settings.groups.plugins`，但源码新增未消费的 `_legacyPluginGroupKey` 保留该字面量；可达性脚本把任意源码 `agent.*` 字符串都算引用，因此三语死 key 仍能通过检查。                                                                                                                                                                                                                                                                                                    | `settings/AgentSettingsPanel.vue`、`scripts/check-agent-i18n.mjs`（见 §7.146）                                                                       |
| **P2 · 🟠 开放 2026-09-24**               | **MCP 时间戳单位回归**：`97560f1` 把 Backend 的 Unix-seconds `lastAttemptAt/lastSuccessAt` 直接传给 `new Date(number)`，被当作毫秒后会显示到 1970 年附近。                                                                                                                                                                                                                                                                                                                                                                                                                       | `settings/McpIntegrationSettings.vue`（见 §7.147）                                                                                                   |
| **P2 · 🟠 开放 2026-09-24**               | **Browser / ACP Profile / Model fallback 在父级 async patch 完成前就宣告保存成功**：Vue emit 不 await listener；失败时子组件仍 toast success、关 modal/保留本地 mutation，成功时还可能双 success。                                                                                                                                                                                                                                                                                                                                                                               | `BrowserRuntimeSettings.vue`、`AcpRuntimeSettings.vue`、`ModelProviderSettings.vue`、`AgentSettingsPanel.vue`（见 §7.148）                           |
| **P1 · 🟠 开放 2026-09-24**               | **`97560f1` 删除三类既有配置编辑能力**：Browser Target/Endpoint、ACP Profile、MCP endpoint/trust 从可编辑控件变成只读卡片，只剩部分开关/删除/新增；普通修改被迫 delete/recreate。                                                                                                                                                                                                                                                                                                                                                                                                | `BrowserRuntimeSettings.vue`、`AcpRuntimeSettings.vue`、`McpIntegrationSettings.vue`（见 §7.149）                                                    |
| **P2 · 🟠 开放 2026-09-24**               | **Plugin catalog 只按 URL path owner 分组导致 provenance 错配**：不同 host 的同名 owner 会合组，任一 source official 就让整组显示官方，而组头 URL 固定取第一条 catalog。                                                                                                                                                                                                                                                                                                                                                                                                         | `PluginManagementSettings.vue:extractGithubUser/groupedCatalogSources`（见 §7.150）                                                                  |
| **P2 · 🟠 开放 2026-09-24**               | **ACP 新增 Profile 的 command-string tokenizer 会静默改写 argv**：正则切词不支持 shell escaping/相邻 quoted segment 合并，合法输入可持久化成错误参数数组。                                                                                                                                                                                                                                                                                                                                                                                                                       | `settings/AcpRuntimeSettings.vue:parseCommandToArgv()`（见 §7.151）                                                                                  |
| **P2 · 🟠 开放 2026-09-24**               | **移动端 Settings 总览误用 Agent 专属副标题**：窄屏“所有设置”目录覆盖全部 Settings 类别，header 却固定渲染 `settings.descriptions.agent`；同一三语字典已有 `settings.mobile.settingsOverview` 但未接入。                                                                                                                                                                                                                                                                                                                                                                         | `app/pages/settings/SettingsPage.vue`（见 §7.152）                                                                                                   |
| **P2 · 🟠 开放 2026-09-24**               | **非默认 Provider 抽屉显示别家的全局默认模型**：每张 Provider 卡底部都无条件渲染 `defaultModelId                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |                                                                                                                                                      | provider.models[0]?.id`，不检查当前 provider 是否 default；多 Provider 时所有抽屉可显示同一个外部 model id。 | `settings/ModelProviderSettings.vue`（见 §7.153） |

---

## 1. 可直接复现的缺陷

### 1.1 设计 token 未定义 → 158 处样式静默失效（P0 · ✅ 已关闭 2026-09-23）

> ✅ **当前复验**：`tokens.css` 已暴露 `--color-card / --color-border-hover / --color-primary-hover / --color-warning-foreground`；2026-09-23 CDP 临时 `.bg-card` 探针计算背景为 `rgba(246, 247, 249, 0.92)`，不再透明。

`tokens.css` 通过 `@theme inline` 只暴露了 `background / foreground / border / header / footer / button / primary / success / warning / error / text-secondary ...`，
**没有 `--color-card`、`--color-border-hover`、`--color-primary-hover`、`--color-warning-foreground`**。

Agent UI 却大量使用 `bg-card`、`hover:border-border-hover`、`hover:bg-primary-hover`、`text-warning-foreground`：

| 类名                            | Agent 内出现次数  | 编译产物中是否存在规则 |
| ------------------------------- | ----------------- | ---------------------- |
| `bg-card`（含 `/70`、`/88` 等） | 158（全仓库 164） | **0（不存在）**        |
| `border-hover`                  | 33                | **0**                  |
| `primary-hover`                 | 1                 | **0**                  |
| `warning-foreground`            | 1                 | **0**                  |

核对方式：`packages/frontend/dist/assets/index-*.css` 中 `bg-header` 出现 58 次、`bg-background` 27 次、`border-border` 32 次，
而 `bg-card` / `border-hover` / `primary-hover` 出现次数为 **0**；`tokens.css` 中也没有这些变量定义。

影响（都是"看得见的错"，不是理论问题）：

- `.agent-composer-shell`（`ai/AgentConversation.vue:722`）的 `bg-card/88` 失效 → 输入框外壳没有卡片底色，只靠 `backdrop-blur` 撑场面，与其他页面卡片不一致。
- 大量卡片/下拉面板/按钮缺少背景：`host/AgentAppSurface.vue:1535`、`1571`、`1595`；`runtime/TaskRail.vue`（11 处）；`runtime/WorkspaceCreateCard.vue:108`、`124`；`runtime/SubagentCard.vue:25`。
- `hover:border-border-hover` 失效 → 输入框 hover 无边框反馈（`ai/AgentConversation.vue:722`、`settings/PluginManagementSettings.vue:517/832/839`）。
- `hover:bg-primary-hover` 失效 → 发送按钮 hover 无反馈（`ai/AgentConversation.vue:767`）。
- `text-warning-foreground` 失效 → 对账确认按钮文字落到默认色，警告底上的对比度不可控（`ai/AgentConversation.vue:640`）。

**重要补充（第二轮，见 §7.1）**：用户认为"很高级"的主界面模型弹层（`files/AgentConfigPopover.vue:154` 的 `bg-card/95 backdrop-blur-md`）正是这个 bug 的**副产物**——填充色没了，只剩模糊，于是呈现"通透玻璃"观感；而助手气泡（`ai/ConversationMessage.vue:342`）、空态卡片（`ai/AgentConversation.vue:434`）、任务栏面板（`runtime/TaskRail.vue:182`）因为同样失效却**没有** blur，就变成"只有描边的空框"。也就是说：这一条不是纯样式债，而是"用户喜欢的观感"和"看起来糙的地方"共用的同一个根因；修复时必须先决定玻璃层配方，再补 token，否则会一次性改掉所有弹层的观感。

建议方向（不实施）：二选一即可，不要继续扩散——

1. 在 `tokens.css` 里补齐 `--color-card`（例如映射到 `--input-bg-color` 或新增 `--card-bg-color`）并同步 `--color-border-hover`、`--color-primary-hover`、`--color-warning-foreground`；或
2. 全量替换为已存在的 token 类（`bg-background` / `bg-header` / `border-border` / `hover:bg-button-hover`）。

### 1.2 缺失 i18n key：`agent.ui.saveFailed`（P0 · ✅ 已关闭 2026-09-23）

> ✅ **当前复验**：三份 locale 均已有 `saveFailed`，`ModelProviderSettings` 保存失败路径直接引用该 key。

`settings/ModelProviderSettings.vue:94` 使用 `t('agent.ui.saveFailed')`，但 `features/agent/i18n/{zh-CN,en-US,ja-JP}.json` 三份文件都没有该 key（脚本核对：static refs 811 个，仅此 1 个缺失）。
用户看到的会是原始键名 `agent.ui.saveFailed`。三份语言文件叶子 key 数一致（1148），说明不是漏同步语言，而是"用了不存在的 key"。

### 1.3 面向用户的硬编码文案（P0/P2）

- `settings/AgentSettingsPanel.vue:106-108`：`if (!settings.value?.requestedSettings.model.defaultModelId) return '未设置';` —— 中文写死，en-US / ja-JP 用户看到中文。
- 同文件 `:108`：`formatAgentApiError(cause, 'Agent request failed.')` —— 英文写死，中/日用户看到英文。
- `settings/SubagentSettings.vue:92`：新建 profile 的 `role: 'Bounded child agent'` 直接成为用户可见字段值。
- 后端工具摘要（见 §1.8）也是英文写死。

### 1.4 未本地化的枚举/内部标识直接进 UI（P1）

> ✅ **2026-09-23 闭环**：原始枚举不再直接渲染，改成"查表 → 译文，查不到才退回原值"的统一写法。
>
> | 位置                                             | 修复                                                                                                                                         |
> | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
> | `runtime/SubagentCard.vue` 状态徽章              | 新增 `agent.subagents.status.{queued,running,waiting,completed,failed,cancelled}`（三语），模板改 `$t(\`agent.subagents.status.${status}\`)` |
> | `runtime/SubagentCard.vue` 页脚                  | `profileId · failureMode` → `配置档 {id} · 失败仅影响自身 / 失败即中止同级`（新增 `profileLabel` 与 `failureMode.{isolate,failFast}`）       |
> | `runtime/ApprovalCard.vue` 风险徽章              | 新增 `agent.approvals.risk.{read,control,mutate,destructive,forbidden}`，`risk` 不再原样输出                                                 |
> | `settings/WorkspaceRuntimeSettings.vue` 最近命令 | `{action} · {status}` 两个内部值都先查表（`commandAction` 11 项 / `commandState` 5 项），未命中才退回原值                                    |
> | 枚举插进句子（3 处）                             | `agent.approvals.resolved` 与 `agent.settings.feature.state` 上一提交已修（`status` / `stateLabels`），`commandStatus` 本轮完成              |
>
> **CDP 证据**：真实页面（zh-CN）里通过运行中的 i18n 实例取值，
> `agent.subagents.status.queued→排队中`、`failureMode.failFast→失败即中止同级`、`agent.approvals.risk.destructive→破坏性`、
> `commandAction.packInstall→安装工具包`、`commandState.succeeded→已成功`、`agent.settings.feature.stateLabels.enabled→已启用` 全部命中；
> Hub 首屏扫描 `queued/claimed/completed/mutate/destructive/failFast/succeeded` 等原始值命中 **0** 次。
>
> **有意保留的原始值（不算缺陷）**：`ApprovalCard` 折叠区里的 `precondition.kind/key`、`operationHash`，以及 `TaskRail` 的
> `#{{ id.slice(-6) }}` / `ledgerThrough`、`MessageExchangePanel`/`TaskRail` 的 `entry.kind` —— 这些都在"规范化操作 / 账本明细"
> 这类调试性披露里，属于 §7.14-b 建议的"原始码放调试区"；改动它们等于隐藏排查信息，因此保留并在此记录。
> 全仓剩余未走 i18n 的枚举渲染已收敛到上述 7 处（`grep -rn "{{ *[a-zA-Z_.]*\(status\|state\|kind\|risk…\) *}}"`，均在这些调试区）。

- `runtime/SubagentCard.vue:35` 直接渲染 `{{ delegation.status }}`（`queued/claimed/waiting/completed/cancelled` 英文原值）。
  对比：Run 状态是有 i18n 的（`agent.tasks.runStatus.*`），Subagent 状态没有（`agent.subagents` 下只有 title/description/empty/depth/steps/tokens/cancel/messages/noMessages/artifacts）。
- `runtime/SubagentCard.vue:50`：`{{ delegation.profileId }} · {{ delegation.failureMode }}` —— 内部 id 与策略枚举直接给用户看。
- `runtime/TaskRail.vue`：Run 详情用 `#{{ detailSnapshot.id.slice(-6) }}`、`#{{ checkpoint.id.slice(-8) }}`、`checkpoint.ledgerThrough / eventThrough` 等内部标识。
- `runtime/ApprovalCard.vue`：`approval.inspection.risk`、`precondition.kind/key`、`operationHash` 原样展示。
- **把枚举直接插进本地化句子**（比单纯"没翻译"更隐蔽）：i18n 里共 4 个含 `{state}/{status}` 的模板，其中 3 处传入的是**原始枚举值**：
  - `runtime/ApprovalCard.vue:73` → `agent.approvals.resolved`（`审批状态：{state}`）→ 实测显示「审批状态：approved」；
  - `settings/AgentFeatureSettings.vue:49` → `agent.settings.feature.state`（`当前状态：{state}`）→ 实测显示「当前状态：enabled」；
  - `settings/WorkspaceRuntimeSettings.vue:529` → `agent.settings.workspaceRuntime.commandStatus`（`最近命令：{action} · {status}`，`action`/`status` 均为内部值）。
    （第 4 个 `agent.conversation.runState` 目前无人引用，属死 key。）
- **原始机器码当说明文案**：`settings/WorkspaceRuntimeSettings.vue:270` 把 `availability.reason` 原样渲染 → 实测界面显示 `runtime_not_configured`（见 §7.15-b）。
- **中文词典里存着英文**：`i18n/zh-CN.json` 有 34 个 key 与 en-US 完全相同、14 条是整句英文 → 实测中文界面出现 `Denylist revision 1`（见 §7.15-a）。

### 1.5 `v-for` 与 `v-if` 同元素（P1，✅ 指令缺陷已关闭 2026-09-22）

`runtime/ToolTimeline.vue:13-23` 原为：`<ApprovalCard v-for="approval in approvals" :key="approval.id" v-if="clock" ... />`。

> **关闭记录（2026-09-22）**：已把 `v-if="clock"` 提升到外层 `<template>`，`ApprovalCard` 只保留 `v-for`，消除 Vue 3 指令优先级隐患并保持原有渲染语义。同元素 `v-for/v-if` 扫描为 0，frontend `vue-tsc --noEmit && vite build` 通过。下面关于 `clock === null` 缺少显式空态、以及组件命名与内容不完全一致的两条维护备注仍开放，不计入本次关闭范围。
> Vue 3 中 `v-if` 优先级高于 `v-for`，当前只是"恰好能用"（条件是外部 prop `clock`），但：

- 会被 `vue/no-use-v-if-with-v-for` 判为错误写法（仓库当前无 lint，所以没暴露）；
- `clock === null` 时整个列表**静默不渲染**，而不是给出占位或错误提示；
- ✅ **已关闭 2026-09-22**：组件已从 `ToolTimeline.vue` 重命名为 `ApprovalTimeline.vue`，`TaskRail.vue` 的 import 与两处使用同步更新；当前源码已无 `ToolTimeline` 残留，frontend `vue-tsc --noEmit && vite build` 通过。

### 1.6 死代码 / 死监听（P2，✅ 已关闭 2026-09-22）

`host/AgentAppSurface.vue:133`、`1467-1469`：

```ts
let taskRailWideViewport = typeof window !== 'undefined' ? window.innerWidth > 1040 : false;
...
const syncTaskRailViewport = (): void => {
  const wide = window.innerWidth > 1040;
  if (wide === taskRailWideViewport) return;
  taskRailWideViewport = wide;
};
```

`taskRailWideViewport` 只被赋值，**从未被读取**；`resize` 监听（`:1487`）因此毫无作用。顺带这条 `window.innerWidth` 判断也违反 `doc/architecture/FRONTEND.md:519`「响应式必须以 named container `agent-hub-window` 为准，而不是浏览器 viewport」。

> **关闭记录（2026-09-22）**：已删除 `taskRailWideViewport`、`syncTaskRailViewport` 以及对应的 `resize` 注册/清理逻辑；未改模板与样式，不改变 Task Rail 的可见行为。`AgentAppSurface.vue` 中已无上述标识和 `window.innerWidth`，前端 `vue-tsc --noEmit && vite build` 通过。

### 1.7 流式文本容易丢（P1，✅ 已关闭 2026-09-22）

`streamingText` 是 `AgentAppSurface` 的组件内 `ref`（`host/AgentAppSurface.vue:140`），而：

- `message.delta` 是 transient 事件、不是 durable（`api/agent-events.ts:20-29`），重连只补 durable 事件；
- 切 App 标签会卸载 surface（`host/AgentHubWindow.vue:561` 只有 `v-if` 分支，没有 `<KeepAlive>`），`onBeforeUnmount` 里 `facade.dispose()` + `resetStreamingPresentation()`（`:1494-1503`）；
- `transport.disconnected` 时也会 `resetStreamingPresentation()`（`host/AgentAppSurface.vue:667`）。

结果：模型正在输出时切换 App / 触发一次断线，**已经流出的文字会整段消失**，直到该 model step 结束（`message.final` → 刷新 ledger）才重新出现。用户观感是"卡住/丢字"。

> **关闭记录（2026-09-22）**：Hub 主内容区现在由持续存在的 `<KeepAlive>` 缓存 `AgentAppSurface` / Plugin surface / Files surface，切 App 或 Files 只 deactivate，不再触发 Agent surface 的 `onBeforeUnmount → facade.dispose() → resetStreamingPresentation()`；`transport.disconnected` 与 stream `onError` 也不再主动清空已经显示的 partial text，断线重连期间保留用户已经看到的内容。Run 真正结束、切线程/停止订阅时仍按原逻辑清理。前端 `vue-tsc --noEmit && vite build` 通过。

### 1.8 后端工具摘要英文硬编码，直接进对话 UI（P1，✅ 已关闭 2026-09-23）

`modules/agent/tools/host/**` 中 `summary` 是面向模型与用户的同一条字符串，例如：

```ts
// modules/agent/tools/host/file-tools.ts:220
return confirmed(`Read ${data.contentBytes} byte(s) from ${data.path}.`, ...);
```

同类字符串在该目录至少 34 处（`Found ${n} ... matches`、`Waiting for the user to answer ...` 等），会被 `ai/ConversationMessage.vue` 作为工具结果摘要渲染。
即：中文/日文界面里混入英文短句。**一个字符串同时服务模型与用户**本身也是设计问题（建议分离"模型可见证据"与"用户可见摘要"）。

> **关闭记录（2026-09-23）**：不在 Agent 工具层引入 i18n 框架，改为把"模型可见证据"与"用户可见摘要"拆开——
> `ToolResult` 新增**可选** `userSummary?: { key: string; params?: Record<string, JsonValue> }`，`summary` 保持英文不变。
>
> - **模型侧零变化（这是硬约束）**：`capabilities/tool-result-projection.ts` 的 `projectToolResult` 第一行就 `withoutUserSummary(toolResult)`，
>   而模型只通过 ledger 的 `payload.text`（= `modelToolResultJson` → `projectToolResult`）与子代理上下文里的同一个投影函数读结果，
>   因此 `userSummary` **不可能**进入任何一条发给模型的 JSON。实测展开任意工具结果的 JSON 面板，含 `userSummary` 的 `<pre>` 为 **0** 个。
> - **用户侧**：`infrastructure/agent/runtime/state-commit/tool-transition-result.ts` 新增 `toolResultLedgerPayload(row, result, toolCallId)`，
>   在 `text` 旁边旁路写入 `userSummary`；3 个 ledger 落库点（proposal / mutation / interactive）全部切到它，
>   顺带修掉 `tool-interactive-transitions.ts` 里唯一还在手写 `{ toolCallId, text }` 的成功路径。
>   `ai/ConversationMessage.vue` 新增 `localizedToolSummary`：优先渲染 `payload.userSummary`，**缺失时原样回退** `summary`（历史数据零迁移）。
> - **参数里的枚举不再裸奔**：约定 `params` 里以 `Key` 结尾的参数值本身是 i18n key，由前端 `te()` 解析成标签后插值
>   （如 `stateKey → labels.jobState.running → 运行中`），缺失时退化成 key 末段，不会把 key 路径渲染到界面上。
> - **覆盖范围**：`tools/host/**` 共 **16 个文件、52 处**用户可见 `summary` 全部接上（file / machine / shell+job / workspace 管理 / workspace 代码智能 /
>   skill / tool-discovery / user-input / artifact / docker mutation / collaboration / ACP / browser 6 个文件 / plan-tool），
>   另把 `state-commit` 里 4 条明确面向用户的失败摘要（审批拒绝、审批过期、审批被新输入取代、Run 取消）一起收口；
>   `mcp-tools.ts` 有意排除（远端不可信内容不能进本地字典），`verification.summary` 保持英文（前端不渲染它）。
> - **顺带修掉一个真实维护隐患**：`ConversationMessage.vue` 原先把"有中文文案的失败码"硬编码成 `friendlyFailureCodes` 数组，
>   新增失败域必须同步改组件；现在改成 `te('agent.conversation.toolFailure.<CODE>')` 查表，后端只要码在字典里就能本地化。
> - **三语齐平**：新增 `agent.conversation.toolSummary.*`（72 条句子 + 39 条 `labels.*` 枚举标签）与 5 条补充失败文案，
>   `node scripts/check-agent-i18n.mjs` 通过（三语 key 齐平、zh/ja 无逐字英文、组件源码无硬编码 CJK）。
>
> **CDP 实测（`/tmp/w/verify-summaries.mjs`、`verify-en.mjs`，复用历史会话 `8dce1e79`… 的 9 条真实 `tool_result`）**：
> 为了在无 Runner 的环境里验收"新投影 + 老数据回退"两条路径，临时给 4 条历史 ledger 行补上 `userSummary`（验收后逐字节还原，DB 已恢复、FTS 索引行数 27 未变）。
>
> | 工具                                       | 无 `userSummary`（历史数据，回退）                       | 有 `userSummary`（zh-CN）                                                 | 同一条的 en-US                                             |
> | ------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------- |
> | `plan_update`                              | `Plan updated to revision 2 with 3 item(s).`             | `计划已更新到修订 1，共 3 项。`                                           | `Plan updated to revision 1 with 3 item(s).`               |
> | `machine_list_connections`                 | —                                                        | `找到 0 个已授权的 SSH 连接。`                                            | `Found 0 authorized SSH connection(s).`                    |
> | `skill_read`                               | `Loaded signed Skill developer (nexus.agent.developer).` | `已加载已签名 Skill operations（nexus.agent.operations）。`               | `Loaded signed Skill operations (nexus.agent.operations).` |
> | `get_shared_fact`                          | `Shared fact loaded.`                                    | `共享事实已加载。`                                                        | `Shared fact loaded.`                                      |
> | 带 `*Key` 参数（`browserActionCompleted`） | —                                                        | `浏览器点击已完成。`（`actionKey` → `labels.browserAction.click` = 点击） | `Browser click completed.`                                 |
> | 带 `*Key` 参数（`jobState`）               | —                                                        | `工作区任务状态：运行中。`（`stateKey` → `labels.jobState.running`）      | `Workspace job is running.`                                |
>
> 展开面板里含 `userSummary` 的 JSON 块 **0** 个（模型证据未被污染）；同一 `userSummary` 随 `localStorage.user-locale` 在 zh/en 间切换（`localStorage.user-locale` 实测）。
> 初次验收还抓出两个自身缺陷并修掉：**标签值发生了语言错位**（zh-CN 拿到的其实是英文标签，CDP 显示 `浏览器click已完成。` / `工作区任务状态：running。`），
> 以及 **i18n 占位符与后端参数名不一致**（`{action}` vs `actionKey`），修完复测即达标；这两个缺陷只有真实浏览器渲染才能暴露，已补进验收清单。
>
> **门禁**：backend `tsc --noEmit`、frontend `vue-tsc --noEmit`、`eslint`（agent 前后端 + `infrastructure/agent`）、
> `prettier --check`、`node scripts/check-agent-i18n.mjs` 全绿。
>
> **仍开放（不计入本节）**：`mcp-tools.ts` 的远端摘要、`execution-errors.ts` 的执行期错误前缀、`command.reason`（`supersedeMutationTool` 的自由文本原因）
> 仍是英文——它们不在 `tools/host/**` 范围内，且依赖 Runner / 远端才能触发，已并入 §3.6 的"非 UI 残余"继续跟踪。

### 1.9 历史 Run 的审批接口稳定 500，且前端完全静默（P1，✅ 已关闭 2026-09-22）

> **关闭记录（2026-09-22）**：新增数据库 migration #45，将历史 inspection 的 `target.kind = "machine"` 迁移为 canonical `ssh`，同时补齐 `target.target = "ssh"` 与稳定 `target.id`；tool call 与 approval 自带 inspection 均覆盖。新增 `migration/legacy-machine-inspection-targets` 回归场景，后端 build 与完整 Agent scenario suite 通过。对真实数据库副本执行迁移后，legacy tool call 从 **26 → 0**、受影响 approval 从 **25 → 0**，且 25 条 approval inspection 全部通过当前严格解码器。保留严格 decoder，不接受旧别名作为长期协议。

**复现路径**：打开 Agent Hub → 点开会话「只进行只读检查，不执行任何修改…」（`thread 5017b33b-3b87-41e8-944f-293afb5f053d`）
→ 前端请求 `GET /api/v1/apps/nexus.agent/runs/e4abdda0-6924-4f7e-a7c0-5a1810a72899/approvals` → **500**。

```
HTTP 500  {"error":{"code":"INTERNAL_ERROR","message":"Agent request failed."},"requestId":"8d2526d0-..."}
backend log: {"level":50, "method":"GET", "status":500, "errorCode":"AGENT_DURABLE_STATE_INVALID"}
```

- **可稳定复现**：连续两次调用同一 URL 都是 500（`requestId` e42bb7dc… / e685a59f…）；本轮实测在 20 分钟内共出现 8 次同码 500（全部 `GET`，16:00:28Z 起）。
- **作用范围（实测）**：只有 `/runs/:runId/approvals` 受影响；同一个 Run 的 `/runs/:runId`、`/checkpoints`、`/reconciliation` 都是 **200**（说明不是数据整体损坏，而是这条读取路径的解码器更严格）。

**根因（数据库 + 解码器对照）**：

1. `sqlite-approval.repository.ts:34` 取审批的 inspection 用的是 `COALESCE(a.inspection_json, t.inspection_json)` —— 该审批行 `inspection_json` 为 `NULL`，于是回退到 tool call 的 inspection。
2. 该 tool call（`machine_execute_shell`）里存的是**旧命名**：`inspection_json.target.kind = "machine"`。
3. `runtime/durable-state-decoders.ts:396-427` 的 `parseToolInspection` 只接受 `['ssh', 'workspace', 'integration', 'browser', 'run']` → 直接 `invalid()` → 抛 `AGENT_DURABLE_STATE_INVALID` → 路由 500。

**影响面（当前真实数据库）**：`agent_tool_calls` 共 43 条，其中 **26 条是 legacy `target.kind = "machine"`**（另 17 条为 `run`）；
与之关联的 **8 个 Run**、共 **25 条审批记录** 的 `/approvals` 都会 500：

```
079c25fa…(10) 1b179f42…(4) 6aa40c62…(3) 57568d9b…(2) 7aefe2fb…(2) be931827…(2) de745348…(1) e4abdda0…(1)
```

**为什么以前的迁移没兜住**：`sqlite-migrations.ts` 的迁移 **#44**（"Project legacy SSH shell results into typed execution semantics"）已经把 `machine_execute_shell` 的 **result** 归一成 `semantic.target.target = 'ssh'`，
但**没有同步改写 `inspection_json.target.kind`**，而读取路径校验的恰恰是 inspection —— 迁移改了一半，留下一批"写进去时合法、现在读不出来"的行。

**前端表现（这条更值得重视）**：切到会话视图时，界面上**没有任何错误提示**——没有 toast、没有空态、没有降级文案，审批区块直接不出现（截图 `doc/imgs/review-2026-09-21/agent-hub-run-approvals-500-silent-zh.png`，同一屏会话照常渲染）。
代码上也对得上：`host/AgentAppSurface.vue:571-584` 的 `refreshApprovals` 里 **`catch {}` 是空的**，失败被直接吞掉；只有用户主动打开 Run 详情抽屉（`openRunDetail`，`:1246-1258`，用 `Promise.all` + `error.value = explain(cause)`）才会看到错误。
用户会以为"这个 Run 本来就没有审批记录"，属于 §3.4「静默失败」的典型：**后端 500 + 前端静默 = 数据看起来消失了**。

**建议**：① 补一条迁移把 `inspection_json.target.kind` 的 `machine` 归一为 `ssh`（或在 `parseToolInspection` 里兼容旧别名并记录 deprecation）；
② 审批读取失败时给出可见降级（"审批记录加载失败，点击重试"），而不是静默为空；
③ 这条 500 也说明 §1.1 之外还有一类"老数据 + 严格解码器"的风险面，建议给所有 `AGENT_DURABLE_STATE_INVALID` 抛出点补一次全库自检脚本。

---

### 1.10 打开 Run 详情会因审批接口 500 而**整体失败**（P0，✅ 核心缺陷已关闭 2026-09-22）

§1.9 记录的是"审批读取 500 + 前端静默"；本轮把**用户可见后果**补全：**点历史 Run 根本打不开详情**。

**复现路径**：Hub → 会话「只进行只读检查，不执行任何修改…」→ 右侧任务栏 → 在「Run 历史」里点任意一条。

实测（CDP 抓响应 + 读 DOM）：

```
GET /runs/e4abdda0-…            200
GET /runs/e4abdda0-…/approvals  500   ← 唯一失败项
GET /runs/e4abdda0-…/checkpoints 200
GET /runs/7aefe2fb-…/subagents?limit=50  200
GET /runs/7aefe2fb-…/approvals  500

结果：详情抽屉没有打开（没有「返回任务」按钮、没有 #hash 头部、没有检查点区块），
      界面上只多出一条红色横幅 —— 内容是英文："Agent request failed."
```

**根因（代码）**：`host/AgentAppSurface.vue:1235-1258` 的 `openRunDetail` 用
`Promise.all([facade.getRun, facade.listCheckpoints, facade.listApprovals, facade.listSubagents])` **一次性并发**，
任意一个 reject 就直接落到 `catch`，而 catch 只做 `error.value = explain(cause)`；
打开详情的 `detailVisible.value = true` 写在 try 内、且在 4 个请求之后 ⇒ **详情永远打不开**。

> **关闭记录（2026-09-22）**：`openRunDetail` 已把核心 snapshot 与辅助数据拆成不同失败域：`facade.getRun()` 成功后立即清空旧详情并打开详情；checkpoints / approvals / subagents 通过 `Promise.allSettled` 独立回填，任一辅助请求失败不再阻断其它成功区块，失败仍使用现有错误横幅反馈。保留 generation 守卫，关闭/切换详情后旧响应不会回填。前端 `vue-tsc --noEmit && vite build` 通过。

**影响面（实测）**：`GET /runs` 返回 22 个 Run，逐个回放 `/approvals` → **8 个 500**（与 §1.9 的 8 个 Run 一致）。
也就是说这些 Run 的**详情、检查点、子代理、审批全部看不了**，用户端唯一反馈是一句英文报错。

**两个次生问题（错误协议已关闭，UI 重试仍开放）**：

1. ✅ **错误协议 / 5xx 本地化阻断已关闭 2026-09-22**：此前 `AGENT_DURABLE_STATE_INVALID` / `SUBAGENT_DURABLE_STATE_INVALID` 会对外退化成 `INTERNAL_ERROR + "Agent request failed."`，前端又优先回显该英文 message。现在 backend 只对白名单中的 durable-state 解码故障保留稳定机器码（HTTP 仍为 500，message 使用安全泛化文案），未知内部异常继续掩码为 `INTERNAL_ERROR`；frontend 的 `formatAgentApiError` 对所有 5xx 统一使用调用方传入的本地化 fallback，不再把 backend 英文兜底直接显示给用户，稳定 `AgentApiError.code` 仍保留供日志/诊断。lint、backend build、frontend build、5xx 本地化探针与完整 Agent scenario suite 均通过。
2. ✅ **已关闭 2026-09-23**：横幅以前只有关闭按钮，用户既无法"再试一次"、也不知道哪一路失败，
   而且 `AgentAppSurface.vue` 把机器码 `AGENT_REQUEST_FAILED` 直接当兜底文案渲染。
   现在横幅与空态面板都会**先给出失败域**（会话列表 / 会话记录 / 运行状态 / 审批 / 检查点 / 任务详情 / 配置 / 实时事件 / 运行时操作），
   再给一句本地化的兜底文案，并把稳定错误码放进 `title`；**读路径带「重试」、写路径带「重新同步」**，
   未清除原修改语义（对账提示仍写明"不要重试原修改操作"）。详见 §7.37。

---

## 2. UI / 交互 / 视觉（第一轮重点）

> 第二轮（主界面布局/细节、设置区与主界面的落差、用户实测反馈）见 §6 与 §7。

### 2.1 「模态遮罩 + 浮动窗口」定位矛盾（✅ 已确认保留模态 2026-09-23，非缺陷）

> **产品决策（2026-09-23，用户确认）**：Agent Hub **保持模态**，背景必须不可交互。理由是"两边同时可交互会互相冲突"，且该场景下用户不需要同时看终端。
> 因此本条从"P1 缺陷"改判为**有意设计**；`aria-modal="true"` + 背景 `inert` + 遮罩吸收指针/滚轮/触摸都是预期行为，不改为非模态、也不做 docking。
> 三段式"浮窗外部形态（可移动/缩放/最小化）"作为窗口隐喻继续保留；本轮不引入"全屏工作台"改造。

`host/AgentHubWindow.vue:341-353`：

```html
<div
  class="agent-hub-backdrop fixed inset-0 z-40"
  @pointerdown.stop="handleBackdropPointerDown"
  @wheel.prevent
  @touchmove.prevent
/>
...
<section role="dialog" aria-modal="true" ...></section>
```

- 全屏遮罩 (`fixed inset-0`) + `aria-modal="true"` ⇒ **这是模态对话框**，不是 Windows 风格浮窗；
- 遮罩本身拦截 `wheel` / `touchmove`，且滚轮/触摸被 `prevent`；
- 但文档与实现又都按"浮窗"描述（可移动、可缩放、可最小化、geometry 持久化）。

~~对用户的直接后果：Agent 正在跑、正在等审批时，用户无法同时查看 SSH 终端 / 文件管理器 / Dashboard……~~
→ **已按上述决策接受**：使用 Hub 期间不并行操作主界面；关闭 Hub 不丢 Run，回来即可继续。

（以下为当时的候选方向，现已按"保留模态"收敛，仅作记录：）

1. 改为**非模态**（去掉全屏 backdrop，浮窗与主界面并存，点击外部只失焦不遮挡交互）；
2. 或保留模态，但增加 **docking / 半屏 / 侧栏** 形态，至少让用户能把 Hub 靠边并保留一部分主界面可见；
3. 若坚持模态，就不要同时暴露"移动/缩放"的窗口隐喻，统一成"全屏工作台"。

### 2.2 遮罩点击行为反直觉（P2 · ✅ 已关闭 2026-09-23）

`host/AgentHubWindow.vue:72-80`、`:355`：点击遮罩不关闭、不最小化，而是给窗口加 400ms 的 `ring + scale(1.002)` 「闪烁」反馈。
用户预期是「点击外部 = 关闭/最小化」或「完全无反应」；"闪一下"既没有说明也没有后续动作，属于需要解释的隐藏交互。

> ✅ **2026-09-23 闭环**：结合 §2.1 的"保留模态"决策，遮罩点击收敛为**真正的 no-op**——移除了 `flashWindow` / `flashTimer` 与窗口上的 `ring-2 ring-primary/60 scale-[1.002]`，遮罩只保留 `@pointerdown.stop` + `@wheel.prevent` + `@touchmove.prevent`（继续吸收背景事件，保证"不要交互"）。
> CDP 复验：在 Hub 打开时点击导航栏处遮罩 `(150,25)`，`#app.inert` 仍为 `true`、Hub 仍打开、URL 不变、窗口 `class`/几何均无变化（不再出现 400ms 闪烁）。

### 2.3 字号与可读性（P1 · ✅ 已关闭 2026-09-23）

> **复核修正（2026-09-23）**：本文原先"563 处 ≤11px ⇒ 中文几乎不可读"的结论**大部分不成立**，实测如下——
>
> - `features/agent/**` 当前 `text-[Npx]` 共 610 处：6/7/8/9/10/11px = 5/20/42/114/283/138；
> - **≤9px 的 181 处里，95 处是 FontAwesome 图标**（`<i class="fa-solid … text-[7px]">`），图标小字号是正常做法；
> - 真实文字仅约 86 处，集中在：`bg-header px-1.5 py-0.5 text-[9px]` 徽章、`text-[9px] text-text-secondary` hint、`ArtifactLibraryView` 8px 大写表头、`TaskRail` 9px mono 串；
> - **真实 Hub 首屏（默认空会话）只有 6 个 <11px 的可见文本节点**（会话标题 10.75px / `#590e8c` 9px@45% / `9月22日` 9px@50% / 计数 10px），1× 下并非"不可读"。
>
> 因此**不做 610 处全量重排**（收益低、`doc/imgs/e2e/*` 全部失效、回归成本高）。本轮按窄口径执行"阅读文本 ≥11px"：
>
> | 档位                           | 处置                                                                |
> | ------------------------------ | ------------------------------------------------------------------- |
> | ≤10px 真实阅读文字（全量）     | ✅ 抬到 **11px**（hint / mono / 表头 / 行内标签 / 按钮文案 / 徽章） |
> | 图标字形（`<i class="fa-…">`） | ⏸ 不改（95 处；图标小字号是正常做法）                               |
> | 14–16px 固定圆内的计数 / 勾选  | ⏸ 保留 9px（`h-3.5 min-w-3.5` / `h-4 w-4`，放大即溢出）             |
>
> **执行记录（两轮，合计 33 文件 / 274 行）**
>
> - 第一轮：17 文件 / 28 处（图标外的 8–9px 阅读文字 → 11px，文字徽章 → 10px）。
> - 第二轮：33 文件 / 269 处（`text-[6..10.75px]` → `text-[11px]`，逐行排除图标与固定圆形容器；其中 5 处固定圆形徽章主动回退到 9px）。
> - 收敛后 `features/agent/**` 的 `<11px` 只剩图标字形与 5 个 14–16px 圆形容器内的数字/勾选（`ArtifactPicker`、`AgentAppSurface`、`AgentLauncher`、`TaskRail`、`AppManagementSettings`）——**已无任何阅读文字低于 11px**。
>
> 复验：`vue-tsc --noEmit` 通过；`format-changed --check` 通过；CDP 溢出扫描在 Hub **1423px** 与最小 **560px** 两种宽度下均 `scrollWidth === clientWidth`、`clippedCount = 0`（composer 工具条 649/649 与 462/462），截图 `overflow-small.png`、`tb-hub.png`、`tb-files.png`。

Agent UI 中任意像素字号统计：

| 字号                             | 出现次数    |
| -------------------------------- | ----------- |
| `text-[6px]` / `[7px]` / `[8px]` | 5 / 20 / 41 |
| `text-[9px]`                     | 113         |
| `text-[10px]`                    | 274         |
| `text-[11px]`                    | 135         |
| 合计 ≤ 11px                      | **563 处**  |

典型位置：`host/AgentThreadSidebar.vue:309`（10.75px 会话标题）、`:316`（9px 元信息）、`runtime/TaskRail.vue`（8–10px 的 checkpoint / 事实区）、`host/AgentAppSurface.vue:2515-2665`（窄容器下降到 10–10.5px）。
同时大量使用 `text-text-secondary/50`、`/45`、`/40` 之类的低对比度（例：`host/AgentThreadSidebar.vue:316`、`files/ArtifactLibraryView.vue:526`）。

影响：拉丁字母 9px 已偏小，**中文/日文汉字在 9–10px 下几乎不可读**；配合低对比度，等于把关键状态（Run 状态、目标主机、审批风险）做成"看不清的次要信息"。

建议方向：正文/元信息下限 12px，辅助文字不低于 11px，取消 6–9px 档位；对比度不低于 4.5:1（`/50` 这类需要重新取值）。

### 2.4 点击目标偏小（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 闭环（3 项）**
>
> | 位置                                                                                 | 修复前                                                   | 修复后                                                              |
> | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ------------------------------------------------------------------- |
> | 关闭 App 标签（`AgentHubWindow`）                                                    | `h-4 w-4`(16×16) + `opacity-0`(hover 才出现) + 无 cursor | `h-6 w-6`(24×24) + 常显 `text-text-secondary/60` + `cursor-pointer` |
> | 窄容器纯图标 Run 配置（`AgentAppSurface` / `AgentConfigPopover` / `ArtifactPicker`） | `height/min-width: 25px`、`font-size: 10/10.5px`         | `28px`、`font-size: 11px`                                           |
> | 审批卡「拒绝 / 反馈 / 批准」（`ApprovalCard`）                                       | 仅 `px-2 py-2`，高度随字体浮动                           | 追加 `min-h-8`（=32px 下限）                                        |
>
> 探针实测：关闭标签旧 `16×16 / opacity:0 / cursor:auto` → 新 `24×24 / opacity:1 / cursor:pointer`；配置图标档 `h-7 w-7` = **28×28**。
> 未采纳"全局 32px 下限"：窄容器图标档取 **28px** 与同组件的 `agent-config-trigger-square`（28×28）保持一致，取 32px 会把 560×380 最小窗口下本就紧张的消息区再压缩（§7.2）；审批卡按钮则已用 `min-h-8` 保证 32px。
> 复验：`vue-tsc --noEmit` 通过；CDP 在 1423px / 560px 两种 Hub 宽度下 `clippedCount = 0`、composer 单行未破（649/649、462/462）。

- 工具栏/窗口按钮普遍 `h-7` / `h-7.5`（28–30px）：`runtime/TaskRail.vue:204`、`host/AgentHubWindow.vue:528/536/548`、`host/AgentAppSurface.vue:1535`、`:1567`；
- `runtime/ApprovalCard.vue:107-134` 的"批准/拒绝"按钮 `py-2 text-xs` 且三列并排，在浮窗里每个按钮宽度很小；
- 窄容器下 Run 配置压缩成 `25px` 高的纯图标按钮（`host/AgentAppSurface.vue:2577+`）；
- `host/AgentHubWindow.vue:444-455` 关闭 App 标签的按钮是 `h-4 w-4`（16px）且默认 `opacity-0`，只在 hover 时出现 —— 触屏几乎不可能命中。

建议方向：交互元素最小 32px（触屏 40px+），危险操作（拒绝/删除/关闭标签）避免"hover 才出现"，改成常显或长按/菜单。

### 2.5 Composer 的信息架构与按钮语义（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 闭环（CDP 实测，Hub 1200/900/700/560 四档）**
>
> 1. **一个按钮两种语义 → 拆开**：发送按钮现在**只发送**（`sendDisabled = busy || !canSend || !draft`），
>    旁边新增独立的 **停止按钮**（`w-7 h-7` 方形、`border-error/45 + bg-error/10 + text-error`，仅 `activeRun` 时出现，
>    `cancelling` 时转圈并禁用）。实测活动 Run 时：`stop=true`（图标 `rgb(220,53,69)`）、`sendDisabled=true`；
>    运行中再输入草稿 → `sendDisabled=false` 且 stop 仍在（转向/补充输入的原语义保留）。
>    四档宽度 `toolbarOverflow=0`、控件与操作组**零重叠**（最紧的 1200 档仍留 31px 余量）。
> 2. **`sendHint` 原来从未渲染（死 key）→ 渲染到 Composer 上方状态行**：`Enter 发送 · Shift+Enter 换行`（新增 `agent.conversation.sendHintNewline`）。
>    没有放进工具栏：composer 工具条在 768px 上限下**已经零余量**，塞提示会让配置触发压到操作按钮下面（实测重叠 92px），所以复用已有状态行。
> 3. **空草稿按 Enter 会误取消 Run（顺带发现的真实缺陷）**：`onComposerEnter` 之前走 `primaryAction()`，
>    而 `primaryAction` 在「活动 Run + 空草稿」时 `emit('cancel')` —— 即光标在空输入框里敲回车 = 取消当前 Run。
>    现在 Enter 只调用 `send()`（空草稿时是 no-op）。实测：活动 Run 下对空 composer 按 Enter，`stop` 仍在（未取消）。
> 4. **批准策略的安全语义**：批准策略触发器在 `full_access`（全授权）时改为警示色（`text-warning`，盾牌），
>    `ask`（按需询问）为 `text-success`；弹层两个选项的「绿=受保护 / 琥珀=放行写入」语义与触发器一致，
>    两个选项的图标 tile 也补齐显式 `text-*`（原来 tile 有底色但图标是灰的）。
>    这条依赖 §7.19：在此之前图标上的 `text-warning` 被未分层规则压成灰色，改了也看不见。
> 5. **token 统计不在主操作区**：`agent/ui` token 胶囊位于 Composer 上方状态行左侧（§7.4 已处理），本节原文的「token 占据主操作区」已过时。
>
> **本轮未做（保留为设计决策）**：把「模型 / 执行 / 环境 / SSH」移出工具条收进「下一个 Run 设置」面板。
> 工具条在 768px 上限下已零余量、且 §7.3 刚把裁切问题闭环，重排属于 §4「需要产品决策」范畴；
> 现在只保证「模型 + 思考强度 + 发送」永远不会被裁掉（§7.3 的 compact 分层）。

`ai/AgentConversation.vue:722-782` 的输入区底部一行同时容纳：
`ArtifactPicker` + 模型选择 + 执行模式 + 批准策略 + 运行环境 + SSH 目标 + token 统计 + 跳转最新 + 发送/取消。
其中 5 个都是 popover，触发面只有 `icon + 11px 文本`（窄容器下退化为纯图标）。

具体问题：

- **一个按钮两种语义**：`ai/AgentConversation.vue:769-776`，当存在活动 Run 且草稿为空时，同一个按钮从"发送"变成"取消 Run"（含图标变化）。用户容易在"想发送"时误触取消，或反之。
- `sendHint`（"Enter 发送"）已存在于 i18n，但**没有任何地方渲染**（属于 §3.5 的未使用 key 之一），用户不知道 Enter 会直接发送、Shift+Enter 换行。
- 批准策略（`ask` / `full_access`）属于**安全决策**，目前与"模型/环境"同权重地塞在输入框工具栏里，安全语义被弱化。
- token 统计（`ai/AgentConversation.vue:759`）放在发送按钮旁边，属于调试信息占据主操作区。

建议方向：输入区只保留"发送/停止"与附件；模型/环境/目标移到 Run header 或"下一个 Run 设置"面板；批准策略单独成组并带风险说明；取消 Run 用独立按钮或明确二次确认。

### 2.6 空态自动轮播（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 闭环（真实 Hub 实测）**
>
> 保留 4 页 × 2 张的便当卡（"留哪 3–4 张"属于 §4 的产品决策，不在本轮），但把"自己动"变成可中断：
>
> 1. **悬停 / 键盘焦点在空态区时暂停**：空态容器加 `mouseenter/mouseleave/focusin/focusout` → `homePromptPaused`。
>    实测：指针停在卡片上 10.5s，当前页 `active=1` 不变（`paused:true`）；移开指针后 10s 内又自动前进（`advanced:true`）。
> 2. **用户手动点分页后固定（不再抢回去）**：`selectHomePromptPage()` 置 `homePromptPinned=true`。
>    实测：点最后一页后离开指针再等 10.5s，仍停在 `active=3`。
> 3. **`prefers-reduced-motion: reduce` 时完全不轮播**：`matchMedia` 同时管脚本定时器与动画。
>    实测（`emulateMedia({ reducedMotion: 'reduce' })` 后重新加载）：10.5s 后仍 `active=0`，卡片 `transition-duration: 0s`、
>    脉冲点 `animation-name: none` —— 即轮播 + hover 位移 + `animate-pulse` 全部停掉（原来全仓只有 2 处 reduced-motion）。
> 4. 轮播本身继续只在"真的空态"里跑（`entries/streamingText/draft` 任一非空即跳过），没有改动卡片文案与分页 UI。

**原始记录（2026-09-21）**：

`ai/AgentConversation.vue:66`、`:163-166`：8 张 bento 卡片（`HOME_PROMPT_ROTATE_MS = 9000`）每 9 秒自动翻页，且只要没有内容就一直轮播。
问题：内容会在用户指针下方自动移动（点击到错误卡片的风险）；整个 Agent 前端只有两处 `prefers-reduced-motion`（`host/AgentAppSurface.vue:2697` 侧栏 drawer、`runtime/TaskRail.vue:914` 卡片），轮播、`animate-pulse`、hover 位移都不受影响；8 张装饰卡对"第一次怎么用"的引导价值很低。

建议方向：静态展示 3–4 个真实高频入口；确需轮播则只在 hover 时暂停 + 手动分页 + 尊重 reduced-motion。

### 2.7 硬编码调色板绕过主题体系（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 闭环**：`features/agent/**` 的调色板类由 **182 处 → 0**，全部收敛到语义 token；顺带清掉硬编码阴影/遮罩。
>
> **① 新增 `info` 语义 token**（原有 `success/warning/error/primary` 无法覆盖"信息蓝"）：
> `tokens.css` 增 `--color-info` / `--color-info-text` + `:root` 的 `--status-info-color: #0ea5e9`、`--status-info-text-color`；
> `appearance/config/default-theme.ts` 的 `defaultUiTheme` 同步，`darkUiTheme` 覆盖为 `#38bdf8`（暗底提亮）。
>
> **② 类名收敛映射**（逐行生成补丁，11 文件 / 78 行）：
>
> | 原调色板                                         | → token   |
> | ------------------------------------------------ | --------- |
> | `emerald` / `teal` / `lime` / `green`            | `success` |
> | `amber` / `yellow` / `orange`                    | `warning` |
> | `sky` / `cyan`                                   | `info`    |
> | `rose` / `red`                                   | `error`   |
> | `indigo` / `blue` / `purple` / `violet` / `pink` | `primary` |
>
> 同时删掉因此变得冗余的 `dark:<token>` 变体（token 自身已随主题变化）。
> 例外保留：推理强度滑杆的"光谱"语义改为 **`from-info via-primary to-warning`**（主题化的三段光谱，替代写死的 `blue→purple→pink`）。
>
> **③ 硬编码色值清理**：
>
> - 4 张 bento 卡的 hover 阴影 `rgba(16,185,129,.12)` 等 → `color-mix(in srgb, var(--color-<tone>) 18%, transparent)`；
> - 滑杆发光 `rgba(168,85,247,.35)` → `color-mix(var(--color-primary) 35%)`；滑杆拇指 `bg-white text-gray-800 ring-black/10` → `bg-background text-foreground ring-border/70`；
> - 中性阴影 → `shadow-2xs` / `shadow-sm`；搜索框 `inset_0_1px_0_rgba(255,255,255,.22)` → `shadow-xs` + `ring-2 ring-primary/15`；
> - Hub 窗口阴影（原写死 `rgba(0,0,0,.22)` + 白色内高光，深色下发脏，§7.5-10）→ 由 `--overlay-bg-color` / `--border-color` / `--card-bg-color` 推导；
> - Hub 遮罩 `rgba(15,23,42,.4)` → `color-mix(in srgb, var(--overlay-bg-color) 66%, transparent)`（浅色 ≈0.40、深色 ≈0.53）。
>
> **CDP 复验（真实页面）**
>
> - **主题跟随证明**：给 `--status-success-color / -info- / -warning-` 注入临时值后，`text-success / text-info / text-warning` 计算色同步变为品红/青/黄（原调色板类不会变）；
> - 深色预设下 Hub 遮罩 = `rgba(0,0,0,.528)`、窗口阴影 = 黑色 0.296 + `#495057` 55% 描边（不再发白）；截图 `theme-light.png` / `theme-dark.png` 中侧栏、徽章、bento 卡均随主题变化；
> - bento 卡渐变实测解析为 `oklab(... / 0.04)` + card token；Hub 内 `clippedCount = 0`。

仓库有完整主题定制（`tokens.css` + appearance 设置 + 主题截图 `doc/imgs/e2e/theme-customization.png`），但 Agent UI 大量使用 Tailwind 调色板与硬编码色：

仓库有完整主题定制（`tokens.css` + appearance 设置 + 主题截图 `doc/imgs/e2e/theme-customization.png`），但 Agent UI 大量使用 Tailwind 调色板与硬编码色：

- `ai/AgentConversation.vue:127-152`：`emerald/sky/amber` 卡片 + 硬编码阴影 `shadow-[0_8px_24px_rgba(16,185,129,0.12)]`；
- `host/AgentAppSurface.vue`：推理强度滑杆用 `from-blue-500 via-purple-500 to-pink-500`、`bg-indigo-600`；
- `settings/ModelProviderSettings.vue`（emerald 系 37 处）、`settings/PluginManagementSettings.vue`、`settings/SafetyNetworkSettings.vue`、`files/ArtifactLibraryView.vue` 等。

影响：用户切到深色/自定义主题后，这些颜色不跟随，形成"补丁感"；同时 `white/black` 文本与 `text-white` 在浅色主题下的对比度也不受控（`runtime/ApprovalCard.vue:127` 用 `text-black` 压 `bg-warning`）。

建议方向：新增少量语义 token（如 `--color-accent-*`、`--color-danger-foreground`），或统一收敛到 `success/warning/error/primary`。

### 2.8 不可发现 / 与整体不一致的交互（P1）

| 交互                           | 位置                                                         | 问题                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 会话列表 **Ctrl/⌘ + 滚轮缩放** | `host/AgentThreadSidebar.vue:132-146`                        | ✅ **已关闭 2026-09-23**（§7.13-d）：面板化 + 显式重置 + `title` 说明；只对会话列表生效，不再劫持别处的滚轮                                                                   |
| 任务栏卡片**拖拽排序**         | `runtime/TaskRail.vue:107-160`、`:475-490`（`vuedraggable`） | ✅ **已关闭 2026-09-23**（§7.14-b）：改为独立把手（`grip-vertical` + `aria-label` + `title` 提示）、方向键重排、顺序改动后出现「恢复默认顺序」入口，不再与点击/滚动抢同一区域 |
| Launcher **6px 阈值拖拽**      | `host/AgentLauncher.vue:39-61`                               | ✅ **已关闭 2026-09-23**（§7.38）：改成**长按 320ms 才拖动**、点击只负责打开 Hub；拖动后给一次性「重置位置」入口，右键还原作为兜底                                            |
| 遮罩**闪烁反馈**               | `host/AgentHubWindow.vue:72-80`                              | ✅ 已关闭，见 §2.2                                                                                                                                                            |
| **虚拟滚动 + 固定行高**        | `host/AgentThreadSidebar.vue:34`、`:269-272`                 | ✅ **已关闭 2026-09-23**（§7.38）：行高改为**量一个隐藏探针行**（同一组 class + `ResizeObserver`），占位与可视窗口都跟着 CSS 走                                               |

建议：删掉列表缩放与任务栏拖拽排序（收益低、成本高、与产品其余部分不一致）；Launcher 位置改为"长按拖动"并提供"重置位置"。

> ✅ **本节 5 行全部闭环（2026-09-23）**：缩放走 §7.13-d、任务栏拖拽走 §7.14-b、Launcher 与虚拟列表行高走 §7.38、遮罩闪烁走 §2.2。

### 2.9 详情与任务栏的信息架构（P1）

- TaskRail 默认收起（`host/AgentAppSurface.vue:134`、`:1598-1602`）；窄窗口它变成覆盖层，宽窗口才并排。运行概览、检查点、运行时面板、子智能体、最近事实、Workspace 都塞在这一个 320px 列里。
- **"最近事实"直接 dump JSON**：`runtime/TaskRail.vue:469` `JSON.stringify(entry.payload, null, 2)` 以 9px 字体展示 ledger 原始 payload。对用户没有语义，属于调试视图（应仅开发者模式可见）。
- 审批/预算/对账的状态出现在至少三处（顶部 badge `host/AgentHubWindow.vue:466-472`、TaskRail、Conversation 内 notice `ai/AgentConversation.vue:566-580`），信息重复但**没有统一的"待处理"入口**。
- Agent 概念总数偏多且直接暴露给用户：Goal / Plan / Step / Verification / Checkpoint / Subagent / Mailbox / Shared Facts / Reconciliation / Lease。文档里明确 Plan≠Step，但 UI 上两者并列出现（Plan 卡片 + "最近事实"）。

建议方向：把 Run 详情变成"概览 + 折叠的高级信息"；调试类数据（JSON payload、hash、lease、watermark）统一收进开发者/诊断面板；待处理事项收敛成一个可跳转的收件箱。

### 2.10 无障碍与键盘（P1 · ✅ 已关闭 2026-09-23）

- Hub：✅ **已闭环 2026-09-23**。打开时聚焦 Hub 根、背景 `#app.inert=true`；Hub 与 Hub-owned portal 共同构成焦点边界；Escape 关闭并恢复到 Launcher。
- 窗口移动/缩放**只能 pointer**（`handleDragPointerDown` / `handleResizePointerDown`），没有键盘替代；缩放热区是右下角 `h-4 w-4`（`host/AgentHubWindow.vue:585`）。
- Hub 未直接复用旧 `BaseModal/OverlayPanel`，但当前实现已补齐等价模态边界，并额外处理 Teleport 到 `body` 的 Hub-owned portal。
- `prefers-reduced-motion` 只覆盖了两处（`host/AgentAppSurface.vue:2697`、`runtime/TaskRail.vue:914`），其余动画（`animate-pulse`、自动轮播、卡片 hover 位移、`active:scale-95`）未处理。

剩余无障碍项集中在窗口移动/缩放的键盘替代与 reduced-motion；Hub 的 Escape / 初始焦点 / focus trap / inert / 焦点恢复已关闭。

> ✅ **2026-09-23 闭环**：补上窗口几何的键盘路径与全局 reduced-motion 基线；Hub 的 Escape / 初始焦点 / focus trap / inert / 焦点恢复此前已关闭。
>
> **修复前 CDP 实测（`https://api.honus.top/`，视口 1920×953，Hub 1600×711 持久化几何）**
>
> | 探测点                                      | 修复前                              | 修复后                                           |
> | ------------------------------------------- | ----------------------------------- | ------------------------------------------------ |
> | `.agent-hub-header` 的 `tabindex` / 键盘    | 无 `tabindex`，方向键对窗口无作用   | `tabindex=0`，`aria-label` + `aria-keyshortcuts` |
> | 聚焦缩放热区后按方向键                      | 窗口尺寸不变（1423×800 → 1423×800） | 1423×800 → 1439×880（+16 / +16+64，符合步进）    |
> | Hub 内 `transition-duration > 0.05s` 的元素 | **60 个**（最大 `0.2s`）            | **0 个**（最大 `0.00001s`）                      |
>
> **改法**
>
> 1. `host/AgentHubWindow.vue`：新增 `handleMoveKeydown` / `handleResizeKeydown`（方向键 16px、Shift 64px），
>    分别挂在标题栏与右下角缩放热区上；标题栏在非最大化时 `tabindex="0"`，最大化时退回 `-1`，并带
>    `aria-label`（`agent.hub.moveHandle`）与 `aria-keyshortcuts`。缩放热区的 `title` 改为
>    `agent.hub.resizeHint`（含步进说明）。顺带补齐最小化 / 最大化 / 关闭三个窗口按钮的 `aria-label`
>    （`agent.hub.restore` 为新 key，最大化态切换文案）。
> 2. `app/styles/global.css`：新增**未分层**的 reduced-motion 基线（`animation-duration: 0.01ms`、
>    `animation-iteration-count: 1`、`transition-duration: 0.01ms`、`transition-delay: 0ms`、
>    `scroll-behavior: auto`）。放在未分层区是为了不被 `@layer utilities` 的 `transition-*` 工具类按层序盖回。
>    刻意**不动 `transform`**：全局 `transform: none` 会破坏 `-translate-x-1/2` 这类居中布局；
>    `active:scale-95` 变成瞬时跳变（无动画过程），这正是 reduced-motion 想要的结果。
>
> **验证**：最大化后方向键不再移动/缩放窗口（几何 `0,0 1920×953` 不变，标题栏 `tabindex` 退回 `-1`）；
> Hub 内 Tab 首个落点是标题栏、`Shift+Tab` 从标题栏绕回缩放热区（焦点边界未破坏）；
> `vue-tsc --noEmit`、`pnpm lint:agent-i18n`、Prettier 全部通过。

### 2.11 视觉语言不统一（P2）

- **圆角混用**：同一层级里出现 `rounded`（`runtime/SubagentCard.vue:24`、`runtime/AgentWorkspaceTerminal.vue:48`）、`rounded-lg`、`rounded-xl`、`rounded-2xl`（Hub 窗口）。SubagentCard 明显偏离其他卡片语言。
- **边框透明度随手取**：`border-border/40 /45 /50 /55 /60 /65 /70 /75 /80` 全都在用。
- **魔法尺寸**：`h-[37px]`（`runtime/TaskRail.vue:185`、`:212`）、`h-[26px]`、`w-[54px]`、`text-[10.75px]`、`h-7.5 w-7.5`。
- **阴影多套**：`shadow-2xs/xs/sm/xl/2xl` 与硬编码 `shadow-[0_8px_24px_rgba(...)]` 并存。
- 结果：整个 Agent 区域看起来像"在一套设计系统里手绘的第三方应用"。

### 2.12 反馈真实性（P2）

`settings/AgentSettingsPanel.vue:243-260`：安装推荐插件时用 `setInterval(450ms)` 依次把进度从 25% → 65% → 90% 推上去（`installProgress`），与真实安装进度无关；成功后 `setTimeout(350ms)` 关闭弹窗。
用户看到的是**模拟进度动画**。建议改为不确定态（indeterminate）或绑定真实阶段事件。

### 2.13 UI 建议清单（若要重做交互，按此优先级）

1. **定位**：Hub 改非模态或可 docking；先解决"能一边用终端一边跑 Agent"。
2. **输入区减法**：发送/停止 + 附件 + 一个"运行设置"入口；Shift+Enter 提示；取消 Run 独立化。
3. **排版基线**：正文 ≥12px、辅助 ≥11px、禁用 6–9px；统一 4/8pt 间距；统一圆角与边框等级。
4. **主题合规**：清除硬编码调色板，补 `--color-card` 等 token。
5. **可读状态**：Run/Subagent/审批状态统一走 i18n + 图标 + 颜色三态，不暴露内部枚举与 id。
6. **可发现交互**：删除列表缩放/卡片拖拽排序；空态卡片静态化。
7. **无障碍**：Esc、焦点管理、`inert`、reduced-motion 全覆盖。
8. **反馈**：真实进度、静默失败改为显式提示（见 §3.4）。

---

## 3. 代码与模块结构问题

### 3.1 巨型文件与"文件级职责过载"（P2，但影响长期维护）

| 文件                                                                            | 行数  | 说明                                                                                                              |
| ------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------- |
| `frontend/src/features/agent/host/AgentAppSurface.vue`                          | 2,719 | 会话、线程列表、Run 配置、审批、对账、Checkpoint、Subagent、Workspace、Composer 配置全在一个组件；**UI 侧仍开放** |
| `frontend/src/features/agent/settings/ModelProviderSettings.vue`                | 2,067 | Provider CRUD + 模型发现 + capability 编辑 + 测试连接；**UI 侧仍开放**                                            |
| `frontend/src/features/agent/api/agent-api.ts`                                  | 791   | transport DTO canonical 化后已明显缩小；仍可继续按 API domain 拆分，但不再是 1.6k 行单体                          |
| `frontend/src/features/agent/ai/AgentConversation.vue`                          | 944   | 空态 + 消息列表 + 命令面板 + 对账 + Composer；**UI 侧仍开放**                                                     |
| `frontend/src/features/agent/settings/AgentSettingsPanel.vue`                   | 961   | 分区导航 + onboarding + provider + storage + denylist；**UI 侧仍开放**                                            |
| `frontend/src/features/agent/host/AgentHubWindow.vue`                           | 754   | 窗口 chrome + 拖拽/缩放 + App tab + 视图切换；**UI 侧仍开放**                                                     |
| `backend/.../infrastructure/agent/workspace-runtime/runner-http.adapter.ts`     | 770   | HTTP protocol decoding / websocket transport 等职责已拆出独立 owner                                               |
| `backend/.../infrastructure/agent/runtime/state-commit/subagent-transitions.ts` | 14    | 已降为聚合/转发入口，具体状态迁移拆入 subagent model/tool owners                                                  |
| `backend/.../infrastructure/agent/runtime/state-commit/tool-transitions.ts`     | 18    | 已降为聚合/转发入口，具体 proposal/mutation/interactive 等迁移拆分                                                |
| `backend/.../agent/runtime/execution/native-agent-backend.ts`                   | 722   | Root execution lifecycle 已抽出独立职责，主循环进一步收窄                                                         |
| `backend/.../agent/runtime/runs/state-commit.port.ts`                           | 5     | 状态提交 contract 已拆分为细粒度 contracts                                                                        |

`AgentAppSurface.vue` 单文件仍同时承担：App 级会话状态、Run 流订阅、审批/对账交互、线程 CRUD、目标选择、Composer 配置渲染、TaskRail 编排。

> **2026-09-22 非 UI 收尾复核**：本节原列出的 Backend / transport 大 owner 已完成一轮实质拆分：`runner-http.adapter.ts` 1503→770、`subagent-transitions.ts` 1373→14、`tool-transitions.ts` 1107→18、`native-agent-backend.ts` 891→722、`state-commit.port.ts` 859→5；`agent-api.ts` 1622→791。当前“巨型文件”问题剩余主体已经转为 UI 组件职责过载，因此非 UI 阶段不再继续为追求行数而机械拆文件。

UI 侧后续建议仍是：`useAgentThreads` / `useAgentRunStream` / `useRunConfiguration` composable + 把 Run 详情（TaskRail 内容）拆成独立 feature 组件，把 Composer 配置拆成 `RunConfigBar.vue`。

> **2026-09-23 复核与本轮决定（⏸ 已评估、按约定延后，非缺陷）**：重新测量 `features/agent/**` 的 `*.vue`，当前 TOP：
> `AgentAppSurface.vue` **2,915**（script 1–1,678 / template 1,680–2,648 / style 2,650–2,915）、
> `ModelProviderSettings.vue` **2,201**（script 1–904 / template 906–2,201）、`AgentSettingsPanel.vue` **1,447**。
> 本轮**不拆**，理由是这条已经没有隐藏的用户可见缺陷，而"按职责拆"必须动到绑定层：
>
> - `AgentAppSurface.vue` 的 Composer 配置区（`agent-config-summary` + 7 组 `AgentConfigPopover`，约 1,890–2,500 行、约 600 行模板）
>   要抽成 `RunConfigBar.vue`，需要一次搬迁 **约 30 个 props + 约 15 个 emit**；`ModelProviderSettings.vue` 的 Provider 卡（`v-for="provider in providers"`，约 1,205–2,000 行、约 800 行）
>   要抽成 `ProviderCard.vue`，同样依赖父组件的发现结果、capability 编辑器、测试弹窗与批量策略状态。
> - 这类搬迁的正确验收方式是**逐控件交互回归**（Provider 弹窗 / 模型发现 / 重命名 / 删除、Composer 每个 popover 的开关与提交、Run 详情抽屉），
>   而本环境 `runner_not_configured`（`runner-http.adapter.ts:147`）、只有 22 个历史 Run，无法把 Provider CRUD 与 Run 详情两条主路径跑到，
>   因此"拆完只能靠类型检查 + 静态走查"，风险高于收益。
> - 已确认**本轮不需要这次拆分**：§7.39 / §7.40 的改动都不在这两个文件里（`ConversationMessage.vue` 只改了 1 处 computed）。§3.1 保持开放，
>   作为"下一个有 Provider/Runner 环境的迭代"的第一项，计划不变（`useAgentThreads` / `useAgentRunStream` / `useRunConfiguration` + `RunConfigBar.vue` / `ProviderCard.vue` / Run 详情组件）。

### 3.2 Nexus 前后端 transport DTO / event 协议统一（P1，✅ 当前问题已闭合 2026-09-22）

> **2026-09-22 迁移检查点**：问题范围已从“仅 Agent protocol”修正为 **Nexus 全局前后端真实 transport contract**。canonical source 统一为 `packages/protocol`，不再计划建立单独的 `packages/agent-protocol`。依赖方向固定为 `protocol <- frontend/backend`；protocol 不依赖 frontend/backend，backend domain/service/repository 类型继续留在各自模块，frontend UI-only ViewModel 也继续本地维护。

当前状态：

- ✅ **基础协议包已建立**：`@nexus-terminal/protocol` 已作为 workspace package 接入 frontend/backend；公共 envelope 与按 domain 的 DTO 从此集中维护。
- ✅ **Auth / Security 已完成双端接线**（commit `69b48be`）：登录、2FA、Passkey、CAPTCHA、IP access 等真实 HTTP request/response 使用同一 DTO；同时补出了 Passkey rename 的运行时输入校验缺口。
- ✅ **Settings / Preferences 已完成双端接线**（commit `8f939cb`）：`/settings` request/response 改由 `protocol/settings` 定义，backend mapper 从 `Record<string, unknown>` 收紧为 `SettingsResponseDto`。
- ✅ **Connections / Proxy / SSH Keys / Tags / Remote Desktop 已完成一批 canonical DTO 接线**（commit `0ba2caf`）。
- ✅ **Appearance / HTML Themes / Terminal Themes 已完成双端 canonical DTO 接线（2026-09-22）**：frontend API 已消费 `protocol/appearance`，backend `appearance.routes.ts` 与 `terminal-themes.routes.ts` 现显式完成 domain↔DTO mapping；terminal theme 导入/create/update 的 JSON theme data 也从裸类型断言收紧为字符串 map 边界校验。
- ✅ **Audit / Command History / Filesystem Catalog / Notifications / Quick Commands / System / Transfers 已完成 HTTP 双端 canonical DTO 接线（2026-09-22）**：补齐 Audit 漏掉的 5 个 Agent Memory action；Notification channel/event 常量改由 protocol 单一来源；Favorite Path / Quick Command query 也纳入 DTO；System 将本机状态与 SSH remote sampling 拆为真实的两种 DTO；Transfers backend 增加 request decoder 与 domain→DTO mapper，Date 显式转 ISO，同时不再把 domain-only `userId` 顺带序列化到 wire response。
- ✅ **SSH Suspend 已完成 HTTP + Workspace WS 子协议 canonical 化（2026-09-22）**：catalog/rename/terminate HTTP 与 `suspend.mark/unmark/list/resume/owner.renew/history.previous/history.reset/terminate/remove/rename` WS operation，以及 `suspend.autoTerminated/revoked` event 全部由 protocol 单一来源约束；Workspace 通用 request/response/event envelope 也迁入 `protocol/workspace`。迁移时编译器发现并修复了旧 WS `suspend.mark` 实际返回 `suspendSessionId`、frontend 却读取 `suspendedSessionId` 的字段漂移。
- ✅ **Workspace 其余 transport 已完成 canonical 化（2026-09-22）**：`workspace.connect`、Terminal、Status、Docker、Filesystem、Copy/Move、Archive、Upload 共 41 个 JSON operation 与 15 个 event 全部进入 `protocol/workspace` request/response/event map；frontend `WorkspaceSocket` 由 operation key 推导 request/response/event 类型，旧 `*Wire` 与显式 generic 旁路清零；Backend 对 filesystem / transfer / archive / upload event 显式 domain→DTO mapping。独立 `/ws/uploads` raw binary 流不包装 DTO，但握手 `workspaceId/uploadId/size` metadata 已由 `WorkspaceUploadStreamQueryDto` 三端共享。覆盖脚本验证 backend operation/event 与 frontend Workspace key 对 protocol 的差集均为 0。
- ✅ **Agent HTTP common envelope + Integrations 已完成 canonical DTO 接线（2026-09-22）**：`agent-common` 统一 `{data, requestId}` / error envelope / CSRF response，backend `agentData/agentError` 与 frontend unwrap/client 共同消费；Integrations 的 list/get/create/update/delete/refresh 6 条 route 已迁入 `protocol/agent-integrations`，MCP/ACP discriminated request、version/query、management view 与 refresh response 均显式 DTO 化，frontend create/update 不再以 `Record<string, unknown>` 作为 wire contract。
- ✅ **Agent Providers / Model Registry 已完成 canonical DTO 接线（2026-09-22）**：provider CRUD/discover/test、`/ai/models` projection、model-registry resolve/status/refresh/auto-update 均迁入 `protocol/agent-providers`；request writable model 与 response-derived capability metadata 分离，frontend PATCH 会剥离 `capabilitySources/registryDefaults/providerCapabilities` 等只读字段。迁移同时补齐旧 frontend wire type 漏掉的 provider `createdAt/updatedAt` 与 discover `liveCapabilityReport`。
- ✅ **Agent Threads / Ledger 已完成 canonical DTO 接线（2026-09-22）**：thread list/get/create/rename/delete/delete-all 与 ledger page 共 7 条 route 已迁入 `protocol/agent-threads`；list/ledger 分页 query 分别保留真实的 100/200 上限，create title 的 placeholder 语义与 rename 的 strict title/version 语义分离。frontend thread/ledger 手写 interface 已清零并直接使用 canonical `*Dto` 名称，ledger payload 由 `unknown` 收紧为共享 `AgentJsonValueDto`。
- ✅ **Agent Approvals 已完成 canonical DTO 接线（2026-09-22）**：Run approval list、approval get、resolve 三条真实 HTTP contract 已迁入 `protocol/agent-approvals`，backend 两个 route 文件共用单一 domain→DTO mapper；ToolInspection target 按 backend 真实 `workspace/ssh/integration/browser/run` union 建模，修正旧 frontend 将 SSH 字段错误视为统一必填的漂移。Agent versioned mutation 的 `schemaVersion: 1` envelope 同步迁入 `agent-common`；approval 快照在 Vue 侧使用 `shallowRef`，保持递归 JSON DTO 精确类型而不触发深层响应式类型展开。
- ✅ **Agent Artifacts 已完成 canonical metadata DTO 接线（2026-09-22）**：app-scoped reserve/get/retain/delete/upload-result 与 global library/storage/cleanup/attach 两组 JSON metadata surface 统一迁入 `protocol/agent-artifacts`，backend 共用 `artifact-dto.ts` 做 domain→DTO mapping；attach response 按 backend 真实完整字段建模，修正旧 frontend 只声明 `{artifact,crossApp}` 的裁剪漂移。Artifact content GET/PUT 仍保持 Blob/stream/raw bytes，仅其 reservation/query/metadata 受 DTO 约束。
- ✅ **Agent Host Settings / Apps / Grants / Execution Policy 已完成 canonical DTO 接线（2026-09-22）**：Settings document/view/patch、hard-limit preview+confirm、Host summary、App summary/state mutation、capability definitions/grants 与 per-app execution policy 已统一迁入 `protocol/agent-host`；backend 共用 `agent-host-dto.ts` 显式映射，frontend settings/grant/policy 本地 wire interface 清零。迁移修复 hard-limit confirm 旧 response 只返回 `availability.state`、缺失 `reason/appId/appHealth` 的漂移，并将 App Management capability id 从普通 `string` 收紧到 canonical capability union。
- ✅ **Agent Run Core 已完成 canonical DTO 接线（2026-09-22）**：agent-definitions、Run list/create/get/reconciliation、checkpoint、resume、append/interrupt input、pending-input mutation、goal、budget、cancel/delete 等核心 HTTP surface 已统一迁入 `protocol/agent-runs`，backend 共用 `run-dto.ts` 显式 domain→DTO mapping，frontend Run/Checkpoint/Definition 本地 wire interface 清零。迁移补齐旧 frontend RunView 漏掉的 `activeExecutionStartedAt/executingRuntimeCount` 与 definition `requiredModelCapabilities/modelCapabilities/rootModelRoutes`，修复 definitions public facade 类型过窄以及 `terminalIssue` 错挂在普通 RunView 的漂移。
- ✅ **Agent Collaboration / Memories 已完成 canonical DTO 接线（2026-09-22）**：Subagent settings/profiles、delegation create/list/cancel、delegation messages，以及 Memory list/propose/review/import preview+confirm 已迁入 `protocol/agent-collaboration` / `protocol/agent-memories`；backend 共用显式 DTO mapper，frontend 本地 Subagent/Memory wire interface 清零。迁移修正旧 frontend delegation 将 scoped `grants` 错写为 `capabilities: string[]`、漏掉 `modelCapabilities` 的漂移，并把 delegation result/message body/memory sourceRefs/import snapshot 从 `unknown` 收紧为共享 JSON value；Vue Memory 快照使用 `shallowRef` 避免递归 DTO 深响应式展开。
- ✅ **Agent Plugins / App Intents 已完成 canonical DTO 接线（2026-09-22）**：publisher keys、installations/versions、official/remote catalog+stage、artifact stage、verify/install/upgrade/uninstall/delete-data、frontend descriptor/RPC，以及 app-intent create/list/revoke/artifact metadata 已统一迁入 `protocol/agent-plugins`；artifact content range 继续保持 raw `ArrayBuffer`。迁移补齐旧 frontend plugin stage 的 `userId/source/createdAt/updatedAt`、manifest `nexus/agentSurface`、plugin app `surface/defaultApprovalMode` 等漏字段，并将 RPC/AppIntent/storage JSON 从 `unknown` 收紧为共享 JSON value。
- ✅ **Agent frontend transport 命名已改为破坏性 canonical DTO（2026-09-22）**：不再保留 `AgentRunView = AgentRunViewDto`、`PluginVersionView = AgentPluginVersionDto`、`AgentEnvelope = AgentEnvelopeDto` 等兼容 alias/re-export；41 个 Agent frontend 文件已直接改用 protocol `*Dto` 名称，严格扫描 alias/代表性 legacy transport name 均为 0，`vue-tsc` 与 frontend full build 通过。
- ✅ **Agent Workspace Runtime 已完成 canonical DTO 接线（2026-09-22）**：Host-side availability/catalog/storage/setup/tool-pack/runtime-cleanup/settings-reset/command/cache-cleanup 与 App-side workspace list/create/get/action/tool-version switch/artifact import-export 两组 HTTP surface 已统一迁入 `protocol/agent-workspace-runtime`；backend 共用 `workspace-runtime-dto.ts`，workspace profile 与 Run 共享同一 environment mapper。frontend 本地 Workspace Runtime wire interface、旧 `*View` 名称、`result/current/proposed: unknown` 与 backend 本地 workspace request interface 均清零。迁移同时修复 settings-reset confirm 旧 frontend 错把 domain `AgentSettingsView` 当完整 Host `AgentSettingsViewDto` 的漂移：confirm 改用专用 result DTO，随后显式重取完整 Host settings。
- ✅ **Agent event WS / durable event union 已完成 canonical protocol 接线（2026-09-22）**：`protocol/agent-events` 现为 durable run event、host event、ephemeral run event 与 subscribe/unsubscribe/subscribed/event/error WS envelope 的单一来源；backend state-commit、RunEvent/HostEvent、host outbox、transient event pipeline 与 WS session 均直接消费该 contract，并在 SQLite decode 边界对持久化 event name 做 fail-closed validation。frontend `agent-events.ts` 删除本地 `AgentWireMessage/AgentWireEventPayload/AgentSubscriptionRequest`，subscribe/unsubscribe 直接构造 protocol DTO；同时移除旧 projector 中并非 durable event 的 `checkpoint.resume` 漂移项。backend build、frontend full build、legacy WS declaration / compatibility alias 扫描均通过。
- ✅ **Agent terminal WS 已完成 canonical protocol 接线（2026-09-22）**：`protocol/agent-terminal` 现统一定义 attach query、`resize | signal | close` client control 与 `ready` server control；PTY stdin/stdout/stderr 继续保持 raw binary bytes。backend upgrade parser 与 terminal session、frontend terminal channel 均直接消费 protocol DTO，text frame 继续执行 runtime validation；frontend 额外校验 `ready.generation` 与当前 workspace generation 一致。backend build、frontend full build、local terminal wire/interface/compatibility alias 扫描均通过。
- ✅ **architecture guard 与最终回归已闭环（2026-09-22）**：新增 `scripts/check-transport-contract-boundaries.mjs` 并接入 root `lint`；当前 guard 覆盖 **93 个 frontend/backend network adapter 文件 + 335 个 frontend 文件 + 2 个 Agent WS adapter**，禁止 adapter 内重新声明本地 `*Dto`、DTO→旧名兼容 alias，以及 Agent WS 重新定义本地 Wire/Message/Request/Response/Envelope contract。guard 首次运行还抓出并删除了遗留 `workspace-protocol.types.ts` compatibility alias。历史 closure 的 root `build/lint` 已通过；本次当前 HEAD 收尾复核再次通过 architecture guard、Agent ESLint、Backend/Agent Runner typecheck、Frontend `vue-tsc + vite build`，Agent scenario suite **71/71 PASS**。
- ✅ **durable 漂移静默消费已关闭 2026-09-22**：projector 遇到带 durable `id` 的 unknown event 会 fail-closed，不再推进 cursor；这一条是行为防线，不能替代 canonical protocol。
- ⏸ **backend 单元测试保持冻结**：本轮只做现有 build / lint / scenario / architecture guard 验证，不新增、迁移或补 backend unit test，除非后续明确重新授权。

完成标准（此项全部满足后才可标记关闭）：

1. 所有真实 frontend↔backend JSON HTTP / WebSocket request、response、event contract 均由 `packages/protocol` 单一来源定义；文本/Blob/二进制 payload 仅对其结构化 metadata 建 DTO。
2. backend route/WS adapter 显式完成 domain↔DTO mapping；不得把 service/repository domain model 当作“碰巧长得一样的 wire type”直接当协议来源。
3. frontend network API 直接消费 protocol DTO；仅在字段完全一致时允许 app model 作为 type alias，带本地状态的 UI ViewModel 必须继续与 DTO 分离。
4. 运行时边界继续执行 `unknown -> parser/validation -> RequestDto -> domain`，不能因为共享 TypeScript 类型而删掉输入校验。
5. 增加 architecture guard，阻止在 `features/*/api`、`interfaces/http/*`、WS protocol adapter 中重新定义新的重复 wire DTO。
6. backend/frontend 全量 build 通过；Agent/Workspace 迁移后再跑其现有 regression / scenario suite。**以上条件已于 2026-09-22 全部满足，§3.2 关闭。**

### 3.3 前端状态与事件传递方式偏"隐式全局"（P1，✅ 当前问题已闭合 2026-09-22）

同一个 host 事实要跨组件传播，目前用了三套机制叠加：

1. ✅ **window CustomEvent 全局总线已关闭 2026-09-22**：`nexus:agent:thread-changed` / `authorization-changed` / `memory-changed` / `host-changed` 已迁移到 `host/agent-host-events.ts` 的类型化模块事件总线；发布与订阅都受 `AgentHostEventMap` 约束，组件卸载时显式取消订阅。`features/agent` 内上述 4 个 `nexus:agent:*` CustomEvent 扫描为 0，frontend `vue-tsc --noEmit && vite build` 通过。
2. **跨标签 BroadcastChannel + navigator.locks 选主**：`host/AgentSurfaceHost.vue`（leader 订阅 + 广播）。
3. **组件内 ref + `agentSurfaceSession` 的 Map 视图状态**（`host/surface-session.ts`，109 行）。

风险：谁在什么时候改了 `summary` 难以追踪；✅ **2026-09-22 已补 `refresh()` generation 守卫**，同一用户的并发 summary 请求只允许最新请求提交到 `summary`，旧响应仍可作为调用方游标参考但不会覆盖新状态；用户切换/卸载后的旧响应也会丢弃。✅ 同日已移除 window CustomEvent 这一套隐式通道。

> **复核结论（2026-09-22）**：剩余的 `BroadcastChannel + navigator.locks` 与 `agentSurfaceSession` **无需继续合并**。前者仅负责跨标签 Host stream leader 选举/广播；后者仅保存当前标签页、按 App 隔离的草稿与视图选择；权威 Host summary 只有 `AgentSurfaceHost.summary` 一个写入点。两者作用域与生命周期不同，不构成重复权威状态源。保留当前分层，后续除非职责重新重叠，不再推进“统一成一个 store”的重构。

### 3.4 静默失败与状态吞错（P1）

- ✅ **静默丢操作已关闭 2026-09-22**：`execute()` 在全局 `busy` 时不再直接 `return undefined`；现在会通过统一 `useOperationFeedback` 明确提示“已有设置操作正在进行”，并记录稳定错误 cause。全局 busy 锁本身仍保留，后续若要改为 per-operation 互斥应单独设计，避免同时改动多个子面板的禁用/关闭语义。前端 `vue-tsc --noEmit && vite build` 通过。
- ✅ **已关闭 2026-09-22**：`host/AgentAppSurface.vue` 的 `refreshRun()` 不再 `catch { return null; }` 静默吞错；失败会写结构化 `logger.warn`，默认同步到现有错误横幅。仅 `recoverRuntimeFailure()` 这条已经持有原始 mutation 错误的恢复链会显式关闭二次错误覆盖，避免把主错误替换成后续 refresh 错误。前端 `vue-tsc --noEmit && vite build` 通过。
- ✅ **已关闭 2026-09-22**：`refreshCurrentCheckpoints()` 不再把请求失败伪装成空 checkpoint 列表；现在失败会记录结构化日志并走现有错误横幅，同时增加 generation + run-id 守卫，避免切换 Run 后旧响应覆盖新 Run 的 checkpoint 状态。前端 `vue-tsc --noEmit && vite build` 通过。
- ✅ **已关闭 2026-09-22**：`copyKeyId` 不再吞掉 Clipboard API 失败；失败现在通过设置区已有的 `useOperationFeedback` 统一错误链反馈，并保留 cause 进入结构化日志。前端 `vue-tsc --noEmit && vite build` 通过。

建议：统一 "操作失败必须可见"（toast + inline error），并把 `busy` 从"全局锁"改为 per-operation 互斥。

### 3.5 死代码与 i18n 冗余（P2）

- **i18n（✅ 已关闭 2026-09-23）**：原记录为"每种语言 1,148 个叶子 key，其中 274 个（约 24%）无引用，三语各存一份 ⇒ 约 822 条死文案"。
  本轮把"无引用"从一次性脚本结论升级成**常驻门禁**，并清掉当前真正不可达的 key：`scripts/check-agent-i18n.mjs` 新增第 4 条守卫（key 可达性），
  三语字典从 **1,467 → 1,392** 个叶子 key，删除 **75 × 3 = 225** 条死文案。
  典型删除项：`agent.operations.environmentRecipes`、`agent.files.used`、`agent.hub.appActivity`、`agent.ui.budget`、`agent.tasks.progress`、
  `agent.settings.hardLimits.preset*`。详见 §7.40。
- **死变量（✅ 已清理 2026-09-22）**：`taskRailWideViewport` 与无效 `resize` 监听已删除（§1.6）。
- **无效样式类**：§1.1 的 158 处。
- 以上三类问题都能被规则检查拦住（§3.6）。

### 3.6 工程保障与测试策略（P1，✅ 非 UI 核心项已闭合 2026-09-22）

- ✅ **基础 lint 门禁已关闭 2026-09-22**：新增 ESLint flat config 与根级 `lint / lint:agent` 脚本，覆盖 Backend Agent、HTTP/WebSocket Agent interface、Agent Runner、Frontend Agent、Agent scenario runner；启用 `@typescript-eslint/no-unused-vars` 与 `vue/no-use-v-if-with-v-for` 为 error。首跑实际发现 **47** 个 unused import/type/helper/局部变量，逐项确认后清理；backend / frontend / agent-runner build 均已有通过记录。**未定义 utility 类、未使用 i18n key、设计 token 等需要自定义规则，仍开放，但属于后续 UI / i18n / design-system 门禁，不阻塞本轮非 UI 收尾。**
- ✅ **scenario 单文件与串行问题已关闭 2026-09-22**：`tests/backend/agent-scenarios/runner.ts` 当前为 **258 行编排器**，场景已拆为 **71 个独立 `*.scenario.ts` 文件**；runner 以 `SCENARIO_CONCURRENCY` 分批 `Promise.all` 执行可并发场景，仅 `SERIAL_SCENARIOS` 中显式列出的共享资源场景保持串行。失败仍会聚合并最终非零退出，不会因首个失败遮蔽后续结果。
- ✅ **源码形态正则架构测试已关闭 2026-09-22**：当前扫描未发现 scenario 通过 `readFileSync` 读取 `packages/backend/src` / `packages/frontend/src` 源文件做 source-shape 断言。现存 `readFileSync` 与 `assert.match/doesNotMatch` 用于 Workspace 文件内容、checkpoint、projection、fingerprint 等**运行行为/数据结果**断言，不再以源码排版、命名或字符串形态充当架构门禁；transport 等架构约束已迁入独立 guard/lint。
- ✅ **工具摘要英文硬编码的残余已收敛 2026-09-23**：用户可见的工具摘要改由 `ToolResult.userSummary` 旁路承载（见 §1.8 / §7.39），`tools/host/**` 16 文件 52 处 + 4 条 state-commit 失败摘要全部本地化。**仍属"非 UI 残余"、明确保留英文的三处**：`tools/host/mcp-tools.ts` 的远端摘要（远端不可信内容不应进本地字典）、`runtime/execution/execution-errors.ts` 的执行期错误前缀（`${context.summaryPrefix}: ${detail} [CODE]`，模型与用户共用的证据文本）、以及 `supersedeMutationTool` 的 `command.reason` 自由文本。三者都依赖 Runner / 远端才能触发，本环境 `runner_not_configured`，无法实测。
- ⏸ **缺模块级 backend 单测保持冻结 / 不实施**：按当前明确要求，本轮及后续接手者**不要新增、迁移或补 backend unit test**；除非后续再次得到明确授权，否则保持现状。此项仅保留为审计记录，不计入本轮待改总数。

**本轮非 UI 工程保障收尾结论**：scenario runner 模块化、受控并发、source-shape 架构断言迁出、transport architecture guard 与基础 ESLint 门禁均已落地。后续工程规则新增项主要是 i18n / design token / utility class 等 UI-facing 静态检查，不再继续扩张本轮非 UI 改造范围。

### 3.7 后端结构观察（多数是优点，附两点提醒）

正面：

- `src/modules` 下**没有**其他模块直接 import agent 的实现（唯一入口是 `modules/agent/public.ts`、`bootstrap/agent/*`、`interfaces/*`），模块隔离做得干净。
- 前端只有 `app/App.vue`、`app/pages/settings/SettingsPage.vue` 通过 `features/agent/public` 引入 agent，符合 `FRONTEND.md` 的依赖规则。
- 工具执行治理集中在 `GovernedMutationExecutor`，与文档描述一致；`event-hub`、`scheduler` 这类横切组件都很小、职责单一。

提醒：

1. ✅ **已关闭 2026-09-22**：`interfaces/websocket/agent-terminal-protocol.session.ts` 不再 deep-import `modules/agent/workspace-runtime/workspace-runtime-interactive-session.port`；`modules/agent/public.ts` 已 re-export `WorkspaceRuntimeTerminalAttachment`，WebSocket interface 只从 Agent public surface 取该类型。后端 TypeScript build 通过。HTTP Agent interface 的同类私有 deep-import 后续也已全部收口，见提醒 4。
2. `modules/agent` 187 个文件中有 **53 个 `.port.ts`**。端口化方向是对的，但接近 1:1 的单实现端口会增加阅读与变更成本，建议定期抽查"是否所有 port 都真的提供了可替换性"。
3. ✅ **已关闭 2026-09-22**：5,112 行生成的 model capability registry 已从 `modules/agent/ai/` 移到 `modules/agent/data/model-capability-registry.snapshot.ts`，运行时引用与 `agent:model-registry:sync` 输出路径同步更新。执行干净 backend build 后，`dist` 中只生成 `modules/agent/data/model-capability-registry.snapshot.js`，不再把生成数据混在 AI 逻辑目录。
4. ✅ **HTTP interface 私有 deep-import 已全部关闭 2026-09-22**：先后将 `JsonValue`、runtime request DTO 所需类型、`MemoryStatus`、`IntegrationKind`、`AGENT_CAPABILITIES`、`AgentCapability` 与 `resolveAgentAvailability` 收口到 `modules/agent/public.ts`；`agent-route-input.ts`、`agent-runtime-route-input.ts`、`app-collaboration.routes.ts`、`app-integrations.routes.ts`、`agent.routes.ts` 均只通过 Agent public surface 访问这些边界符号。backend TypeScript build 通过，`interfaces/http/agent` 对 `modules/agent/(?!public)` 的扫描结果为 **0**。

---

## 4. 需要产品/设计决策的开放问题

这些问题不是"改 bug"，而是需要先定方向：

1. **Agent Hub 是模态还是常驻？** 如果目标是"终端运维助手"，用户必然需要边看终端边用 Agent；当前模态遮罩把两者对立起来。
2. **多 App 标签的真实价值？** 现在同时安装多个 App 时切换标签会卸载整个 surface（无 keep-alive）。若主要场景是"同一个 App 多会话"，多 App 标签的复杂度（tab 管理 + 每 App 独立视图状态 + 全量重载）收益存疑。
3. **用户可见概念要收敛到几层？** 当前一处 Run 详情里同时出现 Goal / Plan / Step / Verification / Checkpoint / Lease / Reconciliation / Subagent / Mailbox / Shared Facts。建议定义"默认可见 3 个概念（目标、计划、动作与结果）+ 高级信息折叠"。
4. **工具输出是给模型看的还是给人看的？** 现在一条 `summary` 同时承担两种职责（§1.8）。
5. **个性化能力的边界**：列表缩放、任务栏卡片拖拽排序、窗口几何持久化，哪些是真实需求？
6. **危险操作的确认强度**：`full_access` 批准模式在 Composer 里一键切换（`host/AgentAppSurface.vue` approval popover），是否需要更强提示或与设置页绑定？

---

## 5. 建议的修复顺序

0. **P0 先修两处"会让人以为功能没做"的崩溃点**：① `openRunDetail` 的 `Promise.all` 无隔离 → 8/22 个 Run 打不开详情（§1.10）；② composer 工具条裁切根因（`max-w-3xl` 封顶 + 容器查询监听错容器）→ 默认窗口下"思考强度"已不可见（§7.14-a）。这两条都不需要设计决策，且修完立刻可见。
1. **P0 样式与文案**：**先定"玻璃层"配方**（§7.1：`--color-card` 是否半透明 + 统一 `.glass-surface`），再补 token（或替换 158 处类名）——否则会一次性改掉所有弹层观感；补 `agent.ui.saveFailed`；清掉硬编码 `'未设置'` / 英文 fallback；顺手清掉无效间距类（§7.8）。
2. **P0 无障碍底线 · ✅ 已关闭 2026-09-23**：Hub 已支持 `Esc`、打开聚焦、关闭恢复焦点、背景 `inert`，并覆盖 Hub-owned Teleport。
3. **P1 定位决策**：模态 ↔ 非模态 / docking（需要产品拍板，决定后续所有布局工作）。
4. **P1 交互减法**：Composer 拆分（发送/停止独立、配置外移）、删除列表缩放与卡片拖拽排序、空态静态化。
5. **P1 排版基线**：字号下限、对比度、点击目标尺寸、统一圆角/边框/阴影。
6. **P1 主题合规**：清理硬编码调色板。
7. **P1 主界面（第二轮，详见 §7.9）**：先把"玻璃层"固化成 `.glass-surface` 并把 `--color-card` 定为半透明，再修 composer 工具条静默裁切（§7.3）、"回到最新"位置（§7.4）、助手气泡/空态卡片/任务栏的表面（§7.5）。
8. **P1 设置区精致度**：先定 §6.6 的三档按钮/行结构/圆角规范，再按 §6.7 的 Top-10 逐项替换（移除模型、SubagentSettings、ACP/Browser/MCP 三面板优先）；设置区自绘下拉统一换成主界面弹层组件（§7.6）。
9. **P2 协议与工程**：抽共享协议包、接入 ESLint、拆巨型文件与测试、清理死 i18n。
10. **P2 状态与错误**：类型化 host store、失败必可见、streaming 文本不丢（keep-alive 或把 streaming 状态提到 App 级）。

---

---

## 6. 设置区 UI 精致度复查（补充）

> 目标：让设置区达到「Agent 浮窗里选择模型」那种精致度。本节先固化基准，再逐文件列出差距。
> **注意**：用户明确参考的就是"选择模型弹层的透明质感 + 模糊"。这套观感的成因（`bg-card` 死 token 导致的无填充 + backdrop blur）已在 §7.1 拆解，本节只讲"结构与节奏"，视觉配方请以 §7.1 为准。

### 6.1 基准：浮窗模型选择为什么"精致"（把它固化成规范）

参考实现：`host/AgentAppSurface.vue:1703-1762`（模型）、`:1818-1900`（执行模式/批准策略）、`:2240-2290`（SSH 目标）。
它的"精致"来自 6 条可复制的要素：

1. **固定面板节奏**：`panel-class="w-72"` + `max-h-64 overflow-y-auto` + `space-y-1`，弹层由 `AgentConfigPopover` 统一负责定位/视口 clamp/Escape/焦点返回/全局单开互斥。
2. **行级三段式结构**：前导图标方块（`h-6 w-6 rounded-lg border`，随状态换底色）→ 两行文本（`text-xs font-medium` 主 + `text-[10px] text-text-secondary` 辅）→ 尾部 `fa-check` 选中标记。
3. **三态定义清晰**：选中 `border border-border/80 bg-card font-medium text-foreground shadow-xs`；未选中 `border border-transparent text-text-secondary`；hover `hover:bg-card/70`。（注意这里的 `bg-card` / `hover:bg-card/70` 现在都是死 token，选中态实际只靠 `border` 表达——见 §7.1。）
4. **不可用仍可见**：`opacity-55 cursor-not-allowed`，并保留在列表里，用副标题解释原因（不是直接隐藏）。
5. **交互闭环**：点击后 `close(true)` 关闭并把焦点还给触发按钮；外部点击/离开会把弹出层收回。
6. **图标语言一致**：一律 Font Awesome 实心小图标 + 语义色（`text-success` / `text-primary` / `text-warning`），不用浏览器原生控件。

**结论**：设置区要"精致"，本质是把上面 6 条搬过去，而不是继续堆 `rounded border px-2 py-1 text-xs`。
**补充（第二轮）**：6 条里真正决定"高级感"的其实是第 1 条背后的面板质感——`rounded-2xl + border-border/70 + ring-1 ring-border/20 + shadow-2xl + backdrop-blur-md`。请连读 §7.1，避免只抄节奏、抄不到质感。

### 6.2 设置区现状：同一个"主按钮"有 6 套写法

| 写法                                                                                   | 位置                                                                                                 | 特征                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| `rounded bg-primary px-3 py-1.5 text-xs text-white`                                    | `AcpRuntimeSettings.vue:262/319`、`BrowserRuntimeSettings.vue:203`、`McpIntegrationSettings.vue:310` | 圆角 4px、无 hover、无阴影、无按下反馈        |
| `rounded-md bg-primary px-4 py-2 text-sm`                                              | `SubagentSettings.vue:263`、`AppExecutionPolicySettings.vue:246`                                     | 圆角 6px、`text-sm`（比别处大一号）、无 hover |
| `rounded-lg bg-primary px-4 py-2 text-xs font-medium shadow-sm hover:bg-primary/90`    | `BudgetContextSettings.vue:343`、`PerformanceSettings.vue:125`                                       | 圆角 8px、有阴影                              |
| `inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs shadow-sm`    | `HardLimitsSettings.vue:142`                                                                         | 固定高度 32px                                 |
| `inline-flex h-9 ... rounded-xl px-4 text-xs font-semibold shadow-2xs active:scale-95` | `SafetyNetworkSettings.vue:451`                                                                      | 圆角 12px、高 36px、有按下反馈                |
| `rounded-lg bg-primary px-4 py-2 text-xs font-semibold shadow-sm active:scale-95`      | `ModelProviderSettings.vue:1570`、`StorageArtifactSettings.vue:152`                                  | 圆角 8px + 按下反馈                           |

同一屏内还并存 5 档圆角（settings 目录统计：`rounded` 152 次、`rounded-md` 55 次、`rounded-lg` 123 次、`rounded-xl` 80 次、`rounded-2xl` 15 次），以及 3 套"裸按钮"：`rounded border border-border px-2 py-1 text-xs`（`AcpRuntimeSettings.vue:278`、`BrowserRuntimeSettings.vue:127`、`McpIntegrationSettings.vue:255/378/387/418`）、`rounded-lg border bg-background px-3 py-1.5 text-xs`（`MemorySettings.vue`）、`rounded-lg border bg-card px-2.5 py-1.5 shadow-2xs active:scale-95`（`SafetyNetworkSettings.vue`，最接近浮窗风格）。

**这就是"添加模型 / 移除模型按钮粗糙"的根因**：设置区没有统一的按钮/控件规格，每个面板作者各写一套。

> ✅ **2026-09-23 第一批闭环（主操作档 → Gen2 三档里的 solid/primary）**
>
> - **现象（修复前 CDP 实测，同屏）**：实心主按钮并存 `添加 Provider 122×28 fs12 r8`、`保存 56×32 r8`、`创建 Integration 110×28 fs12 r4`、`保存浏览器配置 108×28 r4`、`保存 Profiles 90×28 r4`、`保存配置档 102×36 fs14 r6`、条目内 `校验插件包 102×24 r8`、`添加仓库 h-8`…即 §6.2 说的"6 套写法"在界面上完全成立（3 档高度 24/28/32/36、2 档字号、4 档圆角）。
> - **根因**：这些按钮是**逐处手写的 class 串**（`bg-primary` + 各自的 `rounded/py/text-size/hover/disabled`），没有共用控件；`disabled:opacity-50` 又让禁用态继续保留品牌色（§7.13-e）。
> - **改法**：把「实心主操作」统一换成设计系统控件 Gen2 `UiButton appearance="solid" tone="primary"`（33 处：27 处静态 class + 6 处动态 `:class` 的启停/保存按钮）。它自带 `--ui-control-height: 32px`、`font-size: 12px`、`radius: 8px`、hover/active/焦点环，并把禁用态换成**中性填充 + 中性描边 + 中性文字**（不再"品牌色 × 0.5"）。语义对照 §6.6 的三档：主操作 = `solid + primary`，次操作 = `soft + neutral`，危险 = `soft + danger`（第三批施工）。
> - **CDP 验证**：三组设置页逐按钮实测，主操作档全部为 `…×32 fs12px r8px`——`添加 Provider 119×32`、`创建 Integration 112×32`、`保存浏览器配置 108×32`、`保存 Profiles 92×32`、`保存配置档 84×32`、插件条目 `校验插件包 / 重新校验包 105×32`；禁用态实测为 `bg rgb(243,244,246) + border rgb(209,213,219)`（中性），不再是品牌紫。行为回归：`添加 Provider` 仍正常打开「添加模型服务商」弹窗。
> - **未覆盖（后续批次）**：次操作/危险/图标档的裸按钮（`立即更新` 77×28 fs11 r6、`模型与测试` 117×26、`添加配置档` 86×34 r6、`卸载` r12…）、设置区分组导航胶囊（`115×36 r12`）、以及 §6.3 的行结构问题。

> ✅ **2026-09-23 第二批闭环（次操作 / 危险 / 图标档 + 禁用态）**
>
> - **现象（第一批之后实测）**：主操作已统一，但次操作/危险档仍是手写串，同屏并存 `立即更新 77×28 fs11 r6`、`模型与测试 (1) 117×26 r8`、`添加配置档 86×34 r6`、`刷新 42×26 r4`、`卸载 69×30 r12`、`关闭 Agent 90×30 r8`、删除服务商 `28×28`；provider 卡片行内还出现 26 / 28 / 32px 三档混排。
> - **改法**：次操作 → `UiButton appearance="soft" tone="neutral"`；危险 → `soft + danger`；纯图标 → `ghost + icon-only + density="compact"`（28×28，与 §6.6 第 2 条的 `h-7 w-7` 一致）；动态态按钮（provider/插件启用停用、`更新模型` 抽屉开关、测试弹窗里的"取消已添加"）改用 `:appearance` / `:tone` 绑定。共 65 处。禁用态随之统一为 Gen2 的中性填充（`rgb(243,244,246)` + 描边 `rgb(209,213,219)`），替代原来的"品牌色 × `opacity .5`"。
> - **CDP 验证**：三组设置页逐按钮实测，动作按钮全部为 `…×32 fs12px r8px`；主操作紫 `rgb(160,108,213)`、次操作中性 `srgb(0.928…)`、危险为 soft-danger（`关闭 Agent` 84×32 实测 `bg srgb(0.984 0.905 0.912)`）、禁用中性灰；同排控件高度一致性扫描只剩一处误报（按钮 32px vs 文本 label 13px）。批 1 里 6 处动态按钮漏掉的 `UiButton` import 也在本批补上（`AgentFeatureSettings` / `AppManagementSettings` / `SafetyNetworkSettings`）。
> - **未覆盖**：设置区分组导航胶囊（`115×36 r12`）、顶部 Tab（36px）、预设卡（290×104）、`QuantityInput` 的单位切换（`18×20` 命中区，属点击目标问题）、以及 §6.3/§6.7 的行结构与原生控件改造。

> ✅ **2026-09-23 第三批闭环（分组导航胶囊 + 备用模型触发器）**
>
> - **现象（修复前 CDP 实测，同屏）**：Agent 设置区顶部三枚分组胶囊是 **`115×36 / fs12 / r12`**，
>   而同页 Gen2 动作按钮（`添加 Provider 119×32`、`保存 48×32`、`模型与测试 (11) 127×32`）全部是
>   **`32px / fs12 / r8`** —— 同一屏两套规格，胶囊比按钮高 4px、圆角大 4px。同一轮全量扫描还抓到
>   `添加备用模型` 触发器是 **`137×36 / fs13`**：一个 Gen2 控件被单独传了 `density="comfortable"`。
> - **根因**：① 分组胶囊不是控件而是手写 `<button>`（`AgentSettingsPanel.vue:541`，`min-h-9 + rounded-xl`），
>   当初按"胶囊导航"单独设计，没跟 Gen2 的 `--ui-control-height: 32px` / `--ui-control-radius: 8px` 对齐；
>   ② 备用模型触发器是设置区里唯一没走默认密度（`[data-density='comfortable']` = 36px / fs13）的 `UiPopover`。
> - **改法**：① 胶囊 `min-h-9 → min-h-8`、`rounded-xl → rounded-lg`（只动高度与圆角；字号 `text-xs`、图标、
>   hover、`aria-current`、`aria-controls` 全部原样）；② `添加备用模型` 的 `UiPopover` 删掉 `density="comfortable"`，
>   回落默认档。**顶部 Tab 保持 36px / fs14 不动** —— 它是全局设置页跨页共用的 chrome，按约定不在本轮范围。
> - **CDP 复验**：胶囊 **`115×36 r12` → `115×32 r8`**（三枚一致，激活态仍是品牌紫 `rgb(160,108,213)` + `aria-current="page"`）；
>   `添加备用模型` **`137×36 fs13` → `133×32 fs12 r8`**（与同页 `添加 Provider` 完全同规格）。
>   重扫三页"非 32px 控件"清单后，Agent 设置区**自己的**控件里只剩：顶部 Tab（36px，约定不动）、
>   预设卡 `290×104`、`QuantityInput` 的 `…×34`、以及 §7.15-f 的原生 `<select>` / 少量 `<input>`。
> - **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check` 全绿。

> **第二轮补充（重要）**：上表里所有 `text-xs` / `text-[11px]` 写法在浏览器里**全都不生效**，实测按钮字号一律是 16px —— 根因是 `app/styles/global.css:26-33` 的 `button { font: inherit }` 未分层，压过了 `@layer utilities` 里的字号类。**这一条必须先修**，否则把 6 套写法统一成 1 套之后，字号仍然是错的（详见 §7.10）。

### 6.3 添加/移除模型的逐处问题（ModelProviderSettings.vue）

| 位置                                             | 现状                                                                                                                                          | 问题                                                                                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 服务商工具条 `:1178-1238`                        | 「测试」`rounded-lg border px-2.5 py-1 text-xs`、「更新模型」同款、「启用/停用」`rounded-lg px-2.5 py-1`、删除 `h-7 w-7` 图标按钮             | 同一行 3 种高度/内边距；删除按钮没有二次确认（浏览器 `title` 之外无提示），而线程删除要两次点击、服务商删除有弹窗                                            |
| 协议切换 `:1143-1152`                            | 原生 `<select class="h-6 rounded-md ... text-[10px]">`                                                                                        | 原生下拉外观 + 10px 字号，与浮窗里的 `AgentConfigPopover` 完全不是一套语言                                                                                   |
| 可添加模型列表 `:1384-1421`                      | 原生 `<input type="checkbox" class="rounded border-border/80 accent-primary">` + 行内 `rounded-md px-2 py-0.5 text-[11px]` 的「添加」文本按钮 | 无 icon tile、无两行文本、无选中态；勾选框是浏览器原生样式（`accent-primary` 只能改颜色）；行内按钮 11px、无 icon                                            |
| 一键添加/多选添加 `:1323-1348`                   | 「多选添加」实心 primary 与「添加所有」描边 primary 并排                                                                                      | 两个语义相近的批量动作视觉权重相近，用户容易点错                                                                                                             |
| 已生效模型列表 `:1509-1536`                      | 单项「移除」是 `text-[11px] text-error` 纯文字（无图标、无底色、无确认）                                                                      | 最典型的"粗糙"：危险操作看起来像普通文字；不可移除时只降透明度                                                                                               |
| 批量「移除全部」`:1479-1488`                     | `border border-error/40 bg-error/10` 按钮，点击**立即**执行                                                                                   | 与产品其他危险操作（会话删除两段式、服务商删除弹窗）确认强度不一致；没有撤销                                                                                 |
| 抽屉底部 `:1540-1560`                            | 「已自动保存」绿胶囊（顶部还在显示「正在保存/已自动保存」）+ 底部 `autoSaveHint` 文案 + 「关闭」按钮                                          | 同一条"自动保存"信息出现 3 次，抽屉视觉噪音大                                                                                                                |
| 能力编辑弹窗 `ModelCapabilityEditor.vue:179-402` | 原生 number / checkbox / select；「恢复默认」是 `text-primary hover:underline` 文本按钮；来源标签 `text-[10px]`                               | 弹窗外壳用了 `BaseModal`（好），但内部仍是朴素表单；文本链接式按钮与浮窗按钮语言不一致                                                                       |
| **备用模型链 `:1062-1083`（第二轮新增）**        | `v-for` 渲染**该 Provider 除默认模型外的全部模型**（实测 6 个模型 → 5 枚按钮），无搜索/无折叠/无序号                                          | 不是"已选列表"而是"全部模型按钮墙"；"按顺序勾选"的顺序**在界面上完全不可见**（无序号、无拖拽、无上移下移、无单项移除）；模型一多就会撑爆卡片（详见 §7.11-c） |

> ✅ **2026-09-23 部分闭环（原生 checkbox 部分，见 §7.20）**：本表里所有"原生 `<input type="checkbox">`"写法（可添加模型列表、能力编辑弹窗、应用能力授权、禁用目标、MCP/ACP/Subagent 等）已统一为 Gen2 `UiCheckbox`，实测 `16×16 / r5 / role=checkbox` + Gen2 焦点环。
> ✅ **2026-09-23 追加闭环**：11px 纯文字按钮已收成 Gen2 `UiButton`（soft + compact，danger/neutral 分档）并给「一键取消」补了确认弹窗（§7.34）；协议/强度等原生 `<select>` 已全部换成 `UiSelect`（§7.32）。批量动作的视觉权重随 §7.30 的动作簇收敛一并调整。

**第二轮实测（把"粗糙"量化）**：同一屏内 `添加 Provider` 144×38/16px、`关闭 Agent` 109×40/16px、`立即更新` 77×28/11px、服务商行 `模型与测试(6)` 144×36、`更新模型` 107×36、`停用` 54×36、删除 28×28 —— **3 档高度、2 档字号、4 档圆角**；其中"停用 / 删除"这两个危险操作的视觉权重低于"模型与测试"，删除还只有 28×28 且点击即执行（详见 §7.11-b）。

### 6.4 其他设置面板的粗糙点

- **SubagentSettings.vue（差距最大）**：
  - `:217-221` `subagentLabels` 三条中文硬编码（`最大委派深度` 等），未走 i18n；
  - `:334-390` 原生 `input/select class="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"`（4px 圆角 + `text-sm`）；
  - `:339` `profile.role` 是自由文本框，新建时被填入英文 `'Bounded child agent'`（`SubagentSettings.vue:92`）；
  - `:400-425` 允许模型/能力用裸 `checkbox + text-xs`；
  - `:437` 「移除 profile」= `class="text-xs text-error"` 纯文字按钮，无图标、无确认；
  - `:263`/`:449-456` 保存按钮 `rounded-md px-4 py-2 text-sm`，与设置区其他主按钮不一致。
- **AppManagementSettings.vue**：权限勾选用原生 checkbox（`:765-800`）；目标范围下拉的选项是硬编码英文 `All targets` / `Specific IDs`（`:812-813`）；能力名称/描述整块中文硬编码（`:335-425`，含兜底 `系统底层能力声明`）；`appVisuals` 的 `summary` 为中文，`badge` 字段一半是 i18n key（`agent.settings.apps.coreOfficial`）一半是中文原文（`:446-470`）——同一个字段两种语义，`en/ja` 下必然露中文。
- **MemorySettings.vue**：顶部「重载」（`:268-276`）与底部动作按钮（`:371-475`）规格不一；原生 `<select>` 没有 `label for/id` 关联（`:283/293/410/423`）。
- **PluginManagementSettings.vue**：多处文案硬编码（`:336` `扩展生态与仓库`、`:391` `签名验真通过`、`:584` `第三方扩展仓库`、`:655` `已启用/已安装`、`:658` `未安装`、`:816` `个密钥`），安装/校验流程按钮与 `SafetyNetwork` 风格不一致。
- **AcpRuntimeSettings / BrowserRuntimeSettings / McpIntegrationSettings**：三处的"添加 / 移除"都是 `rounded border border-border px-2 py-1 text-xs`（无图标、无 hover、无阴影），且主按钮 `rounded bg-primary ... text-white` 无 hover/active 反馈——这三个面板基本是"功能能用、观感最糙"的一组。
- **PerformanceSettings / StorageArtifactSettings / BudgetContextSettings / SystemGuardrails / AgentFeatureSettings**：模板内硬编码中文（见 §6.5）。
- **AgentSettingsPanel.vue**：3 组胶囊导航（`:508-526`）在窄屏是 `flex-wrap` 折行，而 `doc/software-requirements/requirements/agent.md` 要求"手机使用选择器"；loading 是 `p-10 text-center`（`:497`）没有骨架屏；外壳 `rounded-xl` 里嵌 `rounded-2xl` 子卡（Memory/Safety/AppManagement），圆角层级反了。
- **SafetyNetworkSettings.vue**：反而是全设置区最接近浮窗基准的一个（`rounded-2xl` 卡片 + 头部横栏 + 状态胶囊 + 折叠 chevron + `h-8` 带 icon 的次要按钮 + `active:scale-95`）。**建议直接以它为设置区风格样本**，把其他面板对齐到它 + `AgentConfigPopover` 这两套现成实现。

### 6.5 文案层：设置区约 38 行硬编码中文 + 硬编码英文选项（P1 · ✅ 已关闭 2026-09-23）

模板内硬编码中文（脚本扫描 `<template>` 段落，settings 目录 38 行 / 9 个文件；另有 `ai/ConversationMessage.vue` 4 行）：

| 文件                           | 行号示例                                                            | 文案                                                                                        |
| ------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `ModelProviderSettings.vue`    | 1053 / 1063 / 1130 / 1137 / 1158 / 1796 / 1913 / 1916 / 1941 / 2041 | `未匹配到模型`、`个模型`、`已配密钥`、`复制接口地址`、`响应延迟:`、`上下文`、`输出`、`思考` |
| `PluginManagementSettings.vue` | 336 / 391 / 422 / 584 / 655 / 658 / 671-686 / 740 / 816             | `扩展生态与仓库`、`签名验真通过`、`已启用/已安装`、`未安装`、兼容要求说明                   |
| `AppManagementSettings.vue`    | 335-430 / 516 / 748 / 888                                           | 14 个能力名称与描述、`已启用 N/M`、`N/M 项已授权`                                           |
| `BudgetContextSettings.vue`    | 280 / 283 / 315 / 335                                               | `步`、`自定义微调`、`有效:`、`有尚未保存的预算变更`                                         |
| `StorageArtifactSettings.vue`  | 75 / 115 / 144 / 147                                                | `当前占用`、`产物存储上限与保留策略`、`有尚未保存的存储配额变更`                            |
| `PerformanceSettings.vue`      | 121                                                                 | `并发设置已更改，请点击保存`                                                                |
| `SafetyNetworkSettings.vue`    | 398                                                                 | `title="点击移出黑名单"`                                                                    |
| `SystemGuardrails.vue`         | 21                                                                  | `系统硬边界`                                                                                |
| `AgentFeatureSettings.vue`     | 52                                                                  | `调度器支持多应用委派与动态预算管控`                                                        |
| `ai/ConversationMessage.vue`   | 311-334                                                             | `总消耗: ... (输入: ..., 输出: ...)`、`命中缓存:`、`预估 Token:`                            |

硬编码英文（在中文界面里同样突兀）：`AppManagementSettings.vue:812-813` `All targets` / `Specific IDs`；`SubagentSettings.vue:92` `Bounded child agent`。
`AgentSettingsPanel.vue:104` 的 `'未设置'`、`:108` 的 `'Agent request failed.'` 已在 §1.3 记录。

**第二轮实测（把上面这张表变成可复现的界面缺陷）**：把界面切到英文（`localStorage['user-locale'] = 'en-US'`）后，**Agent Hub 主界面 100% 英文**（`Conversation / Files / Agent Workspace / What would you like to work on? / Environment Insights / Send / High`，唯一的中文是用户自己建的会话标题），
但 **Settings > Agent 仍然剩下 29 个可见的中文文本节点**，且超出上表范围的新增项集中在"数值 + 单位"这类拼接文案上：

`执行步数保险丝`、`执行与超时控制`、`工具截断与上下文记忆`、`25 步 · 10 min`、`80 步 · 30 min`、`150 步 · 60 min`、`自定义微调`、
`≈ 1 小时 (3,600 秒)`、`≈ 2 分钟 (120 秒)`、`≈ 2 小时 (7,200 秒)`、`≈ 30 天 (2,592,000 秒)`、`(131,072 字节)`、`(262,144 字节)`、`(1,073,741,824 字节)`、`(10,737,418,240 字节)`、`(32,768 字节)`、`(8,388,608 字节)`、`6 个模型`、`已配密钥`。

> 结论：i18n 缺口**只在设置区**（`features/agent/settings/**`），Hub 是干净的——这让修复范围很明确。
> 另外注意"数字 + 单位"这类文案**不适合逐个 `$t`**：应为 `Intl.NumberFormat`（字节/步数）与 `Intl.RelativeTimeFormat`/`Intl.NumberFormat`（时长）配一个 `unit` 参数的 i18n 方案，否则日文界面同样会露馅。
> 截图：`doc/imgs/review-2026-09-21/agent-settings-agent-en-mixed-language.png`（英文界面里的中文）。

> ✅ **2026-09-23 闭环**：见 §7.14-c 的闭环记录——`features/agent/**` 里 116 行非注释硬编码中文已全部接入词典，
> 英文界面下 `Settings > Agent` 三个子页的可见中文文本节点从 **29 → 0**；"数值 + 单位"按上面这条建议改成了
> **formatter 收 `labels` 参数**（`settings/use-quantity-labels.ts`），而不是逐个 `$t` 拼字符串。

### 6.6 对齐基准的最小规范（可直接当实现清单）

1. **按钮只保留三档 + 明确尺寸**：主操作 `inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-white shadow-xs transition-all hover:bg-primary/90 active:scale-95 disabled:opacity-50`；次操作 `rounded-lg border border-border/80 bg-card px-2.5 py-1.5 text-xs font-medium hover:bg-header`；危险操作 `rounded-lg border border-error/40 bg-error/5 px-2.5 py-1.5 text-xs text-error hover:bg-error/15`（禁止无边框纯文字的危险按钮）。
2. **图标按钮统一** `h-7 w-7 rounded-lg hover:bg-header`（危险用 `hover:bg-error/10 hover:text-error`），并提供 `aria-label` + `title`。
3. **列表项统一走浮窗行结构**：`icon tile（h-6/h-7 rounded-lg）+ 两行文本 + 尾部动作/勾选`，选中态 = `border bg-card shadow-xs`；把「可添加模型」「已生效模型」「审批目标」「记忆条目」都改成这一种行。
4. **停用原生表单控件**：`select` → `AgentConfigPopover` 风格的 listbox；`checkbox` → 自绘圆形/方形勾选块（参考 SSH 目标行的 `h-5 w-5 rounded-full` 选中圆形）；`number` → 已有 `QuantityInput`（它已经是带单位药丸的精致控件，应在全设置区铺开，而不是只在预算/上限里用）。
5. **危险操作确认强度统一**：移除模型/移除全部/删除 profile/删除数据 都改成与「删除会话」一致的两段式（先变红再确认）或弹窗确认，并提供批量移除前的计数预览。
6. **消除重复提示**：自动保存状态只在抽屉顶部保留一处（`正在保存 → 已保存` 原位切换），删掉底部第三份 hint。
7. **文案全部走 i18n**：把 §6.5 的 38 行中文与 3 处英文迁移到 `features/agent/i18n/*.json`；`appVisuals` 的 `badge/summary` 统一成 i18n key。
8. **加载与异步**：列表用骨架屏替代 `p-10 text-center`；按钮内联 spinner 且保持宽度不跳动（现有 `fa-circle-notch fa-spin` 已足够）。
9. **圆角与边框收敛**：卡片只用 `rounded-xl`（或统一 `rounded-2xl`）+ 控件 `rounded-lg` + 胶囊 `rounded-full`；边框透明度只用 `border-border/60` 与 `border-border/80` 两档。
10. **导航与布局**：窄屏把 3 段导航换成 `select`/分段控件（符合 SRS 的"手机使用选择器"），并保证切换不滚动外层页面。

### 6.7 设置区优先修 Top-10

| #   | 位置                                                                   | 问题                                         | 改法                                                    |
| --- | ---------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------- |
| 1   | `SubagentSettings.vue:334-437`                                         | 原生表单 + 纯文字"移除 profile" + 中文硬编码 | 改用 §6.6 规范，移除按钮改图标按钮 + 确认               |
| 2   | `ModelProviderSettings.vue:1509-1536`                                  | 单项"移除模型"是 11px 纯文字                 | 行尾图标按钮 + hover 底色 + tooltip；保留不可移除态说明 |
| 3   | `ModelProviderSettings.vue:1479-1488`                                  | "移除全部"无确认                             | 两段式确认 + 显示将移除数量                             |
| 4   | `ModelProviderSettings.vue:1388-1430`                                  | 原生 checkbox 的"可添加模型"列表             | 换成浮窗式行 + 选中态 + 单一"添加"图标按钮              |
| 5   | `AcpRuntimeSettings / BrowserRuntimeSettings / McpIntegrationSettings` | 裸按钮、裸主按钮                             | 统一到三档按钮规范                                      |
| 6   | `AppManagementSettings.vue:335-430/812-813`                            | 能力文案中文硬编码 + 英文选项混排            | 迁 i18n                                                 |
| 7   | `AgentSettingsPanel.vue:508-526`                                       | 窄屏导航折行、不满足 SRS                     | 窄屏改选择器/分段控件                                   |
| 8   | `ModelCapabilityEditor.vue:179-402`                                    | 文本链接式按钮 + 原生控件                    | 用浮窗行结构与三档按钮重排                              |
| 9   | 全设置区                                                               | 6 套主按钮 / 5 档圆角 / 3 套裸按钮           | 收敛到 §6.6 的三档 + 3 档圆角                           |
| 10  | 全设置区                                                               | 约 38 行硬编码中文                           | 全部迁 i18n（可与 §3.5 的死 key 清理一起做）            |

> ✅ **2026-09-23 进度**：#4 / #8 里的"原生 checkbox"部分已关闭（27 处 → Gen2 `UiCheckbox`，见 §7.20）；#6 / #9 / #10 已由 §6.5（i18n）与 §6.2 批 1/2（按钮三档）关闭；#1 / #8 的剩余表单控件（原生 `<select>`）由 §7.32 关闭；#2 / #3（11px 文本按钮、无确认的批量移除）由 §7.34 关闭；#7（窄屏导航与窄屏动作簇）由 §7.27 / §7.30 关闭。**本节已全部闭环。**

## 7. 主界面布局与细节复查（第二轮）

> 本轮的参考基准由用户明确：**Agent 主界面里"选择模型"那个弹层的透明 / 模糊 / 高级感**。
> 因此本节先把这套观感拆成可复制的配方（§7.1），再逐层看主界面骨架（§7.2）、Composer（§7.3–7.4）、其它细节（§7.5）、以及设置区与主界面的落差（§7.6）。

### 7.1 先把"高级感"讲清楚：它是 `--color-card` 缺失的副产物（P0 · ✅ 已关闭 2026-09-23）

> ✅ **当前方案**：不再依赖“死 token 导致纯透明”的偶然效果。`.glass-surface` 统一使用 card token × 82% transparent mix + `blur(16px)` + 弱边框/阴影；DEV Gallery CDP 实测最终背景 alpha≈0.7544、16px radius。

模型弹层的实际组成（`files/AgentConfigPopover.vue:154`）：

```
fixed z-[60] max-w-[calc(100vw-24px)] overflow-y-auto
rounded-2xl border border-border/70 bg-card/95 backdrop-blur-md p-3
shadow-2xl ring-1 ring-border/20 outline-none
```

面板内部节奏由调用方给：`panel-class="w-72"` + `max-h-64` + `space-y-1`（`host/AgentAppSurface.vue:1705、1721`）。

关键点：`bg-card/95` 属于 §1.1 的死 token —— 编译产物里**没有 `.bg-card\/95`**（已核对 `dist/assets/index-*.css`）。
所以这个面板的真实渲染是 **"没有任何填充色 + backdrop-blur-md"**：背景完全透明，只有背后的内容被模糊，看起来就是"通透、有玻璃感、很高级"。

**实测确认（CDP 读计算样式，2026-09-21）**：弹出模型面板后实测 `background-color: rgba(0, 0, 0, 0)`（**完全透明**）、`backdrop-filter: blur(12px)`、`border: 1px oklab(...) / 0.7`、`border-radius: 16px`，而 `box-shadow` 在浅色底上**几乎渲染不出可见投影**。
也就是说这套"高级感"= **纯透明 + 12px 模糊 + 16px 圆角 + 一条 70% 描边**，半分填充色都没有；任何"顺手把 `--color-card` 补成不透明色"的修法都会当场改变它的观感（见下方建议 1/4）。

- 这个观感**不是设计出来的，是 bug 的副产物**：面板里没有任何"玻璃色"，全靠模糊 + `border-border/70` + `ring-1 ring-border/20` + `shadow-2xl` 撑着。
- 同一根因在主界面/设置区是**反向**结果：助手气泡 `bg-card/45`、任务栏面板 `bg-card/70`、插件/记忆卡片 `bg-card`、设置抽屉左右两栏 `bg-card`（`settings/ModelProviderSettings.vue:1308`）统统没有填充 → 只剩"描边盒子"，看起来又平又糙（截图佐证见 §7.7）。
- 直接修 token 有回归风险：把 `--color-card` 补成不透明色，弹层会立刻变成实心白（用户喜欢的观感消失）；而 `bg-card` 与其他底色类同串出现的地方（`runtime/SubagentCard.vue:25`；`foundation/ui/OverlayPanel.vue:157` 加 agent 内 6 处 `panel-class="... bg-card"`），胜者由 CSS 输出顺序决定，不可控。

建议（一次明确决策，而不是顺手补 token）：

1. 定义"玻璃层"语义：新增 `--color-card`（半透明基色）与可选的 `--color-glass-tint`，并把 `rounded-2xl + border-border/70 + ring-1 ring-border/20 + shadow-2xl + backdrop-blur-xl + bg-card/70` 固化成**唯一入口**（`.glass-surface` 或 `AgentPopoverPanel` 变体）。
2. 弹层不再逐处写 utility；设置区自绘下拉（§7.6）也换成同一个组件。
3. 同步补 `--color-border-hover` / `--color-primary-hover` / `--color-warning-foreground`，或统一改写成已有 token。
4. 改完必须做一次视觉回归（`doc/imgs/e2e/agent-*.png` 可作基线位），否则"观感变化"没法评审。
5. 深色主题要单独验证：`ring-border/20`、`shadow-2xl`、`inset 0 1px 0 rgba(255,255,255,.2)`（`host/AgentHubWindow.vue:606-611`）都是浅色假设。

### 7.2 主界面骨架：三层 chrome 把消息区压得很窄（P1 · ✅ 已关闭 2026-09-23）

默认窗口 `1180×740`，最小 `560×480`（2026-09-23 由 380 上调，见下方闭环 a）：

| 层次                                                         | 位置                                  | 高度      |
| ------------------------------------------------------------ | ------------------------------------- | --------- |
| Hub 顶栏（品牌 + App 标签 + 会话/文件切换 + 窗口按钮）       | `host/AgentHubWindow.vue:355` `h-11`  | 44px      |
| Surface 顶栏（会话标题 + 运行状态 + 删除 + 任务栏开关）      | `host/AgentAppSurface.vue:1530` `h-9` | 36px      |
| Composer（textarea 96–192 + toolbar 40 + footer padding 24） | `ai/AgentConversation.vue:722-788`    | 160–256px |

> ✅ **2026-09-23 闭环（a：最小高度 + 矮窗口 composer 压缩）**
>
> - **现象（CDP 实测）**：把窗口拖到最小高度时，Hub 顶栏 44 + Surface 顶栏 40 + composer 203 = 287px，
>   会话滚动区只剩 **94px**（约 4 行）—— 本节原先估的 140px 还是乐观的。
> - **根因**：`window-manager.ts` 的 `MIN_HEIGHT = 380` 允许窗口矮到装不下自己的 chrome；composer 的高度只按**宽度**压缩
>   （`.agent-composer-shell` 的 730/620/520 容器断点），从不看窗口高度 —— 矮窗口下它照样占满三行 + 工具条 + 状态行。
> - **改法**：① `MIN_HEIGHT` 380 → **480**；② `AgentHubWindow.vue` 暴露 `data-hub-compact`
>   （`!maximized && bounds.height < 560`），`AgentConversation.vue` 用 `.agent-hub-window[data-hub-compact]`
>   把输入框收成两行（`min-height 56 / max-height 96`）并收紧 footer padding。
>   **没有**改用 `container-type: size`：`contain: layout` 会让 Hub 变成 fixed 后代的包含块，弹层/portal 的视口定位会全部错位。
> - **CDP 复验**：最小高度 **380 → 480**，会话滚动区 **94 → 227px**（约 4 → 9 行）；此时 composer 170px、textarea 75px（两行）；
>   把窗口拉回 614 / 874px 时 `data-hub-compact` 消失、composer 回到 203px / textarea 96px —— 压缩只在矮窗口生效。
> - 截图：`/tmp/shots/hub-min-height-after.png`（探针 `probe-hub-min-height2.mjs` / `probe-hub-min-height3.mjs`）。

> ✅ **2026-09-23 闭环（c 侧栏折叠 + e 状态持久化）**
>
> - **现象/根因**：`agent-thread-toggle` 默认 `hidden`，只有 `@container agent-hub-window (max-width:760px)` 才 `display:flex` ——
>   宽窗口下侧栏被 256px 网格列钉死，用户没有任何办法把会话列让宽；同时 `threadSidebarVisible` / `taskRailVisible` / `hubView`
>   既不在 `window-manager` 的 localStorage payload 里（只存了 bounds / maximized / launcher / recentAppIds），`hubView` 也不恢复。
> - **改法**：
>   - `window-manager` 增加 `threadSidebarVisible`（默认 true）、`taskRailVisible`（默认 false）并让 `hubView` 一起进 payload / restore；
>   - 布局列宽改为 CSS 变量（`--agent-thread-sidebar-column` / `--agent-task-rail-column`），侧栏折叠 = 列宽置 0 + 面板 `min-width:0; overflow:hidden`
>     （**不写 `display:none`**，否则会与 ≤760 的浮层抽屉规则互相覆盖）；
>   - 开关按钮不再有 `hidden`，宽容器下切「停靠列」、窄容器下切「浮层抽屉」；两种模式由 ResizeObserver 量**自身容器**宽度区分
>     （不是 `window.innerWidth`，延续 §1.6 的容器查询约定）；
>   - `selectThread` 现在只关抽屉、不再关停靠 —— 这正是旧实现里"宽窗口点一下会话侧栏状态被写死"的来源。
> - **CDP 复验**：

| 场景                                  | 侧栏列        | 会话列     | 任务栏 | 抽屉                |
| ------------------------------------- | ------------- | ---------- | ------ | ------------------- |
| 默认 1180×740（清空 localStorage 后） | 256px         | 922px      | —      | —                   |
| 点开关折叠                            | 1px（被裁掉） | **1178px** | —      | —                   |
| 刷新后                                | 1px           | 1178px     | —      | 记忆生效            |
| 重新停靠 + 打开任务栏                 | 256px         | 602px      | 320px  | —                   |
| 刷新后                                | 256px         | 602px      | 320px  | 记忆生效            |
| 560 宽：抽屉关闭                      | absolute      | —          | —      | `hidden`            |
| 560 宽：点开关                        | absolute      | —          | —      | `is-open` / visible |
| 560 宽：选一条会话                    | absolute      | —          | —      | 自动 `hidden`       |

`hubView` 同样复验：会话 → 文件 → 刷新后仍是文件。截图为 `/tmp/shots/hub-sidebar-collapsed.png`、
`/tmp/shots/hub-sidebar-narrow-clip.png`（探针 `probe-hub-sidebar.mjs` / `probe-hub-sidebar-narrow.mjs` / `probe-hub-view.mjs`）。

> - **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check` 全绿。

> ✅ **2026-09-23 闭环（b 列宽 + f 窗口体感）**
>
> - **b) 列宽**：原记录"容器 560px 时会话列只剩 304px、弹层几乎铺满"已过时。CDP 在 560×740 实测：
>   `.agent-conversation-pane` **558px**，侧栏 280px 与任务栏 340px 都是 `position: absolute` 浮层（不占网格列），
>   配置弹层 `288×338` 完整落在窗口内（`overflowsLeft/Right` 均为 false）。≤1040 / ≤760 两档容器查询
>   已经把网格让回会话列，本条无需再改，只补实测证据。
> - **f) 顶栏双击**：原来双击无响应。现在 Hub 顶栏空白处双击 = 最大化 / 还原（`@dblclick`，命中
>   `button, a, input, select, textarea, [role=button], .no-drag` 时忽略，避免与 App 标签、窗口按钮冲突）。
>   实测：560×740 → **1920×953 @0,0** → 560×740；双击 App 标签不触发。
> - **保留不改（记录为有意设计）**：最大化时 `borderRadius: 0`（贴满视口，刻意不露背景）；拖拽不做贴边/吸附，
>   多屏下只按当前视口 clamp —— 这两项需要窗口级 API，超出前端渲染层职责。
> - 探针：`probe-hub-columns.mjs`、`probe-hub-dblclick2.mjs` / `probe-hub-dblclick3.mjs`。
>   ：`MIN_HEIGHT` 提到 480 且矮窗口下 composer 自动收成两行，实测最小高度下会话区 94 → 227px，见上方闭环块。

> ✅ **2026-09-23 闭环（g 停靠态折叠/展开闪跳）**
>
> - **现象（CDP 逐帧采样 `probe-sidebar-flash.mjs`）**：宽窗口点左上角开关，侧栏**一帧跳到底**——
>   折叠 `81,256 → 81,1`、展开 `81,1 → 81,256`，整段采样里没有任何中间尺寸；
>   用户看到的就是"闪一下跳到展开位置"。
> - **根因**：停靠档的折叠只做了两件事——把列宽变量 `--agent-thread-sidebar-column` 从 256px 翻成 0px，
>   并给面板补 `min-width:0; overflow:hidden`。**两条都是瞬时生效、没有 `transition`**：
>   0 宽的网格列 + 立即裁切 = 侧栏内容被一刀切掉。（≤760px 的浮层档之所以看不出问题，是因为它走
>   `transform: translateX(-102%)` + `transition: transform 160ms`，本来就有动画。）
> - **改法**：① 布局加 `transition: grid-template-columns 200ms cubic-bezier(0.4, 0, 0.2, 1)`，
>   列宽本身变成动画，会话列跟着平滑让位；② `min-width:0; overflow:hidden` 从"只在折叠时"改为
>   **停靠档常驻**——否则展开动画途中面板的 min-content 宽度会越过 0 宽的网格列压到会话区；
>   ③ 折叠时面板 `opacity: 0`（同样 200ms），内容在裁切的同时淡出，避免"文字被挤扁"的错觉。
>   三条规则包在 `@container agent-hub-window (width > 760px)` 里（与浮层档的 `max-width: 760px` 严丝合缝，不留夹缝），**刻意不碰 ≤760 的浮层档**：
>   浮层档用 `transform`/`visibility` 自成一套，若继承这里的 opacity，`is-threads-hidden`
>   会把窄窗口的浮层抽屉一并透明掉；`prefers-reduced-motion` 下布局与面板的过渡都关掉。
> - **CDP 复验**（`probe-sidebar-flash3.mjs` / `probe-sidebar-mid-tier.mjs`，逐帧采样，去重后）：

| 档位            | 折叠：面板宽 / 透明度                                      | 展开：面板宽 / 透明度                    |
| --------------- | ---------------------------------------------------------- | ---------------------------------------- |
| 1260px（停靠）  | 256 → 102 → 4 → 1；1.00 → 0.40 → 0.01                      | 1 → 167 → 253 → 256；0 → 0.65 → 0.99 → 1 |
| 900px（两列档） | 256 → 98 → 8 → 1                                           | 1 → 144 → 181 → 252 → 256                |
| 640px（浮层档） | transform −285.6 → −201 → −204，opacity 恒为 1（未受影响） | 同上，反向                               |

> - 中间帧截图（把 200ms 慢放 15 倍后在 25%/50% 取样）：`/tmp/shots/slow-collapse-25.png`、
>   `/tmp/shots/slow-expand-25.png`——侧栏变窄时内容正常截断（标题 `定位当…`、`在当前…`），
>   没有溢出到会话区。
> - **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check` 全绿。

- ✅（2026-09-23）列宽已复核：窄容器下侧栏与任务栏都是浮层，560×740 实测会话列 558px、弹层 288×338 不越界，见上方闭环块（原 304px 记录已过时）。
- ✅（2026-09-23）侧栏折叠已上线并记忆状态：开关常显，宽容器切停靠列、窄容器切浮层抽屉，实测会话列 922 → 1178px，见上方闭环块。
- ✅（2026-09-22，见 §1.6）断点基准已统一：死变量 `taskRailWideViewport` 与那个只写不读的 `resize` 监听已删除，`AgentAppSurface.vue` 里不再有 `window.innerWidth` 判断。
- ✅（2026-09-23）状态持久化已补齐：`threadSidebarVisible` / `taskRailVisible` / `hubView` 一并写入 `window-manager` 的 localStorage payload（schemaVersion 1）并在 restore 时校验恢复。
- ✅（2026-09-23）顶栏双击已支持最大化/还原；最大化 `borderRadius: 0`、无贴边吸附两项按有意设计保留（见上方闭环块）。
- ✅（2026-09-23）停靠态折叠/展开不再闪跳：列宽 200ms 过渡 + 面板淡出（≤760 浮层档不受影响），逐帧采样已见中间帧，见上方闭环块（g）。

### 7.3 Composer 工具条：控件太多被静默裁掉（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 CDP**：560px Hub 下 composer shell 542px、toolbar 37px、controls `462/462`，附件/发送均 28×28，0 个控件越界。最终采用“单行硬约束 + composer 自身 container query + compact”，没有引入 More 菜单。

> **已修（2026-09-22）**：Composer 拆成「会话状态行 + 单行配置/操作工具条」——token 与「回到最新」移到输入框上方独立一行，附件改为右侧紧凑 `+`，配置顺序固定为「模型 → 思考 → 执行 → 批准 → 环境 → SSH」，`.agent-composer-shell` 建立 `agent-composer` 容器并把工具条密度断点（730/620/520）迁到它上面，移除 `overflow-x: hidden`。实测 Hub 560→1148 全宽度 `scrollWidth === clientWidth`、单行、零裁切。详见 `doc/progress.md`。

> **根因补充（第四轮实测）**：本轮定位到"右组变宽"只是触发器，真正的结构性原因是 composer 外层 `max-w-3xl`（768px）封顶、而折叠断点挂在会话面板容器（1342px）上永不触发。**默认窗口下「思考强度」就已经被裁 42px、只剩一枚闪电图标**，实测数据与探针见 §7.14-a。

**用户反馈**：底部条目太多，导致"思考等级"有时候看不到。

代码事实：

- 容器：`agent-toolbar-controls flex min-w-0 flex-1 items-center gap-1 overflow-x-hidden`（`ai/AgentConversation.vue:737`），窄容器下再次强制 `overflow-x: hidden`（`:835-838`）。
- 这一行塞了 **7 个配置触发**：附件（`files/ArtifactPicker.vue`）/ 模型 / 执行模式 / 批准策略 / 运行环境 / SSH 目标 / 思考强度（`host/AgentAppSurface.vue:1701、1769、1889、2005、2122、2294`）。
- 右侧组还有 **3 个**：回到最新（条件出现）、token 胶囊、发送/取消（`ai/AgentConversation.vue:747-783`）。

所以容器一窄，**靠后的"运行环境 / SSH 目标 / 思考强度"会被直接裁掉**：没有省略号、没有横向滚动、没有"更多"入口——用户既看不到，也无从知道被裁了。思考强度恰好排在最后一位，因而是最先消失的那个。

**实测确认（2026-09-21）**：

- 空会话：`.agent-toolbar-controls` 的 `clientWidth 617 / scrollWidth 659`，最后一枚 `高` 位于 `x=1156 w=66` → `right` 超出容器右边 → 判定为**被裁切**（`getBoundingClientRect` 越界，`visible:false`），而它前面的 `SSHSSH1`（x=1068）完整可见；容器的 `overflow-x` 计算值是 `hidden`，所以**连滚动条都没有**。
- 有内容的会话（`doc/imgs/review-2026-09-21/agent-hub-jump-to-latest-clipped-chip-zh.png`）：工具条上只剩 `文件(0) / 模型 / 执行 / 全授权 / 原生环境 / SSH 1` 六枚，`高` **整枚消失**，右侧同时多出「跳到底部」+ token 胶囊。
- 也就是说：**同一产品里，"能不能看到思考强度"取决于当前会话内容多寡**（右侧控件随 `run` 状态增减），用户完全无法预测——这正是"有时候不可见"的机制。

加重因素：

- 每个触发表面带 `agent-config-verbose` 文案（模型 id、`Full access`、`Native Host`、`SSH 1` …），仅在容器 ≤1040/760/560 才隐藏（`host/AgentAppSurface.vue:2531、2571、2583`）。
- 思考强度还有 `v-if="reasoningCapabilityAvailable || (modelSelectionLocked && reasoningValue)"`（`:2295`）→ 模型不支持时整条消失，用户**无法区分"模型不支持"和"被裁掉"**。

建议（按收益排序）：

1. 分层：把"运行环境 / SSH 目标"这类低频项收进一个 `⋯ 更多` 弹层（复用 `AgentConfigPopover`，内部仍是同一套行结构），主行只留 附件 / 模型 / 思考强度 / 批准策略。
2. 排序：思考强度不要排最后，至少保证"模型 + 思考强度 + 发送"永远可见。
3. 兜底：改用 `overflow-x-auto` + 两侧渐隐遮罩，或 `flex-wrap` 成两行自适应高度，**不要用 `overflow-x-hidden` 静默截断**。
4. 复用已有的 `.agent-config-compact` 机制：阈值下退化成图标-only，而不是把控件丢掉。

### 7.4 "回到最新"按钮的位置需要挪（P2 · ✅ 已关闭 2026-09-23）

> ✅ **当前实现**：「回到最新」已在 Composer 上方状态行右侧；token 使用量在左侧且仅总 token > 0 时显示，避免再次挤压工具条。

> **已修（2026-09-22）**：「回到最新」已移出输入框工具条，改为 Composer 上方状态行右侧的一枚玻璃胶囊（`rounded-full + bg-card/70 + backdrop-blur-md`），只在滚离底部时出现；状态行左侧同时承载 token 状态。出现/消失不再改变下方配置工具条的宽度分配。详见 `doc/progress.md`。

**用户反馈**：滚动后出现的"一键跳到底部"按钮现在挤在输入框这一行，应该放到聊天输入框上方那一排的右侧。

代码事实：按钮在 composer 工具条右侧组内（`ai/AgentConversation.vue:747-756`，`h-7 w-7`），左边是 token 胶囊，右边紧挨着发送/取消按钮。

```html
<div class="flex shrink-0 items-center gap-1.5">
  <button
    v-if="showJumpToLatest"
    class="flex h-7 w-7 items-center justify-center rounded-lg border border-border/60 bg-background/60 ..."
  >
    ↓
  </button>
  <span v-if="run && ..." class="agent-token-status ...">67.0k</span>
  <button ...>发送 / 取消</button>
</div>
```

**实测确认（2026-09-21）**：滚动到会话顶部后，这一行右组实测依次是 `↓`（h-7 w-7 = 28×28，`rounded-lg` 描边方块）→ `67.0k` 胶囊 → 发送位；
而且此时原本在左组的 `高`（思考强度）已被裁掉（§7.3 实测）——**同一块屏幕位置上"有时是思考强度、有时是跳到底部"**，这既是语义混乱，也是用户"它怎么在这个地方"的直接来源。

问题：

1. 语义错位：它控制的是**消息区滚动位置**，却和"输入配置 / 提交"挤在同一行。
2. 误点风险：与发送按钮只隔 6px，且运行中那个位置是"取消运行"——两个都会改变状态的按钮贴在一起。
3. 布局跳动：`v-if="showJumpToLatest"` 出现/消失时整行内容左右位移。

建议：移到 composer 上方独立一行、右对齐，做成一枚悬浮胶囊（`h-6~h-7`、`rounded-full`、`bg-card/70 backdrop-blur-md border border-border/60 shadow-lg`，即 §7.1 的玻璃配方），只在 `showJumpToLatest` 时出现；可用绝对定位贴在消息区底部右侧（不占滚动内容高度），并在 composer 顶部留 8–10px 间距。若坚持留在工具条内，则固定占位 + 移到最左（与配置控件同组），避免跳动。

### 7.5 主界面其它布局 / 细节问题

1. **助手气泡没有填充**：`ai/ConversationMessage.vue:342` 是 `rounded-xl bg-card/45 ring-1 ring-inset ring-border/30`，`bg-card/45` 死类 → 助手回复变成"只有描边的白框"；而用户气泡 `bg-primary/[0.07]`（`:299`）有色。一强一弱，观感割裂，这是"主界面看起来很糙"最直接的原因之一。
2. **空态 bento 卡片同样没填充**：`ai/AgentConversation.vue:434` 的卡片 + tone 类（`:127-152`）里 `via-card to-card` 全是死类，卡片只剩 `border-border/75` + hover 阴影；空态容器 `min-h-[460px]`（`:401`）在矮窗口会被裁。
3. **空态自动轮播**：9s 自动翻页（`:66、163-166`）、4 页，pager 点击区实测 **12×16px**（`:472-486`，`h-4 w-3/w-5` + `px-0`，点本身只有 6×6）——既不可发现又远低于触控标准（详见 §7.12-3 实测截图）。建议改 1 页 4 卡或静态 + 显式翻页按钮（≥32px）。
   ✅ **2026-09-23**：命中区已关闭（`28×32` / 当前页 `36×32`，每枚圆点独占一格，见 §7.12）；轮播按 §2.6 保留，但已改为可中断（悬停 / 焦点 / 手动分页 / `prefers-reduced-motion`）。
4. **发送 / 取消二合一**：同一个按钮承担两种语义（`ai/AgentConversation.vue:765-783`），`hover:bg-primary-hover` 是死类 → 连 hover 反馈都没有；`disabled:opacity-20` 几乎看不见。
5. **token 胶囊太小**：`text-[9.5px]`、`h-7`（`:757-764`），`title` 里塞的是英文 `input / output / cache / steps`，未 i18n。
6. **消息列宽**：`max-w-3xl`（768px）在窄窗口下被会话列压缩，气泡贴边；同时弹层 `w-72` 几乎占满（见 §7.2）。
7. **任务栏（TaskRail）**：面板 `bg-card/70`（`runtime/TaskRail.vue:182`）死类 → 整栏无底色；卡片可拖拽排序且顺序入 localStorage（`:125、157`），但**没有"恢复默认顺序"入口**，也没有键盘排序路径（`vuedraggable`/Sortable 仅支持指针拖拽）；卡片内大量 `text-[8px]/[9px]`。
   实测补充（§7.12-4）：栏宽 320px、`background-color: rgba(0,0,0,0)`，空态是 295×176 的虚线框（`border-dashed` + 70% 透明度）里只放一行 12px 文案，且与左右两栏之间**没有分隔线/投影** → 三个面板的层次完全靠"底色差异"区分，而这一栏恰好没有底色。
8. **Hub 顶栏的毛玻璃没生效**：`bg-header/45 backdrop-blur-md`（`host/AgentHubWindow.vue:362`）被同文件 scoped 的 `.agent-hub-header { background: linear-gradient(...) }`（`:673-680`）覆盖成不透明渐变 → 顶栏其实是实心的，与弹层的玻璃语言不一致。
9. **App 标签条**：一次展开全部启用的 App（`host/AgentHubWindow.vue:217-240`），窄窗口靠 `max-w-56/64` 截断；关闭按钮 16px 且 hover-only（`:466-474`）；标签没有 `role="tablist"/"tab"` 语义，键盘只能 Tab 遍历。
10. **窗口阴影写死浅色**：`0 20px 48px -12px rgba(0,0,0,.22)` + `inset 0 1px 0 rgba(255,255,255,.2)`（`host/AgentHubWindow.vue:606-611`），深色主题下会发脏。
11. **硬编码色仍在主界面里**：`text-emerald-500 / text-amber-500 / text-indigo-500`，思考强度滑条用 `from-blue-500 via-purple-500 to-pink-500`（`host/AgentAppSurface.vue:2348`）。
12. **滚动体验**：`isNearBottom` 阈值 96px（`ai/AgentConversation.vue:273`），只有"回到最新"按钮、没有"有新消息"横幅；`loadOlder` 按钮固定在列表顶部（`:388-397`），必须滚到顶才出现。
13. **死 CSS**：`.agent-config-label`、`.agent-run-history`（还带 `display:none`）、`.agent-detail-label`（`host/AgentAppSurface.vue:2612、2648、2692`）、`.agent-budget-meter`、`.agent-budget-bar`（`ai/AgentConversation.vue:820、825`）都已无对应元素。

### 7.6 设置区 vs 主界面：两套弹层实现（P1 · ✅ 已关闭 2026-09-23）

|          | 主界面                                                                                      | 设置区                                                              |
| -------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 实现     | `files/AgentConfigPopover.vue`（Teleport 到 body）                                          | `settings/ModelProviderSettings.vue:989` 自绘 `absolute` 下拉       |
| 定位     | 视口 clamp + 12px 边距，随窗口 resize 重算                                                  | `absolute right-0 top-full`，可能被父级 `overflow-hidden` 裁切      |
| 键盘     | Escape 关闭 + 焦点归还触发按钮                                                              | 仅外部 `pointerdown` 关闭（`:762-764`），**无 Escape、无焦点管理**  |
| 互斥     | 全局单开（模块级 `activePopoverCloser`）                                                    | 无                                                                  |
| 面板样式 | `rounded-2xl border-border/70 ring-1 ring-border/20 shadow-2xl backdrop-blur-md bg-card/95` | `rounded-xl border-border/80 bg-card/98 shadow-xl backdrop-blur-md` |
| 行结构   | 图标方块 + 两行文本 + 尾部勾选                                                              | 单行 + 渠道徽章                                                     |
| 空态     | —                                                                                           | 硬编码 `未匹配到模型`（`:1053`）                                    |

结论：设置区**已经想要这套玻璃语言**，但缺"组件化、定位、键盘、行结构"四件事，只剩下"更小的圆角 + 不一样的间距"，于是看起来就是"粗版"。把设置区的下拉统一换成 `AgentConfigPopover`（或 §7.1 的 `glass-surface`）是性价比最高的一步。

> ✅ **2026-09-23 最终闭环**：默认模型已从中间态 Gen2 `UiPopover` 进一步升级为 Gen2 `UiCombobox`（Reka Combobox），选择 / 搜索 / rich row / keyboard focus 由同一控件语义承担；fallback 的「添加备用模型」继续使用 `UiPopover`，因为它是临时动作菜单。真实 CDP 验收：trigger / panel 同宽（`widthDelta=0`）、相接圆角为 `0px`、ArrowDown 打开 / Escape 关闭且焦点留在 combobox；用户指出背景断层后，展开态 trigger / panel 已统一为 canonical glass fill（alpha≈0.7544）+ `blur(16px)` + 同一 border recipe。

### 7.7 视觉佐证（`doc/imgs/e2e/agent-*.png`，2026-09-17 生成）

> 截图可能早于最近改动，仅作观感对照，不做像素级结论。
> **第二轮的实测截图另存在 `doc/imgs/review-2026-09-21/`（2026-09-21 现场抓取，含中文/英文两套界面），逐条结论见 §7.10–§7.12。**

- `agent-nexus-agent.png`：助手气泡是"细描边白框"（`bg-card/45` 缺失），用户气泡有淡紫底（`bg-primary/[0.07]` 正常）——两者对比即 §7.5 第 1 条；会话列上方可见 `agent-conversation-ambient` 的柔和主色光晕（`ai/AgentConversation.vue:793-800`，这个效果是好的，可保留）。
- `agent-settings-models.png`：同一屏出现**两个 "Add provider" CTA**（区块右上 `:882` 与空态内 `:1571`）；「Default model: 未设置」与「调度器支持多应用委派与动态预算管控」是硬编码中文夹在英文界面里。
- `agent-settings-plugins-security.png`：三条绿色 toast 叠在右上，**压住了 Settings 的 Tab 导航**（无上限、无合并）；「已启用 1/1」「扩展生态与仓库」「官方通用智能体核心，内置自动化运维诊断与全栈工程协同技能」均为硬编码中文。
- `agent-settings-runtime.png`：存储配额区整段中文（"单 Run 产物配额 / 单文件产物上限 / 全局产物存储配额 / 临时产物生命周期 (TTL)" 及其说明），数值后缀 `≈ 7 天(604,800 秒)` 也是拼出来的中文；同屏 3 个成功 toast。

### 7.8 顺带发现：不存在的间距类（P2 · ✅ 已关闭 2026-09-23）

> ✅ **当前扫描**：`features/agent` 中 `py-0.2 / py-0.8 / py-1.8` 残留 **0**。

`py-0.2`（25 处）、`py-1.8`（9 处）、`py-0.8`（2 处）在编译产物里**没有任何规则**（同文件中的 `py-0.5 / py-1.5 / py-2.5` 都能正常生成）：Tailwind 的 spacing 只接受 0.25 的倍数，`.2 / .8 / .18` 这类值会被静默丢弃。

后果是按钮/徽章实际没有上下内边距，例如删除服务商确认弹窗的"取消"按钮 `px-3.5 py-1.8`（`settings/ModelProviderSettings.vue:1596`）、徽章 `px-1 py-0.2`（`:945、1315、1402`）。修的时候顺手换成 `py-0.5 / py-1` 即可。

（这条同时解释了一部分"按钮看起来扁扁的"——不是审美问题，是类名无效。）

### 7.9 第二轮优先修（含用户提出的两条）

| #   | 问题                                                                                                                                                      | 位置                                                                             | 级别 |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---- |
| 1   | ✅ **已关闭 2026-09-23**：玻璃层已固化为 `.glass-surface`，card/token 已补齐并做浅/深主题兼容                                                             | §7.1                                                                             | P0   |
| 2   | ✅ **已关闭 2026-09-23**：最终采用单行硬约束 + composer 自身 container query + compact；不引入 More 菜单，思考等级前移                                    | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`                           | P1   |
| 3   | ✅ **已关闭 2026-09-23**：card token 生效，助手气泡/空态/TaskRail 均有真实 surface                                                                        | `ai/ConversationMessage.vue`、`ai/AgentConversation.vue`、`runtime/TaskRail.vue` | P1   |
| 4   | ✅ **已关闭 2026-09-23**：「回到最新」已进入 Composer 上方状态行右侧                                                                                      | `ai/AgentConversation.vue`                                                       | P1   |
| 5   | 减少 chrome：矮窗口压缩顶栏/composer，提高 `MIN_HEIGHT`                                                                                                   | §7.2                                                                             | P1   |
| 6   | ✅ **已关闭 2026-09-23**：设置区默认模型最终迁到 Gen2 `UiCombobox`；选择/搜索/键盘/焦点统一由 Reka Combobox 承担，展开态与 glass panel 同宽同背景连续衔接 | `settings/ModelProviderSettings.vue`、`foundation/ui/UiCombobox.vue`             | P1   |
| 7   | 窄窗口侧栏支持折叠；侧栏/任务栏/Hub 视图状态统一持久化                                                                                                    | `host/AgentAppSurface.vue:1543`、`host/window-manager.ts`                        | P2   |
| 8   | ✅ **已关闭 2026-09-23**：轮播按 §2.6 保留但改为可中断；pager 命中区 `12×16` → `28×32`（当前页 `36×32`），每个圆点独占一格                                | `ai/AgentConversation.vue:429-486`                                               | P2   |
| 9   | Hub 顶栏毛玻璃被覆盖、窗口阴影写死浅色                                                                                                                    | `host/AgentHubWindow.vue:362、606-611、673-680`                                  | P2   |
| 10  | 无效间距类 `py-0.2 / py-0.8 / py-1.8` 与死 CSS 清理                                                                                                       | settings/**、`host/AgentAppSurface.vue:2612/2648/2692`                           | P2   |
| 11  | ✅ **已关闭 2026-09-23**：font/cursor reset 已放入 `@layer base`，Tailwind 字号 utility 恢复生效                                                          | `app/styles/global.css:27-46`（见 §7.10）                                        | P0   |
| 12  | ✅ **已关闭 2026-09-23**：备用模型链已改为 `1..N` 有序列表 + 上移/下移/移除；Add 使用可搜索 Gen2 `UiPopover`，排除默认/已选并限制最多 8 项                | `settings/ModelProviderSettings.vue`（见 §7.11）                                 | P1   |
| 13  | 设置区把「状态」画成按钮（默认模型 / 活跃 App / 沙箱）与「自动保存」绿胶囊，需要收敛成只读 badge 规格                                                     | §7.11                                                                            | P2   |
| 14  | ✅ **已关闭 2026-09-23**：pager 命中区 `12×16 / 20×16` → `28×32 / 36×32`（伪元素外扩，视觉不变）；自动轮播按 §2.6 改为可中断而非移除                      | `ai/AgentConversation.vue:429-486`（实测见 §7.12）                               | P2   |

---

### 7.10 实测根因（P0 · ✅ 已关闭 2026-09-23）：全局 `button { font: inherit }` 曾让按钮字号类集体失效

> ✅ **2026-09-23 CDP 复验**：reset 已移入 `@layer base`；Agent 设置页 `text-xs` 按钮计算字号均为 **12px**（「添加 Provider」高 28/32px、「关闭 Agent」高 30px），旧的 16px 覆盖现象消失。

`packages/frontend/src/app/styles/global.css:26-33`：

```css
button,
input,
textarea,
select {
  font: inherit; /* ← 没有 @layer 包裹 */
  font-family: inherit;
  font-feature-settings: inherit;
}
```

**这条规则是 unlayered 的。** Tailwind v4 把所有 utility 放进 `@layer utilities`，而层叠顺序里"未分层"的普通规则**永远压过任何 `@layer` 内的规则**（与选择器权重无关）。
于是：**只要按钮/输入框自己没有带 `font-size` 的 scoped 规则，`text-xs` / `text-[11px]` / `text-[10px]` 全部作废**，字号回退成继承来的 16px（body）。

实测（CDP 连真实页面读 `getComputedStyle`，窗口 1620×953）：

| 元素                                                   | 源码里声明的字号            | 实测               | 结论                                     |
| ------------------------------------------------------ | --------------------------- | ------------------ | ---------------------------------------- |
| 设置区分段导航「工作区 / 系统 / … / Agent」按钮        | `text-sm`                   | **16px**           | 失效                                     |
| 设置区内层 Tab「模型与预算 / 运行与环境 / 插件与安全」 | `text-xs`                   | **16px**           | 失效                                     |
| 「添加 Provider」                                      | `text-xs`                   | **16px**           | 失效                                     |
| 「关闭 Agent」                                         | `text-xs`                   | **16px**           | 失效                                     |
| 服务商行「模型与测试 (6) / 更新模型 / 停用」           | `text-xs`                   | **16px**           | 失效                                     |
| 「6 个模型」徽章                                       | `text-[10px]`               | **16px**           | 失效（90×28 的胶囊，比正文还大）         |
| 备用模型链按钮                                         | `text-[11px] px-2.5 py-1.5` | **16px → 高 40px** | 失效（"朴素大方框"的直接原因，见 §7.11） |
| 「立即更新」                                           | `text-xs`                   | **11px**           | 正常（父容器是 11px，被继承下来）        |
| 主界面「搜索会话」`<input>`                            | `text-[10.5px]`             | **16px**           | 失效                                     |
| Hub 输入框 textarea                                    | `text-[13px]`               | **13px**           | 正常（scoped 规则里写了 `font-size`）    |
| Hub 工具条触发表面 `.agent-config-summary`             | —                           | **11px**           | 正常（同上，`<style scoped>` 里写死）    |
| Hub 发送按钮                                           | —                           | **11px**           | 正常（同上）                             |

**受控实验（同一页面里注入探针元素后读计算值，2026-09-21）**——同一次注入里，只有"命中那条 unlayered 选择器"的标签才会失效：

| 注入的元素                                                           | 声明 | 实测        |
| -------------------------------------------------------------------- | ---- | ----------- |
| `<button class="text-xs">`                                           | 12px | **16px** ❌ |
| `<button class="text-[11px]">`                                       | 11px | **16px** ❌ |
| `<input class="text-xs">`                                            | 12px | **16px** ❌ |
| `<select class="text-xs">`                                           | 12px | **16px** ❌ |
| `<textarea class="text-xs">`                                         | 12px | **16px** ❌ |
| `<div class="text-xs">` / `<span>` / `<a>`                           | 12px | **12px** ✔  |
| `<button class="text-xs" style="font-size:12px">`（或 `!important`） | 12px | **12px** ✔  |

`button / input / select / textarea` 全中、`div / span / a` 全不中，且内联/`!important` 能救回来 —— **完全是层叠层（unlayered vs `@layer utilities`）的问题，与选择器权重无关**，与 `global.css:26-33` 的选择器清单一一对应。

结论（这条会改写 §6 的整体判断）：

1. **"主界面小字号生效、设置区小字号不生效"的机械原因就是 scoped 规则 vs. 全局 unlayered 规则**（另一类"计算字号与代码不一致"的现象来自浏览器自动放大，性质不同，甄别方法见 §7.12-6）。用户反馈的"设置区又大又糙、跟浮窗不是一个档次"，机械原因就在这里——字号全部大一号 + 高度随之膨胀（`py-1.5` + 16px ≈ 40px 的行高），再叠加 §7.8 的无效 padding 类，按钮既大又不紧凑。
2. 所以 §6.2「6 套主按钮写法」和 §6.6「对齐基准规范」**要先把这一条修掉再执行**，否则改完颜色/圆角，字号还是错的、观感还是不像浮窗。
3. 修法很小：把 `button/input/textarea/select` 那段放进 `@layer base`（保留 `font: inherit` 的意图，但让 utility 能覆盖）；但**预期会有大面积视觉变化**，必须做一次视觉回归（`doc/imgs/e2e/*` + 本轮 `doc/imgs/review-2026-09-21/*` 作基线）。

### 7.11 设置区实测（Agent 页）

截图：`doc/imgs/review-2026-09-21/agent-settings-agent-top-zh.png`、`agent-settings-agent-en-mixed-language.png`。

**a) 中英混排：英文界面下 29 处硬编码中文（实测复现）**

把 `localStorage['user-locale']` 切成 `en-US` 并刷新后，Hub 主界面**完全英文**（含"Conversation / Files / Agent Workspace / What would you like to work on? / Environment Insights / Send / High"，只有会话标题是用户数据），
但 **Settings > Agent 仍留下 29 个含中文的可见文本节点**，例如：

- `调度器支持多应用委派与动态预算管控`（挂在 `Current state: enabled` 这一行的右端，与英文标签同排）
- `按顺序勾选备用模型；新 Run 会冻结兼容 route，运行中设置变更不会改写既有 Run。`
- `6 个模型`、`已配密钥`（服务商卡徽章）
- `25 步 · 10 min`、`80 步 · 30 min`、`150 步 · 60 min`、`自定义微调`（执行步数保险丝预设）
- 区块标题 `执行步数保险丝`、`执行与超时控制`、`工具截断与上下文记忆`
- 单位后缀 **全部是拼出来的中文**：`≈ 1 小时` `(3,600 秒)`、`≈ 2 分钟` `(120 秒)`、`≈ 2 小时` `(7,200 秒)`、`≈ 30 天` `(2,592,000 秒)`、`(131,072 字节)`、`(1,073,741,824 字节)`…

> 这条把 §6.5 从"代码里数出 38 行"升级为**可复现的界面缺陷**：Hub 是干净的，问题集中在 `features/agent/settings/**`；数字+单位这类"拼接式文案"最难被 `$t` 覆盖，建议改成 `Intl.NumberFormat` + `Intl.RelativeTimeFormat`（单位走 i18n）。

**b) 按钮规格矩阵（同屏实测，全部在 1620×953 首屏内）**

| 按钮               | 实测尺寸                     | 字号 | 圆角 | 视觉                                  |
| ------------------ | ---------------------------- | ---- | ---- | ------------------------------------- |
| `添加 Provider`    | 144×38                       | 16px | 8px  | **实心 primary**（视觉最重）          |
| `关闭 Agent`       | 109×40                       | 16px | 8px  | destructive 10% 底 + 描边             |
| `立即更新`         | 77×28                        | 11px | 6px  | 白底描边                              |
| 默认模型选择器     | 298×36                       | 16px | 12px | 白底描边（含 82×16 的 10px 渠道徽章） |
| 备用模型链（每项） | 270/246/269/191/228 × **40** | 16px | 8px  | 无填充纯描边                          |
| `模型与测试 (6)`   | 144×36                       | 16px | 8px  | 描边                                  |
| `更新模型`         | 107×36                       | 16px | 8px  | 描边                                  |
| `停用`             | **54×36**                    | 16px | 8px  | 描边（危险操作被压到最窄）            |
| 删除服务商         | **28×28**                    | —    | 8px  | 纯图标、无二次确认                    |

问题：同一屏里 **3 档高度（28/36/38-40）、3 档字号（11/16）、4 档圆角（6/8/12）**；更关键的是**"停用 + 删除"这种危险操作的视觉权重低于"模型与测试"**，而删除按钮只有 28×28、点击即执行（对比：会话删除要二次确认、服务商删除有弹窗——同一产品三种确认强度）。

**c) 备用模型链（`ModelProviderSettings.vue:1062-1083`）——设计上明显不合理**

```html
<button v-for="option in modelOptions.filter((item) => item.key !== defaultModelKey)" ...>
  {{ option.model.id }} · {{ option.provider.displayName }}
</button>
```

- 它渲染的是**该 Provider 除默认模型外的全部模型**（实测 6 个模型 → 5 个按钮），不是"已选列表"。模型多起来这里会变成一面**按钮墙**（无搜索、无"已选 N 项"摘要、无折叠）。
- 说明文字写着"按顺序勾选备用模型"，但：**没有序号、没有拖拽、没有"上移/下移"、也没有单项移除**；选中态只靠 `border-primary/40 bg-primary/10 text-primary` 表达，实测当前**全部未选中**——用户看不出当前 fallback 链是什么、顺序如何。
- 只在 Provider 卡里能改，且改完只能靠顶部一行提示确认；顺序即生效顺序，却无任何可视化。
- 建议：改成"已选有序列表（1/2/3 + ✕ + 拖拽）"+「添加备用模型」按钮打开 `AgentConfigPopover`（复用 §6.1 的两行行结构 + 搜索）。

> ✅ **2026-09-23 闭环**：已改为显式 `1..N` 有序 fallback 列表，每项提供上移 / 下移 / 移除；Add 使用 Gen2 `UiPopover`，候选排除默认模型与已选模型，最多 8 项，候选 >3 时可搜索。真实设置当前为 `1/8` 且只有一个已配置模型，所以 Add 按设计 disabled；为避免改写真实用户设置，本轮未执行 remove/reorder。

**d) 顶部状态区把"状态"画成了按钮**

`Default model: gemini-3.8-flash-high`、`Active apps: 1/1`、`Sandbox: Not ready` 三枚胶囊是**纯展示**，但外形（圆角描边 + 与按钮同高）与可点击控件完全一致 → 用户会去点 `Sandbox: Not ready`。
同一屏还有：`Agent feature` 卡里既是 `● Enabled` 徽章、又在框内重复一行 `Current state: enabled`（信息重复），旁边还挂着硬编码中文说明；
`Default model for new runs` 标题旁贴了一个绿色 `Changes saved automatically` 胶囊（**状态写成 CTA 的样子**，且与页面底部 `autoSaveHint` 重复 2 次）。

**e) 页面级滚动 & 其他**

- 设置页 `scrollHeight = 2008px`（视口 953px）→ 整页滚动，内层 Tab（y≈240）一滚就消失；同时页面右下角悬浮着 Agent 启动球（40×40，`rgb(160,108,213)`），在窄一点的分栏上会盖住内容。
- 顶部 chrome 共 4 层（应用导航 → 设置分段 Tab → Agent 卡头 + 状态胶囊 → 内层 Tab）才到第一块内容；建议把「Agent 卡头」的状态合并进内层 Tab 行的右侧。

### 7.12 主界面实测（逐条对照用户反馈）

截图：`doc/imgs/review-2026-09-21/`（`agent-hub-empty-state-zh.png`、`agent-hub-jump-to-latest-clipped-chip-zh.png`、`agent-hub-task-rail-zh.png`、`agent-hub-files-view-zh.png`、`agent-hub-model-popover-zh.png`、`agent-hub-empty-state-en.png`）。

**1) 用户反馈①「思考等级有时候不可见」——实测确认，且会被静默裁掉**

- 空会话：`.agent-toolbar-controls` `clientWidth 617 / scrollWidth 659`，最后一个 `高`（思考强度）在 `x=1156 w=66` 处 `right > 容器 right` → **被裁掉**，而它前面的 `SSHSSH1` 仍完整可见（即"从右边开始消失"）。
- 有内容的会话（截图 `agent-hub-jump-to-latest-clipped-chip-zh.png`）：`文件(0) / 模型 / 执行 / 全授权 / 原生环境 / SSH 1` 六枚之后**直接是「跳到底部」+ token 胶囊**，`高` 整枚消失。同一时刻工具条右侧又多了两枚控件 → 越"忙"的会话越看不到思考强度。
- 容器是 `overflow-x: hidden`（没有滚动条、没有省略号、没有渐隐），所以用户**没有任何线索知道被裁了**。
- 建议优先级：`模型 + 思考强度 + 发送` 常驻；`运行环境 / SSH 目标` 收进 `⋯ 更多`；兜底改 `flex-wrap` 或 `overflow-x-auto` + 渐隐（详见 §7.3）。

**2) 用户反馈②「一键跳到底部」的位置——实测它在 composer 工具条右组内**

- 代码：`ai/AgentConversation.vue:747-756`，`h-7 w-7 rounded-lg border border-border/60 bg-background/60`，与 token 胶囊（`:757-764`）和发送/取消（`:765-783`）同一个 `flex shrink-0 gap-1.5` 容器，**整体位于输入框壳体的底栏内**。
- 实测截图：滚动到顶部后它出现在底栏右组，紧挨 token 胶囊；而这个位置正好是"配置控件被裁掉"后空出来的地方 → 用户会在同一处看到"有时是思考强度、有时是跳到底部"，语义混乱。
- 建议：移到**输入框整体上方一行、右对齐**的一枚独立玻璃胶囊（`rounded-full border-border/60 bg-card/70 backdrop-blur-md shadow-lg`），只在 `showJumpToLatest` 时出现；这样既不与配置项抢宽度，也不会在出现/消失时让整行位移（§7.4）。

**3) 空态（截图 `agent-hub-empty-state-zh.png`）**

- 徽章 `智能协作工作台` 10px / 主标题 20px / 副标题 12px（`text-secondary/80`）+ 建议卡标题 13px、描述 12px（`text-secondary/75`）→ **对比度不足**（12px + 75% 灰）是最影响"精致度"的一条，浮窗弹层里同样的灰色只用在副标题且更短。
- 建议卡：361×94、`rounded-2xl`、`border-border/75`、**无填充**（`bg-card` 死类 → §1.1/§7.1），右上角装饰箭头 `↗` 只有 40% 透明度；两卡描述换行不一致（一张 1 行、一张 2 行留孤儿"改"字）→ 卡片高度靠 `min-h` 撑，视觉不齐。
- pager：4 个点，**可点区域 12×16（点本身 6×6）**，且 4 页会 9s 自动轮播（§2.6）——不可发现 + 低于触控标准 + 抢注意力，建议改静态或显式翻页按钮。

> ✅ **2026-09-23 闭环（pager 命中区）**
>
> - **现象**：4 枚圆点的可点区域实测等于按钮盒本身——当前页 `20×16`、其余 `12×16`，而可视圆点只有 `16×6 / 6×6`（`elementFromPoint` 网格采样：从点中心向上下各 ~8px、向两侧 ~6px 就离开自身命中区）。
> - **根因**：`ai/AgentConversation.vue` 的按钮是 `h-4` + `w-3/w-5` + `px-0`，既没有内边距也没有扩大命中区的伪元素，于是命中区 = 16px 高的可视盒。
> - **改法**：`.agent-home-pager-dot` 增加 `position: relative` + 透明 `::after { inset: -8px }`（scoped 样式内说明），命中区外扩到 `28×32`（当前页 `36×32`）。可视圆点尺寸、按钮盒、容器高度与滚动溢出均不变。由于相邻圆点中心原本只相距 18px，同时把容器间距由 `gap-1.5`(6px) 调到 `gap-4`(16px)，让每枚圆点获得**互不重叠**的 ≥28px 命中格——否则后一枚的伪元素会盖住前一枚的可视圆点（实测过：6px 间距下中间圆点的独占区只有 18×32）。
> - **CDP 验证**：外扩后逐点测量 `ownHit` = `36×32 / 28×32 / 28×32 / 28×32`，`centerOwned` 与 `dotFullyOwned` 全为 true；在"可视圆点右侧 +8px、上方 −10px"（旧 12/20 宽盒之外）真实点击 3 枚圆点，`aria-current` 依次切到 3 / 1 / 0 全部命中；两枚圆点正中间处归属明确（无死区）；`.agent-conversation-scroller` 的 `scrollWidth/clientWidth` 与外扩前一致（917 / 917，伪元素不产生滚动溢出）。

- 位置本身**基本居中**（内容 y≈258-565，可视区 144-709：上留白 114px / 下留白 144px），上下略不对称但不是主要问题；真正拖观感的是上面的对比度不足与卡片无填充。

**4) 任务栏（截图 `agent-hub-task-rail-zh.png`）**

- 面板 320px 宽、**整栏无底色**（`bg-card/70` 死类，§7.1），只有 header 一行 `任务` + 关闭按钮（28×28，`h-7 w-7`）。
- 空态是一个 295×176 的虚线框（`border-dashed` + 70% 透明度、`rounded-2xl`）+ 一枚图标 + 12px `当前没有 Run。`——一个 176px 高的虚线框只放一行字，**留白比例失衡**；且虚线 + 低透明度在浅色背景上几乎看不见边界。
- 与左侧会话列表、中间消息区之间**没有分隔线/投影**，三个面板靠背景差异区分（但任务栏没有背景）→ 层次全靠"猜"。

**5) 文件视图（截图 `agent-hub-files-view-zh.png`）**

- 面板头 `文件` + 副标题 `管理 Agent Run 使用的持久文件、证据与产物。` 与窗口标签 `文件` 重复；右上角 `清理可回收文件` 是一枚与窗口级操作同重的描边胶囊（放在面板头而不是窗口头，语义层级错位）。
- 搜索行右侧有**一枚约 37×27 的小方形按钮，里面只有一个 `→`**（过滤面板的展开/收起，截图目测）——无法从图标判断用途，与主界面的玻璃弹层语言也不一致。
- 存储概览：一条通栏进度条 + 右侧 3 个带竖分隔的 KPI 单元（受保护/可回收/可用），进度条与 KPI 的左右边界**没有对齐**（KPI 区从左 816px 才开始，进度条到 800px 结束），观感是"两条不同系统的组件拼在一起"。
- 空态：图标 + `没有找到文件` + 12px 说明（**这是 `未匹配到模型` 之外第二处硬编码中文**，§6.5），垂直位置在剩余空间的中间，但整块没有任何"下一步"动作（比如"清除筛选"）。

**6) 一个容易误判的观察：侧栏字号和代码对不上（P2；结论已在 §7.13-d 更正）**

> **⚠️ 更正**：本节最初的结论（Chrome 文本自动放大）**是错的**。第三轮用 `localStorage` 对照实验定位到真实原因是应用自己的 `nexus.agent.thread-list-scale.v1` 持久化缩放（当时存的是 `1.3`，`10.75 × 1.3 = 13.975`）。下面这段保留作为"如何排除 CSS 原因"的排查过程，**最终结论见 §7.13-d**。

实测中发现侧栏会话行标题（`AgentThreadSidebar.vue:309`，声明 `text-[10.75px]`）的计算字号是 **13.975px**（≈ ×1.3），而同一容器里另一处 `text-[9px]` 是 9px。
用 CDP 做对照后确认这**不是** CSS 层叠问题，而是 **Chrome 的文本自动放大（Text Autosizing / font boosting）** 命中了这个文本块：

- 给该 span 写内联 `font-size: 10.75px` → 立刻变 10.75px（说明代码里没有别的规则覆盖它）；
- 把同一个 span 克隆到 `body` 下 → 也是 10.75px（说明只有它所在的那个"文本块"被放大）；
- 该元素的祖先链上 `zoom` 都是 1、`transform: none`，也没有任何 `font-size` 规则命中它。

（当时的错误推断：这是 Chrome 的文本自动放大。**实际是应用自己的持久化缩放**，见 §7.13-d。）

**这条排查真正有价值的产出**：区分"CSS 失效（§7.10）"与"内联 style / 运行时缩放（§7.13-d）"——两者的现象都是"实测字号与代码里的类不一致"，但修法完全不同：前者改层叠，后者要去掉内联 `font-size`。

### 7.13 第三轮实测：窄窗口 / 深色主题 / 键盘可达性 / 缩放持久化

本轮全部在真实环境用 CDP 操作（拖动 hub 窗口自身的缩放手柄、注入 `darkUiTheme` 的变量做深色对照、按 Tab 走键盘），窗口仍是 1620×953 / dpr 1。

**a) 弹层不受 Hub 窗口约束 → 窄窗口下"跑出窗口"（P1，新发现）**

弹层是 `fixed z-[60]` + **按视口 clamp**（`AgentConfigPopover`），而不是按 Hub 窗口 clamp。实测同一枚模型弹层：

| 场景                                    | Hub 窗口 | 弹层面板            | 是否在窗口内                                             | 覆盖                                                     |
| --------------------------------------- | -------- | ------------------- | -------------------------------------------------------- | -------------------------------------------------------- |
| 附件/文件选择器（宽窗口）               | 1620×840 | `[346,478,520,366]` | 是                                                       | 盖住 composer（向上展开，正常）                          |
| 附件/文件选择器（**最小窗口 560×380**） | 560×380  | `[12,28,520,366]`   | **否**（`y=28` 在窗口顶栏之上，宽 520 几乎等于整个窗口） | 盖住顶栏 + composer + 消息区                             |
| 模型弹层（最小窗口）                    | 560×380  | `[12,88,288,306]`   | 是                                                       | **盖住顶栏与 composer**（窗口只有 380 高，面板就占 306） |

后果：窗口拖到接近最小尺寸时，弹层与窗口"脱开"，视觉上像另一个浮层压在页面上（截图 `agent-hub-attach-popover-escapes-window.png`、`agent-hub-min-window.png`）。
建议：① clamp 边界优先取 **Hub 窗口矩形**，其次才是视口；② 窗口宽度 < 720 或高度 < 520 时，把弹层降级为**贴窗口底部的 sheet**（`rounded-t-2xl`、`max-h-[60%]`），既不出窗口也不盖输入框。

**b) 纯透明弹层在深色底/长内容下"透字"（P1，对 §7.1 的补充证据）**

深色主题下把模型弹层打开，面板背景仍是 `rgba(0,0,0,0)` + `blur(12px)`，实测**能直接看到弹层背后卡片上的文字**（截图 `agent-hub-dark-popover.png` 中弹层左侧透出"规则"二字、下方透出"让"）。
也就是说 §7.1 的"纯透明 + 模糊"不只是风格问题：**当背后是高对比文本时（深色底、或长中文段落），弹层内容与背后文字会互相干扰**，可读性下降。
这给 §7.1 的建议 1（固化成 `.glass-surface` 并给出真正的玻璃基色 alpha）提供了可复现的证据——建议 alpha 取 `0.72~0.85` + `blur(16~20px)`，并在深色主题下单独验证。

**c) Hub 的键盘可达性：✅ 已关闭 2026-09-23（以下保留旧复现证据）**

```
打开 Hub 后：document.activeElement = <body>            // 焦点没有进入弹窗
Hub 根元素：role="dialog" aria-modal="true"             // 声明是模态
背景元素：main/… 的 inert 属性全为 false                // 背景没有 inert
按 1 次 Tab：焦点落到 <a.router-link-active>（背后的应用导航"仪表盘"）
连按 14 次 Tab：14 次全在 Hub 之外（nav-link ×9、icon-link ×2、主题按钮、搜索框、标签按钮…），
                 焦点从没进过这个 role="dialog"
按 Escape：Hub 仍然可见（没有关闭）
```

即：**声明了 `aria-modal="true"`，但用户按一次 Tab 焦点就跑到背后的 Dashboard/终端导航上**；键盘用户完全可能在不经意间操作到被"模态"遮住的应用。
复现成本极低（打开 Hub → 按 Tab）。

> ✅ **2026-09-23 CDP 复验**：打开后 `activeElement = <section class="agent-hub-window">`、`#app.inert=true`；连续 35 次 Tab **0 次逃出** Hub/Hub-owned portal；Escape 后 Hub 关闭、`#app.inert=false`，焦点回到「打开 Agent」Launcher。附件 Popover 内再按 8 次 Tab 同样 0 次逃出，Escape 只关闭 Popover 并把焦点还给附件按钮。

**d) 会话列表"Ctrl+滚轮缩放"被持久化，且会悄悄改变字号（P2，新发现；同时修正 §7.12-6）**

`AgentThreadSidebar.vue:64/127/136-142` 把缩放系数存进 `localStorage['nexus.agent.thread-list-scale.v1']`；
行标题/副标题是用 **内联 `fontSize: ${10.75 * scale}`** 渲染的（`:310`、`:317`），行高也是 JS 算的（`rowHeight = Math.round(BASE * scale)`，`:65`）。
实测（同一个页面，只改这个 key）：

| `thread-list-scale` | 行标题计算字号 |
| ------------------- | -------------- |
| `1`                 | **10.75px**    |
| `1.3`               | **13.975px**   |

本环境的 localStorage 里此前就存着 **`1.3`**（说明有人滚过一次，之后一直生效）。
两个问题：① 该交互**没有任何可见入口/提示/重置项**（§2.8 已记），缩放状态还会跨会话保留；② 因为走的是内联 style + JS 计算，**字号/行高绕过了设计 token**，同一份代码在不同用户机器上侧栏字号可以相差 30%。
建议：给缩放一个可见的入口与"重置为 100%"，并把缩放改为 CSS 变量（`--agent-thread-scale`）驱动，避免内联 font-size。

> ✅ **2026-09-23 闭环**
>
> - **现象（修复前实测）**：侧栏头部只有「删除全部会话」「新建」两枚按钮（`zoomish: 0`、无任何 `100%/重置` 文本入口）；`localStorage['nexus.agent.thread-list-scale.v1']` 为 `1.3` 时行标题计算字号 `13.975px`、副标题 `11.7px`、行内边距 `7.8px`，而三者全是**内联 style**（`style="font-size: 13.975px"` / `style="padding-top: 7.8px"`），根节点没有任何缩放变量。
> - **根因**：缩放只有 `Ctrl/⌘+滚轮` 一条输入路径，状态由 `AgentThreadSidebar.vue` 内联进 DOM；既没有回显也没有重置入口，字号/行高/内边距全部绕开设计 token（同一份代码在不同机器上 10.75px ~ 13.975px）。
> - **改法**：① 头部新增 `100%` 缩放胶囊（Gen2 `UiPopover`，`density=compact`，与相邻 28px 图标按钮同高），面板内含「放大 / 缩小 / 重置为 100%」，到边界（0.8 / 1.3）或已在 100% 时对应项禁用；② 缩放系数改为根节点 CSS 变量 `--agent-thread-scale`，字号与内边距在 scoped 样式里 `calc()` 换算，行高仍由 JS 计算（虚拟列表需要）；③ `Ctrl/⌘+滚轮` 与新面板共用一个写入路径 `applyScale()`（保持"当前行"不跳动）。
> - **CDP 验证**：侧栏头部实测 `会话 | 3 | 100%`，胶囊 `48×28`、`title` 为滚轮提示；打开面板看到 `会话列表缩放 | 100% | 放大 | 缩小 | 重置为 100%`，三项 `disabled = [false,false,true]`；连续点击「放大」3 次 → `110% → 120% → 130%`，`--agent-thread-scale: 1.3`、标题 `13.975px`、副标题 `11.7px`、行内边距 `7.8px`，且 `disabled = [true,false,false]`（放大到顶禁用）；点「重置为 100%」→ 回到 `100%` / `10.75px` / `6px`、`localStorage` 写回 `1`；`Ctrl+滚轮` 路径复测 `1 → 1.1 → 0.9`，胶囊同步显示 `110% / 90%`；三个量（标题/副标题/行内边距）现在均由变量驱动，`style` 属性只剩 `--agent-thread-scale`。

> **更正（第二轮结论）**：§7.12-6 之前把 `10.75px → 13.975px` 判为"Chrome 文本自动放大"。本轮用 `localStorage` 对照实验证明，真实原因是**上面这枚持久化的 1.3 倍缩放**（`10.75 × 1.3 = 13.975`）。特此更正，§7.12-6 保留作为"排查思路"，但结论以本条为准。

**e) 设置区"禁用态主按钮"难以识别（P2，新发现）**

实测「运行与环境」页的 `保存`：`disabled=true`、`opacity: 0.5`、`cursor: not-allowed`、背景 `rgb(160,108,213)`（同一个 primary 色）。
于是同一个设置区里出现两种"主按钮"外观：**全量紫**（可用，如「添加 Provider」）与 **50% 紫**（禁用，如「保存」「预览导入」「卸载」「立即更新」长期处于此态）。
在浅色底上两者差异很小（看起来都像"淡紫的按钮"），用户无法判断"是按钮坏了、还是没改动所以不可点"。
建议：禁用态改为**中性灰底 + 中性文字**（而不是降低品牌色透明度），并在按钮旁给出原因（"无改动可保存"），这也是 §6.6 规范里应该补的一条。

> ✅ **2026-09-23 闭环**
>
> - **中性填充**（§6.2 批 1/2）：`保存` / `预览导入` / `卸载` 等实测已是 `bg rgb(243,244,246)` + 中性描边 + `opacity 0.5`，不再保留品牌色。
> - **补齐禁用原因**（本次）：修复前 11 个"稳态禁用"按钮里只有 `卸载` 有 `title`；现在全部带原因，三语齐全
>   （新增 i18n `agent.settings.disabledReason.*`：`noChanges` / `noPreviewChanges` / `incompleteForm` / `selectionRequired` / `repositoryRequired`）。
>
> **CDP 复验（`https://api.honus.top/settings` → Agent，逐分组扫描 `button:disabled`）**
>
> | 按钮               | 分组 / 卡片               | 禁用条件                          | `title`（修复后）                   |
> | ------------------ | ------------------------- | --------------------------------- | ----------------------------------- |
> | `保存`             | 预算与上下文              | `!isDirty`                        | 没有未保存的修改                    |
> | `保存`             | 执行与性能                | `!isDirty`                        | 没有未保存的修改                    |
> | `保存`             | Plugin / App 独立执行预算 | `!dirty`                          | 没有未保存的修改                    |
> | `保存`             | Artifact 与存储           | `!isDirty`                        | 没有未保存的修改                    |
> | `预览变更`         | 执行步数限制              | `!canPreview`                     | 没有待预览的改动                    |
> | `创建 Integration` | MCP 集成                  | 显示名称 / Endpoint 为空          | 请先填写必填项                      |
> | `创建 Integration` | ACP 运行时                | 显示名称 / Profile 为空           | 请先填写必填项                      |
> | `预览导入`         | Memory 审核与发布         | 来源 App / 记忆 / 目标 App 未选全 | 请先选择来源与目标                  |
> | `添加仓库`         | 可安装 App 与 Skill       | 仓库地址为空                      | 请先填写仓库地址                    |
> | `卸载`             | Agent App                 | 该 App 仍启用                     | 请先停用该 App 后再进行卸载（原有） |
>
> - 门禁：`all templates compile` + `vue-tsc --noEmit` exit 0 + `prettier --check` + `pnpm lint:agent-i18n`（`Agent i18n check passed`）。
> - **同类未覆盖**：全局设置页（`features/preferences`，非 Agent 范围）的 `保存本组` 仍是禁用无原因；
>   本环境也仍未渲染 `添加 App` / 目标列表等需要先选中对象的按钮（与 §7.15-b 同一类环境限制）。
>   **f) 同页控件字号/尺寸仍不统一（实测补充）**

- `<select>`：同一个「Agent」设置页里，运行与环境 tab 的 select 计算字号 **16px**（552×36），插件与安全 tab 的 3 个 select 是 **12px**（588×36 / 537×36）→ 同一组件两种字号。
- `<input type="number">`：552×36 / fs 16px（受 §7.10 的 cascade 问题影响）。
- 原生 `checkbox`：**13×13px**（`accent-primary`），远低于 24px 触控标准，且是浏览器原生外观（与浮窗的图标方块语言不一致）。

**g) 窄窗口下工具栏其实会退化成"图标态"（对 §7.3 的精确化，避免误读）**

把 Hub 窗口拖到 1200 / 740 / 560 宽实测：

| 窗口宽            | `.agent-toolbar-controls` | 7 个配置控件                   |
| ----------------- | ------------------------- | ------------------------------ |
| 1620（默认）      | 683 / 683                 | 全显示，带文字标签             |
| 1200              | 683 / 683                 | 全显示，带文字标签             |
| 740（≤1040 断点） | 660 / 660                 | 退化成**图标态**，7 个全部可见 |
| 560（最小）       | 496 / 496                 | 图标态，7 个全部可见           |

也就是说：**容器变窄时 `agent-config-compact` 会兜住**（不会裁切）；§7.3 观测到的裁切发生在**宽窗口 + 右侧组变长**时（有内容的会话会多出「跳到底部」+ token 胶囊两枚控件，把 `高` 挤出去，实测截图 `agent-hub-jump-to-latest-clipped-chip-zh.png`）。
修的时候要同时管住"右侧组会随运行状态变长"这件事，而不是只怪左侧控件太多。

**h) Agent 回复里的外链会在当前窗口跳走（P2，代码级结论，未做点击实测）**

`ai/AgentMessageBody.vue` 用 `DOMPurify.sanitize(marked.parse(text))` 渲染助手消息（**这点是好的**：sanitize + 明确的 `ALLOWED_TAGS/ALLOWED_ATTR` 白名单，`v-html` 有防护），但白名单是 `['href', 'title', 'start']` —— **不含 `target`/`rel`**，而应用里没有任何全局链接拦截（`grep 'closest("a")' / addEventListener('click')` 在 agent 目录无命中）。
对照：应用其它位置的外链都显式写了 `target="_blank" rel="noopener noreferrer"`（`app/shell/AppHeader.vue:100`、`pages/settings/AboutPanel.vue:67`）。
后果：**点击 Agent 回复里的链接会让整个 SPA 在当前标签页跳走**，用户会离开正在进行的会话（虽然窗口 bounds/线程都在 localStorage，可以后退回来，但体验上是"点一下就丢了界面"）。
建议：在 `ALLOWED_ATTR` 外对 `.agent-message-body a` 统一补 `target="_blank" rel="noopener noreferrer"`（或点击时 `window.open`），与产品其它位置保持一致。

### 7.14 第四轮实测：composer 裁切根因 / 任务栏与审批卡 / i18n 精确计数

> 本轮浏览器窗口实测为 **1600×773 / dpr 1**（与前三轮的 1620×953 不同：本轮开始时浏览器的真实窗口尺寸就已经是 1600×773，**未做任何改动**，Hub 窗口沿用持久化的 1600×711）。下面所有数字都是该尺寸下的实测值。

**a) composer 工具条裁切的根因：`max-w-3xl` 封顶 + 容器查询监听错了容器（P0，§7.3 的根因补充）**

实测（窗口 1600 宽、会话已加载、右侧任务栏关闭）：

```
.agent-toolbar-controls   clientWidth 617 / scrollWidth 659   overflow-x: hidden
容器右边界 x = 1170
最后一个控件「思考强度」（类名 agent-config-reasoning）位于 1146 … 1212  →  被裁掉 42px
可见部分只剩那枚靛蓝闪电图标（fa-bolt），标签「高」与箭头完全在裁切之外
```

即：**在默认窗口尺寸下「思考强度」就已经不可见**（不是"项目多的时候偶尔看不到"），
而且它不是被挤到第二行，而是被 `overflow-x: hidden` 静默切掉 —— 界面上留下一个没有任何文字的闪电图标（截图：`doc/imgs/review-2026-09-21/agent-hub-composer-clip-reasoning-zh.png`）。

**为什么响应式折叠没有兜住？** 两件事叠加：

1. `ai/AgentConversation.vue:590` — composer 外层是 `mx-auto max-w-3xl`（**768px 上限**）；窗口再宽，工具条也只有约 752px 可用。
2. 折叠规则（隐藏 `.agent-config-verbose`、显示 `.agent-config-compact`）挂在
   `@container agent-conversation-pane (max-width: 700px / 560px)`（`host/AgentAppSurface.vue:2553-2592`），
   而这个容器是**整个会话面板**（实测 1342px）——1342 远大于 700，**断点永远不会触发**，
   与真正的约束（768px 的 composer）差了 574px。

**对照探针**（只改 composer 上限，不动产品代码，测完还原）：

| 场景             | composer 宽 | 工具条 clientWidth / scrollWidth | 是否裁切        |
| ---------------- | ----------- | -------------------------------- | --------------- |
| 现状             | 768         | 617 / 659                        | **是（-42px）** |
| 去掉 `max-w-3xl` | 1310        | 1159 / 1159                      | 否（0 溢出）    |

补充：右侧动作组确实会挤压左组（空态时 683/683 不裁；出现 token 徽标后 617/659 裁），
但**让这 42px 无处可去的，是上面的 768px 上限 + 断点挂在错误的容器上**。
修 §7.3 时如果只把 `overflow-x-hidden` 换成 `flex-wrap`/`⋯更多`，问题会变成"换一种形式出现"——
**必须同时把容器查询的容器换成 composer 自身**（在 `.agent-composer-shell` 或 `max-w-3xl` 那层加 `container-type: inline-size` + `container-name`），或把断点提高到 ~800px。

**b) 任务栏（TaskRail）/ 审批卡的新发现（本轮补审：这是此前唯一没逐屏看过的区域）**

| 位置                                           | 现状                                                                                              | 问题                                                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime/TaskRail.vue:782-800`「目标」卡片     | 直接渲染 `#{{ connectionId }}`（实测界面上就是孤零零一个 `#1`）                                   | 内部连接 ID 直接进 UI，用户看不出"这是哪台机器"；没有名称/角色/状态，这张卡几乎是空的                                                                          |
| `runtime/TaskRail.vue:516/710/742/783/807/850` | 6 个拖拽把手都是 `<button>`，只作为 `vuedraggable` 的 `handle` 选择器，自身没有 `click`/`keydown` | 键盘用户能 Tab 到这 6 个按钮，但回车/空格**毫无反应**（读屏会念"拖动卡片排序"，然后什么都没发生）；排序也没有键盘替代（无上移/下移按钮）                       |
| `runtime/TaskRail.vue:125`                     | 卡片顺序存 `localStorage['nexus.agent.task-rail-order.v1']`                                       | 与 §7.13-d 同类：本地状态无重置入口，且不区分用户/线程（换账号共用同一顺序）                                                                                   |
| `runtime/TaskRail.vue:109`                     | `historyRuns` = `…slice(0, 8)`                                                                    | 第 9 条之后的 Run 在任务栏里**没有任何入口**（无"查看全部"、无分页）；实测该会话正好 8 条，卡片标题就写着「Run 历史 8」                                        |
| `runtime/ApprovalCard.vue:45`                  | `{{ approval.inspection.risk }}` 原样输出                                                         | 渲染 `read / control / mutate / destructive / forbidden`；i18n 里**确实没有** `agent.approvals.risk` 这个 key（需新增，例如 `agent.approvals.risk.{value}`）   |
| `runtime/ApprovalCard.vue:73`                  | `$t('agent.approvals.resolved', { state: approval.status })` → 中文串「审批状态：{state}」        | 渲染成「审批状态：approved / denied / superseded」——中文句子里嵌英文枚举                                                                                       |
| `runtime/ApprovalCard.vue:53`                  | `{{ remaining }}s`                                                                                | 单位 `s` 硬编码（中文界面显示「剩余 300s」）                                                                                                                   |
| `runtime/ApprovalCard.vue:110/127`             | 「批准」= `bg-warning text-black`，「拒绝」= `border-error/40 text-error`                         | 用**警告色**表示肯定动作；同一产品里 primary（紫）/ success（绿）都没被用上，品牌色、成功色、警告色、危险色四层语义被压缩成两层，用户难以形成"颜色=后果"的直觉 |

> ✅ **2026-09-23 闭环（审批卡三处）**：`risk` → `agent.approvals.risk.*`；`剩余 {remaining}s` → `agent.approvals.expiresIn`（en `{seconds}s` / zh `{seconds} 秒` / ja `{seconds} 秒`）；「批准并执行」按钮 `bg-warning text-black` → `bg-primary text-white hover:bg-primary-hover`，让"肯定动作=品牌色、拒绝=危险色"回到两层语义。
>
> **验证方式**：本轮 `runner_not_configured`（见 §7.15-b）导致本环境没有任何 Workspace mutation 工具，"创建文件"这类请求直接被模型拒绝执行，因此**无法在本环境复现真实审批卡**（现象基线仍是上一轮的 `doc/imgs/e2e/agent-approval-narrow.png`）。改动本身用运行中的 i18n 实例取值验证：`agent.approvals.expiresIn`、`agent.approvals.risk.*`、`agent.approvals.status.*` 在 zh-CN 下均命中中文；等本环境接入 Workspace Runner 后应补一次真实卡片截图。
>
> ✅ **2026-09-23 闭环（任务栏四项）**：没有删除拖拽排序（§2.8 的"直接删掉"属于产品决策，本轮先补齐可达性），而是把缺的那一半补上。
>
> | 项                      | 改法                                                                                                                                                                                            | 真实 CDP 复验                                                                                                                                                                |
> | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 6 个拖拽把手无键盘行为  | 每个把手加 `@keydown`（↑/↓ 与相邻**可见**卡片交换，走与拖拽同一条 `visibleCards` 写回路径）、`title`（`agent.tasks.dragCardHint`）、`aria-keyshortcuts="ArrowUp ArrowDown"`、`focus-visible` 环 | 实测 `["progress","history"]` → 按 ↓ → `["history","progress"]`；↑ 在顶部被正确 clamp；焦点跟着被移动的卡片走（`activeElement.closest('[data-rail-card]')` 仍是 `progress`） |
> | 卡片顺序无重置入口      | 顺序与默认值不一致时，在卡片列表下方出现 `重置卡片顺序`（`agent.tasks.resetCardOrder`），点击写回 `defaultCardOrder`；顺序一致时不显示                                                          | 顺序被改后按钮出现，点回默认顺序后按钮消失；`localStorage['nexus.agent.task-rail-order.v1']` 同步回到默认                                                                    |
> | 「目标」卡片只渲染 `#1` | 新增 `useConnections()`：连接名（无名字时 `user@host`）作为 chip 文本，原始连接 ID 退到 `title="#{id}"`；取不到名字时回退 `#id`                                                                 | ⚠️ **本环境无任何连接**（`connections` 表 0 行，全部 Run 的 `connectionIds` 都是 `[]`），因此实测只跑到回退分支；接入连接后应补一次截图                                      |
> | Run 历史 8 条硬上限     | `historyLimit` 起步 8 条，卡片底部在有更多时显示「显示更早的 Run（还有 {count} 条）」按钮，每次 +8 条（`agent.tasks.showOlderRuns`）                                                            | ⚠️ 本环境单会话最多 5 个 Run，**无法触发第 9 条**；改动为纯前端增量展开，待有 >8 条 Run 的会话时复验                                                                         |
>
> 6 个把手的键盘路径与焦点保持在 `runtime/TaskRail.vue`；`vue-tsc`、`pnpm lint:agent-i18n`、Prettier 通过。
> | `host/AgentHubWindow.vue:583-590` | 右下角缩放手柄是 `h-4 w-4`（**16×16**）的 `<button>`，只有 `@pointerdown` | 命中区仅 16px（§2.4 同类），且**键盘不可用**：能聚焦、回车无反应（缺 `role="separator"` + 方向键） |

**c) 硬编码文案的精确计数（补 §6.5 的"约 38 行"）**

统计口径：`packages/frontend/src/features/agent/**`（排除 `i18n/`，排除纯注释行），含 CJK 的行数：

| 文件                                                                   | 行数    |
| ---------------------------------------------------------------------- | ------- |
| `settings/AppManagementSettings.vue`                                   | 37      |
| `settings/StorageArtifactSettings.vue`                                 | 16      |
| `settings/ModelProviderSettings.vue`                                   | 14      |
| `ai/ConversationMessage.vue`                                           | 13      |
| `settings/PluginManagementSettings.vue`                                | 13      |
| `settings/quantity-format.ts`                                          | 8       |
| `settings/BudgetContextSettings.vue`                                   | 7       |
| `settings/SubagentSettings.vue` / `settings/SafetyNetworkSettings.vue` | 3 / 3   |
| 其余 4 个文件各 1                                                      | 4       |
| **合计**                                                               | **118** |

会直接显示给用户的代表：`ai/ConversationMessage.vue:99-107`（9 条中文错误解释）、`:311-334`（`总消耗: N (输入: …, 输出: …)`）、`settings/quantity-format.ts`（`≈ 1 小时 (3,600 秒)` 这类"数值+单位"）、`settings/AppManagementSettings.vue:335-425`（能力名称/描述）、`settings/SubagentSettings.vue:217-221`（字段名）、`settings/AgentSettingsPanel.vue:104`（`'未设置'`）。
→ 与 §6.5 实测的"英文界面下 29 个可见中文文本节点"互相印证；**修复范围应按这 118 行评估**，而不是 38 行。

> ✅ **2026-09-23 闭环**：`features/agent/**` 里**非注释硬编码中文 116 行 → 0**（同一个扫描口径：排除 `i18n/`、排除注释行）。
>
> **改了哪些**
>
> | 批次 | 范围                        | 新增 key（节选）                                                                                                                                                                                                                                                                                                                                                                                                                                         |
> | ---- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | 1    | "数值 + 单位"与小型设置面板 | `agent.settings.quantity.*`（新增 `settings/use-quantity-labels.ts`，`formatQuantity` / `getQuantityFeedback` 改收 `labels` 参数，而不是在 formatter 里写死中文）、`budget.groups/presetSteps/customTuning/effective/unsavedChanges`、`performance.*`、`feature.schedulerHint`、`guardrails.hardBoundary`、`modelNotSet`、`subagents.labels.*`、`safety.reasonPresets.* / defaultReason / removeOrphanId`                                                |
> | 2    | 模型 / 存储 / 插件面板      | `providers.fieldRequired / completeRequired / credentialConfigured / copyUrl / latency / reasoning / noMatchingModel`（`modelCount` / `contextShort` / `outputShort` 复用既有 key）、`storage.fields.*`、`storage.currentUsage / quotaTitle / unsavedChanges / savedNotice / example`、`plugins.ecosystemBadge / signatureVerified / skillCount / thirdPartyRepository / state* / summaryNexus* / compatibilityShort / reverifyPackage / publisherCount` |
> | 3    | 能力清单与对话用量          | `apps.capabilities.<id>.name/desc`（14 个能力 × 2）、`apps.badges.*`、`apps.summaries.*`、`apps.enabledCount / grantedCount / deleteDataOnUninstall`、`conversation.toolFailure.<CODE>`（9 条错误解释）、`conversation.usage.estimated/total/cached`                                                                                                                                                                                                     |
>
> **做法上的两个决定**
>
> - **formatter 不再自己拼中文**：`quantity-format.ts` 是纯函数模块，按层约定不能 import `@/app/i18n`（`features/**` 目前 0 处依赖 `@/app/**`），所以改成由组件注入 `QuantityLabels`；`use-quantity-labels.ts` 把位置参数包成 `{ value }` 模板，日文的"分/時間/日"也能正确渲染。
> - **能力名称走 id 查表**：`CAPABILITY_METAS` 只保留 `category` / `icon` 这类结构性数据，`name` / `desc` 用 `t('agent.settings.apps.capabilities.<cap>.name')` 动态查（`file.read` 这类带点的 id 正好对应词典的嵌套路径）；未知能力回退到 `capabilityUnknownDesc`。
>
> **真实 CDP 复验（`https://api.honus.top/settings` → Agent）**
>
> | 语言  | 子页                    | 可见中文文本节点         |
> | ----- | ----------------------- | ------------------------ |
> | en-US | Models & Budget         | **0**（修复前 29）       |
> | en-US | Runtime & Environments  | **0**                    |
> | en-US | Plugins & Security      | **0**                    |
> | zh-CN | 插件与安全 / 运行与环境 | 68 / 122（正常中文界面） |
>
> 抽取样本：en-US `Ecosystem and registries` / `1 keys` / `Verify package again` / `Scheduler delegates across apps with dynamic budget control`，
> 对应 zh-CN `扩展生态与仓库` / `1 个密钥` / `重新校验包` / `调度器支持多应用委派与动态预算管控`；
> 预算页 zh-CN 仍为 `25 步 · 10 min` / `自定义微调` / `执行步数保险丝`，en-US 变为 `25 steps · 10 min` / `Custom tuning` / `Execution step fuse`。
> `vue-tsc --noEmit`、`pnpm lint:agent-i18n`（键位对齐 + zh/ja 无整句英文）、Prettier 全部通过。
> **d) 一致性观察：作者知道要"模态"，但只做了一半（支撑 §7.13-c）**

`host/AgentHubWindow.vue:22-56` 在 Hub 可见时会锁死 `documentElement/body` 的 `overflow` 与 `overscroll-behavior`（`lockBackgroundScroll`），
说明"打开 Hub 时不该操作背后的页面"是被明确认知的；但**焦点/键盘层面完全没有对应处理**（没有 `inert`、没有焦点陷阱、没有 Escape、没有 `aria-hidden`），
实测按 12 次 Tab 全部落在背后应用（§7.13-c）。建议把"滚动锁 + 焦点锁 + Escape + 焦点归还"合并成同一套「模态边界」处理。

---

### 7.15 第五轮实测：设置区逐页扫描（运行与环境 / 插件与安全 / 模型与预算）

> 本轮把设置区三个分组逐页截图核对（全页截图：`/tmp/shots/66-full-{models,runtime,plugins}.png`），补上此前"只看了 Agent 首屏"的缺口。窗口仍是 1600×773。

**a) `zh-CN` 词典里有 14 条"整句英文"（34 个 key 与 en-US 完全相同）→ 中文界面直接显示英文（P1，新）**

> ✅ **2026-09-23 闭环**
>
> - **词典补齐**：`zh-CN` 与 `en-US` 取值完全相同的 key 由 **35 → 22**，其中"整句英文"由 **15 → 5**；
>   `ja-JP` 由 **49 → 31**（整句英文 **20 → 5**）。剩下 5 条都是品牌/协议/格式（`Chat Completions`、`Responses API`、
>   `{count}/{max}`、`https://api.openai.com/v1`、`{entry} · sha256:{hash}`），按规则进白名单。
> - **本轮实际改了这些**：`safety.revision`（`Denylist revision 1` → `禁用清单版本 1`）、`hardLimits.title`/`panelHint`/`confirmTitle`/
>   `hardLimitHint`/`profileHint`、`browserRuntime.endpoints`、`mcpIntegrations.title`/`retry`、`acpRuntime.profiles`/`integrations`/`integrationProfile`、
>   `commands.goalRevision`/`planRevision`、`workspaceRuntime.acpProfiles`/`exportTitle`/`importTitle`、`plugins.officialRepository`、
>   `subagents.templateWorker`/`peerMessaging`（后两条是 ja 侧），ja 侧同步。
> - **枚举不再拼进本地化句子**：新增 `agent.approvals.status.{requested,approved,denied,expired,superseded}` 与
>   `agent.settings.feature.stateLabels.{disabled,enabling,enabled,degraded,unavailable}`（三语齐全，沿用 `agent.tasks.runStatus.*` 的嵌套约定），
>   `ApprovalCard.vue` / `AgentFeatureSettings.vue` 改为查表后再插入 `{state}`。
> - **CDP 复验（中文界面）**：设置 > Agent > 插件与安全 → 「全局禁用目标」右上角显示 **`禁用清单版本 1`**（`Denylist revision` 命中 0 次）；
>   Agent 功能卡片显示 **`当前状态：已启用`**（`当前状态：enabled` 命中 0 次）；两页 `Hard Limits` / `MCP Integrations` / `CDP Endpoints` 命中 0 次。
> - **防回归**：新增 `scripts/check-agent-i18n.mjs`（`pnpm lint:agent-i18n`，已挂进 `pnpm lint`）：
>   校验三份词典 key 完全对齐 + `zh/ja` 中与 `en` 逐字相同且"含 ≥2 个英文单词"的取值必须进白名单；脚本自身做过负向验证（注入英文整句会 fail 并退出 1）。

实测位置：设置 > Agent > **插件与安全** → 「全局禁用目标」卡片右上角写着 **`Denylist revision 1`**（截图 66-full-plugins）。
来源不是组件代码，而是**翻译文件本身没翻译**：`features/agent/i18n/zh-CN.json` → `agent.settings.safety.revision = "Denylist revision {revision}"`（与 en-US 一模一样）。

键值对比统计：

| 指标                                                               | 数量          |
| ------------------------------------------------------------------ | ------------- |
| `zh-CN` 与 `en-US` 取值**完全相同**的 key                          | **34 / 1148** |
| `zh-CN` 中"不含中文、含 ≥2 个英文单词、长度 > 12"的值（=整句英文） | **14**        |
| `ja-JP` 中同类值                                                   | **18**        |

代表条目（都是用户可见文案）：`agent.settings.safety.revision`（`Denylist revision {revision}`）、
`agent.conversation.commands.goalRevision` / `planRevision`（`Goal revision {revision}` / `Plan revision {revision}`，由 `ai/conversation-command-executor.ts:115/137` 输出到对话里）、
`agent.settings.summary.runtime`（`Workspace Runtime`）、`agent.settings.acpRuntime.profiles`（`Workspace ACP Profiles`）、`agent.settings.acpRuntime.integrations`（`ACP Integrations`）…
→ 建议加一条 i18n 校验规则：`zh/ja` 中若某 value 与 `en` 完全相同且含多个英文单词则报错（品牌词 `MCP Integrations` / `Chat Completions` 之类进白名单），然后把这 14+18 条补上译文。

**b) 把原始机器码当"不可用原因"给用户看（P1，新）**

> ✅ **2026-09-23 闭环（CDP 复验，中文界面）**
>
> `WorkspaceRuntimeSettings.vue` 不再直接渲染 `availability.reason`：新增 `availabilityReason` computed，
> 先按 `agent.settings.workspaceRuntime.reason.{code}` 查表（新增 `runner_not_configured` / `runner_unavailable` / `runtime_not_configured` 三个码，三语齐全），
> 命中就显示人话、原始码只留在 `title`；未命中则显示 `reasonUnknown` 通用说明，并在下面加一行
> `后端原因代码: <code>`（等宽小字）供排查 —— 既不再把机器码当解释，也不丢调试信息。
>
> 实测：接口当前返回 `{"available":false,"reason":"runner_not_configured"}`，界面显示
> **「尚未配置 Workspace Runner（缺少地址或访问令牌），Workspace 运行时不可用。」**，页面内 `runner_not_configured` 命中 0 次。
> （§7.15-b 原文记录的 `runtime_not_configured` 是当时那套配置下的取值，两者都已进映射表。）

`settings/WorkspaceRuntimeSettings.vue:270` 的 `<p v-if="availability.reason">{{ availability.reason }}</p>` 直接渲染后端原因码；
实测「Workspace 开发环境」卡片里显示的是灰色的 **`runtime_not_configured`**。
这是"为什么这个功能用不了"的**唯一解释**（同一行只有「不可用」三个字），用户既看不懂也没法搜索。
建议：`reason` 走 code → 文案映射（i18n），原始码放进 `title` 或调试区。

**c) 超长页面 + 8 个各自独立的「保存」按钮（P2，新）**

「运行与环境」分组实测全页高 **3825px**（`documentElement.scrollHeight`），内部至少有 8 处独立保存动作：
执行与性能 / Plugin·App 独立执行预算 / 浏览器运行时 / MCP Integrations / ACP 运行时（Profiles）/ Subagent / 配置档 / Artifact 与存储。
它们用的是同一个浅紫主按钮样式、且**大多数时候处于 `disabled`**（没改动时），页面又没有粘性分区导航 ——

> **部分闭环（2026-09-23，见 §7.25）**：分组导航已改为粘性（滚 807px 后停 y=0），嵌套框也从 3~4 层收到 1 层，
> `运行与环境` 全页高 3625 → 3423px；其中 **8 个独立保存按钮已由 §7.31 关闭**（按 dirty 分级：无未保存变更时降级为 `soft`/`neutral` + 禁用 + 原因 `title`），本条整节闭环。原文如下：
> 滚到页面中段时用户既不知道自己在上/下哪一段，也不知道刚才改的那一项有没有生效（§7.13-e 已记"禁用态难识别"，这里是它的放大版）。

**d) 空态风格与主界面不一致（P2，新）**

设置区的空态基本是**左对齐一行纯文本**：`尚未配置 MCP Integration。`、`当前 App 与状态下没有 Memory。`（外面套一层虚线框）；
而主界面（Hub / 会话）的空态是"图标 + 居中 + 标题 + 引导按钮"的卡片。
同一产品两套空态语言，设置区显得没做完。

> ✅ **2026-09-23 闭环（见 §7.28）**：新增 Gen2 通用 `UiEmptyState`（`dense` / 卡片两档），
> 设置区 **10 处**空态收到同一套语言：7 处列表内空态用 `dense`（实测 `950×38`，行内图标+说明），
> 3 处「整块列表为空」用卡片档（`950×143`，图标 + 标题 + 说明 + 可选主操作）。
> 原文记录的「左对齐一行纯文本」在设置区已归零。

**e) 状态胶囊被当成按钮用（P2，§7.11 同类的补充）**

同一屏实测出现：`已启用`（绿）、`运行正常`（绿）、`官方核心`（紫）、`扩展生态与仓库`（绿）、`可安装 App 与 Skill`（绿）、`已禁用 0/1 个连接`（橙）、`系统硬边界`（绿）、`变更实时保存`（蓝）……
其中「已禁用 0/1 个连接」用**警示橙**表示"禁用"这一**状态**，而同一行的「管理禁用目标」才是操作按钮 ——
颜色语义（橙=警告/需要注意）与可点击性（哪些能点）都没统一。

**f) 设置区控件规格的实测计数（配合 §7.10 / §6.2）**

在 `#agent-settings-models` 面板内实测：

| 指标                                         | 实测值                                                                                           |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `<button>` 总数 / 其中计算字号 = **16px** 的 | 55 / **53**                                                                                      |
| 出现的「高度×字号」组合                      | ≥10 种：`40x16`、`38x16`、`36x16`、`28x16`、`20x16`、`16x12`、`97x16`、`42x16`、`32x16`、`28x11` |
| 原生 `<input type="checkbox">` 尺寸          | **13×13**                                                                                        |
| 同页 `input` 与 `select` 的字号              | input **16px** / select **12px**                                                                 |

→ "设置区又大又糙"的机械原因就是 §7.10 的级联：**字号类根本生不效**，所以按钮只能跟着全局 16px 走。

> ✅ **2026-09-23 复核**：按钮档位已由 §6.2 批 1/2 收敛（实测统一 `32px / fs12 / r8`），表中"原生 `<input type="checkbox">` **13×13**"一行已清零：`features/agent/settings/**` 的 27 处原生 checkbox 全部换成 Gen2 `UiCheckbox`，实测 `16×16 / r5 / role=checkbox`（逐条证据见 §7.20）。剩余规格差异集中在**分组导航胶囊 / 顶部 Tab 的 36px 高度**与**原生 `<select>`**（下一轮）。

---

### 7.16 组件级补充（模型弹层 / 启动器）

**a) 弹层的 clamp 用的是**视口**而不是 Hub 窗口（§7.13-a 的代码定位）**

`files/AgentConfigPopover.vue:38-57` 的 `positionPanel()` 里，水平/垂直边界都取 `window.innerWidth / window.innerHeight`（`minLeft = 12`、`maxLeft = window.innerWidth - width - 12`），
`AgentAppSwitcher.vue:31-46` 的 `positionPanel()` 同样只用 `window.innerWidth/innerHeight`。
这解释了 §7.13-a 的实测现象（最小窗口 560×380 时弹层跑到 Hub 窗口之外）——**它们根本不知道 Hub 窗口的矩形**。
建议：把 Hub 窗口矩形（`agentWindowManager.state.bounds`）作为第一优先 clamp 边界，视口只作为兜底。

**b) 同一个「活动数」在两处用了两种颜色（P2，代码核对；测试时为 0 未截图）**

- 启动器悬浮球徽标：`host/AgentLauncher.vue:85-89` → `bg-error`（**红色**）；
- Hub 顶栏徽标：`host/AgentHubWindow.vue:381-384` → `bg-primary/15 text-primary`（**紫色**）。

两处显示的是同一个 `totalRunningRuns + totalPendingApprovals + totalPendingBudgetRequests`。
"有 Run 在跑/有待审批"是**中性或需要关注**的信息，用错误红表示会把"正常运行中"渲染成"出错了"；
而且同一数字在两处不同色，用户无法形成稳定预期。建议统一为 primary（待审批可单独用 warning）。

---

### 7.17 第五轮补充：可复用的"正面样本"与一处主操作禁用态

本轮顺带把几个"做对了的地方"记录下来——它们是修 §7.13-c（Hub 键盘可达性）与设置区精致度时**现成的模板**。

**a) 正面样本 1：`AgentConfigPopover` 是唯一交互完整的弹层（实测通过）**

| 能力                                                              | 实测结果                        | 代码                                  |
| ----------------------------------------------------------------- | ------------------------------- | ------------------------------------- |
| Escape 关闭                                                       | ✅ 关闭并**把焦点归还触发按钮** | `files/AgentConfigPopover.vue:98-102` |
| `aria-expanded` 同步                                              | ✅ 关闭后回到 `false`           | `:137-139`                            |
| `aria-haspopup="dialog"` + `panelId` 关联                         | ✅                              | `:138-140`                            |
| 打开时 `panel.focus()`、点击外部关闭、`ResizeObserver` 跟随重定位 | ✅                              | `:85-90`                              |
| 同一时刻只有一个弹层（`activePopoverCloser` 单例）                | ✅                              | `:2`、`:76-81`                        |

对比 §7.13-c：Hub 现在已经补齐这套模态边界；`AgentConfigPopover` 的 Escape / 焦点归还模式也继续作为其它弹层的正面样本。
（用户提出的"把设置区做成模型弹层那种质感"，除了视觉，也应包含**这套交互契约**。）

**b) 正面样本 2：主界面「文件」视图的空态做对了，设置区没跟上（呼应 §7.15-d）**

`files/ArtifactLibraryView.vue` 的空态 = 「图标底托 + 居中标题『没有找到文件』+ 一行说明 + 筛选器就在上方」，
配套的筛选是自绘下拉（`类型 / App / 状态`），搜索框、存储进度条、`清理可回收文件` 主按钮都很整齐（截图 `73-files-view`）。
→ 建议：把这一套空态/筛选器/主按钮规格**反向移植到设置区**，而不是反过来。

**c) 发送按钮的禁用态几乎不可见（P2 · ✅ 已关闭 2026-09-23）**

实测（composer 无草稿、无 active Run 时）：

```
.agent-send-button  disabled=true
  background: color-mix(foreground 15%, transparent)   （oklab … /0.15）
  color: rgb(102,102,102)
  opacity: 0.2
  cursor: not-allowed
```

即"整个产品的主操作"在禁用时只剩 **20% 不透明度**，旁边的 token 徽标却是正常对比度 —— 视觉上像按钮消失了。
而设置区的禁用主按钮又是 `opacity: 0.5`（§7.13-e），两处对"禁用"给出两种强度。
建议：主操作禁用态统一为"填色降级 + 描边保留 + `title` 说明为什么不能点"（例如"请先输入内容"），而不是靠调透明度；并把 0.2 / 0.5 收敛成一个值（建议 ≥0.45 并保留边框）。

> ✅ **2026-09-23 闭环**：Composer 发送按钮的禁用态改为「中性填充 + 保留描边」，并补上禁用原因 `title`；
> 同时把全仓禁用态不透明度从 20/25/35/40/45 收敛到单一值 `0.5`。
>
> **真实 CDP 复验（`https://api.honus.top/`，Hub 窗口 1600×711）**
>
> | 状态             | `disabled` | `title`      | `opacity` | `background`                              | `border`                 | `color`            |
> | ---------------- | ---------- | ------------ | --------- | ----------------------------------------- | ------------------------ | ------------------ |
> | 空草稿           | `true`     | 请先输入内容 | `0.5`     | `oklab(0.321 … / 0.07)`（中性，非品牌色） | `1px oklab(0.845 …/0.7)` | `rgb(102,102,102)` |
> | 有草稿           | `false`    | 发送         | `1`       | `rgb(160,108,213)`（primary）             | `0px`                    | `rgb(255,255,255)` |
> | 清空后回到空草稿 | `true`     | 请先输入内容 | `0.5`     | 同空草稿                                  | 同空草稿                 | 同空草稿           |
>
> 截图：`/tmp/shots/cmp-1717c.png`（上=禁用，下=可用）。
> 设置区实测：`button:disabled` 的 `opacity` 只有 `0.5`（6 个）与 `1`（1 个 Gen2 `ui-button--soft`，由 Gen2 自带禁用样式负责，非本次范围），不再出现 0.2/0.35/0.4。
> 新增 i18n `agent.conversation.sendEmptyHint` / `sendBusyHint`（zh-CN / en-US / ja-JP），`pnpm lint:agent-i18n` 通过。

---

### 7.18 设置区「默认模型」选择框：文字背景与框背景断层（P1 · ✅ 已关闭 2026-09-23）

**现象（真实 CDP 实测，`https://api.honus.top/settings` → Agent → 模型与预算）**

默认模型选择器（§7.6 升级后的 Gen2 `UiCombobox`）的**模型 ID 文字坐在一块纯白矩形上**，而同一个 trigger 的其余部分是半透明灰填充 —— 一个控件里两种底色，拉开闭合都成立：

| 元素                            | 修复前计算背景                  | 修复后计算背景           |
| ------------------------------- | ------------------------------- | ------------------------ |
| `.ui-combobox__anchor`（闭合）  | `color(srgb .928 .928 .928)` 灰 | 不变（design 预期）      |
| `.ui-combobox__input`（文字区） | **`rgb(255,255,255)` 纯白**     | **`rgba(0,0,0,0)` 透明** |
| `.ui-combobox__anchor`（展开）  | `…/0.7544` glass fill           | 不变                     |
| `.ui-combobox-panel`（展开）    | `…/0.7544` glass fill           | 不变（与 trigger 连续）  |

截图证据：`/tmp/shots/dm-closed-zoom.png`、`/tmp/shots/dm-open-zoom.png`（修复前文字区为白块；修复后与框体同色）。

**根因（机械定位）**

`app/styles/global.css:112-117` 有一条**未分层**（不在 `@layer` 内）的全局表单规则：

```css
input:not([type='checkbox']):not([type='radio']):not([type='range']):not([type='color']),
textarea,
select {
  background-color: var(--input-bg-color); /* #ffffff */
  color: var(--input-text-color);
}
```

它的特异性（`0,4,1`）高于 `foundation/ui/uiGen2.css:1102` 的 `.ui-combobox__input { background: transparent }`（`0,1,0`），
且两条规则都未分层（unlayered 之间按特异性比较）—— 于是全局白底稳定胜出，把 combobox 输入框涂白。

> 这正是 §7.10 记的同一类级联陷阱（当时修的是 `button { font: inherit }`），只是当时只处理了字号，没有处理`background-color`。
> Gen2 自己的 `.ui-input` / `.ui-textarea` 早已用「在宿主上把 `--input-bg-color` 覆写为 `transparent`」绕开它（`uiGen2.css:295-296 / 371-372`），
> **唯独 `.ui-combobox__anchor` 漏了这一步**，所以只有 combobox 的输入框露白。

**修复**

按 Gen2 既有约定，在 `.ui-combobox__anchor` 上覆写自定义属性（禁用它态同步覆写 disabled 三个变量），使内部 `ComboboxInput` 不再吃到全局白底：

```css
.ui-combobox__anchor {
  --input-bg-color: transparent;
  --input-text-color: currentColor;
  --input-placeholder-color: color-mix(in srgb, var(--ui-text-muted) 72%, transparent);
}
.ui-combobox__anchor--disabled {
  --input-bg-color: transparent;
  --input-text-color: currentColor;
  --input-disabled-bg-color: transparent;
  --input-disabled-text-color: currentColor;
  --input-disabled-border-color: transparent;
}
```

**CDP 复验**：修复后 `.ui-combobox__input` 计算背景为 `rgba(0, 0, 0, 0)`，trigger 闭合态与展开态（raw + panel）均为同一 glass fill，
模型 ID 文字与框体同底；trigger / panel 宽度仍为 `276.078125`（`widthDelta=0`），圆角衔接与 §7.6 一致，无新增布局变化。

**同源风险（未在本轮改动）**：任何其它"Gen2 宿主里嵌原生 `input/textarea`"的组件若没有覆写 `--input-bg-color`，都会有同样的白框。
本轮只修 combobox；后续新增 Gen2 控件时应把这条覆写写进组件规范（或把 `global.css` 的表单规则整体移入 `@layer base`，即 §7.10 建议的方向）。

### 7.19 图标颜色：未分层的 `i / .fas / .far / .fab` 规则让 `text-*` 工具类集体失效（P1 · ✅ 已关闭 2026-09-23）

> ✅ **2026-09-23 CDP 复验**：`global.css` 里的图标颜色规则已移入 `@layer base`。同一页面里 Hub composer 工具条实测：
> `fa-bolt text-primary` → `rgb(160, 108, 213)`；`fa-play text-success` → `rgb(40, 167, 69)`；
> `fa-shield-halved text-warning` → `rgb(255, 193, 7)`（修复前这三个都是 `rgb(102, 102, 102)`）。
> `text-text-secondary` 图标仍为 `rgb(102, 102, 102)` —— `--icon-color` 本来就等于 `--text-color-secondary`，这部分**外观零变化**。
> 影响面核对：全仓 `<i>` 共 527 个，带颜色 utility 的 132 个（`text-secondary` 64 个外观不变，
> `primary` 47 / `success` 8 / `warning` 8 / `foreground` 5 / `error` 1 从灰变语义色，另有 10 个写的是 `!text-white` 本来就生效）。

**现象**：Agent UI 里大量图标显式带着语义色（`text-primary` / `text-success` / `text-warning` / `text-error` / `text-foreground`），
但真实渲染一律是 `#666`。§2.5 想把「批准策略 = 全授权」标成警示色时才发现：改 class 完全不生效。

**根因**（与 §7.10 同一类，unlayered 压过 `@layer utilities`）：
`packages/frontend/src/app/styles/global.css:91-110` 原来是**未分层**的普通规则：

```css
i,
.fas,
.far,
.fab {
  color: var(--icon-color);
}
button:hover i, /* … */ {
  color: var(--icon-hover-color);
}
```

未分层规则永远压过任何 `@layer` 内的规则（与权重无关），于是写在 `<i>` 上的 `text-primary` 等 Tailwind utility 全部作废；
图标只能靠 `!important`（仓库里 10 处 `!text-white` 正是这么绕过去的）或 scoped 规则（如本轮新增的 `.agent-stop-button i`）救回来。

**修法**：把这两条规则整体移入既有的 `@layer base` 块（保留 `--icon-color` 默认色与 hover 行为，但让显式 utility 生效）。
没有改选择器、没有加 `!important`，改动只影响"本来就写着颜色 utility"的 69 个图标。

**CDP 回归**：设置区 Agent 页 / 仪表盘 / 连接管理 / Hub 工具条四处截图对照，未见低对比或错色；
`text-text-secondary` 图标（占多数）保持原色，视觉基线未变。

**同源残留（本轮未动）**：`global.css` 里 `input/textarea/select` 的表单规则仍未分层（§7.18 已记录），
Gen2 控件内嵌原生表单元素时仍需逐个覆写 token。

### 7.20 设置区原生 checkbox 收敛到 Gen2 `UiCheckbox`（P1 残留 · ✅ 已关闭 2026-09-23）

**现象（修复前 CDP 实测，`https://api.honus.top/settings` → Agent，Hub 之外的独立页面）**

| 分组       | 可见原生 `<input type="checkbox">`                                   | 尺寸    | 圆角 | `accent-color`                              |
| ---------- | -------------------------------------------------------------------- | ------- | ---- | ------------------------------------------- |
| 模型与预算 | 1（`自动更新`）                                                      | `13×13` | 0px  | `rgb(160,108,213)`（写了 `accent-primary`） |
| 运行与环境 | 13（10×`覆盖` / 2×`启用` / 1×`信任 Server Tool annotations`）        | `13×13` | 0px  | `auto`（浏览器默认强调色）                  |
| 插件与安全 | 0（能力授权要先选中 App 才渲染；禁用目标列表在本环境为空，只出空态） | —       | —    | —                                           |

同一页因此出现**两种对勾颜色**（写了 `accent-primary` 的是品牌紫、没写的走浏览器默认强调色），
尺寸比 Gen2 控件小一档（`UiCheckbox` 默认 `16×16`），圆角是浏览器默认 `0px`（Gen2 是 `5px`），
焦点态也只剩浏览器默认 outline。

**根因**：这批控件从来没接入 Gen2 控件层，而是逐处手写 `<input type="checkbox" class="rounded accent-primary">`
——`features/agent/settings/**` 共 **27 处 / 10 个文件**。`accent-color` 只能改对勾颜色，尺寸 / 圆角 / 焦点环 /
禁用态全部交给浏览器；仓库里已有的 Gen2 `UiCheckbox`（Reka `CheckboxRoot`，渲染为 `<button role="checkbox">`，
`--ui-checkbox-size: 16px` + `r5` + `ui-focusable`）此前只有 UI Gallery 在用。

**改法**（只动设置目录，10 个文件 / 27 处）：

- `<input v-model="x" type="checkbox" class="rounded accent-primary">` → `<UiCheckbox v-model="x">`；
- `:checked` + `@change="handler($event.target.checked)"` → `:model-value` + `@update:model-value="(value: boolean) => handler(value)"`；
  顺手把 3 个"从 Event 里取 `checked`"的处理器（`AppManagementSettings.onCapabilityChange` / `onTargetEnabledChange`、
  `ModelProviderSettings.setModelRegistryAutoUpdate`）改成直接收 `boolean`，删掉 `instanceof HTMLInputElement` 兜底；
- `accent-error` → `tone="danger"`（卸载时删除数据、禁用目标选择）；应用能力里的目标勾选原为 `h-3.5 w-3.5` → `density="compact"`（正好 `14px`，尺寸不变）；
- 原有的 `<label>` 包裹结构保留，保证"整行文字可点"的语义不丢。

**CDP 复验（修复后，同一路径）**

| 分组       | Gen2 `[data-ui=checkbox]` | 原生 | 尺寸    | 圆角 | tone      |
| ---------- | ------------------------- | ---- | ------- | ---- | --------- |
| 模型与预算 | 1                         | 0    | `16×16` | 5px  | `primary` |
| 运行与环境 | 13                        | 0    | `16×16` | 5px  | `primary` |

- 元素语义：`<button role="checkbox" data-ui="checkbox" data-gen="2">`（不再是 `input`），`cursor: pointer`；
- 选中态：填充 `color(srgb 0.657 0.470 0.848)` + 白色对勾 + 描边 `color(srgb 0.676 0.529 0.825)`；
  未选中：`bg color(srgb 0.968 0.968 0.968)` + `border color(srgb 0.8 0.8 0.8 / 0.68)` + inset 阴影；
- 交互回归：点 **label 文字**（`覆盖`）→ `unchecked → checked`，再点方框 → 回到 `unchecked`，整行可点语义没丢；
- 键盘：从 `<body>` 连按 **15 次 Tab** 到达该 checkbox，` :focus-visible = true`，焦点环 `box-shadow: 0 0 0 3px rgba(160,108,213,0.18)` + 品牌色描边（原生 input 之前只有浏览器默认 outline）；
- 静态门禁：`all templates compile`（`@vue/compiler-sfc` 编译设置区全部模板）+ `vue-tsc --noEmit` exit 0；
- 截图：`/tmp/shots/ck-checked-6x.png`、`/tmp/shots/ck-unchecked-6x.png`（6× 放大）、`/tmp/shots/probe-checkbox4-plugins.png`；
- **未覆盖**：`AppManagementSettings` 的能力授权勾选（需先选中 App）与 `SafetyNetworkSettings` 的禁用目标勾选
  （本环境连接列表为空）在真实环境没有渲染实例，只有模板编译 + 类型校验——与 §7.15-b 的 `runner_not_configured` 属同一类环境限制。

**同源残留（下一轮）**：设置区仍有 **22 处原生 `<select>`**（对应 §7.15-f 的"input 16px / select 12px"差异）、
**36px 的顶部 Tab**（分组导航胶囊已在 §6.2 第三批闭环收敛为 `115×32 r8`）、`QuantityInput` 的 `18×20` 单位切换命中区；`global.css` 里 `input/select/textarea`
的表单规则仍未分层（§7.19 已记），Gen2 控件内嵌原生表单元素时仍需逐个覆写 token。

---

### 7.21 Hub 模型弹层回归：恢复「真毛玻璃」与无盒选项行（P1 回归 · ✅ 已关闭 2026-09-23）

**现象（用户报告 + 修复前 CDP 实测：`https://api.honus.top/` → Hub 工具条「模型」弹层）**

修复前（`b3e397a`）弹层是一个**近乎不透明的浅灰圆角盒**：面板 `background = color(srgb 0.9647 0.9686 0.9765 / 0.7544)`（75% 不透明），
背后的对话内容几乎透不过来；选中行本身又是一个带描边 + 底色 + 投影的小盒子
（`border 1px` + `rgba(246,247,249,.92)` + `shadow 0 1px 2px rgba(0,0,0,.05)`，高 52），列表高 256px。
用户描述为"毛玻璃没了""选项一格一格的"。

**根因（两层，都是 2026-09-23 凌晨那次改造的副作用）**

1. `a2a9e94`（01:03）第一次补齐 `--color-card`（`rgb(246 247 249 / 92%)`）并新增 `.glass-surface`
   （`global.css:193-203`，`color-mix(card 82%)` + `blur(16px)`）；`af405e9`（01:04）把弹层面板从
   `border border-border/70 bg-card/95 backdrop-blur-md …` 换成 `.glass-surface`。在此之前 `--color-card` **未定义**，
   `bg-card/95` 不产出任何 CSS → 面板实际是"纯 `backdrop-blur` + 1px 边框"的**真毛玻璃**；换成 `.glass-surface` 后
   `color-mix(card 82%)` 把面板变成 75% 不透明的实色表面，毛玻璃感消失。
2. 选中行的盒子来自 `413f2e9`（09-15 03:27，"refine current UI"）：选中行加了 `border-border/80 bg-card shadow-xs`，
   未选中行是 `border-transparent`（1px 占位）——每个选项都带边框位，观感上就是"一格一格"。

**改法**（只动两处 class，不新增样式）

| 位置                                | 修复前                                                                  | 修复后                                                                                      |
| ----------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `files/AgentConfigPopover.vue` 面板 | `glass-surface`                                                         | `border border-border/70 backdrop-blur-md shadow-2xl ring-1 ring-border/20`                 |
| `host/AgentAppSurface.vue` 选项行   | `rounded-xl … border border-border/80 bg-card … shadow-xs`              | `rounded-xl …` 无边框无底色，选中 `bg-primary/8`、未选中 `hover:bg-card/70`                 |
| 行内图标 tile                       | `h-6 w-6` + `border`，选中 `border-border/60 bg-header text-foreground` | `h-7 w-7` 无边框，选中 `bg-primary/10 text-primary`，未选中 `bg-header text-text-secondary` |
| 选中勾选                            | `text-foreground`                                                       | `text-primary`                                                                              |
| 列表容器                            | `max-h-64`（256px）                                                     | `max-h-72`（288px，= 09-15 之前的原值）                                                     |

- **刻意不写回 `bg-card/95`**：那个写法当年"看起来透明"只是因为 token 缺失；token 现已存在，写回反而是不透明实色。
  要复现的是**观感**（纯 `backdrop-blur` + 细边框），所以面板保持无底色。
- 未选中行的 `hover:bg-card/70` 与不可用项的 `cursor-not-allowed opacity-55` 保留，交互语义不变。

**CDP 复验（同一个弹层，修复前 / 修复后由同一次探针分别读取）**

| 指标                   | 修复前                                                      | 修复后                                                                  |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| 面板 `background`      | `color(srgb .9647 .9686 .9765 / .7544)`                     | `rgba(0,0,0,0)`（纯 blur）                                              |
| 面板 `backdrop-filter` | `blur(16px)`                                                | `blur(12px)`                                                            |
| 面板边框               | `1px color(srgb .8 .8 .8 / .6)`                             | `1px oklab(0.845217 0.0000385046 0.0000169277 / .7)`                    |
| 选中行                 | `border 1px` + `rgba(246,247,249,.92)` + `shadow-xs`，高 52 | `border 0px` + `oklab(.6297 .0917 -.1303 / .08)` + `shadow none`，高 50 |
| 行内 tile              | `24×24` + 1px 边框，选中 `#f0f0f0` / `#333`                 | `28×28` 无边框，选中 `bg-primary/10` / `rgb(160,108,213)`               |
| 列表                   | `max-height 256px`                                          | `max-height 288px` + `overflow-y auto`                                  |

- 静态门禁：`all templates compile`（`@vue/compiler-sfc`）+ `vue-tsc --noEmit` exit 0 + `prettier --check` 通过；
- 截图：`/tmp/shots/model-list-restored-2.png`、放大 `/tmp/shots/zoom-final.png`；
- **未覆盖**：本环境只配置了 1 个模型（`gemini-3.8-flash-high`，`scrollHeight == clientHeight == 50`），
  "可上下滚动"只能由 `max-height 288px + overflow-y auto` 推断，无法真实滚动验证；`shadow-2xl` / `ring-1`
  在当前 oklab token 体系下 computed 值接近透明（既有现象，非本次引入）。

**追加（同日）：选项副信息回到 9px，并补上「可上下滑动」的实测**

- **现象**：用户反馈"选择项信息排布不是这样、提示信息太大"。CDP 实测主行 `12px`、副行（提供方 / 缺失能力）`11px`，
  两行只差 1px，层次被压平，288px 宽的弹层里读起来"整块偏大"。
- **根因**：`e4d86e2`（09-23 04:34，"finish the 11px reading-text floor"）把可读文本下限统一提到 11px，
  模型弹层副行随同批 269 行从 `text-[10px]` 变成 `text-[11px]`；主行一直是 `text-xs`（12px），没动。
- **改法**：副行回到 `413f2e9^`（09-14）的原写法 —— `mt-0.5 block truncate text-[9px] text-text-secondary`
  （先降到 10px 用户仍觉得偏大，同日再降到 9px）；主行、配色、行高不变。
- **复验**：副行 computed `font-size 11px → 10px → 9px`、`line-height 14.4px`、`margin-top 2px`；选项行高 `50 → 48`；
  与 09-21 参考截图（10px，副行大写字母墨迹 7px）对照，9px 副行明显更小一档，放大对照 `/tmp/shots/cmp-9px.png`。
- **滚动实测（用户此时已补到 11 个模型）**：`newapi`（`version 11`）= `gemini-3.8-flash-high` / `gpt-5.6-luna` /
  `gpt-6-luna` / `gpt-5.6-terra` / `gpt-5.6-sol` / `gpt-5.5` / `gpt-6-astra` / `gpt-6-sol` / `grok-4.6` / `grok-4.5` / `grok-4.7`；
  列表 `clientHeight 288` / `scrollHeight 572` ⇒ `scrollable: true`，最后一行默认不可见（`lastRowVisible: false`），
  弹层总高 338px —— 即用户记忆中"上下滑动"的原始交互；此前只有 1 个模型的环境无法复现，现已实测。
- 说明：新增模型原本要重新加载 Hub / 刷新页面才会出现，该刷新时机问题在 §7.22 修复。
- **追加（同日）：面板透明度再提一档** —— 用户要求"透明玻璃透明度再高一点"。面板底色本来就是 `rgba(0,0,0,0)`（无填充），
  真正决定"透不透"的只有模糊半径，所以把 `backdrop-blur-md`（12px）→ `backdrop-blur-[6px]`：
  背后的内容从"糊成一片"变成"看得出形状"，观感从实色面板回到玻璃；对照图 `/tmp/shots/cmp-blur.png`（左 12px / 右 6px）。
  实测：`backdrop-filter: blur(6px)`，`background` 仍是 `rgba(0,0,0,0)`，边框 / 圆角 / 阴影不变。

### 7.22 Provider / 设置写完后主界面不刷新（P1 · ✅ 已关闭 2026-09-23）

**现象**：用户在设置区「模型与预算」里给 provider 补模型（`newapi` 从 1 个加到 11 个），回到 Hub 打开「模型」弹层
仍是旧列表，必须刷新页面 / 重开 Hub 才更新。

**根因**：`AgentAppSurface` 只在挂载时执行一次 `loadRunConfiguration()`（一次 `Promise.all` 同时拉 `definitions` /
`providers` / `settings`）；设置区（`settings/AgentSettingsPanel.vue`）保存后只更新自己的 `providers` ref ——
两边没有共享 store，也没有通知。仓库里已有的 `agent-host-events` 只有 `thread-changed` / `authorization-changed` /
`memory-changed` / `host-changed`，而 `host-changed` 仅被 `AgentSurfaceHost` 用于刷新 host summary，
`AgentAppSurface` 并未订阅。

**改法**（新增一个事件，不改数据流）

- `host/agent-host-events.ts` 新增 `configuration-changed`；
- 设置区只在**真正写成功**之后发出：`execute()` 中 `locks.includes('providers')`（create / toggle / protocol / delete /
  discover / add-model / update-models 全部经过这个口）与 `patchSection()`（模型 / 预算 / 性能等分区保存）；
- `AgentAppSurface` 订阅该事件 → 重新执行 `loadRunConfiguration()`（失败沿用现有的 `error` 提示），`onBeforeUnmount` 退订。
  刷新后仍用 session 里恢复的模型 key 重新匹配，因此**不会覆盖用户已选的模型**（`setModelSelection` 会写 `agentSurfaceSession`）。

**CDP 复验**（同一页面、全程不刷新；Hub 是 `app/App.vue` 里的常驻浮窗，切路由不会卸载）

| 步骤 | 操作                      | Hub 实测                                                            |
| ---- | ------------------------- | ------------------------------------------------------------------- |
| A    | 打开「模型」弹层          | trigger `gemini-3.8-flash-high`，列表 11 行                         |
| B    | 设置区点 provider「停用」 | trigger 消失、弹层关闭、0 行（surface 立即换成 providerMissing 态） |
| C    | 再点「启用」              | trigger 回到 `gemini-3.8-flash-high`                                |
| D    | 重新打开弹层              | 11 行                                                               |

- 每次写入触发 2 次 `/agent/ai/providers` GET（surface 的 `loadRunConfiguration` + 设置区自身的 `agentApi.providers()`）；
- 复验结束后环境已复原：`newapi` `enabled: true`、11 个模型（`version 15`）；
- 门禁：`all templates compile` + `vue-tsc --noEmit` exit 0 + `prettier --check` 通过；
- 截图：`/tmp/shots/refresh-after-disable.png`、`/tmp/shots/refresh-after-enable.png`；
- **未覆盖**：跨标签页（在另一个浏览器 tab 改 provider）仍不推送 —— `host-changed` 的 BroadcastChannel 只同步 host summary。

### 7.23 玻璃配方上收到 Gen2 通用层（P1 残留 · ✅ 已关闭 2026-09-23）

**背景**：§7.21 把 Hub 模型弹层的观感改回来了，但那份配方当时写在 `files/AgentConfigPopover.vue` 的 class 串里；
同一份配方在仓库里存在**三处**：`global.css` 的 `.glass-surface`（Gen2 popover / combobox / select / dialog / gallery 都用它）、
`uiGen2.css` 里 combobox 展开态 anchor 的复制品、以及 Agent 弹层自己手写的 utilities。用户要求"做成通用组件"。

**改法**

- 配方收敛到 `app/styles/global.css` 的 `@layer components`，并拆成可覆写的自定义属性（`:root`）：
  `--glass-fill` / `--glass-backdrop-filter` / `--glass-border-color` / `--glass-inset-highlight` / `--glass-shadow`；
  `.glass-surface` 只引用这些 token，取值就是 §7.21 的结论（无底色 + `blur(6px)` + 细边框 + 柔和投影）；
- `files/AgentConfigPopover.vue` 面板不再手写 `border` / `backdrop-blur-*` / `shadow-*` / `ring-*`，改为 `glass-surface` + 布局类；
- `uiGen2.css` 里 combobox 展开态的 anchor 删掉配方复制品，改为引用同一组 token（只保留圆角拼接与焦点环）；
- 组件形态的入口是既有的 `UiSurface surface="glass"`（渲染 `.glass-surface`），自定义面板直接挂 class。

**影响面（全仓 glass 消费者）**：`UiPopover` / `UiCombobox`（面板 + 展开态 anchor）/ `UiSelect` / `UiDialog(surface=glass)` /
`UiButton(appearance=glass)` / `UiSurface(surface=glass)`。实际页面用到的是设置区「添加备用模型」菜单、会话侧栏的 `UiPopover`、
设置区默认模型的 `UiCombobox`，其余只在 UI Gallery 出现。

**CDP 复验**

- Hub 模型弹层：`class="glass-surface …"`，`background rgba(0,0,0,0)`、`backdrop-filter blur(6px)`、
  `border 1px color(srgb .8 .8 .8 / .6)`、`radius 16px`（与 §7.21 手写版逐项一致）；
- 设置区默认模型 combobox 展开态：anchor 与 panel 计算值**逐项相同**（都是 `rgba(0,0,0,0)` + `blur(6px)` + 同一边框色），
  §7.6 记录的"trigger / panel 背景断层"从此在结构上不会再出现；
- 门禁：`all templates compile` + `vue-tsc --noEmit` exit 0 + `prettier --check`；
- 截图：`/tmp/shots/glass-shared-hub.png`、`/tmp/shots/combobox-panel.png`。

**提醒（未覆盖）**：`.glass-surface` 现在没有底色，浮在深色 / 复杂内容之上的 glass 表面（例如将来把 `UiDialog` 设成 `glass`）
会牺牲可读性；`UiGalleryPage` 的 glass 样例与 `UiButton appearance="glass"` 未逐个目视，只在 gallery 出现。

### 7.24 提示性文字过多：长句移入 `ⓘ` / `⚠` 悬浮说明（P1 · ✅ 已关闭 2026-09-23）

**现象（CDP 实测，2026-09-23）**：Agent 设置页把大量解释性句子直接铺在版面上 —— 累计 **53 段 / 1155 字**；
最长的一段 56 字（备用模型链），其次是 53 字（并发说明）、48 字（预算说明）、45 字（Agent 功能说明）。
每张卡片的标题下面都挂一行 `description`，有的卡片底部还再挂一条状态句 / 口号句，与顶部的徽标重复。

**根因**：`settings/**` 的 15 个面板都是同一个手写结构 ——
`<h3>标题</h3><p class="mt-0.5 text-xs text-text-secondary">描述</p>` + 若干补充段落，全部当作正文排版；
仓库里没有任何"帮助说明"的通用组件，所以每处都各自决定要不要显示（结果是都要显示）。

**规则（用户给出）**

1. 界面只保留**必要**的短提示（状态、单位、必填）；
2. 长句 / 解释性文字移入 `ⓘ`（提醒类用 `⚠`）图标，**鼠标悬浮**展开完整说明；
3. 图标必须有 `title` 与 `aria-label`，并可通过键盘聚焦（`tabindex=0` + 焦点环）。

**落地**

- 新增 Gen2 通用组件 `UiInfoHint`（`foundation/ui/UiInfoHint.vue` + `uiGen2.css` 的 `.ui-info-hint` + `index.ts` 导出）：
  20×20 命中区、12px 图标、`cursor: help`、`tone="warning"` 走 `⚠`，`title` / `aria-label` 自动同步；
- **a) ✅ 已关闭 2026-09-23：设置区「模型与预算 → Agent 功能」卡片**
  - 问题（用户指出）：卡片底部那行「当前状态：已启用」与顶部徽标「已启用」重复冲突，右侧还挂着一句口号
    「调度器支持多应用委派与动态预算管控」；标题下的 45 字描述也一直占版面。
  - 改法：删掉整个底部信息行；45 字描述 + 口号句合并进标题右侧的 `UiInfoHint` 悬浮说明；
    顶部徽标改用**真实可用性文案**（`stateLabels`：已启用 / 降级运行 / 正在启用 / 未启用 / 不可用），
    并按状态配色（启用=success，降级/启用中=warning，其余=中性），顺手修掉"降级运行显示绿色"的隐患。
  - CDP 复验：卡片 `1230×155 → 1230×62`（-93px，-60%）；`bodyRows 1 → 0`；
    可见文字 `Agent 功能 控制 Agent Host… 已启用 关闭 Agent …调度器支持…` → `Agent 功能 已启用 关闭 Agent`；
    `UiInfoHint` 实测 `20×20`、`cursor: help`、`title` = 描述 + 口号（74 字）；
  - 删除随之失效的 i18n `agent.settings.feature.state`（三语，避免制造死 key）；
  - 截图：`/tmp/shots/feature-card-after.png`。
  - **追加（2026-09-23，用户反馈）**：右侧「`已启用` 胶囊 + `关闭 Agent` 按钮」两个色块并排不好看 —— 把状态胶囊移到标题行
    （`Agent 功能 · 已启用 · ⓘ`），右侧只留一个操作按钮，与同分组其它卡片（Provider / 插件 / 安全的"标题 + 统计胶囊 + ⓘ，右侧单个操作"）一致。
    CDP 实测：标题 `@362` → 胶囊 `@440` → `ⓘ` `@516`，按钮独占右侧 `@1466`；把卡片压到 470px 宽仍是单行且按钮不越界（`overflow -21px`）。
    截图 `/tmp/shots/feature-after.png`（宽）/ `feature-narrow.png`（窄）。
- **b) ✅ 已关闭 2026-09-23：其余 16 张卡片的 `description` 段落全部迁到 `UiInfoHint`**
  - 范围：settings 的 **15 个文件 / 16 处卡头**（AcpRuntime / executionPolicy / browserRuntime / budget /
    mcpIntegrations / memory 卡头 / memory.import / providers / performance / plugins / safety / storage / subagents /
    guardrails / workspaceRuntime / apps）＋ Hub Run 详情里同款的 2 个面板
    （`runtime/SubagentTree.vue`、`runtime/WorkspaceRuntimePanel.vue`）。
  - 改法：`<h3>标题</h3><p class="mt-0.5 text-xs text-text-secondary">描述</p>` →
    `<div class="flex items-center gap-1.5"><h3>标题</h3><UiInfoHint :text="描述" /></div>`；
    带统计徽标的卡片（Provider / plugins / safety）把 `UiInfoHint` 排在徽标之后；顺手把改动后多余的 `<div>` 包裹层合并掉。
  - CDP 实测（三组分区，同一页面同一窗口，改动前用 `git stash` 对照）：

    | 分区       | 修复前 `ⓘ` / 可见说明字数 | 修复后 `ⓘ` / 可见说明字数 |
    | ---------- | ------------------------- | ------------------------- |
    | 模型与预算 | 1 / 378                   | 3 / 315                   |
    | 运行与环境 | 0 / 1319                  | 8 / 711                   |
    | 插件与安全 | 0 / 448                   | 5 / 183                   |
    | **合计**   | **1 / 2145**              | **16 / 1209**             |

    版面可见解释性文字 **-936 字（-43.6%）**，全部收进 16 个 `ⓘ`（20×20、`cursor: help`、`title` = 原文）。

  - 实测残留的可见段落只保留**字段级短标签**（如「限制单个 Run 最多可执行的模型/工具循环步数」24 字）与分区导语，
    卡片头部的长句已清零；截图为 `/tmp/shots/hints-before.png` / `hints-after.png`。
  - 门禁：模板编译、`vue-tsc --noEmit`、`prettier --check`、`check-agent-i18n` 全绿。两个 Hub 面板当前环境无可用 Run
    （`runner_not_configured`）无法实跑截图，本次只做到编译级验证。
- **c) ✅ 已关闭 2026-09-23：Hub 侧提示语审计（结论是"基本不需要再改"）**
  - 方法：CDP 打开 Hub（`.agent-hub-window` 1183×736），遍历窗口内全部可见叶子文本节点、列出 ≥18 字的整句；
    再逐个展开 composer 的配置弹层（模型 / 推理强度 / 执行模式 / 批准策略 / 运行环境 / SSH）与 `/` 命令面板分别统计。
  - 结果：Hub 常驻版面**没有**可以收起的解释句 —— ≥18 字的可见文本只有 4 处，全是内容本身
    （会话标题 49 字、两张便当卡的副标题 22/24 字、模型名 21 字）；`/` 命令面板的 5 条是命令说明（内容）。
    真正的"提示句"只有 composer 里 2 个弹层的头部说明。
  - 改法：`执行模式` / `批准策略` 弹层头部说明句（34 / 29 字）→ 标题 + `UiInfoHint`；
    弹层内**每个选项**的说明保留（它们是选项正文，不是提示性文字，隐藏反而增加成本）。
  - CDP 复验：弹层 `288×218`；头部由「标题 + 说明」两行变为单行「执行模式 ⓘ」，`ⓘ` 实测 `20×20`、
    `title` = 原说明句；截图 `/tmp/shots/hub-popover-execution.png`、`hub-popover-approval.png`。
  - 门禁：模板编译 + `vue-tsc --noEmit` + `eslint` + `prettier --check` 全绿。

---

### 7.25 Agent 设置区的嵌套框：3~4 层收到 1 层（P1 · ✅ 已关闭 2026-09-23）

**现象（CDP 从叶子控件逐层回溯「有边框/有底色」的祖先，`probe-box-depth.mjs`）** —— 修复前是 **5 层**，
其中带 `1px` 边框的就有 **3 层**：

| #   | 元素                                                        | 边框     | 是谁                          |
| --- | ----------------------------------------------------------- | -------- | ----------------------------- |
| 1   | `main.bg-background`                                        | —        | 设置页底色                    |
| 2   | `section#settings-panel-agent`                              | 1px+阴影 | Agent 面板卡                  |
| 3   | 模块卡（16 个 `section`：模型 Provider / 预算与上下文 / …） | 1px      | 每个 `*Settings.vue` 的根节点 |
| 4   | 模块内分组框（默认模型 / 执行与超时控制 / …）               | 1px      | 模块内部又包了一层            |
| 5   | 控件本身（`select` / `button` / `input`）                   | 1px      | —                             |

三个分组实测完全一致（`关闭 Agent` / `select auto` / `卸载` 三个叶子的祖先链都是这 5 层）
→ 界面上就是"框里套框里套框"；窄屏下同一块设置外层能数到 3~4 层边框。

**根因**：两级"卡"各长各的 —— ① `AgentSettingsPanel.vue` 的 16 个设置模块子组件，
根节点清一色是 `rounded-xl border border-border/70 bg-card/35`（自带一张卡）；
② 模块内部又把字段分组再包一层小卡（`rounded-xl border … bg-background/50 p-3.5` 这类，共 39 处）。
面板卡根节点还有 `overflow-hidden`，因此连"粘性导航"都做不了。

**设计（「一层卡片」原则）**：

1. **页面 → 分组卡 → 控件**，中间不许再叠框。分组卡 = `#settings-panel-agent`（承载标题、状态与分组导航）。
2. **模块不再是卡**：保留"图标 + 标题 + 状态 + 主操作"那一行，模块之间用 **1px 细分隔线**分隔，
   去掉各自的边框、圆角、底色与阴影（`.agent-settings-group > :deep(*)`，只作用于**直接子节点**，
   不碰模块内部的表头、callout 与控件）。
3. **模块内的分组框降级为 inset**：去边框、去阴影，只留极淡底色（`bg-header/20~30`）+ 圆角，
   靠留白分组。
4. **仍然保留边框的**：控件自身、"选择项"（场景预设卡）、语义色 callout（primary/error/warning/虚线空态）——
   这些是**交互语义**，不是结构嵌套。
5. **分组导航改为粘性**：`sticky top-0 z-20` + `bg-header/80 backdrop-blur-md`；为此去掉面板根的
   `overflow-hidden`，改用 `rounded-t-xl` 让头部贴合圆角（否则粘性会被裁切失效）。

**CDP 复验**：

| 指标                                     | 修复前                           | 修复后                        |
| ---------------------------------------- | -------------------------------- | ----------------------------- |
| 叶子控件的**带边框**祖先                 | 3 层（面板卡 / 模块卡 / 分组框） | **1 层**（只剩面板卡）        |
| 叶子控件的"框"总数（含无边框底色层）     | 5                                | 4（其中 3 层无边框）          |
| 分组导航                                 | `static`，滚走就看不见           | `sticky`，滚 807px 后停在 y=0 |
| `documentElement.scrollHeight`（同视口） | 1854 / 3625 / 1825px             | 1760 / 3423 / 1711px          |

- 三个分组（模型与预算 / 运行与环境 / 插件与安全）逐层回溯后，叶子的带边框祖先都落到 **1 层**。
- 窄屏 414×900（`Emulation.setDeviceMetricsOverride`）逐组截图：模块全部成为平铺节 + 细分隔线，
  同一块设置外层只剩「分组卡 + 控件」一层边框。
- 截图：`/tmp/shots/agent-before-{0,1,2}.png`（1600 桌面，改后）、`/tmp/shots/mobile-agent-{0,1,2}.png`（414 手机）；
  探针 `probe-box-depth.mjs` / `probe-page-height.mjs` / `probe-flat-check.mjs` / `shot-mobile-settings.mjs`。
- **本轮只动"框的层数"，不动控件本体**；当时列出的三项后续均已闭环：卡片内 8 处独立「保存」按钮（§7.31）、
  设置区空态仍是纯文本（§7.28）、22 处原生 `<select>`（§7.32）。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check` 全绿。

---

### 7.26 Composer 配置弹层首帧位置错乱（"点一下会闪一下"）（P1 · ✅ 已关闭 2026-09-23）

**现象（CDP 逐帧采样面板 rect + inline style）**：点 Composer 底部的「模型 / 思考强度」，
面板**第一帧出现在错误位置**，下一帧才跳到正确位置：

| 弹层       | 首帧（错误）        | 第二帧（正确） | 偏差           |
| ---------- | ------------------- | -------------- | -------------- |
| 思考强度   | `470, 472`          | `426, 667.5`   | **上偏 195px** |
| 模型       | `433, 472`          | `426, 434`     | 上偏 38px      |
| App 切换器 | 兜底 `260×220` 定位 | `288×100` 实测 | 尺寸/位置都错  |

用户看到的就是"点一下会闪一下"（视野里那一下错位）。

**根因**：`AgentConfigPopover.vue` 的 `positionPanel()` **在面板还是占位尺寸时就测量**。
`position` 的初值是 `{ maxWidth: '0px', maxHeight: '300px' }`（占位，保证定位前不铺开），
第一次调用时读到的是**被压缩后的盒子**：宽度 0、高度被 300px 卡住 —— 于是

- `width = 0` → 水平居中退化成 `anchorCenter`（470 / 433 就是触发按钮的中心）；
- `height = 300` → "向上展开"分支算出 `anchor.top − 300 − 8 = 472`。

真正的定位要等 `ResizeObserver` 回调**下一帧**再跑一次才正确。`AgentAppSwitcher.vue` 是同一个写法
（占位 `maxWidth/maxHeight: 0`，首帧退回 `260×220` 兜底值）。

**改法**：定位前先把两个占位上限**解除再测量**，并用 `positioned` 标记保证"没量准就不画"：

1. `positionPanel()` 里先 `popup.style.maxWidth/maxHeight = 可用尺寸`（强制同步 reflow），再 `getBoundingClientRect()`；
   响应式 `position` 随后写入**同样的值**，Vue 的 patch 是空操作。
2. 新增 `positioned` 标记：面板在定位完成前带 `visibility: hidden`（`positioned` 为真才显示），
   关闭时复位；`toggle()` 中若同 tick 量不到再补一次 `requestAnimationFrame`。
3. 两个组件同改（`files/AgentConfigPopover.vue`、`host/AgentAppSwitcher.vue`）。

**CDP 复验**（`probe-popover-birth3.mjs` / `probe-switcher-flash.mjs`，逐帧读 rect + inline style）：

| 弹层       | 修复后首帧                          | 结论                     |
| ---------- | ----------------------------------- | ------------------------ |
| 思考强度   | `426, 667.5 224×105`                | 首帧即终值，无中间错位帧 |
| 模型       | `426, 434 288×338`                  | 首帧即终值               |
| App 切换器 | `539, 129 288×100`（首次/再次一致） | 首帧即终值               |

- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check` 全绿。

### 7.27 Agent 设置区布局重构：宽屏左栏分区导航（P1 · ✅ 已关闭 2026-09-23）

**现象（用户反馈）**：「agent 设置的界面还是不好看，设置项太多太杂了，主要是布局的设计」。
CDP 实测确认事实：面板宽 1280px、内部是**一条 1746~3394px 的长流**，三组共 **17 个模块**
（`models` 4 / `runtime` 8 / `plugins` 5）首尾相接，分组之间只有一条发丝线，纵向没有任何
「这里有哪些设置」的导航；同时 1280px 的宽度里控件行左右两端相距 1000px+，中部大片空档。

**根因**：§7.25 把模块卡并入分组卡（一层卡片）解决了嵌套，但**没有给出替代性的结构**——
去掉卡片边框后分区只能靠间距区分，17 个模块在一条流里既没有地图也没有入口。

**改法**：

1. **宽屏（≥1280px）常驻左栏**：`grid-template-columns: 15rem minmax(0, 1fr)`。左栏是 3 个分组标题
   （点击切组）+ 组内 17 个模块入口（点击跳转，标签直接复用各模块自己的标题 key，不新增词典项）；
   右栏只滚动当前分组的内容流。窄屏放不下左栏，仍用顶部胶囊切组，**同一份 DOM** 靠媒体查询切换，
   没有重复渲染。
2. **左栏粘在全局顶栏之下**（`top: 3.5rem`，顶栏 `h-14`），自身 `overflow-y: auto` 兜住矮窗口；
   灰底条只贴左栏，卡片左下角用 `border-bottom-left-radius` 对齐 `rounded-xl`。
3. **滚动联动**：`requestAnimationFrame` 节流的 scroll 监听，取「最后一个 top ≤ 70px 的锚点」高亮；
   到页面底部时直接认最后一个分区（最后一段永远够不到顶，否则点「硬性限制」不会亮）。
4. **跳转落点**：跳转前先等布局稳定（连续两帧高度不变 **且** 至少观察 140ms，上限 600ms），
   再 `scrollBy` 一次；之后最多追 8 次（间隔 220ms）校正 ≥24px 的迟到位移。用户一动滚轮 /
   触摸 / 键盘立刻放弃，不抢滚动权。

**为什么需要「等布局 + 追落点」**（两个都是实测出来的，不是预防性写法）：

- 分组是 `v-show` 切换，切过去的瞬间模块才开始渲染，文档高度**连跳三级**（实测 `2760 → 3346 → 3394`），
  此刻量出的锚点位置是错的；
- 这个 Chrome 里 `behavior: 'smooth'` **不产生动画**（`scrollTo({top:900,behavior:'smooth'})` 首帧就落到 891），
  所以「先跳一次、稳住再跳第二次」会被用户直接看到两次跳转——用户反馈的「第一帧点击从另一个地方开始」正是这两跳。
  实测修复前：目标 2352 / 实停 1766（被重渲染打断）或先停 819 再跳 1357。修复后逐帧采样只剩一次跳转，
  落点 `scrollY 1357 / 锚点 top 70`（误差 0px）。

**CDP 复验**（`probe-727-anchor2.mjs` / `probe-727-frames2.mjs` / `probe-727-responsive.mjs`）：

| 场景                                  | 目标           | 实测                                    |
| ------------------------------------- | -------------- | --------------------------------------- |
| 点「浏览器运行时」（跨组）            | 锚点 top = 70  | `scrollY 1357`，误差 **0px**，高亮同步  |
| 点「Subagent」（跨组、深层）          | 锚点 top = 70  | `scrollY 2352`，误差 **0px**            |
| 点「Artifact 与存储」（末节）         | 页面到底 2441  | `2441`（被夹住），高亮正确认到末节      |
| 点「硬性限制」（藏在 `<details>` 内） | 页面到底 793   | `793`（被夹住），高亮正确               |
| 滚动中自己滚轮                        | 用户优先       | 校正立即放弃（`scrollY 0`）             |
| 1100px 宽                             | 左栏隐、胶囊显 | `rail:none / pills:flex`，粘在 `top 56` |
| 414px 宽                              | 同上           | `rail:none / pills:flex`，粘在 `top 56` |

**同轮顺带修掉的 4 个真实缺陷**（都是本轮实测撞出来的，不是重构本身的改动）：

1. **粘性分组导航一直没生效**：`sticky top-0 z-20` 正好被 `h-14 / z-30` 的全局顶栏盖住
   （实测滚动后 nav rect `top: 0`、而顶栏占 `0~56`），等于 §7.25 的「分组导航改粘性」是空转。
   现改为 `top-14`，并加 scoped `z-index: 29`——因为 `ModelProviderSettings` 根节点自带
   `relative z-20` 且 DOM 在后，同层级会盖住导航条，414px 实测内容从条上「穿」过去（当时底是
   `bg-header/80` + blur，看起来像透明度问题，实际是层叠问题，已改不透明底 + 提层）。
2. **`v-show` 在这块面板上完全失效**：SFC 是 `section + BaseModal` 双根 → 父级指令落到非元素根，
   Vue 直接 warn 并忽略。切到「工作区」后实测 `#settings-panel-agent` 仍在流里（`top 1852`、`h 1584`），
   用户会在一屏设置下面再看到一整块 Agent 设置。已包一层无样式 `div` 收成单根。
3. **`AppManagementSettings.vue` 漏 import `UiInfoHint`**：被当成未知元素渲染，
   `agent.settings.apps.description` 这条提示**整条丢失**（`<uiinfohint>` 不是组件，文本在属性上）。
   已补 import；实测输出 `data-ui="info-hint" data-ui-gen="2"`。
4. 控制台噪声从 14 条（重复的 directive warn + 组件未解析 warn）降到 **0 条**（`probe-727-console.mjs`，
   连点 5 个跨组锚点）。

- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check`、`scripts/check-agent-i18n.mjs` 全绿。
- **未改**：全局设置 Tab（跨页 chrome）与各模块内部布局；本次只加导航层。

### 7.28 设置区空态统一到 Gen2 `UiEmptyState`（P2 · ✅ 已关闭 2026-09-23）

**现象（§7.15-d 原文）**：同一个产品里空态有三种写法 —— 设置区是「一行左对齐的灰色纯文本」
（有的套虚线框、有的套 `bg-background` 小方块、有的什么都没有），主界面（Hub / 会话 / 产物库）
却是「图标 + 标题 + 说明 + 引导按钮」的卡片。

**根因**：`foundation/ui` **没有空态原语**，每个模块各写各的；而且写法本身也在漂移 ——
实测主界面那几张卡片并不一致：图标芯片 `h-9`/`h-10`/`h-12`/`h-14` 四种，标题 `text-xs font-medium`
与 `text-sm font-semibold` 两种，图标 `text-base`/`text-xl`/`text-2xl` 三种，内边距 `px-4 / p-6 / p-8` 三种。

**改法**：新增 Gen2 `UiEmptyState`（`foundation/ui/UiEmptyState.vue` + `uiGen2.css` 的 `.ui-empty-state`），
两档规格：

| 档位         | 用在                   | 形态                                                        | 实测      |
| ------------ | ---------------------- | ----------------------------------------------------------- | --------- |
| 默认（卡片） | 整块列表 / 面板为空    | 居中：40px 图标芯片 + 13px 标题 + 12px 说明 + `action` 插槽 | `950×143` |
| `dense`      | 分组内的一个小列表为空 | 行内：20px 图标 + 12px 说明，实线发丝 + 3% 底               | `950×38`  |

设置区 10 处接入：卡片档 3 处（Provider 空态含「添加 Provider」主操作、Agent App、全局禁用目标），
`dense` 档 7 处（浏览器目标 / MCP Integration / ACP Profile / ACP Integration / Subagent 配置档 /
受信任发布者 / Memory）。

- **配色全部走 token**（`--ui-hairline` / `--ui-text-muted` / `--link-active-color`），深浅色主题自动跟随。
- `dense` 第一版按主界面的虚线框做，截图后发现「一个分组里四五个列表都空着」会排成一串虚线洞，
  改成实线发丝 + 极浅底（`46px → 38px`），保留可识别度但不喧哗。
- **CDP 复验**：`probe-715d.mjs` 逐分组读 `[data-ui="empty-state"]` 的 `dense` / 尺寸 / `flex-direction`，
  `probe-715d-b.mjs` 展开安全抽屉核对卡片档；控制台噪声 **0 条**（本轮同时消掉了 `UiEmptyState` 未解析与
  §7.27 的两类告警）。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`（`features/agent/settings`）、`prettier --check`、
  `scripts/check-agent-i18n.mjs` 全绿。
- **未覆盖**：`foundation/ui/**` 不在 `eslint.config.mjs` 的 `files` 里（现有 `UiInfoHint.vue` 同样解析报错），
  所以新组件只过了模板编译 + `vue-tsc`；扩充 lint 覆盖面属于独立议题，未在本轮顺手改。

### 7.29 设置区面板头部摘要有「调试输出感」（P2 · ✅ 已关闭 2026-09-23）

**现象（用户反馈）**：「默认模型:gemini-3.8-flash-high 活跃 App:1/1 沙箱:未就绪 这块显示也很原生不好看」。
CDP 实测确实如此：三块是 `rounded-lg border border-border/70 bg-card/60 px-2.5 py-1` 的方块，
内容为 `<span>标签:</span><span>数值</span>` —— 带冒号的键值对 + 每块自带边框，像一段调试输出；
414px 下三块各自换行堆叠，占掉 3 行。

**根因**：这里没有走任何统一样式，是三块手写的 inline「胶囊文案」；面板里其它地方（rail、控件）
都已经是图标 + 两行层级，只有头部这块停留在「文字 + 冒号」。

**改法**：改成通用统计形态并去掉方框：

- 结构换成 `dl / dt / dd`：`<i>` 26px 圆角图标底 + 「标签（11px muted）/ 数值（12px 600）」两行；
- 整组只用 `gap` 分隔，不再每项一个边框 —— 灰底头上再叠三个白框也是「原生感」的来源之一；
- 数值 `white-space: nowrap` + `max-width: 13rem` + `text-overflow: ellipsis`（模型 id 可能很长，
  第一版实测「未就绪」被挤到第二行正是漏了这条），完整 id 走 `title`；
- 沙箱就绪时数值转 `--status-success-color`（原来是 `text-success` 类，语义不变）。

- **CDP 复验**（`probe-729.mjs` / `probe-729c.mjs`）：1920px 下三项同行 `337×29`，
  首项 `dd` 实测 `118×16` 且文本完整；414px 下折成两行但每项仍 29px 单行、无内部换行；
  控制台噪声 0 条。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check`、i18n 校验全绿。

### 7.30 Agent 设置区的标题带与动作簇：信息密度与窄屏溢出（P1 · ✅ 已关闭 2026-09-23）

**现象（用户反馈）**：「agent 设置这样也不好看，还要考虑手机端问题；还有像 `关闭 Agent` 和 `添加 Provider`
这些按钮乱七八糟的挨太近了，很乱，这块信息密度太大了」。CDP 实测确认到 4 条具体现象：

1. 16 个模块的标题行各自带 `bg-header/40` 之类的灰底色块，整页滚动时呈**斑马纹**，标题与内容没有主次；
2. 标题文字与右侧动作簇（`关闭 Agent` / `添加 Provider` / 保存等）只隔 12px 且同排，长标题下动作簇紧贴文字；
3. 414px 下标题行 `flex-wrap` 换行后动作簇**仍维持右对齐**，与左侧标题拉成对角，反而更乱；
4. `PluginManagementSettings` 的「仓库 catalog URL」输入框写死 `min-w-[240px]`，414px 下把卡片右边缘顶出。

**根因**：§7.25 只把模块间的分隔线收敛了，但标题带自身既没有统一规格、也没有按断点降级；
动作簇沿用 `flex-wrap` 的默认水平语义（换行后仍是 `justify-between` 的右对齐）；
插件仓库行是设置区唯一给输入框写死 `min-w` 的写法。

**改法**：

- **标题带去底色**：新增 `.agent-settings-head`（`AgentSettingsPanel.vue` scoped），16 个模块标题行统一为
  `background: transparent` + `padding: 14px 16px`（≥640px 为 `16px 20px`）+ `gap: 12px 16px`，
  斑马纹消失，模块之间只靠 §7.25 的细线分隔；
- **窄屏动作簇整行下移**：`@media (max-width: 639px)` 下标题行 `flex-direction: column; align-items: flex-start`，
  换行后的动作簇左对齐，与标题共用同一条左基准线；
- **按钮间距**：`ModelProviderSettings` 右侧工具条 `gap-1.5` → `gap-2.5`（并允许 `flex-wrap` 后右对齐），
  备用模型行的图标按钮组 `gap-1` → `gap-1.5`；
- **窄屏溢出修复**：插件仓库行 `min-w-[240px] sm:min-w-[280px]` → `w-full min-w-0 sm:w-auto sm:min-w-[280px]`，
  行容器补 `flex-wrap` —— 414px 下输入框独占整行、`添加仓库` 换行左对齐，不再顶出卡片。

- **CDP 复验**（`probe-730.mjs` / `probe-730b.mjs`）：1920px 下 3 个可见标题行为
  `990×64 / 990×65 / 990×55`、`flex-direction: row`、`background: rgba(0, 0, 0, 0)`、`gap: 12px 16px`、
  末位控件距右边缘 20px；414px 下为 `348×92 / 348×97 / 348×83`、`flex-direction: column`、
  末位控件距右边缘 248 / 213 / 244px（左对齐生效）；插件仓库行在 414px 下输入框与按钮各占一行、无横向溢出；
  控制台噪声 0 条。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`（`features/agent/settings`）、`prettier --check`、i18n 校验全绿。

### 7.31 设置区 8 处独立「保存」按钮的语义分级（§7.15-c 收口，P2 · ✅ 已关闭 2026-09-23）

**现象**：§7.15-c 原文实测「运行与环境」全页高 3825px、内部 8 处各自独立的保存动作
（执行与性能 / Plugin·App 独立执行预算 / 浏览器运行时 / MCP Integrations / ACP 运行时 Profiles / Subagent / 配置档 / Artifact 与存储），
**用的是同一个浅紫主按钮样式、且大多数时候处于 disabled**（没改动时），滚动中段既看不出「哪里能存」也看不出「刚才改的生效没有」。
源码枚举与原文一致：这 8 处都写死 `appearance="solid" tone="primary"`
（`BudgetContextSettings` / `PerformanceSettings` / `StorageArtifactSettings` / `AppExecutionPolicySettings` /
`SafetyNetworkSettings` / `BrowserRuntimeSettings` / `AcpRuntimeSettings` / `SubagentSettings`×2）。

**根因**：保存按钮的视觉档位是**静态写死的**，没有跟「是否存在未保存变更」绑定。
全目录只有 `SafetyNetworkSettings` 一处按 `isDirty` 分级（局部的偶然正确），其余把「待命」和「有待保存的动作」
画成了同一个主按钮；另有 4 处（Browser / ACP / Subagent ×2）**根本没有 dirty 概念**，永远可点、点了也只是重发一遍同样的 payload。

**改法**：统一成一条规则 —— **有未保存变更 → `solid` + `primary`；无变更 → `soft` + `neutral` + `disabled` + `title`（复用已有的 `agent.settings.disabledReason.noChanges`）**：

- 已有 dirty 计算的 4 处（Budget / Performance / Storage / AppExecutionPolicy）改成绑定 `dirty ? … : …`，不新增状态；
- `BrowserRuntimeSettings`：新增 `isDirty`，把 `targets` 草稿与 `settings.requestedSettings.browser.targets` 的克隆快照做 JSON 比对；
- `AcpRuntimeSettings`：把 `saveProfiles` 里的校验/归一化抽成 `normalizeProfiles()`，`saveProfiles` 与 `isDirty`
  共用同一份归一化（解析失败时 `isDirty` 返回 `true`，即回退成「保持主按钮」，不会误判成干净）；
- `SubagentSettings`：全局上限用 `draft` 与 `settings.requestedSettings.subagents` 快照比对；
  配置档用 `loadProfiles` / 保存成功后写入的 `profileBaseline` 基线比对（`profileSettings` 尚未加载时视为干净）。

**CDP 复验（`probe-731f.mjs` / `probe-731h.mjs`，1920px）**：

- 「运行与环境」8 处保存按钮**全部** `data-appearance="soft" data-tone="neutral" disabled`，
  实测底色 `rgb(243, 244, 246)`（原为浅紫 `rgb(160, 108, 213)`），尺寸维持 `48×32 / 70×32 / 84×32 / 92×32 / 108×32`；
- 反向验证（dirty 路径）：把「执行与性能」的执行并发 `2 → 3`，其保存按钮**立刻**变成
  `solid / primary / 可用 / rgb(160, 108, 213)`，同一屏未改动的「浏览器运行时」保存按钮**保持** `soft / neutral / disabled`
  —— 说明每条是各自独立判定，不是一刀切；
- 刷新页面后回到 `soft / neutral / disabled`（草稿丢弃，无残留脏态）；控制台噪声 0 条；
- `title` 实测为「没有未保存的修改」（`agent.settings.disabledReason.noChanges`），禁用态仍有原因可查（延续 §7.13-e）。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`（`features/agent/settings`）、`prettier --check`、i18n 校验全绿。

**同条剩余部分**：本条原文另两点「没有粘性分区导航」已由 §7.27 关闭（宽屏左栏 + 滚动联动），
「页面过长」随 §7.25（嵌套收敛）与 §7.27（左栏跳转）一并缓解，故 §7.15-c 整条关闭。

### 7.32 设置区 22 处原生 `<select>` 收敛到 Gen2 `UiSelect`（P1 残留 · ✅ 已关闭 2026-09-23）

**现象**：§6.3 / §6.7 / §7.15-f / §7.20 反复记录的同一条 —— 设置区的下拉仍是逐处手写的原生 `<select>`，
各自写死 height / radius / padding / font-size。修复前源码计数：`features/agent/settings/**` 共 **22 处**
`<select>`，同屏并存 `h-6 rounded-md text-[11px]`（Provider 协议）、`h-9 rounded-lg text-xs`、
`rounded-md px-3 py-2 text-sm`、`rounded px-2 py-1 text-xs` 四种规格；展开时弹的是**浏览器原生下拉**，
与本产品其余浮层（玻璃 + 圆角 + 阴影 + 动效）完全不是一套语言。

**根因**：`foundation/ui` 里其实早就有 Gen2 `UiSelect`（Reka listbox + `.ui-select__panel` 玻璃面板、`z-index: 85`），
但 `features/agent` 下**一处都没用** —— 22 处全是手写原生控件，所以「有规范却没落地」。
次要原因：`UiSelect` 的 `v-model` 语义是「nullable 进、nullable 出」，直接拿来替换 `ref<string>` 的字段类型不过，
于是没人愿意第一个改。

**改法**：

- 22 处全部换成 `UiSelect`：`class` 落到外层 div（保住 `w-full` 这类布局），`aria-label` 由组件转发到真正的 trigger；
  值走 `v-model`（string 字段）或 `:model-value` + `@update:model-value`（窄联合字段）；
- **`UiSelect` 语义收窄**（`foundation/ui/UiSelect.vue`）：prop 仍接受可空值（首帧显示 placeholder），
  但 update **只会回传真实选项值**，不再回传 `null` —— 否则每个 `ref<string>` 调用点都得跟着放宽类型；
- **空选项**：Reka 的 `SelectItem` 禁止空字符串 value（会直接抛
  `A <Select.Item /> must have a value prop that is not an empty string`），所以 4 处「不选择」项
  （Memory 来源 App / 来源 Memory、模型能力默认 effort）改用新增的 `NONE_OPTION` 哨兵值 + 校验式 handler；
- **窄联合字段**（`scope` / `via` / `protocol` / `contextProfile` / `contextCompactionMode` / `peerMessaging` /
  `mutationMode` / `failureMode`）不直接 `v-model`，走新增的 `settings/pick-option.ts → pickOption()`：
  只接受白名单内的字面量，其余原样丢弃，既保类型又防脏值；
- **删掉事件式用法**：`@change` + `($event.target as HTMLSelectElement).value` 全部清除，
  `AppManagementSettings.onTargetModeChange` / `ModelProviderSettings.protocolFromEvent`(→`protocolFromValue`) /
  `SubagentSettings.setDefaultModel` 改为直接收值；`AppManagementSettings` 那两个写死的
  `All targets` / `Specific IDs` 一并进词典（新增 `agent.settings.apps.targetScope{,All,Ids}`，三语齐平）。

**CDP 复验（`probe-732b/e/f.mjs`，1920×953）**

| 分组       | 可见 Gen2 `[data-ui=select]`                      | 残留原生 `<select>` |
| ---------- | ------------------------------------------------- | ------------------- |
| 模型与预算 | 1（`297×28`）                                     | 0                   |
| 运行与环境 | 5（`435×32` / `208×32` ×2 / `160×32` / `383×28`） | 0                   |
| 插件与安全 | 4（`469×32` ×2 / `427×32` ×2）                    | 0                   |

- 展开面板实测 `z-index: 85` + `backdrop-filter: blur(6px)`（不是浏览器原生下拉），
  选项文本走词典（`Chat Completions` / `Responses API`）；点选后 trigger 文本即时更新
  （`自动（跟随执行并发）` → `1`），保存按钮随之由 `soft` 转 `solid`（§7.31 的联动仍然成立）；控制台噪声 0 条；
- 414px：三组均 0 原生 select，控件 `308×32` / `284×32` / `316×28` 撑满可用宽度，**横向溢出元素 0**；
  Memory 的两处「选择来源 App / 选择已发布 Memory」placeholder 正常占位；
- **e2e 同步**：`tests/e2e/specs/agent/host.spec.ts` 里对协议 / 默认 effort 的 `selectOption()` + `toHaveValue()`
  改为 Gen2 listbox 的 `pickGen2Option()` + `toContainText()`；「PATCH 失败」那一步的断言由
  「点击后瞬时的 DOM 值」改为「服务端值不变」—— Gen2 控件的显示值只跟随服务端状态，这正是该用例想守住的语义。
- **门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check`、i18n 校验全绿。

**同源残留（下一条）**：`features/agent/runtime/**` 另有 5 处原生 `<select>`
（`WorkspaceCreateCard` ×3 / `WorkspaceToolchainCard` ×1 / `WorkspaceArtifactTransfer` ×1），
属同一类问题但不在本条 22 处的计数内；本环境 `runner_not_configured`（§7.15-b）导致 Workspace 卡片不渲染，
无法用 CDP 实测，故另立一条处理。

### 7.33 `QuantityInput` 单位快捷药丸的命中区 18×20 → 24×24（P1 残留 · ✅ 已关闭 2026-09-23）

**现象（修复前 CDP 实测）**：§6.2 遗留项。预算/上限里的快捷单位药丸（`m` / `h` / `K` / `M` / `G`）
实测 **`18×20`**（`probe-733b.mjs`：可见 10 个，尺寸全部 `18x20`），比仓库里其它交互元素的下限（24px）小一档；
药丸本身是输入框内的次级入口，命中区偏小时更容易误触到输入框。

**根因**：`.inline-flex h-5 … px-1.5` —— 高度写死 20px，宽度由单字符 + 12px 内边距撑出来（≈18px），
两处都没有下限；输入框为药丸预留的右侧内边距也只有 `pr-20`（80px）。

**改法**：高度 `h-5` → `h-6`、宽度补 `min-w-6`（24px 下限）；同时把输入框的 `pr-20` → `pr-24`（96px），
因为字节型字段有 3 枚药丸（`K` / `M` / `G`），24px × 3 + 间距 + 右侧 6px ≈ 82px，旧的 80px 已经压到边。

**CDP 复验（`probe-733b.mjs`）**：药丸尺寸 `18×20` → **`24×24`**，可见 10 个全部一致；
`128K` / `16K` 这类三药丸字段的输入框右内边距实测 `96px`，数值文本未被药丸压住；控制台噪声 0 条。

**门禁**：模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check`。

### 7.34 模型列表的「取消添加 / 一键取消」升级为 Gen2 按钮并补确认（§6.3 / §6.7 收口，P1 · ✅ 已关闭 2026-09-23）

**现象**：§6.3 把设置区"粗糙感"量化时点名的两处 ——

1. 「已生效模型」列表的单项移除是 `text-[11px] text-error` 的**纯文字**（§6.7 表格 #2：无图标、无底色、无确认），
   与同屏其它按钮（`32px / fs12 / r8` 的 Gen2 档位）明显不是一套；
2. 「移除全部模型」是**批量危险动作**却没有二次确认（§6.7 #3），点下去直接改写服务端模型列表。

**根因**：这两处是从早期"抽屉式模型管理"沿留下来的手写 `<button>`，
没有跟着 §6.2 的按钮三档一起收敛；而"批量删除"在设置区其它位置（如删除 Provider）已经有确认弹窗范式，
只有这里漏了。

**改法**：

- 单项移除（抽屉内「已生效模型」列表）：手写 11px 文字按钮 → **Gen2 `UiButton`（`appearance="soft"`、`density="compact"`）**，
  可移除时 `tone="danger"`，不可移除（仅剩一个模型 / 是默认主力模型）时 `tone="neutral"` + `disabled`，
  原因仍走 `title`（`atLeastOneModel` / `cannotRemoveDefault`），延续 §7.13-e 的"禁用必须给理由"；
- 批量移除：`@click` 改为先打开确认弹窗（复用删除 Provider 那套 `BaseModal` 形态），
  正文写明**将移除几个、保留哪一个**（`{name}` / `{count}` 插值），确认键才真正调用 `removeAllConfigured`。

**CDP 复验（`probe-734.mjs`，1920×953）**

- 抽屉内单项按钮实测 **11 个、`85×28`、`data-appearance="soft"`**；首个（默认主力模型那一行）为 `tone="neutral"` 且禁用，
  其余为 `tone="danger"`（红底红字 + 垃圾桶图标），不再是裸文字；
- 点「一键取消」→ 弹窗实测文案 **「确认移除全部模型 / 将移除 newapi 下 10 个可移除模型；默认主力模型或首个基础模型会保留。」**，
  按钮为「取消 / 一键取消」；Esc 可关闭，未确认前**不会**发出任何写请求；
- 控制台噪声 0 条；`vue-tsc`、模板编译、`eslint`、`prettier --check`、i18n 校验（新增两条 key 三语齐平）全绿。

**同条余项**：§6.2「设置区控件风格分裂」清单里，按钮三档（已闭环）、原生 checkbox（§7.20）、原生 `<select>`（§7.32）、
`QuantityInput` 命中区（§7.33）、11px 纯文字按钮（本条）均已收口；**唯一保留项是顶部 Tab 的 36px 高度**——
它属于跨页 chrome（工作区 / 系统 / 安全 / IP 管控…共用），按约定不在 Agent 设置范围内单独改。

### 7.35 Workspace 运行时的 5 处原生 `<select>` 同批收敛（§7.32 遗留 · ✅ 已关闭 2026-09-23）

**现象**：§7.32 收口设置区 22 处原生 `<select>` 时点名的同源残留 —— `features/agent/runtime/**` 还有 5 处：
`WorkspaceCreateCard`（配方 / 浏览器目标 / 工具版本）、`WorkspaceToolchainCard`（工具版本）、
`WorkspaceArtifactTransfer`（导入产物），全部是 `rounded px-2 py-1 text-xs` 的手写原生控件，
和刚收敛完的设置区又形成新旧两套。

**根因**：同 §7.32（有用的 Gen2 组件没人用）。

**改法**：5 处全部换成 `UiSelect`。这批和设置区不同的地方是**它们的空值有语义**
（"不选配方 / 不选浏览器目标 / 不选工具版本" 表示回到 None），Reka 不允许空字符串作为选项值，
所以用 `NONE_OPTION` 哨兵承载"不选择"这一项、在 `@update:model-value` 里换回 `''`；
`WorkspaceToolchainCard` 的"不选择"还要跟随 `pinnedVersion()`（已固定版本时不提供该选项），
用条件展开保持原语义。

**验证**：本环境 `runner_not_configured`（§7.15-b），Workspace 运行时的卡片不渲染，
因此本轮**只有模板编译 + `vue-tsc --noEmit` + `eslint`**，没有 CDP 实测（与 §7.15-b / §7.20 同类环境限制，
在此显式记录而不是含糊带过）。收敛后 `features/agent/**` 的原生 `<select>` 计数为 **0**。

### 7.36 TaskRail「最近事实」不再默认 dump JSON（§2.9 收口，P1 · ✅ 已关闭 2026-09-23）

**现象（§2.9 原文）**：「最近事实」卡把 ledger 的原始 payload 用
`JSON.stringify(entry.payload, null, 2)` + 等宽小字**直接铺在运行详情里** —— 对用户没有语义，
属于调试视图（原文建议"仅开发者模式可见"）。

**根因**：这一块是从后端 ledger 直接搬到 UI 的，中间没有任何"给人看"的投影层：
一条事实本来就是 `{ key: value, … }` 结构，但 UI 只提供了"原始 JSON"这一种读法。

**改法**（保留可排查性，但不把默认视图变成转储）：

- 每条事实渲染成 **`dl` 投影**：一行一个字段（`dt` 等宽字段名 + `dd` 取值），长字符串/嵌套值截断到 120 字符加省略号；
- 原始 JSON **折进二级 `<details>`**（新增词典 `agent.tasks.rawPayload` = 原始数据 / Raw payload / 生データ），
  排查时一键展开，默认不再占据版面；
- payload 不是对象（数组/标量）时回退成单行 `value` 投影，不会渲染空块。

**验证**：本环境（`runner_not_configured` + 当前会话没有任何历史 Run，`#agent-task-rail` 实测只有
「当前没有 Run。」）**无法打开 Run 详情**，`detail-snapshot` 恒为 `null`，因此「最近事实」卡在真实环境没有渲染实例 ——
与 §7.15-b / §7.20 / §7.35 属同一类环境限制，本轮据此只有：
模板编译、`vue-tsc --noEmit`、`eslint`、`prettier --check`、i18n 校验（三语齐平）；
并静态确认 `JSON.stringify(entry.payload` 现在**只**出现在二级折叠的 `<pre>` 里（`TaskRail.vue:556`）。

### 7.37 Agent 错误横幅：补失败域与重试入口（§2.9 收口，P1 · ✅ 已关闭 2026-09-23）

**现象（§2.9 原文 + 本轮 CDP 复现）**：错误横幅只有关闭按钮 —— 用户既不能"再试一次"，也不知道**是哪一路失败**。
本轮先用 CDP 把现象钉死（`probe-237-b7.mjs`）：拦截 `GET /api/v1/apps/nexus.agent/runs?limit=50&threadId=…` 回 500 后，
`[role="alert"]` 的文本是 **`AGENT_REQUEST_FAILED`** 本身，按钮只有 1 个（`aria-label="关闭"`）——
比原记录更糟：**机器码被直接渲染给了用户**。

**根因**：

1. 文案：`host/AgentAppSurface.vue` 的 `explain` 把 `formatAgentApiError(cause, 'AGENT_REQUEST_FAILED')` 的兜底参数写成机器码，
   而 `formatAgentApiError` 对所有 5xx 直接返回兜底值 ⇒ 内部标识漏到界面。同类写法还有 `PluginManagementSettings.vue`、
   `AppManagementSettings.vue`、`ArtifactLibraryView.vue`、`ArtifactPicker.vue`；`AgentSettingsPanel.vue` 用的是英文整句。
2. 入口：`error` 只是一个 `ref<string>`，状态里没有"哪一路失败 / 怎么重跑"，横幅自然只能渲染文案 + 关闭。

**改法**：

- 失败状态升级为 `{ message, domainKey, code, retry }`（`applyFailure` / `fail` / `clearError`），
  9 个失败域三语齐平：会话列表、会话记录、运行状态、审批、检查点、任务详情、配置、实时事件、运行时操作。
- 兜底文案改为 `agent.operations.requestFailed`；稳定错误码不再当正文，改放进 `title`；
  上述 5 处以机器码/英文整句当兜底文案的调用点同步换成词典值。
- `openRunDetail` 的辅助请求按索引映射失败域（checkpoints / approvals / subagents → 检查点 / **审批** / 任务详情），
  正是 §2.9 点名的"不会知道是审批这一路失败"。
- `formatAgentApiError` 不再把 `SCREAMING_SNAKE` 的机器码当文案（4xx 未带 message 时会漏出 `RUN_VERSION_CONFLICT` 这类内部标识）：
  只有真正的人类可读 message 才渲染，机器码一律回到兜底文案并留给 `title`。
- 横幅与"无内容"空态面板都带动作按钮：**读路径 = `agent.operations.retry`（重试）**，
  **写路径 = `agent.operations.resync`（重新同步）** —— 只重新拉取权威状态，不重放原修改操作，
  与对账提示"不要重试原修改操作"保持同一语义；`title` 统一为 `agent.operations.retryHint`。

**CDP 验证（注入 500 的实测数据）**：

- 读路径（切换会话 → `GET /runs` 500）：横幅实测 `会话记录 · 请求失败，请稍后重试。` + `重试` 按钮 **42×28 / r8 / fs11 / soft**
  （`title=重新加载失败的数据`）+ 关闭；解除注入后点「重试」，`[role=alert]` 归零、会话内容正常加载。
- 空态面板（`GET /threads` 500，`entries.length === 0`）：实测 `会话列表 / 请求失败，请稍后重试。` + `重试 42×28`；
  点击后报错清零、侧栏 3 个会话加载成功。
- 4xx 机器码（`GET /runs` → 409 `{error:{code:'RUN_VERSION_CONFLICT'}}`，故意不带 message）：横幅实测 `会话记录 · 请求失败，请稍后重试。`，
  内部标识只出现在 `title="RUN_VERSION_CONFLICT"`；对照组带 message 的 400 仍原样展示后端 message（`threadId must be a uuid`，`title=VALIDATION_FAILED`）——
  即"内部码不再进正文、真实后端文案保留"。
- 截图：`/tmp/shots/probe-237-after-fail.png`、`probe-237-after-retry.png`、`probe-237-panel-fail.png`；
  探针 `probe-237-{b7,after,panel}.mjs`。
- 方法备注：注入必须用 CDP `Fetch.enable` + `Fetch.fulfillRequest`；实测 `connectOverCDP` 拿到的页面**不经过 Playwright 路由**
  （`page.route` 安装了但 `requestPaused` 为 0），这条坑记在此处以免复发。
- 同轮修掉两个自己引入的运行时缺陷（`clearError` 自递归 → `RangeError: Maximum call stack size exceeded`；
  空态面板漏 `import UiButton`），两者都是被 CDP 探针 + `/tmp/frontend-dev.log` 抓到的。

**门禁**：模板编译、`vue-tsc --noEmit`、`eslint packages/frontend/src/features/agent/`、`prettier --check`、
`node scripts/check-agent-i18n.mjs`（三语齐平 + 无硬编码句子）全绿。

### 7.38 §2.8 收口：Launcher 长按拖动 + 虚拟列表行高实测（P1 · ✅ 已关闭 2026-09-23）

本节关闭 §2.8 里最后两项「不可发现 / 与整体不一致」的交互（前两项已由 §7.13-d 与 §7.14-b 关闭）。

**a) Launcher：6px 阈值拖拽 → 长按拖动 + 重置位置**

- **现象（CDP 复核）**：40×40 圆钮的拖动与"打开 Hub"共用一条 pointer 流程，只要移动超过 6px 就变成拖动；
  拖走之后除清 localStorage 外没有回去的入口（`title` 只有「打开 Agent」）。
- **根因**：`pointerDown/Move/Up` 只有一个 `moved` 标志位，没有"意图"概念；位置恢复没有对外暴露的 API，
  默认值 `{right: 22, bottom: 24}` 只写死在 `window-manager.ts` 的初始 state 里。
- **改法**：`host/AgentLauncher.vue`
  - **长按 320ms** 才进入拖动（期间给 `scale-110` + `ring` 的抓取反馈）；未到阈值前移动 >10px 的指针序列会被**放弃**
    （既不拖动、也不打开 Hub），不会再误触；
  - 拖动结束后，若不在默认位置就显示一次性的「重置位置」胶囊（7s 自动收起），点击还原；
  - 右键（`contextmenu`）直接还原作为兜底；`title` 变成「打开 Agent · 长按可拖动，右键还原位置」；
  - `window-manager.ts` 新增 `DEFAULT_LAUNCHER_POSITION` 与 `resetLauncherPosition()`，默认值不再是两处各写一份。
- **CDP 验证（`probe-238-launcher.mjs`，注入真实 pointer 事件）**：

  | 步骤                        | 实测                                                                                                                    |
  | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
  | `title`                     | `打开 Agent · 长按可拖动，右键还原位置`                                                                                 |
  | 单击（down/up）             | Hub 打开 ✔（位置仍 `right 22 / bottom 24`）                                                                             |
  | 快速拖动（<320ms、80×60px） | 位置**不变**、Hub **未打开** ✔（旧行为会把它拖走）                                                                      |
  | 长按 450ms 后拖动 140×120   | 位置 → `right 161 / bottom 143`，拖动中 `cursor-grabbing` ✔，出现胶囊 `重置位置`（85×28，`title=还原到右下角默认位置`） |
  | 点胶囊                      | 回到 `right 22 / bottom 24`，胶囊消失 ✔                                                                                 |
  | 右键                        | 还原（读回 `21/23`，差值来自 hover 的 `scale-105` 1px 外扩）✔                                                           |

  控制台/`pageerror` 全程 **0** 条。

**b) 虚拟列表行高：`45 × scale` 手算 → 量探针行**

- **现象/根因**：`host/AgentThreadSidebar.vue` 的占位高度与可视窗口都按 `Math.round(45 * scale)` 算，
  而行内 `padding / 字号` 是按 `--agent-thread-scale` 在 CSS 里换算的 —— 两套算法各算各的。
  实测在 120% 档：真实行距 **53.06px**，公式给 **54px**（每行差 0.94px）；130% 档真实 **57.16px** vs 公式 **59px**（差 1.84px）。
  按每页最多 100 条算，滚动位置最多会累积 ~94–184px 的偏移。
- **改法**：新增一个**隐藏探针行**（复用 `.agent-thread-row / .agent-thread-title / .agent-thread-meta` 同一组 class，
  放在 `h-0 overflow-hidden` 容器里，不参与布局），用 `ResizeObserver(..., { box: 'border-box' })` 观察它，
  把量到的"行高 + `mb-0.5` 间距"直接作为虚拟列表的 `rowHeight`；`applyScale` 在恢复锚点前先重新量一次。
  CSS 改了字号/内边距/缩放，占位高度自动跟着走，不再有第二份手算常量。
- **CDP 验证（`probe-238-{rowheight,expand,drawer}.mjs`）**：

  | 场景                                              | 探针行高          | 实际行高 | 行距                              |
  | ------------------------------------------------- | ----------------- | -------- | --------------------------------- |
  | 100%                                              | 42.89             | 42.89    | 44.89（= 行高 + 2px `mb-0.5`）    |
  | 110%（Ctrl+滚轮）                                 | 46.98             | 46.98    | 48.98                             |
  | 120%                                              | 51.06             | 51.06    | 53.06                             |
  | 130%                                              | 55.16             | 55.16    | 57.16                             |
  | A/B：临时把行内边距改成 `10px × scale`（+4px/边） | 51.06 → **60.69** | 60.69    | 62.69（移除后回到 42.89 / 44.89） |

  最后一行是关键证据：**光改 CSS 就能让占位高度跟着变**，这正是"两套算法合一"要达到的效果。

- **同轮修掉两个自己引入的缺陷**（都是探针先发现）：`ResizeObserver` 默认观察 content-box，
  `padding` 变化不触发回调（改 `box: 'border-box'`）；探针在 `onMounted` 时还没渲染（线程列表异步到达），
  观察器挂在 `null` 上（改成 `watch(rowProbe, { flush: 'post' })` 绑定模板 ref）。
- **收尾**：把探针轮次改动的 `thread-list-scale` 复位成 `1`，Hub 侧栏开合状态与 Launcher 位置恢复原值。

**门禁**：模板编译、`vue-tsc --noEmit`、`eslint packages/frontend/src/features/agent/`、`prettier --check`、
`node scripts/check-agent-i18n.mjs`（新增 3 个 launcher key 三语齐平）全绿。

- 截图：`/tmp/shots/probe-238-launcher-dragged.png`（拖动后 + 重置胶囊）、`probe-238-drawer.png`（展开侧栏的行高）。

---

### 7.39 §1.8 收口：工具结果摘要的「模型可见证据 / 用户可见摘要」拆分（P2 · ✅ 已关闭 2026-09-23）

本节关闭 §0 速览表里最后一条「非 UI 但影响 UI」的开放项：`modules/agent/tools/host/**` 的工具摘要只有英文一份，
中文/日文界面里直接混入 `Found 0 authorized SSH connection(s).` 这类句子。

**a) 现象与根因（先 CDP 复现，再动手）**

- **现象（CDP 实测基线）**：历史会话 `8dce1e79`… 的 9 条真实 `tool_result`，在 **zh-CN** 界面里渲染为
  `Plan updated to revision 1 with 3 item(s).` / `Found 0 authorized SSH connection(s).` /
  `Loaded signed Skill operations (nexus.agent.operations).` / `Shared fact loaded.` —— 全英文。
  探针：`/tmp/w/dump2.mjs`（读 `.agent-conversation-scroller summary` 的文本）。
- **根因**：`ToolResult.summary` 是**同一条字符串**同时服务模型（函数返回的证据文本）与用户（`ai/ConversationMessage.vue` 渲染的摘要行），
  工具层没有任何"用户可见文案"的表达能力；直接在工具里查表又会把 i18n 依赖灌进后端领域层，并把 key 写进模型能读到的 JSON 里。

**b) 改法：加一条"只给用户的旁路"，模型侧一字不动**

| 层                                       | 改动                                                                                                                                                          |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `capabilities/tool.types.ts`             | 新增 `ToolUserSummary { key: string; params?: Record<string, JsonValue> }`；`ToolResult.userSummary?` 可选                                                    |
| `capabilities/tool-result-projection.ts` | `projectToolResult` 首行 `withoutUserSummary(toolResult)` —— 模型侧投影**结构上不可能**带出 `userSummary`                                                     |
| `state-commit/tool-transition-result.ts` | 新增 `toolResultLedgerPayload(row, result, toolCallId)`：`text` 仍是 `modelToolResultJson`，旁边旁路写 `userSummary`                                          |
| ledger 落库点                            | proposal / mutation / interactive 三个 transition 全部改用 `toolResultLedgerPayload`（顺带修掉 interactive 成功路径里唯一手写 `{ toolCallId, text }` 的漏网） |
| `ai/ConversationMessage.vue`             | 新增 `localizedToolSummary`：优先 `payload.userSummary`，**缺失时原样回退** `summary`（历史数据零迁移、无需 backfill）                                        |
| `i18n/{zh-CN,en-US,ja-JP}.json`          | 新增 `agent.conversation.toolSummary.*`：**72 条句子 + 39 条 `labels.*` 枚举标签**，三语键序一致                                                              |

- **枚举不裸奔的约定**：`params` 里以 `Key` 结尾的参数值**本身是 i18n key**，前端 `te()` 解析成标签后插值
  （`stateKey → labels.jobState.running → 运行中`）；key 缺失时退化成 key 末段，**不会**把 `agent.conversation.…` 路径渲染到界面。
- **覆盖范围**：`tools/host/**` **16 个文件、52 处**用户可见 `summary` 全部接入（file×7 / machine×2 / shell+job×9 / workspace 管理×5 /
  workspace 代码智能×3 / skill×2 / tool-discovery / user-input / artifact×3 / docker mutation / collaboration×10 / ACP / browser 6 文件×14 / plan-tool），
  外加 `state-commit` 里 4 条明确面向用户的失败摘要（审批拒绝 / 审批过期 / 审批被新输入取代 / Run 取消）。
  **刻意排除**：`mcp-tools.ts`（远端不可信内容不应进本地字典）、`verification.summary`（前端不渲染）。
- **顺带修掉一个维护隐患**：`ConversationMessage.vue` 原先把"有中文文案的失败码"硬编码成 `friendlyFailureCodes` 数组，
  新增失败域必须同步改组件；现在改成 `te('agent.conversation.toolFailure.<CODE>')` 查表。

**c) CDP 验证（复用历史会话的真实 `tool_result`，不造数据）**

历史行没有 `userSummary`，正好可以同时验收「新投影」与「老数据回退」两条路径：
临时给 4 条历史 ledger 行补上 `userSummary`（`/tmp/w/patch-ledger*.mts`，走真实 `nexus_ledger_search_terms` 触发器），验收后**逐字节还原**。

| 工具                                         | 无 `userSummary`（历史数据，回退）                       | 有 `userSummary`（zh-CN）                                   | 同一条的 en-US                                             |
| -------------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `plan_update`                                | `Plan updated to revision 2 with 3 item(s).`             | `计划已更新到修订 1，共 3 项。`                             | `Plan updated to revision 1 with 3 item(s).`               |
| `machine_list_connections`                   | —                                                        | `找到 0 个已授权的 SSH 连接。`                              | `Found 0 authorized SSH connection(s).`                    |
| `skill_read`                                 | `Loaded signed Skill developer (nexus.agent.developer).` | `已加载已签名 Skill operations（nexus.agent.operations）。` | `Loaded signed Skill operations (nexus.agent.operations).` |
| `get_shared_fact`                            | `Shared fact loaded.`                                    | `共享事实已加载。`                                          | `Shared fact loaded.`                                      |
| `browserActionCompleted`（`actionKey` 参数） | —                                                        | `浏览器点击已完成。`                                        | `Browser click completed.`                                 |
| `jobState`（`stateKey` 参数）                | —                                                        | `工作区任务状态：运行中。`                                  | `Workspace job is running.`                                |

- **模型侧未被污染的硬证据**：展开任意工具结果的 JSON 面板，含 `userSummary` 的 `<pre>` 为 **0** 个
  （模型只读 ledger 的 `payload.text`，其值来自 `projectToolResult`）。
- **投影随语言切换**：把 `localStorage.user-locale` 切到 `en-US` 重新加载，同一条记录渲染回英文（`Browser click completed.`），
  `title`（悬停提示）与摘要正文同步本地化。
- **同轮抓出并修掉两个自身缺陷**（只有真实浏览器渲染才能暴露，已并入验收清单）：
  1. **标签值语言错位** —— 生成字典时把 `zh-CN` 映射到了英文标签，CDP 显示 `浏览器click已完成。` / `工作区任务状态：running。`；修正后复测通过。
  2. **占位符与后端参数名不一致** —— i18n 写 `{action}` 而后端传 `actionKey`，导致插值为空（`浏览器已完成。`）；
     改为 `{actionKey}` / `{stateKey}` / `{reasonKey}` 后复测通过，并补了一个参数/占位符一致性审计脚本（`/tmp/w/audit-params.mjs`）。

**d) 门禁与残留**

- `packages/backend` `tsc --noEmit`、`packages/frontend` `vue-tsc --noEmit`、`eslint`（`modules/agent` + `infrastructure/agent` + `features/agent`）、
  `prettier --check`、`node scripts/check-agent-i18n.mjs`（三语 key 齐平 + 无逐字英文 + 组件无硬编码 CJK）全部通过。
- 验收后 dev 数据库已还原（9 行 `payload_json` 逐字节回写，`ai_thread_entries_search` 行数仍为 27），`localStorage.user-locale` 复位为 `zh-CN`。
- **仍开放（并入 §3.6 跟踪，不计入本节）**：`mcp-tools.ts` 的远端摘要、`execution-errors.ts` 的执行期错误前缀、
  `command.reason`（`supersedeMutationTool` 的自由文本原因，按 `errorCode` 变化）仍是英文；
  它们不在 `tools/host/**` 范围内，且依赖 Runner / 远端才能触发（本环境 `runner_not_configured` 无法实测）。

---

### 7.40 §3.5 收口：i18n 死 key 从"一次性脚本结论"升级为常驻门禁（P2 · ✅ 已关闭 2026-09-23）

**a) 现象与根因**

- **现象**：`features/agent/i18n/*.json` 三份字典各存一份文案，但"某个 key 是否还有人用"从来没进过任何门禁；
  §3.5 记的 274/1148（约 24%）只是一次手工脚本的**快照**，之后既没人复核，也没有机制阻止继续加死 key。
- **根因**：`scripts/check-agent-i18n.mjs` 原有三条守卫只查「三语 key 齐平 / zh-ja 无逐字英文 / 组件无硬编码 CJK」——
  **都是"已存在的 key 是否合规"，没有一条问"这个 key 还有没有人读"**。

**b) 改法：先给门禁补第 4 条守卫，再按守卫的结论删**

`scripts/check-agent-i18n.mjs` 新增"key 可达性"检查，并把扫描范围从 `features/agent` 扩到前端全部源码 + **后端源码** + `tests` + `scripts`。
判定「可达」的三种形态（任一命中即保留）：

| 形态                 | 例子                                                                                                                | 说明                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 精确字面量           | `$t('agent.tasks.title')`                                                                                           | 最常见                                         |
| key 是某字面量的祖先 | 代码里写了 `agent.files.status.ready`，则 `agent.files.status` 视为树节点保留                                       | 保守规则，宁可少删                             |
| 模板/拼接前缀        | ``t(`agent.tasks.runStatus.${status}`)``、`translateOrRaw('agent.settings.workspaceRuntime.commandAction', action)` | 拼接语义按 `startsWith` 判定（**没有分隔点**） |

构建这条守卫时踩到三个坑，都直接决定"会不会误删活 key"，已写进规则：

1. **只看前端会误删活 key**：`agent.conversation.toolSummary.*` 的 key 路径是**后端**（`tools/host/**`、`state-commit/*`）拼出来的，
   只扫 `features/agent` 会把整套刚落地的工具摘要投影判成死文案 → 扫描根必须包含 `packages/backend/src`。
2. **模板拼接没有分隔点**：`agent.settings.subagents.template${'Explore'}` 拼出来是 `…templateExplore`，
   若按 `prefix + '.'` 判定就会漏，导致误判；必须按 `startsWith(prefix)` 判定。
3. **裸前缀字面量**：`translateOrRaw('agent.settings.workspaceRuntime.commandAction', command.action)` 把字面量当**前缀**传进函数，
   既不是完整 key 也不是模板 —— 规则补成"某字面量若不是字典 key、却是某些 key 的前缀，则它整体视为动态前缀"。

**c) 执行结果**

- 三语字典叶子 key：**1,467 → 1,392**（每个语言删除 **75** 条，合计 225 条死文案），三语仍完全齐平。
- 删掉的典型：`agent.operations.environment*`（13 条）、`agent.tasks.{progress,status,detail,current,activity,openDetail,closeDetail,…}`（12 条）、
  `agent.ui.{budget,limits,toolOutput,advanced,usageDetails,reasoning*}`（13 条）、`agent.settings.hardLimits.preset*`（7 条）、
  `agent.settings.groups/groupDescriptions/*`、`agent.hub.{appSwitcher,appActivity,idle,workspace}`、`agent.conversation.kind.{user_input,tool_result,system_notice}`、
  `agent.files.{used,typeFilter,loadedCount,moreAvailable}`、`agent.workspaceRuntime.artifactId`、`agent.subagents.tokens`、`agent.approvals.openPending` 等。
- 门禁自带兜底：`UNUSED_KEY_ALLOWLIST`（当前为空），将来若确有只能运行时解析的 key，显式登记即可，不会再靠一次性脚本。

**d) CDP 验证（防"删过头"）**

- `/tmp/w/verify-i18n-usage.mjs`：登录后进「设置 → Agent」，**逐个点完左栏 20 个分区**
  （模型与预算 4 项 / 运行与环境 8 项 / 插件与安全 5 项 + 3 个分组标题），每切一次就全量扫描 DOM 文本；
  再回首页与 Hub。
  - 结果：**渲染出的原始 key 路径 0 处**、**intlify "Not found key" 告警 0 条**、**console error 0 条**。
  - 说明删掉的 key 里没有"有人读但被误判"的项；同一轮也复测了 §7.39 的工具摘要投影，历史数据仍按预期回退英文。
- 截图：`/tmp/shots/i18n-usage-settings.png`。

**门禁**：`node scripts/check-agent-i18n.mjs`（4 条守卫全绿）、`node scripts/check-transport-contract-boundaries.mjs`、`prettier --check`、
backend `tsc --noEmit`、frontend `vue-tsc --noEmit`、`eslint`（agent 前后端）全部通过。

---

### 7.41 §7.37 回看：创建会话失败的「重试」会重放无幂等 POST（P1 · 🟠 开放 2026-09-23）

本轮按历史 commit 回看 `441810d`（`fix(agent): give the error banner a failure domain and a retry action`）时，发现 §7.37 的“**读路径重试 / 写路径重新同步**”规则有一条漏网路径。

**当前代码事实**：

1. `host/AgentAppSurface.vue:902-916` 的 `createThread(title)` 在失败时调用 `fail(...)`，并把 `retry` 直接设成 `() => void createThread(title)`；没有使用其它 mutation 路径已经采用的 `retryLabelKey: 'agent.operations.resync'`。
2. `api/agent-api.ts:364-374` 的 `createThread()` 发 `POST /apps/:appId/threads`，header 只有 `mutationHeaders()` 的 CSRF token，**没有 `Idempotency-Key`**。
3. backend `conversation.service.ts` 的 `createThread()` 每次调用都会用 `randomUUID()` 生成新 thread id，也没有接收 caller-stable 幂等键。

因此存在典型的 **unknown outcome** 窗口：服务端已经写入 thread，但响应在反代 / 网络 / 浏览器侧丢失或超时；前端把它显示成失败，用户随后点击「重试」会再次发一个新的 create 请求，得到第二个 thread。这里不能用“第一次抛错了”推导“第一次一定没提交”。

这也使 §7.37 的关闭结论需要加限定：当前 Run mutation / 删除等路径已经用「重新同步」收敛，但**会话创建仍是直接重放写请求**。

**建议修复**（二选一，优先前者）：

- 给 thread create 引入 caller-stable `Idempotency-Key`，同一次用户意图在不确定结果后的显式 retry 继续复用同一个 key，backend repository/service 做 request-hash + replay；或
- 不重放 create，按钮改成「重新同步」，重新拉 thread 列表并尝试识别刚创建的结果；若无法可靠识别，则明确提示结果不确定，而不是再创建一次。

**本轮证据**：静态对照 `441810d` 后当前 HEAD；frontend `vue-tsc --noEmit` 通过。本条不依赖视觉主观判断，属于写操作语义 / 幂等性缺陷。

---

### 7.42 §7.2-c 回看：侧栏 / TaskRail 持久化字段漏进 reset，账号切换会继承上一用户布局（P2 · 🟠 开放 2026-09-23）

历史 commit `30fa0ed`（`feat(agent): let the thread sidebar collapse and remember the layout`）新增了 `threadSidebarVisible` 与 `taskRailVisible` 两个持久化字段：它们进入 `AgentHubState`、`restoreForUser()` 与 `persistForUser()`，目标是**按 user id 保存**布局偏好。

但 `host/window-manager.ts:258-268` 的 `reset()` 仍只重置 `status / bounds / maximized / activeAppId / recentAppIds / hubView / launcherPosition`，**没有把上述两个新字段还原为默认值**（线程侧栏 `true`、TaskRail `false`）。

`host/AgentSurfaceHost.vue:191-211` 的认证切换顺序是：

1. A 登出时先 `persistLayout('auth-ended')`；
2. `activeUserId = null` 后调用 `agentWindowManager.reset()`；
3. B 登录时调用 `restoreForUser(B)`；
4. 如果 B 从未保存过布局，`restoreForUser()` 在 `!stored` 时直接 return。

于是同一 SPA 生命周期内，B 会继续使用 reset 前残留在内存里的 `threadSidebarVisible / taskRailVisible`。这不是数据内容泄漏，但和“每用户布局 key”的隔离模型冲突，也会造成新账号第一次打开 Hub 的初始布局不可预测。

**建议修复**：把所有有默认值、且会进入 per-user payload 的字段集中到一个 `defaultState()` / `resetLayoutPreferences()`，`reset()` 必须一次性恢复 `threadSidebarVisible=true`、`taskRailVisible=false`，避免以后新增字段再次漏 reset；补一条 A→logout→B（B 无 localStorage）回归。

**本轮证据**：`git show 30fa0ed` 明确显示该提交新增了 state / restore / persist 三处字段但没有改 `reset()`；当前 HEAD 仍保持这一缺口。frontend `vue-tsc --noEmit` 通过。

### 7.43 §7.13-d / §7.14-b 回看：两类 localStorage UI 偏好仍跨账号共用（P2 · 🟠 开放 2026-09-23）

**当前代码事实**：

- `host/AgentThreadSidebar.vue` 的缩放使用固定 key `nexus.agent.thread-list-scale.v1`；`0a467b6` 补了可发现入口和“重置”，但没有把 key 加上 user id。
- `runtime/TaskRail.vue` 的卡片顺序使用固定 key `nexus.agent.task-rail-order.v1`；`ded8071` 补了键盘排序和“恢复默认顺序”，但 §7.14-b 原来明确指出的“换账号共用同一顺序”没有修。
- 对照 `window-manager.ts` 已经采用 `nexus.agent.surface.v1.user.<userId>`，说明同一产品已有按账号隔离 UI 偏好的模型。

因此 A 用户调整缩放 / TaskRail 顺序后退出，同一浏览器登录 B，B 会直接看到 A 的两项 UI 偏好。它不泄漏业务数据，但与其它 Agent 布局的 per-user 语义不一致。

**建议修复**：把两枚 key 一并迁到 user-scoped namespace；首次读取新 key 为空时可以一次性迁移旧全局值，也可以直接采用默认值。补 A→logout→B 的浏览器回归。

---

### 7.44 §2.4 / §7.14-b 回看：命中区 floor 并未真正收口（P1 · 🟠 开放 2026-09-23）

`8a3bc76` 的标题是 “finish the hit-target floor for 2.4”，`761a970` 又给 Hub resize 补了键盘几何，但当前 HEAD 仍存在可直接证明的小操作目标：

| 位置                                              |      当前盒尺寸 / 形态 | 说明                                                                |
| ------------------------------------------------- | ---------------------: | ------------------------------------------------------------------- |
| `host/AgentHubWindow.vue` 右下 resize             | **16×16**（`h-4 w-4`） | 方向键现已可用，但指针命中区仍是 §7.14-b 当时记录的 16px            |
| `settings/PluginManagementSettings.vue` 仓库删除  | **20×20**（`h-5 w-5`） | 真正的删除操作按钮                                                  |
| `host/AgentAppSwitcher.vue` 关闭                  | **20×20**（`h-5 w-5`） | 真正的关闭按钮                                                      |
| `ai/AgentConversation.vue` 错误横幅关闭           |     **无 h/w/padding** | 只有 x 图标，按钮盒基本跟图标尺寸走；有 `aria-label` 但指针目标极小 |
| `settings/ModelProviderSettings.vue` URL 复制     |     **无 h/w/padding** | 只有约 11px copy/check 图标；有 `title`，但命中区仍极小             |
| `settings/ModelProviderSettings.vue` API Key 显隐 |     **无 h/w/padding** | 只有约 12px eye 图标；同时缺可访问名，见 §7.60                      |
| `host/AgentThreadSidebar.vue` 搜索清空            |     **无 h/w/padding** | 只有 11px x 图标；同时缺可访问名，见 §7.60                          |

空态 pager **不属于本条**：它虽然按钮盒仍是 12/20×16，但 `.agent-home-pager-dot::after { inset: -8px }` 仍存在，独占命中格按 §7.12 的 28/36×32 设计保留。

**建议修复**：可见图标尺寸不一定要变，但上述操作统一用 Gen2 icon-button 或 transparent pseudo hit-area / wrapper，把真实指针目标扩到 ≥24px（优先 28–32px）；resize 仍保留 separator + 方向键语义。

---

### 7.45 §7.31 回看：对象型 dirty-state 用 JSON.stringify，会把“值相同、键顺序不同”判成未保存修改（P2 · 🟠 开放 2026-09-23）

`fb10342` 给 8 处保存按钮补 dirty 语义，其中 `AppExecutionPolicySettings.vue` 当前使用：

`JSON.stringify(draft.value) !== JSON.stringify(view.value?.overrides ?? {})`

但该页面的 `toggleOverride()` 会先 `delete next[key]`，再次启用时再用 spread 把同一个 key 加回对象尾部。用户可以：

1. 初始 overrides 为 `{ maxRunSteps, toolTimeoutSeconds, contextProfile }`；
2. 关闭 `maxRunSteps` override；
3. 再启用并恢复到原值。

此时语义内容完全一致，但插入顺序变成 `{ toolTimeoutSeconds, contextProfile, maxRunSteps }`，`JSON.stringify` 字符串不同，Save 会错误进入 dirty/primary 状态。

**建议修复**：对象 map 用排序后的 entries / 稳定 stringify，或按允许字段逐一比较值；不要把 JS insertion order 当业务变更。

---

### 7.46 §7.39 回看：4 条 state-commit 失败结果把 userSummary 放进了模型 text，而不是 ledger sibling（P1 · 🟠 开放 2026-09-23）

§7.39 的核心边界是：模型只看英文证据 `payload.text`，用户本地化摘要走 ledger sibling `payload.userSummary`。普通工具结果通过 `toolResultLedgerPayload()` 正确实现了这一点，但 `2564ec7` 同批改的 4 类 state-commit 路径没有走 helper，而是把 `userSummary` **JSON.stringify 进 text 本体**：

- `approval-transitions.ts`：`APPROVAL_DENIED`；
- `approval-transitions.ts`：`APPROVAL_EXPIRED`；
- `input-transitions.ts`：`APPROVAL_SUPERSEDED`；
- `run-transitions.ts`：`RUN_CANCELLED_BEFORE_TOOL_EXECUTION`。

这带来两个同时发生的错误：

1. `ConversationMessage.vue` 只从 ledger payload sibling 读 `payload.userSummary`，因此这 4 条读不到本地化摘要，仍回退到 text 里的英文 `summary`；
2. 模型证据 text 反而包含 `agent.conversation.toolSummary.*` i18n key，违背“模型侧结构上看不到 userSummary”的隔离目标。

**建议修复**：这 4 条全部构造标准 `ToolResult` 后走 `toolResultLedgerPayload()`，或至少显式把 `userSummary` 提到 ledger payload sibling、从 text JSON 删除；加断言同时验证“UI sibling 有 key”和“解析 text 后无 userSummary”。

---

### 7.47 §2.5 回看：Run 已进入 cancelling 时 Send 仍可用，后端会必然拒绝（P1 · 🟠 开放 2026-09-23）

`d9c7ed4` 正确把 Send 与 Stop 拆成两个按钮，但状态边界漏了 `cancelling`：

- `AgentConversation.vue` 把 `cancelling` 算入 `activeRun`，只让 Stop 在 cancelling 时转圈并禁用；
- 父层 `AgentAppSurface.vue` 的 `canSend` / `send()` 使用包含 `cancelling` 的 `nonTerminal`，因此非空草稿时 Send 仍可点击；
- backend `input-transitions.ts` 明确写着 `row.status === 'cancelling' -> RUN_NOT_ACCEPTING_INPUT`。

所以用户点击取消后、Run 尚未最终进入 `cancelled` 的窗口里，发送新输入会发出一个**后端必拒绝**的请求并产生错误反馈。Slash-command 的 active-run 判断反而已经排除了 cancelling，两个入口语义不一致。

**建议修复**：把 “accepting input” 从 `nonTerminal` 独立成集合 / helper，至少排除 `cancelling`；Send disabled hint 显示“正在停止当前 Run”。

---

### 7.48 §2.3 回看：11px 阅读文字 floor 被 8166c89 重新打穿（P1 · 🟠 开放 2026-09-23）

`5364e2b` / `e4d86e2` 刚把真实阅读文本提升到 ≥11px，随后：

- `3fddac2` 把 Hub 模型 option hint 恢复到 10px；
- `8166c89` 又明确改成 **9px**；
- 当前 `AgentAppSurface.vue` 的 `modelOptionHint(option)` 仍渲染为 `<span class="... text-[9px] ...">`。

全量扫 `features/agent/**/*.vue` 的非 icon 文本元素后，当前确认的 `text-[9px]/text-[10px]` 阅读文本就是这一处；其余 9/10px 命中主要是图标 / badge。

因此 §2.3 “无阅读文字低于 11px”应重新开放这一个回归点。

---

### 7.49 §7.14-c i18n 回看：源码中的英文 UI literal 仍有漏网（P2 · 🟠 开放 2026-09-23）

当时的硬编码扫描主要以 CJK / 字典值为抓手，漏掉了**源码里的英文用户文案**。`97560f1` 已把 ACP Integration 的 create/update/delete 成功 toast 改为 i18n key，但未知错误 fallback 仍保留 `formatAgentApiError(cause, 'ACP request failed.')`；同一提交又在 `BrowserRuntimeSettings.submitAddTarget()` 新增了 `ID "${id}" already exists.` 英文校验文案。也就是说 §7.49 仍开放，只是当前漏网点发生了变化。

第二遍 literal / accessibility 文案扫描又确认多处遗漏：

- `ModelProviderSettings.vue` 的测试结果能力 badge 仍直接写死 **`Tools`**；同一行的 Image / File badge 已经走 `$t(...)`，因此这不是产品名 / 协议名；
- 同一文件的 Provider 拉取模型下拉把 registry owner 直接拼成 `owned by ${m.ownedBy}`，在 zh-CN / ja-JP 弹窗里仍会出现英文描述；
- `AppManagementSettings.targetLabel()` 把 capability target `workspace` 直接显示成 **`Workspace`**（`SSH` 作为协议缩写可保留）；
- `quantity-format.ts` 的 token 数量精确反馈直接拼接 `${parsed.toLocaleString()} Tokens`；同文件 bytes / seconds 已通过 label helper 本地化，只有 token 单位仍写死英文。
- `AgentSettingsPanel.vue` 的二级分组 `<nav>` 写成 `:aria-label="'agent.settings.navigation'"`，没有调用 `t()`；三份 Agent locale 实际都已有 `settings.navigation` 翻译，因此屏幕阅读器会读出原始 dotted key，而不是本地化的分区名称。

这些都会在 zh-CN / ja-JP 界面里形成英文孤岛。

**建议修复**：把当前 ACP error fallback、Browser duplicate-ID 校验、`Tools` badge、`owned by` 描述、`workspace` target label 与 token 单位一起补进三语字典/label helper，并把 Agent 子导航 `aria-label` 改成 `t('agent.settings.navigation')`；i18n 门禁后续增加“用户反馈 API / template text node / 返回 literal 的 label helper”扫描，而不只查硬编码 CJK。

---

### 7.50 §7.22 已知残留提升：跨标签页修改 Provider / Settings，另一个 tab 的 Hub 与 Settings 都不刷新（P2 · 🟠 开放 2026-09-23）

§7.22 行 2142 已经记录“未覆盖：跨标签页仍不推送”，但顶部总状态把 §7.22 整体列为关闭。本轮复核当前代码后确认该缺口仍存在：

- `configuration-changed` 只存在于进程内 `agentHostEvents`，设置写成功后只通知**当前 tab** 的 `AgentAppSurface`；
- `AgentSurfaceHost` 的 BroadcastChannel 会向其它 tab 发送 `host.changed`，但接收端只刷新 host summary；没有转发 `configuration-changed`；
- 因此 tab A 禁用 provider / 改模型配置后，tab B 已打开的 Hub 会继续持有旧的 definitions/providers/settings，直到自身重载 / 重挂 surface。
- `AgentSettingsPanel` 自身也没有订阅 `agentHostEvents` 或 BroadcastChannel。tab B 若正停在 Agent Settings，tab A 改 provider/app/settings/denylist 后，B 的 `settings/apps/providers/denylist` 与 revision/version 全部保持旧值；后续 Save 还会继续携带 stale revision/version，进一步落入 §7.82 的持续 conflict。

**建议修复**：给 BroadcastChannel / 后端 host event 增加可区分的 `configuration.changed / apps.changed / authorization.changed` 等 sourceType；另一 tab 收到后不仅刷新 host summary/run configuration，也要让 SettingsPanel 做 generation-safe authoritative reload。若本地卡片 dirty，必须和 §7.54 一样保留草稿、只更新 baseline/version，不能用“跨 tab 刷新”再制造草稿丢失。

---

### 7.51 Gen2 foundation 进入主路径后仍没有正确 ESLint 配置（P2 · 🟠 开放 2026-09-23）

§7.28 已记录 “`foundation/ui/**` 不在 eslint flat-config 的 files 范围”，本轮 66 commit 复核后这个问题的重要性已上升：`a2a9e94` 以及后续提交让 `UiButton / UiSelect / UiPopover / UiEmptyState / UiInfoHint` 成为 Agent 设置和 Hub 的公共基础层。

当前 `eslint.config.mjs` 仍只为 `features/agent/**/*.ts|vue` 等路径配置 Vue/TS parser。实测：

`pnpm exec eslint packages/frontend/src/foundation/ui/UiSelect.vue`

直接报 `Parsing error: Unexpected token {`，不是规则通过。

**建议修复**：把 `packages/frontend/src/foundation/ui/**/*.{ts,vue}` 纳入同一 Vue/TS lint 配置（或抽成 frontend shared glob），然后先清现有告警再把它加入 `lint:agent` / CI。

---

### 7.52 历史 commit 对照矩阵：`A..B` 66/66 + 左边界基线单独复核（2026-09-23）

原复核范围写作 `b0d7b22..862a458`，`git rev-list --count` = **66**；注意 Git 的 `A..B` 语义**不包含左边界 A 本身**。收尾机械校验已把左边界 `b0d7b22` 也单独补审：它只修改 `doc/problem.md`（31+/29-），不含产品行为。故历史段若按“包含 `b0d7b22` 本身”统计为 **67/67**；再加 `862a458..97560f1` 的 6 个增量提交，当前从 `b0d7b22` 到 HEAD 共 **73/73** 都有 commit→Problem/无产品行为结论。判断基准始终是 committed HEAD；当前并行未提交 Settings 重构不计入 commit 责任归因。

| Commit    | 主题                                                                                     | 复核结论                                                                                                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `b0d7b22` | docs(agent): close non-ui review items                                                   | 📝 左边界基线提交；仅 `doc/problem.md`（31+/29-），无产品代码行为；收尾机械校验补入以消除 `A..B` 左开区间歧义                                                                                                                                        |
| `a2a9e94` | feat(ui): add Gen2 foundation primitives                                                 | ⚠ 见 §7.51                                                                                                                                                                                                                                            |
| `af405e9` | fix(agent): close composer and popover layout issues                                     | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `80ff943` | fix(agent): enforce hub modal focus boundary                                             | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `191aba4` | fix(agent): close card and spacing utility gaps                                          | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `9b3f703` | fix(agent): restore hub focus after close                                                | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `48ecb85` | docs(agent): close verified UI regressions                                               | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `770dc31` | fix(agent): unify model settings popover                                                 | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `493b356` | docs(agent): close stale UI root causes                                                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `663f26d` | feat(agent): unify model selection ux                                                    | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `54003ba` | docs(agent): consolidate ui closure status                                               | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `e7442ee` | fix(agent): align default model combobox text background                                 | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `2210d07` | fix(agent): make hub backdrop a true no-op                                               | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `5364e2b` | fix(agent): raise real small text to an 11px floor                                       | ✅ 当时闭环成立；后续回归见 §7.48                                                                                                                                                                                                                     |
| `e4d86e2` | fix(agent): finish the 11px reading-text floor                                           | ✅ 当时闭环成立；后续回归见 §7.48                                                                                                                                                                                                                     |
| `8a3bc76` | fix(agent): finish the hit-target floor for 2.4                                          | ⚠ 见 §7.44                                                                                                                                                                                                                                            |
| `1e92d78` | fix(agent): route hardcoded palette through theme tokens                                 | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `bdee90b` | fix(ui): let icon color utilities win over the global icon rule                          | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `d9c7ed4` | fix(agent): split composer send from run stop (2.5)                                      | ⚠ 见 §7.47                                                                                                                                                                                                                                            |
| `1ae8e43` | fix(agent): make the empty-state bento rotation interruptible (2.6)                      | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `d6293b9` | fix(agent): translate the untranslated dictionary entries (7.15-a)                       | ⚠ 见 §7.49                                                                                                                                                                                                                                            |
| `da1aa01` | fix(agent): explain workspace runtime unavailability (7.15-b)                            | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `05705b8` | fix(agent): localize the remaining raw enums (1.4)                                       | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `e66c4c1` | fix(agent): clean up the approval card details (7.14-b)                                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `2959d36` | fix(agent): make the disabled send state readable (7.17-c)                               | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `761a970` | fix(agent): give the hub window keyboard geometry (2.10)                                 | ⚠ 键盘路径已修，16px 命中区仍在；见 §7.44                                                                                                                                                                                                             |
| `5986bfb` | i18n(agent): localize the settings numbers and small panels (7.14-c, part 1)             | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `e79cda3` | i18n(agent): finish the hardcoded text cleanup (7.14-c, part 2)                          | ⚠ 见 §7.49                                                                                                                                                                                                                                            |
| `ded8071` | fix(agent): make the task rail reachable without a pointer (7.14-b)                      | ⚠ 见 §7.43                                                                                                                                                                                                                                            |
| `9829d0d` | fix(agent): give the empty-state pager real hit targets (7.12)                           | ✅ 伪元素命中区仍在，闭环成立                                                                                                                                                                                                                         |
| `0a467b6` | fix(agent): make the thread-list zoom discoverable and resettable (7.13-d)               | ⚠ 见 §7.43                                                                                                                                                                                                                                            |
| `d81c7e0` | refactor(agent): converge the settings primary actions on the Gen2 button (6.2, batch 1) | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `7855cdc` | refactor(agent): converge the settings secondary, danger and icon actions (6.2, batch 2) | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `b3e397a` | refactor(agent): converge the settings checkboxes on the Gen2 control (6.3/6.7, batch 3) | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `d2056c5` | revert(agent): restore the true glass popover and box-free model options                 | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `3fddac2` | fix(agent): restore the 10px option hint in the hub model popover                        | ✅ 后续被 `8166c89` 改到 9px；见 §7.48                                                                                                                                                                                                                |
| `8166c89` | style(agent): shrink the hub model popover hint to 9px                                   | 🟠 直接重新引入 §2.3；见 §7.48                                                                                                                                                                                                                        |
| `64953ed` | fix(agent): refresh the open surface after provider and settings writes                  | ⚠ 同 tab 已修，跨 tab 残留；见 §7.50                                                                                                                                                                                                                  |
| `2b60702` | style(agent): lift the popover glass to 6px blur                                         | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `0a4b6c8` | refactor(ui): make the glass recipe a shared Gen2 surface                                | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `d7abf63` | fix(agent): explain why the steady-state settings buttons are disabled                   | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `2893c88` | feat(ui): add UiInfoHint and slim the Agent feature card                                 | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `cb13a89` | refactor(agent): move card descriptions behind the shared info hint                      | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `ef21441` | refactor(agent): audit the hub hint text and fold the popover headers                    | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `f820e16` | fix(agent): stop the hub window from squeezing out the transcript                        | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `30fa0ed` | feat(agent): let the thread sidebar collapse and remember the layout                     | 🟠 见 §7.42                                                                                                                                                                                                                                           |
| `950a235` | feat(agent): double click the hub title bar to maximise                                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `8516cc9` | style(agent): move the feature state pill next to its title                              | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `b9978f1` | fix(agent): animate the docked thread sidebar instead of snapping                        | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `833cb9b` | style(agent): align the settings group pills with the Gen2 control spec                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `81d0987` | refactor(agent): flatten the settings nesting to a single card                           | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `6b1d3f2` | fix(agent): place the composer popovers before they paint                                | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `308f653` | refactor(agent): give the settings panel a section rail on wide screens                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `5617668` | feat(ui): add a Gen2 empty-state primitive and adopt it in agent settings                | ✅ 功能闭环；lint 覆盖缺口统一见 §7.51                                                                                                                                                                                                                |
| `606c5c6` | style(agent): make the settings header summary read as stats, not debug output           | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `2128787` | style(agent): calm the settings header bands and action clusters                         | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `fb10342` | style(agent): let settings save buttons follow the dirty state                           | 🟠 见 §7.45                                                                                                                                                                                                                                           |
| `d6fcb42` | refactor(agent): move the settings dropdowns onto the Gen2 select                        | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `606fe71` | style(agent): give the quantity unit pills a 24px hit target                             | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `55fac86` | fix(agent): make the model removal buttons and batch confirm consistent                  | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `4d57ecd` | refactor(agent): finish the select migration in the workspace runtime                    | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `ddc887b` | fix(agent): stop dumping raw ledger payloads in the task rail                            | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `441810d` | fix(agent): give the error banner a failure domain and a retry action                    | 🟠 见 §7.41                                                                                                                                                                                                                                           |
| `3016ffb` | fix(agent): make the launcher drag deliberate and measure thread row height              | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `2564ec7` | fix(agent): localize tool-result summaries behind a user-only projection                 | 🟠 见 §7.46                                                                                                                                                                                                                                           |
| `63ea08b` | chore(agent): gate i18n dictionaries on key reachability                                 | ✅ committed HEAD 复核成立；未提交设置重构不计入历史归因                                                                                                                                                                                              |
| `862a458` | docs(agent): record the giant-file review decision with measurements                     | ✅ 当前 HEAD 未发现新增可证明回归                                                                                                                                                                                                                     |
| `06f5e0f` | fix(ssh): contain client socket errors                                                   | ⚠ 补强 direct/proxy/final client error owner；jump intermediate 遗漏见 §7.117，完整 ownership 修复已在 `97560f1` 提交                                                                                                                                 |
| `58c4d5e` | docs(agent): record ui regressions from history review                                   | 📝 纯文档提交；记录历史复核结论，不新增产品行为                                                                                                                                                                                                       |
| `2067c28` | docs(agent): complete 66-commit problem audit                                            | 📝 纯文档提交；完成 66/66 第一遍矩阵                                                                                                                                                                                                                  |
| `a6371f9` | feat(agent): optimize agent settings layout and clean up redundant hints                 | 🟠 endpoint discovery 关联 §7.83 / §7.138；Launcher 回归 §7.137；Settings deep-link §7.142；隐藏分组 eager mount §7.143；Agent panel `aria-controls` 回归 §7.144；i18n 门禁绕过 §7.146；mobile 总览误文案 §7.152；Provider drawer 默认模型错配 §7.153 |
| `af54360` | feat(agent): optimize model select width, card boundaries and disable default popups     | 🟠 默认模型 optimistic identity 回归见 §7.136                                                                                                                                                                                                         |
| `97560f1` | feat(agent): optimize add button widths and responsive settings navigation               | ✅ 提交 §7.117 SSH/Runner/Browser listener ownership 修复；🟠 新回归见 §7.147–§7.151；同时继续扩大已重开 Launcher §7.137（删除可见 reset）；并保留 §7.136–§7.146 中尚未关闭项                                                                         |

**汇总**：

- `b0d7b22..862a458` 的 66/66（不含左边界）均完成路径与当前实现反查，左边界 `b0d7b22` 也已单独补审；`862a458..97560f1` 后续增量 6/6 已完成 commit→Problem 对照，因此 `b0d7b22`（含）到当前 HEAD 合计 **73/73** 有明确映射；
- 第一遍按 commit 的可证明开放项见 §7.41–§7.51；后续跨切面交叉审计与增量 commit 复核已继续扩展到 §7.53–§7.153；
- 表中 “✅” 只表示“逐 commit 第一遍没有找到达到可证明标准的新回归”，**不覆盖第二遍组合竞态 / 跨组件问题**，也不是替代完整 E2E；
- `63ea08b` 当时建立的 §7.40 dead-key 门禁在其提交点成立；但 `a6371f9` 已删除真实 `agent.settings.groups.plugins` 导航 consumer，并用未消费的 `_legacyPluginGroupKey` 字面量让旧 key 继续通过可达性扫描，当前回归见 §7.146。

### 7.53 per-App selector 的异步加载可把 App A 配置写到 App B（P1 · ✅ 已修复 2026-09-24）

第二遍按“selector → async load → shared draft → save”反查时，确认两处相同的跨对象竞态。

**Execution Policy：**

1. `AppExecutionPolicySettings.vue` 的 `watch(selectedAppId, load)` 直接发 `appExecutionPolicy(selectedAppId.value)`；
2. 请求没有捕获 appId，也没有 generation；返回后无条件写共享 `view / draft`；
3. selector 在 loading 时仍可继续切 App；
4. Save 使用的是**当前** `selectedAppId.value`，但 payload/version 来自共享 `draft / view`。

因此 GET(A) → 切 B → GET(B) → B 先回 → A 后回 时，画面 selector 已是 B，但 draft/version 会回退成 A。随后 Save 调用 `replaceAppExecutionPolicy(B, draftOfA, versionOfA)`。

backend `agent-execution-policy.service.ts` 的 version 是**每个 app 独立 storage** 的 `stored?.version ?? 0`。A/B 都处于 version 0 很常见，所以这不是“必然被 optimistic conflict 挡住”的 UI 假象：版本恰好相同时，A 的 overrides 可以被成功写到 B。

**Subagent Profiles 同样成立**：`SubagentSettings.loadProfiles()` 并发读取 selected App 的 subagent settings + grants，返回后无条件覆盖共享 `profileSettings / capabilityOptions / profileBaseline`；`saveProfiles()` 再用当前 selector 的 appId + 共享 profile/version。backend `subagent-policy.ts` 同样是 per-app version，初始值也是 0。

项目里已有正确对照：`MemorySettings.loadMemories()` 会同时捕获 generation + appId + status，`AppManagementSettings.loadGrant(appId)` 也按 appId 维护 generation。

**建议修复**：两处统一采用“captured appId + request generation”，只有仍为当前 selector 的最新请求才能提交；保存时把 loaded appId 与 draft/version 绑定，不要用当前 selector 拼接另一代响应。

**修复（2026-09-24）**：`AppExecutionPolicySettings` 新增 `loadedAppId + loadGeneration`，`SubagentSettings` 新增 `profileAppId + profileLoadGeneration`。两处 load 都只允许“仍为当前 selector 的最新 generation”提交状态；save 也先验证已加载 appId 与当前 selector 一致，并捕获 appId / version / payload，切 App 后旧 mutation 返回不会回写新 App。针对性 Prettier、ESLint、`git diff --check` 与 frontend `vue-tsc --noEmit` 均通过；WebCodex 运行环境仅报告仓库既有的 Node 22 与 `engines.node >=24` warning。

---

### 7.54 全局 settings revision 会静默覆盖其它卡片的未保存草稿（P1 · ✅ 已修复 2026-09-24）

Agent settings 的 `settings.revision` 是整份设置的全局 revision；但多个卡片把它当成“我的 section 已经被保存”的信号，只要 revision 变化就无条件从 props 重建本地 draft：

- `BudgetContextSettings` → `syncFromProps()`；
- `PerformanceSettings` → 重写 runtimes/modelCalls；
- `StorageArtifactSettings` → 重建 storage draft；
- `HardLimitsSettings` → `reset()`；
- `BrowserRuntimeSettings` → `sync()`；
- `AcpRuntimeSettings` → `syncProfiles()`；
- `SubagentSettings` → 重建 global subagent draft；
- `WorkspaceRuntimeSettings` → `syncSelection()`。

同一类“共享父状态变化 → 无条件覆盖局部 dirty draft”还存在于 `AppManagementSettings`：它 watch **所有 App 的 `id@version#stateVersion` 拼串**，任一 App enabled/state/version 变化都会对**所有 App**调用 `loadGrant(app.id)`；而 `loadGrant()` 在请求成功后直接把 `drafts[appId]` 重置成服务端 grants，没有先看 `grantChanged(appId)`。因此用户正在编辑 App A 的 capability scope 时，只要切换 App B 的 enabled 状态，A 的未保存授权草稿也会被静默清掉。

committed HEAD 经 `a6371f9` 后已移除 `visitedGroups` 的惰性挂载门槛，四个分组都常驻，只用 `v-show` 切可见性；因此隐藏卡片从首次进入 Agent Settings 起就保持挂载。于是可稳定出现：

1. 用户在卡 A 改几个值，不保存；
2. 切到同组或另一个已经访问过的卡 B 并保存；
3. B 的 `patchSettings` 返回新全局 revision；
4. A 的 revision watcher 立即把本地未保存 draft 覆盖掉，且没有确认 / dirty protection。

这是**静默数据丢失**，不是仅仅保存按钮样式问题。

**建议修复**：revision 更新时仅在本地 draft clean 时自动同步；dirty 时保留用户草稿并标记 remote baseline changed，或者引入 section-specific baseline/version / 自己保存成功后的显式 sync。

**修复（2026-09-24）**：8 个 Settings 草稿面板都新增/显式维护“上一次已接受的 baseline”，dirty 判断不再直接对新 props 做比较；全局 revision 变化时，只有本地仍 clean，或 authoritative props 已经与当前 draft 相等（即自己的保存已经落地）才会重建本地草稿。`AppManagementSettings.loadGrant()` 则在自动 reload 时先以旧 `grantViews.policyRevision` 判断本地 grant draft 是否 dirty：dirty 且新远端并不等于本地 draft 时，draft 与旧 baseline 一并保留，确保随后保存仍携带旧 revision 并由后端冲突保护；保存失败后的显式恢复才使用 `forceDraftSync` 丢弃草稿。针对 9 个组件的 Prettier / ESLint / `git diff --check`、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p754-dist` 输出目录通过（默认 `dist` 目录此前存在环境权限问题，因此不写仓库产物）。

---

### 7.55 authenticated=true 下 userId A→B 时 Agent surface/session 不清理（P1 · ✅ 已修复 2026-09-24）

`AgentSurfaceHost.vue` 同时 watch `isAuthenticated + user.id`，但逻辑只有两支：

- authenticated + userId：直接设置 `activeUserId=userId` → `restoreForUser` → refresh/start；
- unauthenticated：才会 `summary=null`、`agentWindowManager.reset()`、`agentSurfaceSession.disposeSession()`。

因此 **A→B 且两边始终 authenticated=true** 时不会走清理分支。

这不是不可达理论路径：`App.vue` 自己就单独 watch `auth.user.id`，并在 `previousUserId !== userId` 且两者都非 null 时调用 `resetAuthenticatedUiState()`；说明产品明确考虑 true→true 的用户替换。与此同时 `<AgentSurfaceHost v-if="auth.isAuthenticated.value" />` 没有按 userId key，组件不会因此重建。

影响：

- B 的 summary 请求返回前，A 的 `summary` 仍可继续驱动 Hub/Launcher；
- `surface-session.ts` 的 module-level Map 只按 appId 存 threadId / draft / model / reasoning / execution/approval mode / connections / environment；A/B 都有 `nexus.agent` 时会直接撞 key；
- 旧 `AgentAppSurface` 的普通 HTTP 请求也不会因为 user 切换自动 abort（见 §7.56）。

**建议修复**：显式识别 `activeUserId !== userId`，先持久化旧用户布局、停止旧 stream/请求 generation、清 summary/window/surface session，再 attach 新用户；或把 AgentSurfaceHost 直接 key 到 userId 并确保所有 in-flight 请求有 user generation guard。

**修复（2026-09-24）**：`AgentSurfaceHost` 新增统一 `detachUserScopedState()`，在 authenticated 的 `activeUserId !== userId` 分支中先对旧用户执行：递增 `refreshGeneration`、按旧 userId 持久化 layout、abort Host event stream、清 `summary`、清 Agent CSRF cache、reset window manager、`agentSurfaceSession.disposeSession()`；完成后才把 `activeUserId` 切到新用户并 restore/refresh/start。unauthenticated 与 host unmount 也复用同一 teardown，避免生命周期分支再次漂移。针对性 Prettier / ESLint / `git diff --check`、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p755-dist` 通过。旧 `AgentAppSurface` 普通 HTTP 请求自身的 generation/abort 缺口不在本条伪装关闭，继续由紧邻 §7.56 修复。

---

### 7.56 AgentAppSurface 的 configuration / authorization refresh 缺 generation，旧响应可覆盖新状态（P1 · ✅ 已修复 2026-09-24）

项目其它刷新路径已经知道要防 stale response（`AgentSurfaceHost.refreshGeneration`、thread list generation、Memory generation），但 `AgentAppSurface` 两组关键刷新仍没有：

**`loadRunConfiguration()`：**

- 同时拉 definitions / providers / settings / connections / runtime availability / denylist；
- 第一批 Promise.all 回来后立刻写多个 refs；
- 然后**第二阶段**再 await workspace runtime catalog；
- 最后用本轮局部 `settings` + 当时全局 `modelOptions` 计算并写 selected model/reasoning/environment，且同步写进 `agentSurfaceSession`。

`configuration-changed` 每次设置写成功都会直接启动一轮新的 `loadRunConfiguration()`，没有串行化 / generation。两轮交叉时，旧轮可以最后覆盖新轮；第二阶段 catalog await 还允许出现“较新的 providers + 较旧 settings/default selection”这类混合代际。

**Authorization 也有双 writer**：`loadRunConfiguration()` 写 `targetDenylist`，`refreshConnectionsAndAuthorization()` 在 focus / authorization event 时也写同一个 ref，两边都没有 generation。

**卸载边界同样不完整**：`facade.dispose()` 只中止 run stream / snapshot refresh；`definitions/providers/settings/listThreads` 等普通 HTTP 都是直接 `agentApi` 调用。组件卸载 / session dispose 后，旧 configuration 请求仍可能完成并再次写 `agentSurfaceSession`。

**建议修复**：configuration 与 authorization 分别引入 generation/AbortController；所有数据先拉进 locals（包含 runtime catalog），只有 app/user/generation 仍匹配时一次性 commit；unmount/user switch 时显式 invalidate generation。

**修复（2026-09-24）**：`AgentAppSurface` 新增 `configurationGeneration`、`authorizationGeneration` 与 `surfaceDisposed`。`loadRunConfiguration()` 不再在第一批 Promise 完成时提前写 definitions/providers/settings/denylist，而是把 runtime catalog 第二阶段也先拉进局部变量，确认仍是最新 configuration generation 后再一次性提交全部配置与 model/reasoning/environment/session 派生状态；其中 denylist 只有本轮同时仍是最新 authorization generation 才能写入。`refreshConnectionsAndAuthorization()` 同样按 authorization generation 提交，解决 focus / authorization event / configuration 三个 writer 的跨序覆盖。unmount 会同时标记 disposed 并递增两类 generation，旧 HTTP 即使底层没有被真正 abort，完成后也只能 no-op，不能再写已卸载 Surface 或 `agentSurfaceSession`。针对性 Prettier / ESLint / `git diff --check`、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p756-dist` 通过（`✓ built in 3.25s`）。

---

### 7.57 UiInfoHint 与 disabled-reason 都是 title-only，键盘 / 触屏缺可见说明（P2 · ✅ 已修复 2026-09-24）

§7.24 把大量长说明迁入 `UiInfoHint` 后，组件当前实现是：

- `span tabindex="0" role="note"`；
- 文案只放在 `title` 与 `aria-label`；
- CSS 的 hover / focus-visible **只改颜色和 focus ring**，没有 tooltip / popover / visible description。

当前 Agent 有 **21 处** `<UiInfoHint>`。Screen reader 可以读 aria-label，鼠标用户可能看到浏览器原生 title，但**sighted keyboard 用户把焦点移到 ⓘ 后没有任何可见说明，touch 也没有稳定的 title 交互**。

同类问题还出现在 §7.13-e / §7.31 的“禁用必须给理由”：理由全部放在 disabled button 自己的 `title`。Gen2 `UiButton` 最终渲染原生 `<button disabled>`，禁用按钮不进入正常 Tab 顺序，所以 keyboard-only 用户根本无法聚焦它读取原因。

**建议修复**：`UiInfoHint` 做成真实 tooltip/popover，至少支持 hover + focus + click/tap；禁用原因放到可聚焦 wrapper/tooltip trigger 或邻接可见说明上，不要把可发现性押在 disabled element 的 native title。

**修复（2026-09-24）**：复核当前 HEAD 时，`UiInfoHint` 本体已经使用 Reka `TooltipRoot/Trigger/Content`，并提供 `tabindex=0`、Enter/Space 与 click/tap 切换，因此本问题的“长说明 title-only”半边已由后续实现实际关闭。本轮继续收口剩余 disabled-reason：Subagent（2 处）、Execution Policy、Performance、Storage、Memory Import、Budget、Hard Limits、Plugin Repository 共 9 处不再把解释塞进 disabled `UiButton` 的 `title`，而是在按钮旁条件渲染可聚焦/可点击的 `UiInfoHint`；原 disabled 条件与 mutation 行为保持不变。全文检索确认 Agent settings 已无 `disabledReason` 的 `:title` 绑定；针对 8 个组件的 Prettier / ESLint / `git diff --check`、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p757-dist` 通过（`✓ built in 3.36s`）。

---

### 7.58 两处设置错误处理绕过 formatAgentApiError，机器码重新漏到 UI（P2 · ✅ 已修复 2026-09-24）

§7.37 已明确建立边界：稳定机器码是 diagnostics，不是 UI copy；`agent-api-error.ts` 的 `formatAgentApiError()` 会过滤 SCREAMING_SNAKE 并退回本地化 fallback。

但当前只有两类 settings 路径仍直接：

`cause instanceof Error ? cause.message : '...FAILED'`

- `AppExecutionPolicySettings.vue` 的 load / save；
- `SubagentSettings.vue` 的 loadProfiles / saveProfiles。

Agent HTTP client 会统一把请求异常转成 `AgentApiError`，所以这两处确实会把 `SETTINGS_VERSION_CONFLICT`、`SUBAGENT_MODEL_UNAVAILABLE` 等稳定 code/message 原样交给 toast，绕过已有过滤器。

第二遍全 Agent 扫 `error.value = 'SCREAMING_SNAKE'` 又找到一个更直接的真阳性：`ArtifactPicker.toggle()` 在附件达到 10 个时直接执行 `error.value = 'ARTIFACT_REF_LIMIT'`，而 panel 模板原样渲染 `{{ error }}`。这条甚至不经过 HTTP/error formatter。

后续 terminal 生命周期复核又确认一组直接透传：`agent-workspace-terminal-channel.ts` 会 emit `WORKSPACE_TERMINAL_PROTOCOL_INVALID / ATTACH_FAILED / RECONNECT_EXHAUSTED / INPUT_QUEUE_FULL` 等机器码；通用 `TerminalView` 只是原样转发，`AgentWorkspaceTerminal.vue` 再直接渲染字符串（见 §7.72）。

**建议修复**：两处 settings 统一走 `formatAgentApiError(cause, t(...requestFailed))`；ArtifactPicker 与 Agent Workspace Terminal 的本地状态码统一映射到 i18n 文案，原始 code 只留日志/title/debug。

**修复（2026-09-24）**：`AppExecutionPolicySettings` 与 `SubagentSettings` 的 load/save catch 统一改为 `formatAgentApiError(cause, t('agent.operations.requestFailed'))`，`operationFeedback.notifyError` 仍携带原始 `cause`，因此诊断信息不丢但稳定机器码不会直接作为 UI copy。`ArtifactPicker` 的本地 `ARTIFACT_REF_LIMIT` 改为 `agent.attachments.limitReached`，并在 en/zh/ja 三套字典提供“最多 {count} 个附件”的本地化文案。§7.72 的 Workspace Terminal 机器码属于独立生命周期/通道问题，继续由 §7.72 跟踪，本条不提前关闭。目标源码检索确认三条旧机器码/直透表达式均已消失；Prettier / ESLint / `git diff --check`、Agent i18n parity/dead-key 门禁、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p758-dist` 通过（`✓ built in 3.19s`）。

---

### 7.59 Launcher 在 viewport 缩小时不会重新 clamp，可直接跑到屏外（P2 · ✅ 已修复 2026-09-24）

Launcher 位置以 `{ right, bottom }` 保存：

- 拖动时 `AgentLauncher.clamp()` 会按**当时 viewport**限制；
- restore / `setLauncherPosition()` 也会 clamp；
- 但窗口 resize 时 `AgentHubWindow.handleResize()` 只调用 `agentWindowManager.clamp()`，该函数只处理 Hub bounds，**没有重算 launcherPosition**。

例如宽屏下把 launcher 拖到较大的 `right`（当时合法），随后把浏览器缩窄；CSS 仍按旧 right 定位，40px launcher 的 left 可以变成负数而完全不可见。“重置位置”按钮又和 launcher 同一个 fixed 容器，launcher 出屏后也无法点击它恢复。

**建议修复**：给 window-manager 增加 `clampLauncherPosition()` 并在 viewport resize / restore 后统一调用；最好同时加窄屏→宽屏回归，确保用户偏好与可见性兼得。

**修复（2026-09-24）**：`window-manager.ts` 新增独立 `preferredLauncherPosition` 与 `clampLauncherPosition()`：`setLauncherPosition()` 只有在用户真正设置/拖动时更新 preferred，再把当前 render state clamp 到 viewport；普通 `clamp()` 与专用 `clampLauncherPosition()` 都只从 preferred 重算 render state。持久化改存 preferred，restore 仍经统一 setter clamp；`reset()` 同时重置 preferred/render，避免跨用户残留。`AgentLauncher` 自身在 mount 时立即 clamp，并监听 `window.resize`，因此 Hub 即使关闭也能保证 launcher 留在屏内；viewport 重新放宽后会自动回到原 preferred，而不是永久记住临时窄屏 clamp。第一次 `vue-tsc` 暴露 `as const` 导致 preferred 被推成 `{right:22,bottom:24}` 字面量类型，已改为显式 number position 后重跑；最终 Prettier / ESLint / `git diff --check`、frontend `vue-tsc --noEmit` 均通过，Vite production build 使用 `/tmp/nexus-p759-dist` 通过（`✓ built in 3.30s`）。

---

### 7.60 条件态 icon button 漏可访问名，且三处 label 内嵌第二个 labelable control（P2 · ✅ 已修复 2026-09-24）

对全部 plain `<button>` 做“无 aria-label / title / 可见文字”的静态枚举后，先收敛到 **2 个 icon-button 真阳性**：

1. `AgentThreadSidebar.vue` 搜索框的清空 x：icon 是 `aria-hidden`，button 无 `aria-label/title/text`；
2. `ModelProviderSettings.vue` API Key 显示/隐藏 eye：button 同样无可访问名。

随后把扫描范围扩到 Reka/Gen2 `role=checkbox`，又确认 **3 个 unnamed checkbox**：

3. `AppManagementSettings.vue` capability grant 主复选框；
4. 同文件 target scope（Workspace/SSH）复选框；
5. `SafetyNetworkSettings.vue` 每条 Connection 的 block/allow 复选框。

`UiCheckbox` 只是把 attrs 透传到 `CheckboxRoot`，不会自动从旁边 sibling 文本生成 accessible name；这三处既没有 `aria-label/aria-labelledby`，也不在 `<label>` 内，因此辅助技术只能得到“checkbox”角色而没有对象名。

这也解释了为什么此前 CDP 的“未命名控件 0”不够强：当时只枚举了 `button/a[href]/[role=button]`，既没激活两个条件态 icon button，也**根本没有覆盖 `[role=checkbox]`**。

另外还存在 3 处 HTML label 结构问题：

- Provider credential 的 `<label>` 同时包住 password input 与 eye button；
- `ModelCapabilityEditor` 的 contextWindow `<label>` 同时包 input 与“恢复默认” button；
- maxOutputTokens 同样如此。

一个 `label` 内不应同时包含它所标注的 control 之外的第二个 labelable control；应改为显式 `for/id`，让 action button 成为 sibling。

**建议修复**：给两个 icon button 补动态本地化 accessible name（API Key 需区分“显示/隐藏”）；3 个 checkbox 用 `aria-label/aria-labelledby` 或真实 `<label for>` 绑定旁边的 capability/target/connection 名；三处复合表单改显式 label-target 关联。§7.44 同时补足 icon button 的指针命中区。

**修复（2026-09-24）**：`AgentThreadSidebar` 的搜索清空按钮新增 `agent.operations.clearSearch`；Provider credential eye 根据状态动态使用 `showCredential / hideCredential`，图标本身标为 `aria-hidden`。`AppManagementSettings` 的 capability grant 与 target scope checkbox 分别复用 capability 名和 target label 作为 `aria-label`；`SafetyNetworkSettings` 的 connection checkbox 复用 connection name/host。Provider credential 从包住 input+button 的 `<label>` 改为唯一 `useId()` 派生 input id + 显式 `<label for>`，`ModelCapabilityEditor` 的 context window / max output tokens 同样用组件级 `useId()` 派生两个唯一 id，把“恢复默认”按钮留在 label 外。三语新增 clear/show/hide 文案。静态断言确认 5 个目标控件都有 accessible name、旧两类嵌套 label 片段消失；Prettier / ESLint / `git diff --check`、Agent i18n parity/dead-key、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p760-dist` 通过（`✓ built in 3.19s`）。§7.44 的纯指针命中区问题仍按其自身状态跟踪，本条只关闭 accessible-name 与 label-structure 缺口。

---

### 7.61 Artifact Library / Picker 查询缺 request generation，旧查询可覆盖新筛选（P2 · ✅ 已修复 2026-09-24）

**Artifact Library：**

- `load()` 没有 `if (busy) return`，也没有 generation；
- kind / app / retained 三个 select 的 `@update:model-value="load"` 在 busy 时仍可触发；
- query input 在 busy 时也未禁用，Enter 同样可以再次 `load()`；
- 每轮请求返回后无条件覆盖 `items / nextCursor / storage`。
- `loadMore()` 也没有 generation：它发出旧 cursor 请求后，filter 控件在 `busy` 时仍可改变并触发新的 `load()`；如果新整页先完成、旧分页后完成，旧页会 append 到新筛选结果并覆盖 `nextCursor`；
- `busy` 只是一个共享 boolean，两个并发请求任一 `finally` 都能先把它置回 false，并不能代替 request identity。

所以快速切 “kind A → kind B” 时，两轮请求并发；B 先回、A 后回，界面 filter 已显示 B，但列表最后变回 A。

**ArtifactPicker** 的按钮虽然 busy 时禁用，但 search input 没禁用，`@keydown.enter="load"` 仍可在 busy 中再次启动 load；请求同样没有 query snapshot generation guard。

这不是分页去重能解决的问题：问题发生在**整页 replace** 的 load 路径，旧响应会成为最终 UI。

**建议修复**：捕获 query/filter snapshot + generation，只有最新 generation 且当前 filter 仍匹配才提交；或者在 request 期间锁定所有会改变 query identity 的控件。

**修复（2026-09-24）**：`ArtifactLibraryView` 新增 `queryGeneration` 与稳定 `filterKey()`。每次整页 `load()` 都捕获 filter snapshot 并递增 generation，page/storage 只有在 generation 与当前 filter 都匹配时一次性提交；`loadMore()` 捕获当前 generation、filter snapshot 与 cursor，任一发生变化就丢弃旧页，避免旧分页 append 到新筛选结果。`ArtifactPicker` 同样为整页/分页捕获 query snapshot + generation + cursor。两处 stale request 的 success/error 均 no-op；`finally` 只在自己的 generation 仍是最新时清 `busy`，因此旧请求既不会抢清新请求 busy，也不会在用户只编辑 query 尚未启动新请求时把 busy 永久卡住。Prettier / ESLint / `git diff --check`、静态 generation guard 断言、frontend `vue-tsc --noEmit` 均通过；Vite production build 使用 `/tmp/nexus-p761-dist` 通过（`✓ built in 3.21s`）。

---

### 7.62 mutation 已成功后辅助 refresh / health 失败，会被误报为“写失败”（P1 · ✅ 已修复 2026-09-24）

第三层按“**authoritative commit boundary**”回看写路径时，确认 frontend 与 backend 都存在“持久化已经成功，但后续非权威工作失败，于是整个调用抛错”的模式。

**Frontend SettingsPanel：**

`patchSection()` 的顺序是：

1. `settings.value = await agentApi.patchSettings(...)` —— 此时服务端写入已成功，且前端已经拿到新 revision；
2. `storage.value = await agentApi.storage()` —— 只是辅助 refresh；
3. 最后才 emit `host-changed` / `configuration-changed`。

如果第 2 步 GET 失败，`execute()` 会把整个操作显示为失败，而且两个刷新事件都不发。用户看到“保存失败”，实际上 settings 已经提交。

同类顺序还存在于 feature enable/disable、hard-limit confirm、Provider create/toggle/delete/discover 等路径。尤其 `createProvider()` 是先 POST 创建，再 `providers()` + `apps()` refresh；任何 refresh 失败都会让 caller 得到 `undefined` / error feedback，且 `execute()` 不会触发 provider 的 `configuration-changed`。用户若按失败提示重新创建，可能产生第二个 provider。

Feature enable 还有一个更直接的 commit-boundary 错位：`PATCH /settings` 先持久化 `feature.enabled=true`，route 随即用当前 App lifecycle 计算 `availability`；Backend 明确定义 `enabling` 为合法过渡态。但 `AgentSettingsPanel.assertFeatureReady()` 只接受 `enabled/degraded`，所以 App 正在启动时，前端会在**设置已经提交成功**后主动抛出“启用失败”。此时服务端 feature flag 已为 true，UI 却按失败反馈，容易诱导重复操作；正确语义应是“已启用，App 正在启动/等待健康状态”，而不是回滚式失败。

**Backend ProviderService 更深一层也有同样问题：**

- `create()`：`repository.create(...)` 成功后才 await `onChanged(userId)`；
- `update()`：`repository.update(...)` 成功后才 await `onChanged(userId)`；
- `remove()`：`repository.remove(...)` 成功后才 await `onChanged(userId)`；
- composition root 把 `onChanged` 绑定到 `lifecycle.refreshHealth(userId)`；
- `refreshHealth()` 会调用 enabled App 的 `definition.health(scope)` 与 state CAS，明确是会抛错的异步工作；
- ProviderService catch 后只记录 `PROVIDER_CHANGE_NOTIFICATION_FAILED`，随后**重新 throw**，因此 HTTP 可以在 provider 已持久化后返回失败。

Provider create 由 backend 生成随机 UUID，没有 caller-stable idempotency key；所以这里与 §7.41 的 thread create 类似，但更确定：服务端代码本身就存在“commit 后再抛错”的路径，重试能够创建重复 provider。

**同类 commit-boundary 还存在于主界面与 Workspace Runtime：**

- `cancel()` / `increaseBudget()`：主 mutation 已返回新 Run，随后才并行 refresh ledger / approvals / background runs；任一辅助读取失败会进入 `recoverRuntimeFailure()`，把已成功 mutation 作为失败处理；
- `resolveApproval()`：approval 已 resolve 后才 refresh Run / approvals / ledger / background / detail approvals，任一后处理失败都会落到同一 catch；
- `saveCheckpoint()`：checkpoint 已创建后才 `listCheckpoints()`。这一条还有**真实重复对象后果**：backend 只校验当前 `run.version === expectedRunVersion`，保存 user checkpoint 本身不推进 run.version；checkpoint id 每次 `randomUUID()`，schema 也只对 recovery checkpoint 有 `run_id` 唯一索引。若首次 POST 已插入而后续 list GET 失败，UI 报“保存失败”，用户再次点保存仍携带同一合法 run.version，会插入第二条 user checkpoint；
- `resumeCheckpoint()`：resume 已成功返回新 Run 后，仍继续 getRun + refresh ledger/approvals/background；后处理失败会把 resume 显示为失败；
- `deleteRun()` 先删 Run，再拉 runs / approvals / ledger / background runs；后续任一 GET 失败会进入 mutation error，尽管 Run 已删；
- `deleteThreadConversation()` 先删 thread，再 `selectFirstOrCreateThread()` + refresh background；若自动创建新 thread 或 refresh 失败，删除事实不会回滚；
- `deleteAllConversations()` 先删除全部会话，再自动创建第一条空 thread；create 失败时 UI 会把整次“删除全部”显示成失败，但原会话已不可恢复；
- `WorkspaceRuntimeSettings` 的 setup / uninstall / cleanup / reset / install-pack 等 confirm 路径先提交 command/mutation，再 await `settings()` / `loadDetails()`；辅助读取失败仍进入统一 `run()` catch。
- `ArtifactLibraryView.toggleRetain()` 先完成 retain/unretain 并更新当前 item，随后才 await `storage()`；storage summary GET 失败会显示整次操作失败，虽然 retained 状态已经提交；
- MCP / ACP integration 的多条 update/delete/credential 路径在 mutation 成功后继续 await `loadIntegrations()`；list GET 失败会落到同一 `run()` catch。MCP 删除已有 destructive confirm，但**确认强度并不能解决 commit 后 refresh 失败被误报**；
- `PluginManagementSettings` trust/revoke publisher 在 mutation 成功后继续 await `refresh()`（publishers/installations/versions/catalogs）；任一后续读取失败同样会把已成功 trust/revoke 显示成失败。
- Plugin backend 的普通 `install()` 也有 finalization commit-boundary：package 已移动到 immutable version、version/app state/installation 已写入后，最后才 `updateStage(expectedVersion)`；如果同一 stage 被并发 verify/操作推进了 version，`PLUGIN_STAGE_VERSION_CONFLICT` 会让 HTTP install 报失败，尽管 App 已经安装。upgrade 路径已显式 catch“active version commit 后 stage finalization 失败”并保留 reconciliation，但普通 install 没有同类保护。
- backend `ApprovalService.resolve()` 也在 `stateCommit.resolveToolApproval()` durable commit 并触发 scheduler 后，才再次 `approvals.get(scope, approvalId)` 组装响应；这次辅助读若失败，HTTP 会把已经完成的批准/拒绝显示成失败。
- Host `patchSettings()` 先 `settings.patch()` 持久化全局 `feature.enabled`，再逐 App `quiesceScope()` / `resumeScope()`；任一 App 生命周期失败都会把整个 PATCH 报成失败，但 settings revision/开关已经提交，前面已处理的 App 也不会回滚，可能留下“全局 disabled + 部分 runtime 尚未 quiesce”或相反的半完成状态；
- `setAppEnabled()` 同样先由 `lifecycle.setEnabled()` 提交 App state，再做 `integrations.syncEnabled()` / `deactivate()`；Integration 后处理失败会把已完成的 enable/disable 报成失败。
- Workspace Artifact export 还有同一 commit-boundary：`WorkspaceArtifactService.export()` 在 `artifacts.write()` 返回后，Artifact 已经进入 ready/权威存储；但 `finally` 仍 await `read.close()`，close 失败会记录 `WORKSPACE_ARTIFACT_READ_CLOSE_FAILED` 后**重新 throw**。于是“Artifact 已成功创建 + source close 失败”会让 HTTP 报整个 export 失败；该 export 没有 caller-stable request identity，用户按失败重试会再创建一份 Artifact。

这里已有一个正确对照：`AppManagementSettings.confirmUninstall()` 把“卸载主 mutation”与可选的“删除插件数据”明确分开；后者失败只单独报 delete-data error，仍保留 uninstall success。说明产品层已经有“主提交成功 ≠ 后处理全成功”的正确语义模式。

**建议修复**：

- 明确 mutation commit point：权威写成功后，辅助 read/health/notification 失败不能把 mutation 重新标成失败；
- frontend 将 post-write refresh 错误降级成“已保存，但刷新失败，正在重新同步”，并立即发必要的 invalidation event；
- backend provider change notification 应 best-effort / durable outbox，或把失败转成“写成功 + health stale”状态，不应重新抛成 mutation failure；
- 对 create 类 mutation 仍建议引入 caller-stable idempotency key。

**修复（2026-09-24）**：已把“主 mutation commit”与“后续同步/通知/finalization”明确拆开。Frontend `AgentSettingsPanel` 在 settings/provider/hard-limit/feature 写成功后先提交服务端返回态并立即发必要的 Host/config invalidation，后续 storage/providers/apps refresh 统一走 `postCommitSync()`；Provider create 会先把 create 响应写入本地列表，因此 refresh 失败也不会返回 `undefined` 诱导用户重复创建；`enabling` 被作为 feature enable 的合法过渡态。`AgentAppSurface` 的 cancel / budget / approval / checkpoint / resume / run-delete / thread-delete / delete-all 同样在主 mutation 返回后先 `runtimeOperation.succeed()`，再 best-effort resync；user checkpoint 直接使用 create 返回对象更新列表，`listCheckpoints()` 失败不再把已插入 checkpoint 翻成“保存失败”。Workspace Runtime confirm、Artifact retain、Plugin trust/install/upgrade/data 等路径也把后续 read/refresh 降级为独立同步错误。当前 MCP / ACP `loadIntegrations()` 已在自身内部 catch list 失败，因此复核 current HEAD 后无需额外改动，它们的 availability 生命周期问题仍由 §7.63 单独跟踪。

Backend 侧，`ProviderService.create/update/remove()` 的 `onChanged()` 失败只记录 `PROVIDER_CHANGE_NOTIFICATION_FAILED`；`ApprovalService.resolve()` 在 durable state commit 后对 callback / repository reread 采用 best-effort，并在 reread 失败时返回由 commit 输入推导的 resolved view；Host `patchSettings()` / `setAppEnabled()` 的 lifecycle、scheduler、integration 后处理不再反转已提交 settings/app state；Workspace Artifact `read.close()` 失败只告警；普通 Plugin install 在 installation/app state 已提交后若 stage finalization 失败，只保留 stage 供 reconciliation 并告警，不再返回 install failure。

**回归与验证**：新增 `tests/backend/agent-post-commit-boundary.regression.ts`，动态注入 Provider `onChanged()` 失败，确认 repository 已创建且 `ProviderService.create()` 仍成功返回；同时静态断言 `saveCheckpoint()` 在 create 返回后先记录 mutation success，再执行 `listCheckpoints()` resync。`corepack pnpm --filter @nexus-terminal/backend exec tsc --noEmit`、`corepack pnpm --filter @nexus-terminal/frontend exec vue-tsc --noEmit`、该 regression、`pnpm run lint:agent-i18n`、已纳入 ESLint 配置的改动文件 lint 与 `git diff --check` 全部通过；Runner 为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。`compose-agent.ts` 与新 regression 文件不在当前 ESLint 配置匹配范围，ESLint 报 ignored warning；前者由 Backend `tsc` 覆盖，后者已直接执行通过。

---

### 7.63 MCP / ACP Integration 不跟随 Agent availability 生命周期同步（P2 · ✅ 已修复 2026-09-24）

`McpIntegrationSettings` 与 `AcpRuntimeSettings` 都只在 `onMounted()` 调一次 `loadIntegrations()`，没有 watch `props.agentAvailable`。父层 committed HEAD 则一直稳定挂载这两个组件，只把 `apps.some(app.id === 'nexus.agent')` 作为 prop 传入，不会通过 key/v-if 重建组件。

因此两个方向都会 stale：

1. **mount 时 unavailable → 后来 available**：初次 load 直接清空 integrations 并 return；之后即使 Agent 安装/恢复，列表仍保持空，除非用户手动点 refresh；
2. **mount 时 available → 后来 unavailable**：旧 integrations 不会被清。MCP/ACP 已有 integration 行里的 toggle/delete/profile/credential 等控件大多只看 `disabled = props.busy || localBusy`，没有把 `!agentAvailable` 纳入 disabled；页面一边显示“请先安装 Agent”，一边仍能操作旧条目并向已不存在/不可用的 App 发请求。

另外 `loadIntegrations()` 自身也没有 generation；availability 变化与手动 refresh 交叉时旧响应仍可回写。

**建议修复**：watch `agentAvailable`；false 时 invalidate generation + 清 integrations/loading，true 时自动 reload；已有 integration 行的 mutation controls 也统一包含 `!agentAvailable`。

**修复（2026-09-24）**：`McpIntegrationSettings` 与 `AcpRuntimeSettings` 都移除 mount-only load，改为 `watch(() => props.agentAvailable, ..., { immediate: true })`。`loadIntegrations()` 每次调用先递增 `integrationsGeneration`；availability 变为 false 时新 generation 立即清空 integrations/loading，之前仍在飞行的请求即使随后成功或失败，也会因 generation / availability guard 直接 no-op；manual refresh 与 availability reload 交叉时，同样只有最新 generation 能提交列表或清 loading，因此旧 MCP/ACP 列表不会重新“复活”。availability 恢复 true 时 watch 自动重新拉取，无需用户手工刷新。

Mutation gate 同步收紧：MCP 的统一 `disabled` 现在包含 `!props.agentAvailable`，且已打开的 Create modal 在 submit handler 与 footer save button 两层再次检查 disabled；toggle/delete/refresh/credential 等既有条目操作都继承该 gate。ACP 为避免把同组件里的 Profile 设置误锁，保留原 `disabled = busy || localBusy` 给 Profile，另新增 `integrationDisabled = disabled || !agentAvailable`，只用于 Integration 的 create/profile-select/toggle/delete/reload 和 mutation runner。这样 Agent 不可用时旧 integration 不可操作，同时 ACP Profile 的 settings 编辑语义不被本项改变。

**回归与验证**：新增 `tests/backend/agent-integration-availability.regression.ts`，固定两组件的 immediate availability watch、generation commit/finally guard、MCP submit unavailable guard，以及 ACP “Integration 必须使用 `integrationDisabled` / Profile 不得引用它”的边界。该 regression、Frontend `vue-tsc --noEmit`、两文件 ESLint 与 `git diff --check` 均通过；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.64 Memory host refresh 会静默覆盖候选草稿与导入选择（P1 · ✅ 已修复 2026-09-24）

`MemorySettings` 的 request generation 做得正确，但“最新权威响应如何合并到本地编辑态”仍有数据丢失：

- candidate memory 使用 textarea `v-model="drafts[memory.id]"`，是明确的未保存用户草稿；
- `loadMemories()` 每次成功后都执行 `drafts = Object.fromEntries(next.map(...memory.content))`，无 dirty merge；
- 该 load 不只来自用户主动刷新：watch `props.apps.map(id@version#stateVersion)` 会触发，`memory.changed` host event 对 selected app 也会触发；
- 因此其它 App 的 stateVersion 变化、同 App 新增/更新另一条 memory，均可能把正在编辑的 candidate textarea 无提示恢复成服务端旧内容。

导入区同样有无关刷新副作用：`loadSourceMemories()` 一进入就把 `sourceMemoryId='' / importPreview=null`；source app 的任意 `memory.changed` 都会清掉用户刚选好的来源 memory / preview，即使变化的是另一条记录。

**建议修复**：按 memory id 维护 server baseline + dirty draft，刷新时只覆盖 clean 项；已 dirty 项标记 remote changed/conflict。source list refresh 保留仍存在的 selection，只有所选 memory 真消失/失效时才清 preview。

**修复（2026-09-24）**：`MemorySettings` 新增 per-memory `memoryBaselines` 与 `draftConflicts`，`loadMemories()` 不再整份重建 drafts。刷新时 clean draft 跟随最新 `memory.content`；dirty draft 保留原本地文本，同时 baseline 前移到最新服务端内容；若 dirty 期间服务端内容也变化，则保留草稿并标记 conflict。候选卡片会显示“远端已变化但本地草稿已保留”的提示，并提供“使用最新版本”显式放弃本地草稿。draft state 以 selected App 为 scope，切换 App 时重置，避免跨 App id 污染；同 App 的 app/stateVersion refresh 与 `memory-changed` 则执行 merge，不再丢草稿。

Source import 列表也改为 authoritative reconciliation：`loadSourceMemories()` 不再在请求开始前清 `sourceMemoryId/importPreview`，同 source App 的无关 refresh 会保留仍存在且有效的 selection；transient GET 失败也保留上一份权威列表。刷新成功后，仅当所选 source Memory 已从有效 published 集合消失/过期时清 selection + preview；若仍存在但 version 变化，selection 保留而旧 confirmation preview 因 `sourceVersion` 不匹配被清；confirmation 自身过期也会清 preview。真正切换 `sourceAppId` 时仍会清旧 selection/preview，避免跨 App 误复用。

**回归与验证**：新增 `tests/backend/agent-memory-draft-merge.regression.ts`，固定 clean/dirty merge、server-changed conflict、selected App draft scope、source refresh 不预清、authoritative absence/version invalidation、transient refresh failure preservation 与 source App switch reset。该 regression、Frontend `vue-tsc --noEmit`、`lint:agent-i18n`、`MemorySettings.vue` ESLint 与 `git diff --check` 均通过；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.65 Run 详情 approval batch 刷新缺 generation，旧状态可回写（P1 · ✅ 已修复 2026-09-24）

`AgentAppSurface` 对 current approvals、detail subagents、detail open、ledger、checkpoints 都有 generation/run-id guard，但 `refreshDetailApprovalBatch(runId)` 是明显漏网：

```
const [next, snapshot] = await Promise.all([
  facade.listApprovals(runId),
  facade.getRun(runId),
]);
if (!detailVisible || detailSnapshot.id !== runId) return;
detailApprovalBatch = next;
detailSnapshot = snapshot;
```

同一个 Run 上它会从至少两条高频路径触发：

- 每次 run stream durable event 后，只要详情打开就 refresh；
- approval mutation 成功后的刷新。

`facade.getRun(runId)` 虽按 runId 串行 snapshot refresh，但 `listApprovals(runId)` 是独立并发请求。可出现 R1 的 approvals 很慢、R2 的 approvals + snapshot 先完成并提交新状态，随后 R1 才结束并把旧 approval batch 与较旧 snapshot 再写回。详情里会短暂/持续重新出现已经解决的审批或旧 Run 状态。

**建议修复**：给 detail approval batch 加独立 generation（或复用 detailOpenGeneration + per-run generation），在提交前同时校验 runId + generation；更好是把 approvals/snapshot 作为同一代 authoritative refresh commit。

**修复（2026-09-24）**：`AgentAppSurface` 新增 `detailApprovalGeneration`。`refreshDetailApprovalBatch(runId)` 每次请求先递增 generation，并把 `listApprovals(runId)` 与 `getRun(runId)` 作为同一代读取；仅当 request generation 仍是最新、detail 仍可见且 `detailSnapshot.id === runId` 时，才一起提交 `detailApprovalBatch` 与 `detailSnapshot`。因此 R1 慢于 R2 时，R1 completion 只会 no-op，不能把已解决 approval 或较旧 snapshot 写回来。

`openRunDetail()` 的初始 `listApprovals()` 也纳入同一个 generation：打开详情时会先 invalidate 旧 approval refresh，并捕获本次 `approvalGeneration`；如果详情打开后 stream / approval mutation 触发了更新一代 refresh，则初始 auxiliary approvals 无论成功还是失败都不会再覆盖新结果或上报 stale failure。`closeRunDetail()` 同样递增 `detailApprovalGeneration`，保证关闭/切换详情后所有在飞行的旧请求失效。

**回归与验证**：新增 `tests/backend/agent-detail-approval-generation.regression.ts`，固定独立 generation、generation/runId/visible 三重 commit guard、approvals+snapshot 同代提交、open-detail approvals 与后续 refresh 共用 generation、superseded auxiliary failure 不上报，以及 close invalidation。该 regression、Frontend `vue-tsc --noEmit`、`AgentAppSurface.vue` ESLint 与 `git diff --check` 均通过；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.66 Thread loadMore 不参与 thread-list generation，旧分页可把已删除 thread 带回来（P2 · ✅ 已修复 2026-09-24）

`refreshThreadListFromHost()` 已有 `threadListRefreshGeneration`，但 `loadMoreThreads()` 完全不使用该 generation：

1. 用户滚到底部，以 cursor C 发起旧页请求；
2. 期间其它 tab / host event 删除 thread，`refreshThreadListFromHost()` 拉到新的第一页并提交；
3. 旧 cursor C 的请求随后返回；
4. `loadMoreThreads()` 只按当前 items id 去重，然后直接 append page.items，并覆盖 `threadNextCursor`。

若被删除 thread 不在新第一页的 known set 中，它会被旧页**重新带回 UI**；nextCursor 也可能退回旧分页链。

**建议修复**：loadMore 捕获 `threadListRefreshGeneration + cursor`，任何 authoritative first-page refresh 都应 invalidate in-flight pagination；提交前再校验 cursor/generation。

**修复（2026-09-24）**：`AgentAppSurface` 新增统一 `invalidateThreadPagination()`：任何会重置或改变 thread collection / cursor 链的权威动作都会先释放旧 `loadingMore` 并递增 `threadListRefreshGeneration`。`refreshThreadListFromHost()` 改为通过该 helper 开启新 first-page epoch；完整 `load()`、删除后 `selectFirstOrCreateThread()` 同样会 invalidate 旧分页；本地 `createThread()`、`deleteThreadConversation()`、`deleteAllConversations()` 在主 mutation 成功后、提交本地列表状态前也会 invalidate，因此旧 cursor 请求不能在本地删除/创建之后重新污染列表。

`loadMoreThreads()` 现在在发请求时同时捕获 `requestGeneration` 与 `cursor`。响应成功后只有 generation 仍一致且 `threadNextCursor` 仍等于发起时 cursor 才允许 append items / 前移 cursor；stale 请求的 catch 也直接 no-op，不再把旧分页失败显示给用户；finally 仅在 generation 仍一致时清 `threadListLoadingMore`，所以被 first-page refresh 淘汰的旧请求不会把新一代分页请求的 loading 状态误清。这样 host event、跨 tab 删除、本地删除/删除全部与分页请求交叉时，旧页都不能复活已删除 thread 或把 cursor 退回旧链。

**回归与验证**：新增 `tests/backend/agent-thread-pagination-generation.regression.ts`，固定 shared generation invalidation、success/catch 的 generation+cursor guard、stale finally guard，以及 load/create/delete/delete-all/first-page replacement 对旧分页的 invalidation。该 regression、Frontend `vue-tsc --noEmit`、`AgentAppSurface.vue` ESLint 与 `git diff --check` 均通过；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.67 Plugin frontend bridge 首次 ready 后断开，宿主仍永久显示 ready（P1 · ✅ 已修复 2026-09-24）

`PluginAppFrame` 只观察首次 handshake：

1. 创建 `PluginFrontendHostBridge`；
2. `await nextBridge.start()`；
3. handshake 成功后 `status='ready'`；
4. 之后没有 bridge lifecycle callback。

但 bridge 在 ready 后仍可能主动 `close()`：`MessagePort.messageerror`、非法 nonce/protocol/sequence、超大消息等都会关闭 port；iframe 自身 reload/navigation 后旧 MessagePort 也失效。此时：

- bridge 没有 `onClose/onDisconnected` 通知 `PluginAppFrame`；
- `PluginAppFrame.status` 不会离开 `ready`；
- window `message` listener 在首次连接成功时已移除，iframe reload 后的新 `nexus.plugin.ready` 也没人接；
- 没有自动重新 `load()` / handshake。

结果是 iframe 仍可见、宿主仍认为 ready，但 Plugin SDK 已永久断线，直到整个 App surface 被重挂。

**建议修复**：bridge 暴露 post-handshake disconnect callback/state；宿主收到后进入 reconnecting/unavailable，并按 generation 重建 bridge；iframe load 事件也应触发安全的重新 handshake。

**修复（2026-09-24）**：`PluginFrontendHostBridge` 构造器新增 `onDisconnected` 生命周期回调，并把关闭语义拆成 intentional `close()` 与 internal `disconnect()`。宿主主动 dispose / app 切换 / unmount 仍走 `closeInternal(false)`，不会触发重连；MessagePort `messageerror`、超大消息、protocol/nonce/ack/request sequence 违规以及 `postMessage()` 失败都走 `disconnect()`。`closeInternal(true)` 只在 `wasConnected === true` 时通知，因此初始 handshake 失败仍由 `start()` reject 处理，不会被误判成 post-ready disconnect；pending RPC 会照常 abort/clear。

`PluginAppFrame` 在创建 bridge 时注册 disconnect callback，callback 同时校验当前 descriptor load generation 与 bridge identity，并通过 microtask 调用现有 `load()`，完整重取 descriptor、重建 iframe/bridge 并重新 handshake；旧 bridge / 旧 generation 的迟到 disconnect 无法重建当前 surface。iframe 另绑定 `@load`：宿主自己设置 `src` 前会用具体 `HTMLIFrameElement` token 标记该次 load，避免首次连接和宿主重连形成 load-loop；ready 后发生的外部 reload/navigation 不携带该 token，会触发同一个 generation-safe `load()` 重建流程，因此即使旧 MessagePort 没有显式 close event，宿主也不会永久停留在 `ready`。

**回归与验证**：新增 `tests/backend/plugin-frontend-bridge-reconnect.regression.ts`，固定 intentional close / notifying disconnect 分离、post-handshake callback gate、MessagePort/protocol/post failure 均走 disconnect、handshake failure 保持 start rejection，以及 `PluginAppFrame` 的 generation+bridge identity reconnect、具体 iframe load token 与 `@load` 重建路径。该 regression、Frontend `vue-tsc --noEmit`、`PluginAppFrame.vue` / `host-bridge.ts` ESLint 与 `git diff --check` 均通过；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.68 Plugin RPC timeout 会把仍在执行/可能已提交的 mutation 报成失败（P1 · ✅ 已修复 2026-09-24）

`PluginFrontendHostBridge.forward()` 为每个 RPC 建 `AbortController` + timeout，超时后向插件返回 `HOST_RPC_TIMEOUT`。但两类 mutation 都不满足“timeout = 未提交”：

**Agent RPC 更明确：controller 根本没有传进 dispatcher。**

`this.agent.dispatch(method, params)` 没有 signal 参数，dispatcher 中以下 mutation 会继续执行直到完成：

- `agent.threads.create / rename`
- `agent.runs.create / appendInput / cancel`
- `agent.subagents.cancel`
- `agent.approvals.resolve`

若请求在 timeout 之后成功，`forward()` 只看到 `controller.signal.aborted`，丢掉成功结果并回 `HOST_RPC_TIMEOUT`。插件按“失败”重试时，create 类操作可产生重复副作用。

**Backend RPC 也不能把 AbortSignal 当提交证明。** `pluginFrontendRpc()` 对 `storage.put/delete`、`intents.create/revoke` 等统一发 HTTP POST，并把 signal 交给 Axios。客户端 abort 只能停止等待，不能保证服务端 handler 没进入 commit point。其中 `AppIntentService.createConfirmed()` 每次调用直接 `id: randomUUID()` 写 receipt，没有 caller-stable idempotency key，所以 timeout 后重试能创建第二张 receipt。

这与 §7.41 / §7.62 是同一“unknown mutation outcome”原则在 Plugin SDK 上的缺口。

**建议修复**：区分 read 与 mutation RPC；mutation 超时不得返回普通“失败可重试”，应返回 outcome-unknown + reconcile token/idempotency key。create 类 RPC 使用 caller-stable request id；dispatcher 需要 signal 只用于可安全取消的读操作，不能把本地 abort 当作 server rollback。

**修复（2026-09-24）**：Plugin frontend protocol 新增明确的 mutation method 集合，wire `request.id` 对 mutation 直接作为稳定 UUID `operationId`。`PluginFrontendHostBridge.forward()` 不再把一个 AbortController timeout 同时当作“执行失败证明”：执行 Promise 会被持续观察，deadline 通过 `Promise.race()` 独立先返回；read / binary 仍返回 `HOST_RPC_TIMEOUT`，mutation 则立即返回 `HOST_RPC_OUTCOME_UNKNOWN` 并附带同一个 `operationId`，随后才 abort 客户端 HTTP 等待。这样即使 Agent dispatcher 或 Backend handler 已进入 commit point、甚至稍后成功，也不会把“未知结果”伪装成可安全重试的普通失败，晚到 completion/rejection 也不会形成第二个 response 或 unhandled rejection。

Plugin SDK runtime 同步把 mutation operation id 做成可恢复契约：mutation API 默认生成 UUID，也接受调用方显式传入已有 `operationId`；Host 返回 unknown 时 Error 会带 `operationId` 与 `outcomeUnknown=true`。SDK 自己的 20s fallback timer 也对 mutation 返回 `NEXUS_PLUGIN_MUTATION_OUTCOME_UNKNOWN`，而不是普通 request timeout，因此插件可先通过 list/get 等权威读 reconcile，必要时再使用**同一 operation id**重放。Agent dispatcher 把该 id 透传到已有 durable idempotency owner：Run create / appendInput / cancel 与 Approval resolve 复用现有 HTTP `Idempotency-Key`；普通非 Plugin 调用仍保持原有随机默认键，因此本项没有冒充关闭 §7.78 的全局 caller-stable identity 缺口。

对 create 类高风险路径补了 durable replay：Plugin Thread create 的可选 Idempotency-Key 会被校验为 UUID并直接作为 thread id；Conversation service/repository 对同 id + 同 title/source 返回已有 thread，对不同 payload 报 `IDEMPOTENCY_PAYLOAD_MISMATCH`，SQLite 用 `INSERT OR IGNORE` 收口并发 replay。Plugin frontend `intents.create` 同样要求 mutation `operationId`，AppIntent service 用它作为 receipt id，并按 receiver/intent/input/artifactIds 做语义 hash 对账；repository 对同 id 并发使用 `INSERT OR IGNORE`，同 payload 返回既有 receipt，不同 payload 拒绝，因此 timeout 后复用同 operation id 不会生成第二张 receipt。storage put/delete、thread rename、subagent cancel、intent revoke 等当前没有独立 durable replay receipt 的 mutation 仍只承诺 **outcome unknown**；调用方必须先 reconcile，不能据此假定 rollback。

**回归与验证**：新增 `tests/backend/plugin-rpc-outcome-unknown.regression.ts`，固定 mutation/read timeout 分类、deadline 先于 abort、unknown response 携带 operationId、SDK error 暴露 `outcomeUnknown/operationId`、SDK mutation API 可复用 operationId、Agent Run/Approval 幂等键透传、Thread/AppIntent create durable identity/replay 与 payload mismatch 防护、Backend frontend mutation 必须提供 operationId。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、该 regression、受影响 TS/Vue 文件 ESLint 与 `git diff --check` 均通过；`packages/protocol/src/agent-plugins.ts` 不在当前 ESLint 配置匹配范围，仅产生 ignored warning；Runner 仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.69 Workspace Runtime / Model Registry 的设置型 async load 仍缺 generation（P2 · ✅ 已修复 2026-09-24）

第二遍继续按 async load 扫描，确认两处较小但真实的 stale-response 窗口：

**WorkspaceRuntimeSettings.loadDetails()**

- availability=false 时会清 `catalog/storage`；
- availability=true 时开始 Promise.all 拉 catalog/storage；
- watch availability 变化会再调用 loadDetails，但没有 generation；
- 若 true(R1) → false(清空) → true(R2)，R2 先回、R1 后回，旧 catalog/storage 仍可覆盖新状态；
- 单纯 true→false 时旧 R1 也会在隐藏区重新写回 stale refs，下一次 true 前存在错误缓存代际。

`WorkspaceRuntimePanel.refresh()` 已经有 `refreshGeneration`，说明同项目正确模式现成存在。

**ModelProviderSettings model registry**

- onMounted 的 `loadModelRegistryStatus()` 不设置 `modelRegistryBusy`、没有 generation；
- 用户可在初始 GET 未完成时点击 `refreshModelRegistry()`；
- POST refresh 若先完成写入新 status，较早发出的 GET 仍可后到并把 `modelRegistryStatus` 覆盖回旧快照；
- auto-update mutation 的失败回读也复用同一个无 generation loader。

Backend persistence 还有同一状态 owner 的并发问题：`ModelCapabilityRegistryService.refresh()` 只用 `refreshPromise` 串行 refresh 自身，但 `setAutoUpdate()` 不进入这条链；两者都可并发调用 `store.save(this.state)`。`LocalModelCapabilityRegistryStore.save()` 又固定使用 `${file}.tmp-${process.pid}` 作为 temp path，同进程所有 save 共用一个临时文件。最小文件系统探针已复现：两次 write 同一 temp 后第一次 rename 成功，第二次 rename 稳定得到 `ENOENT`（最终文件内容取决于最后一次覆盖 temp 的 writer）。因此 Refresh 与 Auto-update toggle 并发时可出现“请求返回失败，但内存/磁盘状态实际已部分或完全变化”的 false-failure；store 层本身也没有序列号/mutex。

**建议修复**：前端两处统一捕获 generation；mutation/refresh 成功后应 invalidate 旧 GET，只有最新请求可以提交 UI state。Backend Model Registry 同时需要统一 mutation queue/mutex；store temp 文件必须使用每次 save 唯一名称并在串行 owner 下提交，避免 `setAutoUpdate()` 与 refresh 互抢同一个 temp path。

**修复（2026-09-24）**：`WorkspaceRuntimeSettings.loadDetails()` 增加单调 `detailsGeneration`。每次 availability 变化或显式 refresh 都先推进 generation；availability=false 会立即 invalidate 旧请求并清 `catalog/storage/loading`，availability=true 的 catalog/storage Promise 只在 `generation === detailsGeneration && availability.available` 时提交。旧请求的 error/finally 同样受 generation 门禁，因此不会弹陈旧错误、覆盖新 catalog/storage，或把新一代 `loading` 提前清掉。

`ModelProviderSettings` 增加统一 `modelRegistryGeneration`：onMounted 的 status GET、手工 refresh、auto-update mutation 启动时都会推进 generation；只有当前 generation 可写 `modelRegistryStatus`。因此较早的 mount GET 即使晚于 POST 返回，也不能把新 status 覆盖回旧快照；mutation 失败后的权威 status reload 会再推进 generation，并成为唯一可提交的回读。

Backend `ModelCapabilityRegistryService` 新增统一 `mutationTail` / `enqueueMutation()` owner，`refresh()` 与 `setAutoUpdate()` 都进入同一串行队列；原有 `refreshPromise` 仍负责把并发 refresh 合并成同一 Promise。这样 refresh fetch/save 生命周期内不会再有 auto-update 同时修改 `state` / 调用 `store.save()`。`LocalModelCapabilityRegistryStore.save()` 的临时文件也从固定 `${file}.tmp-${process.pid}` 改为 `${file}.tmp-${process.pid}-${randomUUID()}`，即使未来出现独立 caller 并发 save，也不会互相覆盖/rename 同一 temp path。

**回归与验证**：扩展 `model-capability-registry-sync.scenario.ts`，人为把 refresh 卡在 source fetch，再并发触发 auto-update，验证 auto-update 在 refresh 完成前既不 settle 也不持久化；新增 `settings-async-generation.regression.ts`，固定两处前端 generation commit gate、Backend mutation queue/refresh dedupe，以及真实 `LocalModelCapabilityRegistryStore` 的并发 save 均成功且最终文件保持完整。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、focused regression、完整 Agent scenario runner、受影响文件 ESLint、Prettier check 与 `git diff --check` 均通过；运行环境仍为 Node 22.23.1，而仓库声明 Node >=24，仅产生 engine warning。

---

### 7.70 Run / Workspace / Subagent 仍直接显示稳定内部枚举（P2 · ✅ 已修复 2026-09-24）

第三轮把所有模板里直接插值 `.status / .kind / .state / .mode / goalStatus` 的位置重新扫一遍，排除已经通过 `$t(...)` 映射的路径后，仍有一组明确的用户可见内部枚举：

- `TaskRail.vue` Run 详情主指标直接显示 `detailSnapshot.goalStatus`。协议值为 `unknown | in_progress | satisfied | not_satisfied`，因此用户会看到 `in_progress / not_satisfied`；
- 同一详情的“最近事实”头直接显示 `entry.kind`，协议值为 `user_input | assistant_message | tool_result | system_notice`；
- `WorkspaceRuntimeSettings.vue` 直接显示 recipe `kind = shell/code/data/browser` 与 pack `status = supported/deprecated/unavailable`；
- `WorkspaceRuntimePanel.vue` 直接显示 active workspace 的 profile kind；
- `MessageExchangePanel.vue` 直接显示 subagent message `kind = request/reply/progress/evidence/completion` 与 `status = accepted/delivered/consumed/expired/rejected`。

这与 §1.4 / §7.40 的“枚举不原样进用户句子”结论冲突。尤其 §7.40 删除死 key 时明确把旧的 `agent.conversation.kind.{user_input,tool_result,system_notice}` 列为不可达文案；当前 TaskRail 恰好仍在直接显示这组值，说明当时的可达性扫描只能回答“代码有没有引用 key”，不能回答“某稳定枚举是否还在裸显示”。

Approval 的 `precondition.kind` 位于“操作证据”折叠里的技术证据行，本轮不强行要求翻译；本条只覆盖正常产品文案/状态展示。

**建议修复**：为上述稳定 enum 建集中 translation map/helper；未知未来值可回退到 raw + 明确“技术状态”样式，已知值不要直接下划线英文。i18n 门禁可补一条“已声明协议 enum 在 template 直接插值”的定向守卫。

**修复（2026-09-24）**：新增 `features/agent/enum-labels.ts`，把 `goalStatus`、ledger `kind`、Workspace `kind`、Tool Pack `status`、Subagent message `kind/status` 六组稳定协议枚举集中映射到完整 literal i18n key。`TaskRail.vue`、`WorkspaceRuntimeSettings.vue`、`WorkspaceRuntimePanel.vue`、`MessageExchangePanel.vue` 全部改为调用同一个 `formatAgentEnumLabel()`；已知值显示三语产品文案，未来未知值不再裸插值，而统一通过 `agent.enumLabels.technicalState` 显示“技术状态：{value}”并保留 raw value 便于诊断。Workspace recipe/profile 共用同一 `workspaceKind` 家族，避免重复字典漂移；业务判断如 `pack.status === 'unavailable'` 保持协议值，不把展示翻译反灌进状态机。

三语字典新增同构 `agent.enumLabels.*` 树；helper 内完整列出 literal key，因此 §7.40 的 i18n reachability 门禁能静态证明这些文案可达，不需要 allowlist。新增 `tests/backend/agent-enum-labels.regression.ts`：直接执行 helper 验证已知映射与未知值 technical fallback，同时扫描四个组件，固定 `detailSnapshot.goalStatus`、`entry.kind`、`recipe.kind`、`pack.status`、Workspace profile kind、Subagent message kind/status 不得重新以裸 template 插值出现。Approval 的 `precondition.kind` 仍只存在于技术证据区，按本条原范围保持不动。

**验证**：Frontend `vue-tsc --noEmit`、`scripts/check-agent-i18n.mjs`、受影响组件/Helper ESLint、focused regression、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.71 日期 / 数字格式使用浏览器 locale，而不是当前 UI locale（P2 · ✅ 已修复 2026-09-24）

Agent 已有应用级语言选择（zh-CN / en-US / ja-JP），但多处格式化完全绕过 vue-i18n 的 `locale`，直接调用无 locale 参数的原生格式化：

- `ArtifactLibraryView.formatDate()` → `toLocaleDateString()`；
- `MessageExchangePanel` message 时间 → `toLocaleString()`；
- `ModelCapabilityEditor.formatCapabilityTimestamp()` → `toLocaleString()`；
- `MemorySettings` 时间 → `toLocaleString()`；
- `McpIntegrationSettings.formatTime()` → `toLocaleString()`；
- `ModelProviderSettings.formatRegistryDate()` → `toLocaleDateString()`；
- `AgentConversation / ConversationMessage` 数字 → `num.toLocaleString()`；
- `quantity-format.ts` exact bytes / seconds / token / count → `parsed.toLocaleString()`。

这些 API 不传 locale 时使用浏览器/OS locale。因此用户在英文系统浏览器里把 Nexus UI 切到日文，日期仍可能是英文式 month/day、数字分组仍按系统格式；反之亦然，形成“文案语言已切换、日期数字没切”的混合界面。

项目里已有正确对照：`AgentThreadSidebar.vue` 从 `useI18n()` 取 `locale.value`，用 `new Intl.DateTimeFormat(locale.value, ...)` 构造 formatter。这说明应用并不是有意采用 browser locale。

**建议修复**：集中提供 locale-aware date/number formatter（或 vue-i18n 的 datetime/number formatting），所有 Agent 用户可见日期/数量统一显式使用当前 UI locale；同时把 §7.49 的 `Tokens` literal 收进同一 quantity label 层。

**修复（2026-09-24）**：新增 `features/agent/locale-format.ts`，集中提供 `formatAgentNumber / formatAgentDate / formatAgentDateTime / formatAgentTime`，所有 formatter 都要求显式传 locale，不再隐式依赖浏览器/OS。`ArtifactLibraryView`、`MessageExchangePanel`、`ModelCapabilityEditor`、`MemorySettings`、`McpIntegrationSettings`、`ModelProviderSettings` 都从 `useI18n()` 取 `locale` 并在格式化时读取 `locale.value`；时间戳原有秒/毫秒单位语义保持不变，只替换 locale owner。

Conversation 两处 token formatter 也改用 `formatAgentNumber(locale.value, ...)`，包括 k/M 缩放后的 1 位小数；`quantity-format.ts` 的 `QuantityLabels` 新增 `locale` 与 `exactTokens`，`useQuantityLabels()` 直接绑定当前 i18n locale。bytes/tokens/seconds/count 的可见数字及 exact feedback 全部经过显式 locale 的 `Intl.NumberFormat`，§7.49 遗留的硬编码 `"Tokens"` 已迁入 `agent.settings.quantity.exactTokens` 三语字典；输入框内部用于可逆解析的 `100k / 1M / 64K` 紧凑表达仍保持 ASCII，不把本地化分隔符反灌进解析协议。

新增 `tests/backend/agent-locale-format.regression.ts`，验证显式 locale 会改变数字分组、日期输出，以及 quantity exact token/bytes 的分组；同时最终扫描 `features/agent/**` 的 `toLocaleString/toLocaleDateString/toLocaleTimeString` 为 0。Frontend `vue-tsc --noEmit`、Agent i18n parity/reachability、focused regression、受影响文件 ESLint、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

### 7.72 Workspace Terminal 自然关闭后仍保持“已打开”，且把 transport 机器码直接显示给用户（P2 · ✅ 已修复 2026-09-24）

Agent terminal channel 本身有最多 25 秒的异常断线重连；问题发生在它最终 `finish()` 以后。此时 channel 已 `closed=true / ready=false`，后续 `sendInput()` 直接 return，但父组件只做：

```vue
@error="error = $event" @closed="error = $event || ''"
```

没有同步 `channel=null / opened=false`。因此终端已经不可用时，UI 仍显示“关闭终端”，TerminalView 仍挂着 dead channel；用户必须先手工“关闭终端”再“打开终端”才能重建连接。

同时 channel 的终态错误直接使用 `WORKSPACE_TERMINAL_PROTOCOL_INVALID / ATTACH_FAILED / RECONNECT_EXHAUSTED / INPUT_QUEUE_FULL` 等稳定机器码，通用 `TerminalView` 又原样转发，最终成为可见文案（并入 §7.58）。

**建议修复**：父层收到 terminal close 时原子复位 `channel/opened` 并把 code 映射到 i18n；workspace 仍 running 时给明确“重新打开”动作。

**修复（2026-09-24）**：`AgentWorkspaceTerminal.vue` 将 TerminalView 的 `error/closed` 从模板内联赋值改为显式 handler。`handleTerminalClosed()` 在任何自然终态都立即清 `channel`、置 `opened=false`；若 Workspace 仍 running，现有“打开终端”按钮随状态复位立即重新可用。正常关闭显示本地化的“终端连接已关闭，可重新打开”提示；若 `finish()` 先发出了错误，则保留具体错误而不再用 WebSocket raw reason 覆盖。

新增 `workspace-terminal-errors.ts` 作为 transport code→用户文案的唯一映射 owner：`PROTOCOL_INVALID / ATTACH_FAILED / RECONNECT_EXHAUSTED / INPUT_QUEUE_FULL / SESSION_CHANGED` 分别映射到三语 `agent.workspaceRuntime.terminalError.*`，未来未知机器码统一回退通用终端失败文案，raw code 不进入产品 UI。channel 内部仍保留稳定机器码作为诊断/测试契约；session changed 从泛化 `PROTOCOL_INVALID` 调整为专属 code。另修复 malformed ready JSON 只 `emitError()` 不终止的问题：现在会 `finish(PROTOCOL_INVALID)` 并关闭 socket，使 channel 的内部终态和父 UI 一致。

新增 `tests/backend/agent-workspace-terminal.regression.ts`，验证所有已知 code 的 i18n 映射、未知 code 的 generic fallback、父组件自然 close 必须清 `channel/opened` 且不得恢复 `$event` raw 直传，以及 malformed protocol/session-change 必须进入明确终态。Frontend `vue-tsc --noEmit`、Agent i18n parity/reachability、focused regression、受影响文件 ESLint、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.73 App Tab “关闭”只移除可见标签，没有淘汰 KeepAlive cache（P1 · ✅ 已修复 2026-09-24）

§1.7 引入 `<KeepAlive>` 是合理的：**切换** App / Files 时要保留 partial streaming state。本条的问题是当前实现没有区分 switch 与 close。

`closeAppTab(appId)` 只从 `openAppIds` 移除标签；主内容却由一个无 `include/exclude/max`、无显式 prune 的裸 `<KeepAlive>` 缓存。某 App 一旦访问过，视觉关闭标签不会删除其 cached instance。

而 cleanup 都只在 unmount：

- `AgentAppSurface`：run facade/stream、window focus listener、thread/authorization/configuration host-event subscriptions、ResizeObserver；
- `AgentConversation`：interval 与 media-query listener；
- `PluginAppFrame`：iframe bridge / MessagePort。

全 `features/agent/host` 没有 `onDeactivated`，也没有 KeepAlive eviction。结果是用户已经“关闭”的 App 仍可能继续保持 Run WebSocket、host listeners、timer 或 plugin bridge。重新打开实际上是恢复旧 cache。

`agentSurfaceSession.pauseDetail()/activateApp()` 也不能充当保护：它们只递增 `navigationGeneration`，但全仓没有任何 `currentGeneration()` consumer。

第二遍继续核 key 语义后确认，这个泄漏不只发生在“关闭 Tab”：surface key 是 `${activeApp.id}@${activeApp.version}`，而 summary 的 `version` 映射自 backend `app.activeVersion`。插件/App 升级导致 activeVersion 从 v1→v2 时，KeepAlive 会创建新的 v2 instance，但旧 v1 cache 同样没有 eviction；旧 iframe bridge / run stream / listeners 仍可能存活。

对 Plugin App 来说这还会变成**陈旧前端继续持有当前 App 权限**：

- `PluginFrontendHostBridge` / `PluginAgentSdkDispatcher` 只保存 `appId`，不保存或提交 descriptor version；
- backend `/:appId/frontend/rpc` 只根据 appId 查**当前** installation/state，确认当前 activeVersion 健康后执行 storage/intents；
- 因此缓存里的旧 v1 iframe 在 v2 已激活后继续发 RPC 时，server 只能看到“appId 当前是 v2”，无法知道请求其实来自旧 v1 code；
- host-side Agent RPC 更直接：旧 dispatcher 仍可用同一个 appId 调 threads/run/approval/subagent APIs。

所以版本升级后的旧 cache 不只是资源泄漏，而是旧代码被继续当作当前 App 执行的 authority-staleness。

**建议修复**：保留普通 switch 的 KeepAlive 语义，但 close **以及 activeVersion 替换**都必须 prune 对应旧 cache entry 或发送完整 dispose 信号；Plugin bridge/RPC 最好把 descriptor/active version 纳入 capability identity，backend 拒绝旧 version bridge。分别验证 active/inactive Agent App、Plugin App 关闭/升级后资源释放与旧 bridge 失效，而普通切换仍保留 partial text。

**修复（2026-09-24）**：`AgentHubWindow` 不再把 Agent / Plugin surface 放进一个无法按 key 公开 prune 的裸 `<KeepAlive>`。新增 `residentAppSurfaces` 作为显式 surface owner：只有真正访问过的 `agent/custom` App 才 mount；普通 App / Files 切换通过 `v-show` 保留已访问实例，因此 streaming text、会话状态和 Plugin iframe 不会因正常切换重建。resident entry 同时冻结 `appId + activeVersion + surface`；关闭 Tab 会立即从 resident 列表删除，summary 中 App 被禁用/移除、surface 改变或 activeVersion v1→v2 时也会在 watcher 中淘汰旧 entry，从而触发 `AgentAppSurface` / `AgentConversation` / `PluginAppFrame` 的真实 unmount cleanup。Files 保持 lazy-first-mount + 后续 `v-show`，没有把所有 enabled App eager mount。

Plugin authority 同步加入版本身份：`PluginAppFrame` 接收 Hub 当前 version，并要求 GET descriptor 的 `version` 与该 surface version 完全一致；`AgentPluginFrontendRpcRequestDto` / backend `PluginFrontendRpcRequest` 新增必填 `version`，Host bridge 每次 backend RPC 都提交 `descriptor.version`。`PluginDataManager.frontendRpc()` 先验证 request version == installation.version，再验证 request version == app state `activeVersion`；任一不一致均报 `PLUGIN_FRONTEND_VERSION_STALE`（HTTP 409），因此缓存/延迟中的旧 v1 request 无法在 v2 已激活后继续操作当前 AppStorage/AppIntent。Host-side Agent RPC 与 binary artifact range 由于不走 plugin frontend backend method，本轮在 dispatch 前先用 version-fenced `host.appInfo` 做 authority check；发现 stale version 后 bridge 返回稳定错误并主动断开。

新增 `tests/backend/plugin-frontend-version-lifecycle.regression.ts`：直接验证旧 descriptor version 对当前 installation、当前 activeVersion 两个 stale 条件均 fail closed，当前 version 正常；同时静态锁住 Hub 不得恢复裸 `<KeepAlive>`、close/version-change resident eviction、Plugin frame version prop/descriptor 校验、bridge version request 与 stale disconnect、HTTP route version 字段。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、focused regression、受影响文件 ESLint、Prettier、`git diff --check` 与完整 Agent scenario runner 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.74 App Tab 把 role=button 嵌在原生 button 内，键盘语义不完整（P2 · ✅ 已修复 2026-09-24）

App tab 外层本身是原生 `<button @click="switchApp(app.id)">`，内部关闭控件却是：

`<span role="button" tabindex="0" @click.stop ... @keydown.enter.stop ...>`

这是可聚焦交互元素嵌套在原生 button 内，HTML / accessibility tree 语义不合法；而且这个伪 button 只实现 Enter，没有实现 button 应支持的 Space activation。

全 `features/agent/**` 扫 `role="button"` 后当前只有这一处，属于孤立实现。

**建议修复**：用非交互容器包住两个 sibling 原生 button：一个负责切换 tab，一个负责关闭；保留 stopPropagation，让原生 close button 自带 Enter/Space 语义。

**修复（2026-09-24）**：`AgentHubWindow` 的 App tab 外层改为非交互 `<div class="agent-app-tab">`，继续承担 active/inactive、Chrome-style surface/ears、shrink/max-width 等视觉布局；内部切换控件和关闭控件改为两个 sibling 原生 `<button type="button">`。switch button 保留原来的 App accessible name、title 与 click 行为；close button 保留 `agent.hub.closeApp` 的 title/aria-label、`@pointerdown.stop` 与 `@click.stop`，不再实现 `role="button" / tabindex / @keydown.enter`，因此 Enter/Space 激活由浏览器原生 button 语义负责，也不存在 interactive descendant 嵌套。

新增 `tests/backend/agent-app-tab-a11y.regression.ts`，锁住 `AgentHubWindow` 不得重新出现 `role="button"` / 手写 close Enter handler，并验证 tab 模板中 switch 与 close 是两个先后闭合的 sibling 原生 button、close 仍保留 accessible name 与 click propagation isolation。Frontend `vue-tsc --noEmit`、focused regression、`AgentHubWindow.vue` ESLint、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.75 “失败域”只有标签，没有独立错误状态；无关操作会把别的失败与 retry 一起清掉（P1 · ✅ 已修复 2026-09-24）

§7.37 把原来的 `error: string` 升级成 `message + domainKey + code + retry`，解决了“用户不知道哪一路失败”。但当前仍只有**一套** `error/errorDomainKey/errorCode/errorRetry` refs，所有失败域共享；`clearError()` 也不接 domain。

初始 `load()` 已有确定竞态：

1. `loadRunConfiguration()` 以未 await 的 `configurationPromise` 并行启动；
2. 同时拉 threads；
3. configuration 若先失败，`fail(...configuration)` 会显示“配置 · 请求失败”与重试；
4. threads 成功后进入 `selectThread()`，第 842 行无条件 `clearError()`；
5. 配置错误、code、retry 全部被抹掉，但 definitions/providers/settings 仍可能没有成功加载。

无 thread 时走 `createThread()` 也会在入口 `clearError()`，结果相同。

并且这不只影响初始化：select thread、create thread、reconciliation、runtime mutation、delete thread/delete all 等多个互不相干的操作都会无条件 `clearError()`。因此 stream/checkpoint/config 等失败可以被另一域的用户操作清除，§7.37 的 domain 目前只是**显示标签**，没有状态隔离。

**建议修复**：错误状态按 domain 建 slot/map，成功/重试只清自己的 domain；若 UI 仍只显示一个横幅，可按优先级投影“当前最重要错误”，但不能让 unrelated success 销毁另一域的失败与 retry。初始 config/thread 两条并发路径应独立提交错误。

**修复（2026-09-24）**：新增 `agent-surface-failures.ts` 作为纯 failure-slot registry：每个 domain 只拥有一个 `{ message, code, retry }` slot，同域新失败原位替换并移动到最新投影位置；不同 domain 可以同时存在。`AgentAppSurface` 用 `errorSlots` 保存 registry，现有单横幅只通过 `latestAgentSurfaceFailure()` 投影最近失败，`error/errorDomainKey/errorCode/errorRetry` 改为 computed view，不再是四套共享 mutable refs。dismiss 与 retry 只删除当前投影的 domain，删除后此前仍未解决的其它 failure 会自然重新显示，对应 retry closure 也保持不变。

所有原无参 `clearError()` 已消除：runtime mutation/reconciliation 只清 `mutation`；create/delete/load-more thread 只清 `threads`；configuration、checkpoint、approval、run、stream 等权威刷新成功只清自己的 slot；`postCommitSync` 成功也只清调用方 domain。线程切换使用显式 `THREAD_CONTEXT_FAILURE_DOMAINS`，只淘汰属于旧 thread/run 的 transcript/stream/run/checkpoint/approval/detail/mutation 状态，**不包含 configuration 与 threads 列表域**。完整 `load()` 才使用 `LOAD_FAILURE_DOMAINS`，因为它确实同时重新发起 configuration + thread/context 全套读取；因此首次 load 中 configuration 先失败后，后续 `selectThread()` 成功不会再把 configuration failure/code/retry 擦除。

新增 `tests/backend/agent-surface-failure-domains.regression.ts`，直接验证 config + transcript 多 slot 共存、清 unrelated domain 不影响已有 failure、清当前 domain 后旧 failure/retry 会重新投影、同域失败只保留最新 retry，以及显式 context multi-clear 只删指定域；同时锁住组件不得恢复 singleton refs 或无参 `clearError()`。Frontend `vue-tsc --noEmit`、focused regression、受影响文件 ESLint、Prettier、`git diff --check` 与完整 Agent scenario runner 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.76 Agent API 的 4xx 英文 message 会系统性绕过当前 UI locale（P2 · ✅ 已修复 2026-09-24）

`formatAgentApiError(cause, fallback)` 当前规则是：

- 5xx → 本地化 fallback；
- message 是机器码 → fallback；
- **其它 message → 原样返回 backend message**。

§7.37 当时甚至用 `threadId must be a uuid` 做过对照，明确把“真实后端文案保留”视为成功。但 Agent backend 的 HTTP error rules 本身不是本地化资源：本轮扫描 `interfaces/http/agent/agent-error-rules/**` 得到 **38 条英文固定 message**，例如：

- `Invalid Agent request.`
- `Agent resource changed; refresh and retry.`
- `Provider is unavailable.`
- `Artifact storage quota is exhausted.`
- `Workspace Runtime Runner is unavailable.`
- `Remote Agent plugin repository is unavailable.`

这些大量用于 400/404/409/410/413/422/429。于是 zh-CN / ja-JP 用户只要触发正常 validation/conflict/not-found 路径，frontend 多数 `formatAgentApiError()` 调用都会绕过词典 fallback，直接显示英文。

这与 §7.49 的源码英文 literal 不同：即使前端源码完全无英文，运行时仍会被 API message 注入英文 UI。

**建议修复**：UI 正文以稳定 `error.code` → i18n 映射为主；backend message 只作为诊断 detail/title/log。至少对已知 Agent error code 建集中翻译表，未知 4xx 回退调用方本地化 fallback，而不是默认信任英文 message 为用户 copy。

**修复（2026-09-24）**：`agent-api-error.ts` 新增集中 `classifyAgentApiError(code)`，按稳定机器码后缀/语义把 HTTP Agent 错误归类为 `validation / notFound / conflict / unavailable / forbidden / quota / tooLarge / timeout / authentication / busy`。`formatAgentApiError()` 现在接收当前 vue-i18n `t`：只要是 HTTP 响应，就不再返回 backend `error.message`；已分类 code 映射到 `agent.apiErrors.*` 三语文案，未知 HTTP code 统一回退调用方本地化 fallback。非 HTTP 的本地浏览器 Error 仍保留自身 message，避免吞掉纯前端诊断。

全部 14 个 Agent caller（Files、Host surface、Workspace Runtime、MCP/ACP、Subagent、Execution Policy、Memory、Apps、Plugin、Provider、Settings）均已传入当前 `t`；ACP 原先的硬编码 `ACP request failed.` fallback 同步改为 `agent.operations.requestFailed`，确保未知 4xx 也不会继续显示英文。原始 backend message 仍保留在 `AgentApiError.message`，供日志/诊断使用，但不再直接进入用户正文。

**回归与验证**：新增 `tests/backend/agent-api-error-locale.regression.ts`，覆盖 version conflict、not-found、unavailable、quota、forbidden、timeout、validation、未知 future 4xx fallback 与本地非 HTTP Error；Frontend `vue-tsc --noEmit`、`scripts/check-agent-i18n.mjs`、受影响文件 ESLint、focused regression 与 `git diff --check` 均通过。运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.77 Host 首次 summary refresh 失败后 coordination 正常结束，不会自动恢复（P1 · ✅ 已修复 2026-09-24）

`AgentSurfaceHost.runHostStreamAsLeader()` 的启动顺序是：

```
const initial = await refresh('initial');
if (!initial || aborted || generation changed) return;
for await (const event of agentEvents.host(initial.eventCursor, ...)) { ... }
```

WebSocket transport 内部有指数退避重连，但**连接 WebSocket 之前的 summary GET 没有任何 retry**。一次临时 `/agent/summary` 失败就让 leader callback 正常 return；`start()` 外层 async 也正常结束，没有 schedule restart、focus retry 或 timer。

auth attach 时虽然还额外 `void refresh('initial')` 一次，但这不是可靠兜底，反而是两轮并发 summary GET：较新的 stream-side refresh 一旦失败，会把较早请求标成 stale generation；即使较早请求稍后成功，也不会提交 `summary.value`。

单 tab 下可出现：

- `summary === null` → template 不渲染 AgentHubWindow / Launcher；
- 或已有 summary 时继续显示旧 running/approval badge，但没有 host stream 更新；
- 用户没有任何错误提示或“重新连接”入口。

只有后续某个 local host-changed 等偶发事件再次调用 refresh 才可能恢复。

**建议修复**：把 initial summary + host stream 放进同一可取消重连循环；summary GET 失败也按 transport 策略退避重试。去掉 auth attach 的重复 initial refresh，或让它与 stream startup 共用同一 generation/结果；需要有 stale/disconnected UI 状态而不是静默消失。

**修复（2026-09-24）**：`AgentSurfaceHost.runHostStreamAsLeader()` 现在在 cross-tab leader 持有 `navigator.locks` ownership 的整个生命周期内维护 initial-summary retry loop。`agentApi.summary()` 返回失败/null 时不会再结束 coordination，而是按 500ms 起步、上限 10s 的可取消指数退避等待后继续重取；AbortController 或 generation 变化会立即终止等待，避免 logout/user switch 后残留 timer。summary 成功后才进入既有 `agentEvents.host()`，WebSocket 层继续负责自己的断线重连。

认证 attach 路径删除了原先独立的 `void refresh('initial')`，只调用 `start()`，因此 initial summary 只有 leader loop 一个 owner，不再出现“外层较早 GET 成功、stream-side 较新 GET 失败后把前者判 stale”的双请求竞态。已有 summary 在临时失败期间不会被清空；首次为空时也会在后端恢复后自动拿到 summary 并渲染 Hub/Launcher，无需等待偶发 host/local event。

**回归与验证**：新增 `tests/backend/agent-host-initial-refresh-recovery.regression.ts`，固定 leader 存在 generation/abort guarded retry loop、initial refresh 调用只能出现一次且 auth attach 不得再直接 refresh。Frontend `vue-tsc --noEmit`、受影响组件 ESLint、focused regression、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

---

### 7.78 create 类 mutation 没有 caller-stable identity，unknown outcome 后可重复创建 Run / Integration / App Intent（P1 · ✅ 已修复 2026-09-24）

继续按“服务端已经 commit，但客户端没收到响应”反查 create 类操作，目前确认三类还没有安全重试锚点。

**Run create：backend 幂等正确，frontend 没保存 key。**

backend 的 `createRunTransition()` 会按 `run.create + Idempotency-Key` 查 durable command；同 key + 同 request hash 可以 replay 已提交的原 Run。问题是 frontend `agentApi.createRun()` 每次调用都在 API wrapper 内部现场生成 `crypto.randomUUID()`，key 没绑定到一次 composer submission。

如果 backend 已提交 Run、HTTP 响应在客户端拿到 `created.id` 前丢失：

1. `run.value` 仍为空，runtime failure recovery 没有 targetRunId；
2. “重新同步”回调同样没有 runId 可查询；
3. composer 只有在 create 成功返回后才清空，因此原草稿仍在；
4. 用户再次 Send 会拿到一个新 key，backend 会把它当全新 create command，合法创建第二个 Run。

Slash command 的 create-goal 路径最终也走同一 `createNewRun()`。

这不能泛化到 appendInput：append state-commit 在新 key 路径仍会先校验 `expectedRunVersion`；第一次若其实已经提交，第二次会被旧 version 挡成 conflict，随后可刷新权威状态。

**MCP / ACP Integration create：连幂等 key 都没有。**

`agentApi.createIntegration()` 只带普通 mutation headers；backend `IntegrationService.create()` 每次直接生成随机 UUID。数据库 `agent_integrations` 只有随机 id/scope 唯一约束，没有 `scope + kind + endpoint/profile` 业务去重。两个设置表单又都只在成功响应后才清空。

因此 integration 已插入但响应丢失时，UI 会按失败处理并保留原表单；用户再次创建会得到第二条有效 Integration。

**App Intent create：确认提交同样没有 request identity。**

`POST /apps/:appId/plugin-intents` 的 body 只有 `receiverAppId / intentId / input / artifactRefs / confirmed`，不接受 `Idempotency-Key` 或 client request id。`AppIntentService.createConfirmed()` 每次调用都直接 `id: randomUUID()`；repository 在一个 transaction 里插入 receipt，并为每个 Artifact 再随机生成 grant id。schema 只有 `receipt.id` 与 `(receipt_id, artifact_id)` 唯一，没有“同一 confirmed submission”业务 identity。

因此 receipt + grants 已 commit、HTTP 201 响应丢失时，调用方若按同一已确认 payload 重试，会得到第二个 receipt，并为同一 receiver/artifact 再创建一组 active grant。receiver 列表会出现重复 Intent，grant 的有效期也按第二次提交重新计算。

**建议修复**：createRun 在 submission 层生成并持有 idempotency key，API 接受调用方 key；unknown outcome 用同一 key 重放。Integration / App Intent create 同样增加 caller-stable request/idempotency identity 与 replay/reconcile；Intent 的 durable command 应原子覆盖 receipt + artifact grants，而不是把“再提交一次”当默认恢复路径。

**修复（2026-09-24）**：Run create 的 identity 已从 API wrapper 上移到真实 submission owner。`AgentAppSurface.createNewRun()` 先组装完整 `AgentCreateRunFieldsDto`，以其 JSON fingerprint 绑定一个 `pendingRunCreateIdentity`；同一草稿/thread/provider/model/reasoning/approval/execution/target/environment/goal payload 在 HTTP unknown/failure 后再次 Send 会复用同一个 UUID Idempotency-Key，只有 payload 发生变化才生成新 key。`facade.createRun(fields, key)` 成功返回原 Run 后立即清除 pending identity，因此普通新 submission 不会误复用旧 key；slash `goal.set` create 也走同一个 `createNewRun()` owner。

MCP / ACP Integration create 同样把 key 提升到 modal submission 生命周期：两处表单都对规范化 create input 计算 fingerprint，失败后 modal 保留时再次提交同 payload 会复用原 key；用户修改配置会自动换 key，关闭/重新打开 modal 则开始新的 submission。`agentApi.createIntegration()` 不再内部生成默认 key，而是强制 caller 传入；HTTP route 同样强制 `Idempotency-Key`。Backend `IntegrationService.create()` 用 `requireIdempotencyKey()` 校验 UUID并直接作为 integration id；SQLite repository 改为 `INSERT OR IGNORE`，同 id replay 会比较 kind、完整 configuration JSON、enabled 以及解密后的 credential，完全一致才返回既有 integration，不同 payload/credential 一律 `IDEMPOTENCY_PAYLOAD_MISMATCH`。并发同 key 因主键冲突也会收口到同一 durable integration。

AppIntent 普通 HTTP create 现在同样强制 caller 提供 `Idempotency-Key`：`pluginApi.createAppIntent()` 签名要求显式 key，route 透传到 `AgentHostFacade.createAppIntent(..., key)`，最终进入 §7.68 已实现的 `AppIntentService.createConfirmed(..., key)`。该 service 已以 key 作为 receipt UUID，并对 receiver/intent/input/artifactIds 做语义 hash replay 校验；SQLite `INSERT OR IGNORE` 原子收口 receipt，并只在首次 insert 时创建 artifact grants，因此已 commit 但响应丢失后同 key 重放不会生成第二张 receipt 或第二组 grants。§7.68 仍负责 Plugin RPC 的 outcome-unknown 语义；本条补齐的是普通 UI/HTTP create caller-stable identity，两者职责不混淆。

**回归与验证**：新增 `tests/backend/create-idempotency-identity.regression.ts`，固定 Run payload-bound key、MCP/ACP modal key、Integration API/header/service/repository durable replay 与 credential mismatch、AppIntent HTTP key 透传及已有 receipt replay；同时重跑 `plugin-rpc-outcome-unknown.regression.ts`。Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit`、两条 focused regression、完整 Agent scenario runner、受影响文件 ESLint、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.79 ACP Integration / Workspace 的 Delete 仍是单击即执行的不可逆/破坏性动作（P1 · ✅ 已修复 2026-09-24）

当前产品已经给多类 destructive action 加了明确确认：Provider 删除弹窗、Run 两段式删除、Thread / 全部会话 armed confirmation、Artifact 删除确认、插件卸载与 Workspace cleanup/uninstall preview-confirm。

但两类同等级操作仍是**单击立即执行**：

- ACP Integration 的 Delete 直接调用 `deleteIntegration()`；backend repository 执行真实 `DELETE FROM agent_integrations ...`，不是 soft-delete；
- Workspace Runtime 的 Delete 直接调用 `workspaceAction(workspace, 'delete')`；Runner 会 abort workspace jobs、dispose code intelligence，再调用 runtime.remove；成功后 workspace 状态变成 `deleted`。

MCP Integration 本轮重新核对后**不属于该问题**：`removeIntegration()` 已先调用 `feedback.confirm({ destructive: true })`，用户确认后才 DELETE。此前把 MCP 一并写进本条属于 grep 摘要阅读造成的误判，现已纠正。

这不是 §6.7 已关闭的“按钮样式”问题，而是仍存在的 destructive-action 语义缺口：同一产品里用户删除 Provider / Artifact / MCP Integration 需要确认，删除 ACP Integration 或整个运行 workspace 却只需一次点击。

Memory revoke / publisher revoke 本轮没有并入：publisher key 可以重新 trust 同一 key 恢复；Memory revoke 属于状态审查流，不与 SQL/runtime 删除混成一条。

**建议修复**：ACP Integration 删除至少用与 MCP/Provider 相同的 destructive confirm 并展示 profile；Workspace Delete 用两段式或弹窗，并明确“会终止作业并移除运行环境”。确认 UI 必须在 busy/版本冲突时保持目标绑定，不要用当前 selection 临时解析。

**修复（2026-09-24）**：`AcpRuntimeSettings.removeIntegration()` 改为 async destructive confirmation，确认文案同时展示 Integration `displayName` 与冻结的 `profileId`；只有用户明确确认后才进入既有 `run()` 并调用 `deleteIntegration()`。Workspace runtime 的 Delete 不再直接绑定 `workspaceAction(activeWorkspace, 'delete')`，而改为 `deleteWorkspace(workspace)`：确认消息显式展示被点击的 workspace id，并说明会终止正在运行的作业/runtime 进程、移除运行环境且不可撤销；确认完成后仍使用该函数参数中的原 workspace 对象调用 mutation，不会重新从当前 selection 临时取目标。

三语新增 `acpRuntime.confirmDeleteIntegration` 与 `workspaceRuntime.confirmDeleteTitle/confirmDeleteWorkspace`。新增 `tests/backend/destructive-delete-confirmation.regression.ts`，静态固定 ACP/Workspace 删除都必须先经过 `feedback.confirm()`，并禁止 Workspace delete 按钮退回直接 `workspaceAction(..., 'delete')`。

**验证**：Frontend `vue-tsc --noEmit`、Agent i18n parity/reachability、focused regression、受影响组件 ESLint、Prettier 与 `git diff --check` 均通过；运行环境 Node 22.23.1 相对仓库 Node >=24 仅产生既有 engine warning。

---

### 7.80 排除：active App 失效时父层已经会修正 activeAppId（❌ 非缺陷，2026-09-23）

初看 `AgentHubWindow` 时，summary watcher 只修剪 `openAppIds`、没有直接修改 `state.activeAppId`，看起来会在 active App 被禁用/卸载后落到“请选择 App”。

跨组件继续回看后确认这是假阳性：所有写入 `AgentHubWindow` 的 summary 都来自 `AgentSurfaceHost.refresh()`，而该函数在 `summary.value = next` 后立即调用 `chooseDefaultApp(next)`。它会：

- 取所有 enabled apps；
- 若当前 active id 仍 enabled 则保留；
- 否则优先切到 `nexus.agent`，再退到第一个 enabled App；
- 没有 enabled App 时直接关闭 Hub。

因此无论是运行中禁用/卸载，还是 `restoreForUser()` 恢复了一个后来失效的 recent App，父层 refresh 都会在同一 summary 处理链里修正 activeAppId。§7.80 不应作为开放问题保留。

本条保留为**排除记录**，用于说明为什么只看 `AgentHubWindow` 会误判；后续不要重复开启。

---

### 7.81 enabled 但 health=failed 的 App 仍允许 Send，backend 会必然拒绝（P1 · ✅ 已修复 2026-09-24）

Hub 当前把“可用 App”等同于 `app.enabled`：

- `AgentHubWindow.enabledApps` 和 `AgentAppSwitcher.candidateApps` 都只过滤 enabled；
- `AgentSurfaceHost.chooseDefaultApp()` 同样只过滤 enabled，并优先选择 `nexus.agent`；因此即使另有 healthy/degraded App，也可能默认落到一个 enabled-but-failed 的 Agent App；
- `AgentAppSurface` 只收到 appId/defaultApprovalMode，不收到 health；
- definitions endpoint 会 `lifecycle.get(scope)` 后继续返回 registry/provider compatibility，不要求 observedState 为 running/degraded；
- 因此 failed App 仍能拿到 definitions/provider，`canSend` 可以变成 true。

backend `RunService.create()` 的契约却更严格：`desiredState !== enabled` 或 `observedState` 不属于 `running/degraded` 时，直接抛 `AGENT_APP_DISABLED`。

结果是一个确定的“前端可点、后端必拒”窗口；而且当前 tab 本身没有 health failed 文案，用户主要看到的是发送后的错误。

**建议修复**：把 App health/availability 传入 surface，历史 thread 仍可只读查看，但 create/append/需要运行态的 mutation 应按 running/degraded gating；failed 状态在 tab/surface 显示明确原因与恢复入口。前后端共用同一 `canExecuteApp` 语义，避免再出现 §7.47 同类契约错位。

**修复（2026-09-24）**：新增 `features/agent/app-availability.ts` 作为前端执行能力唯一判定：只有 `enabled && health ∈ {healthy, degraded}` 才可执行新工作。`AgentSurfaceHost.chooseDefaultApp()` 现在优先选择可执行 App；若当前 App 已 failed 且存在其它 healthy/degraded App，会自动切到可执行项；若所有 enabled App 都不可执行，则保留当前项以便查看历史，而不是关闭/隐藏 surface。

`AgentHubWindow` 的 resident surface 现在持续携带 `health/healthReason` 并传给 `AgentAppSurface`；health 变化也进入 resident 同步 key，因此无需重建 tab 就能即时更新 gating。`AgentAppSurface.canSend` 在非 healthy/degraded 时只允许本地 `/help` 与命令语法反馈，普通输入、create run、append input、goal 等运行态提交均不可发送；`send()` 本身也有同样防线，避免绕过 disabled UI 直接触发。Surface 顶部会显示“当前不可执行、历史仍可查看”，并在 backend 提供 `healthReason` 时展示原因。

**回归与验证**：新增 `tests/backend/agent-app-execution-health.regression.ts`，固定 health 判定、默认选择、Hub health 透传与 send 防线。Frontend `vue-tsc --noEmit`、Agent i18n parity/reachability、focused regression、受影响文件 ESLint 与 `git diff --check` 均通过。

---

### 7.82 Settings 的 optimistic conflict 只报错、不 reconcile；同一 tab 会持续使用 stale revision/version（P2 · ✅ 已修复 2026-09-24）

全局 Agent Settings 的写操作大量依赖 optimistic version：

- `patchSettings(..., settings.revision)`；
- Provider update/delete 使用 `provider.version`；
- target denylist 使用 `denylist.revision`；
- hard-limit confirm 使用 preview 的 `expectedVersion`。

这些路径都包在 `AgentSettingsPanel.execute()` 里。当前 catch 只做 `notifyError(...)` 并返回 `undefined`，**不会重取 settings/providers/denylist，也不会更新 stale baseline**。

因此跨 tab（§7.50）或其它并发写导致一次 `SETTINGS_VERSION_CONFLICT / PROVIDER_VERSION_CONFLICT / ...` 后，用户在当前 tab 再点同一个 Save / Toggle / Delete，仍会带旧 revision/version 再次冲突。Agent Settings 主面板没有手动 Refresh 按钮；通常只能整页刷新或碰巧触发其它会重取数据的操作。

项目里已有正确对照：`MemorySettings.mutate()` 对 `MEMORY_VERSION_CONFLICT / MEMORY_REVIEW_STATE_INVALID / NOT_FOUND` 会立即 `loadMemories()`，说明“conflict 后回到权威状态”是已有模式。

但这里不能简单在 conflict 时直接 `load()`：§7.54 已证明全局 revision 更新会让多个卡片 watcher 无条件重建 draft、吃掉其它未保存修改。正确恢复需要同时满足：

1. 更新 authoritative baseline / revision；
2. 保留本地 dirty draft；
3. 明确告诉用户 remote state 已变化，并允许基于新 baseline 比较/重新提交；
4. Provider / denylist 等对象型版本也要按对象刷新，而不是让整个设置页一起 reset。

初始 `load()` 失败也没有 Retry 按钮，只显示 alert；这属于同一 recovery 设计薄弱点，但本条核心是“发生可预期 409 后当前 tab 仍永久持有 stale version”。

**建议修复**：给 settings/provider/denylist 建 conflict-aware reconcile；把 server snapshot 与 local draft 分离，dirty draft 不被 revision watcher覆盖。至少提供明确 Refresh/Reload action，并在重取后展示哪些本地改动仍待保存。

**修复（2026-09-24）**：`AgentSettingsPanel.execute()` 现在先用 `toAgentApiError()` 识别 HTTP 409，再根据本次 operation 持有的 lock 做定向 reconcile：`settings-write` 只重取 `settings()` 并清空已失效的 hard-limit preview；`providers` 重取 provider 列表；`apps` 重取 App 状态；`denylist` 重取 target denylist。多个 lock 会并行刷新，但不会调用全页 `load()`，因此不会把无关卡片一起 reset。reconcile 成功后错误提示明确说明“远端状态已刷新、适用的未保存编辑已保留”；reconcile 本身失败则单独提示 reload failure。

为保证 denylist 也满足 §7.54 的 draft-preserve 契约，`SafetyNetworkSettings` 新增 `baselineIds/baselineReason`：revision watcher 只有在本地不 dirty，或本地 draft 已经等于新远端状态时才 `syncDenylist()`；否则只更新父层 authoritative revision，保留本地选择与原因。下一次 Save 会自然使用父层最新 `denylist.revision`，因此不会持续拿 stale version。

**回归与验证**：新增 `tests/backend/settings-conflict-reconcile.regression.ts`，固定 409→lock-scoped reconcile、Hard Limit preview 失效和 Safety Network dirty-preserve。Frontend `vue-tsc --noEmit`、Agent i18n parity/reachability、focused regression、受影响组件 ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.83 Provider “拉取模型”请求可跨 modal 实例污染下一次新建表单（P1 · ✅ 已修复 2026-09-24）

第三轮用“async loader 写共享 ref，但没有 generation”机械扫描后，确认 Provider 新建弹窗还有一个跨 modal 的 stale-response 路径。

`pullModelsFromEndpoint()`：

- 开始时只设置 `isPullingModels=true`；
- 请求返回后无条件写 `pulledModels`；
- 若列表非空，还立即 `applyPulledModel(match)`，会改写 `form.modelId / contextWindow / maxOutputTokens / supports*`。

而且不需要关闭弹窗也能触发：baseUrl / credential / modelId 输入在 `isPullingModels=true` 时仍可编辑。用户在 endpoint A 请求飞行时直接把表单改成 endpoint B，A 的旧响应返回后同样会覆盖当前 B 表单的 discovered model/capability。

但 Modal 的关闭约束只看 `modalTesting`：

- `closeModal()` 只有 `if (modalTesting.value) return`；
- BaseModal 的 `close-on-backdrop / close-on-escape` 也只绑定 `!modalTesting`；
- **拉取模型时 `isPullingModels=true` 并不会阻止关闭**。

而 `openAddModal()` 会把整张 form、`pulledModels`、`selectedPulledModelKey`、`createdProviderId` 全部重置，并直接把 `isPullingModels=false`。因此可以稳定形成：

1. Modal A 填 endpoint A，开始拉模型；
2. 请求 A 尚未返回时按 Escape / backdrop 关闭；
3. 立即重新打开 Modal B，填 endpoint B；因为 open 时把 busy 清零，甚至可以再发请求 B；
4. 请求 A 最后返回；
5. 旧响应 A 无任何 modal generation / captured baseUrl 校验，直接写进 B 的 `pulledModels`；
6. `applyPulledModel()` 进一步把 B 的 modelId/capability 字段改成 endpoint A 的结果；
7. 用户随后保存时，可能把“B 的 baseUrl + A 的模型能力/模型 id”组合提交成新 Provider。

这比普通搜索结果 stale 更严重：旧请求不仅改列表，还会**主动改写下一次新建 Provider 的可保存字段**。

同一组件的 `testInModal()` 在 `modalTesting=true` 时会禁止关闭，因此没有这个跨 modal 问题；风险集中在 pull/discovery 路径。

**建议修复**：

- 为 modal 增加 instance/request generation，open/close 都 invalidate；
- `pullModelsFromEndpoint()` 捕获 `baseUrl + credential + modalGeneration`，只有当前 modal 仍打开且请求 identity 未变化时才能提交；
- 或在 pull 期间禁止关闭并明确显示进行中，但 generation guard 仍建议保留；
- 不要在 `openAddModal()` 中把一个仍有在途请求的 busy flag 直接清零而没有取消/invalidate 旧请求。

**修复（2026-09-24）**：`ModelProviderSettings` 新增独立 `modalGeneration` 与 `pullGeneration`。每次 `openAddModal()` 都先推进两代再重置表单；`closeModal()` 在允许关闭时同样推进两代并清掉当前 busy，从而让旧 modal / 旧 request 立即失效。`pullModelsFromEndpoint()` 捕获 `requestModalGeneration / requestGeneration / requestBaseUrl / requestCredential / requestModelId`，并通过 `isCurrentRequest()` 同时校验 modal 仍打开、generation 未变化、三项输入 identity 仍与请求发起时一致；不满足时 success/catch 均直接丢弃，不写列表、不改 model capability、不发 stale toast。

`finally` 只在请求仍是当前 generation 时才清 `isPullingModels`，因此 Modal A 的旧请求结束不会把 Modal B 的新请求 busy 状态提前清掉。这样既覆盖 close→reopen 的跨实例污染，也覆盖同一 modal 内用户在请求飞行期间改 endpoint/credential/modelId 的 stale overwrite。

**回归与验证**：新增 `tests/backend/provider-pull-generation.regression.ts`，固定 modal/request generation、三项 identity guard、close invalidation 与 stale finally 防线。Frontend `vue-tsc --noEmit`、focused regression、组件 ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.84 Provider “测试连接”不是无副作用测试：会先创建真实 Provider，失败/取消后仍保留，后续编辑也不再保存（P1 · ✅ 已修复 2026-09-24）

Provider 新建弹窗把“测试连接”和“保存并添加”展示成两个独立操作，但 `testInModal()` 在 Provider 尚未保存时并不是临时探测，而是：

1. 先组装完整 create payload；
2. 调用 `props.createProvider(payload)`；
3. 成功返回后立刻写 `createdProviderId = saved.id`；
4. **然后**才调用 `agentApi.testProvider(targetProviderId, form.modelId)`。

因此 test endpoint 只能测试一个已经持久化的 Provider，带来两个用户不可见的副作用。

**A. 测试失败 / 用户取消，Provider 仍已经存在**

如果 create 成功、随后 test 失败：

- modal 显示“测试失败”；
- 但 Provider 已经由第 2 步真实写入；
- `closeModal()` 只把 `modalOpen=false`，没有 delete/rollback；
- “取消”按钮在测试完成后同样只是关闭 modal。

用户把“测试失败→取消”理解为没有保存，实际设置列表里已经多了一条 Provider。

**B. 一旦测试创建过 Provider，后续表单修改不会再保存**

`submitModal()` 开头是：

`if (createdProviderId.value) { modalOpen.value = false; return; }`

所以 test 成功或失败后，只要 create 那一步成功过：

- 用户可以继续修改 displayName / baseUrl / credential / protocol / modelId / capability 字段；
- “保存并添加”按钮会变成“确认”；
- 点击“确认”不会 update Provider，只会关弹窗；
- 用户刚改的字段静默丢失，服务端仍保留**测试创建时**的旧值。

这与 UI 呈现的“测试连接”和“保存”分离语义冲突，也让 §7.62 的 Provider create commit-boundary 风险更难理解：用户甚至不需要遇到网络失败，正常测试流程本身就已经提前跨过了 commit point。

**建议修复**：

- 最优方案是提供真正无副作用的 test endpoint，直接接受临时 Provider 配置/credential，不先 create；
- 如果 backend 必须基于 persisted provider 测试，UI 必须明确“保存并测试”，并在失败/取消时提供回滚/保留选择；
- `createdProviderId` 存在时若允许继续编辑，提交必须走 updateProvider；否则测试后应把表单锁成只读并明确“Provider 已保存”；
- 增加 regression：test failure + cancel 不应静默留下 Provider；test success 后编辑字段再 confirm 必须与服务端最终值一致。

**修复（2026-09-24）**：新建 Provider modal 的 `testInModal()` 不再调用 `props.createProvider()`，也不再依赖 persisted provider id。它直接复用现有无持久化 `agentApi.discoverEndpointModels({ baseUrl, credential })` 作为 transient connection/auth probe，并用 `performance.now()` 计算 latency 展示测试成功结果。该 backend 路径只校验 endpoint/credential、发起受 timeout/response-limit 约束的远端模型发现，不写 Provider repository，因此 test failure、用户随后 Cancel、或关闭 modal 都不会产生任何 Provider 记录。

`createdProviderId` 状态及其所有分支已删除：`submitModal()` 不再存在“已测试创建过 → 只关窗”的捷径，保存按钮始终保持“保存并添加”语义，并在点击时根据当前 displayName/baseUrl/protocol/credential/model/capability 构造 payload 调用 `createProvider()`。因此测试成功后继续修改字段再保存，服务端得到的是最终表单，而不是测试时的旧快照。

**回归与验证**：新增 `tests/backend/provider-transient-test.regression.ts`，固定 `testInModal()` 只能走 transient discovery、不得调用 `createProvider/testProvider`，并固定真实 create 只存在于 `submitModal()`。Frontend `vue-tsc --noEmit`、focused regression、组件 ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.85 Workspace restart 在 Runner Plugin 激活失败后会保留“running”状态，但必需插件实例已经不存在（P1 · ✅ 已修复 2026-09-24）

第三轮转入 Runner runtime 生命周期后，确认 `restart` 与 `start` 的失败语义不对称。

Runner 的 `workspaceAction()`：

- `start`：先 `runtimeEngine.start()`，再 `pluginRunner.activateWorkspace()`；**如果 activate 失败，会 catch 并把 runtime stop 回去**；
- `restart`：先关闭 ACP / Terminal / Browser，dispose 当前 Runner plugin，然后 `runtimeEngine.restart()`，最后 `pluginRunner.activateWorkspace()`；
- restart 对最后一步没有 catch/rollback。

而 `runtimeEngine.restart()` 最终会把 generation 的 runtime state 文件写成 `running`。如果某个 frozen Runner plugin 的 `activate()` 抛错：

1. 旧 plugin instance 已被 dispose；
2. runtime state 已经是 `running`；
3. 新 plugin instance 在 activate 失败时会从 `PluginRunnerRuntime.instances` 删除并关闭；
4. command catch 只执行 `journal.fail(commandId, error)`，**不会修改 workspace journal status**；
5. workspace 原本通常就是 `running`，所以 Runner journal 仍显示 running；
6. Backend `syncWorkspaceStatus()` 对非-provision 的 failed command 不把 workspace 改成 failed/stopped，因此 Backend projection 也继续显示 running。

正常运行中也没有第二层自动纠正：Runner plugin protocol 虽定义 `lifecycle.health`，但全仓只有类型/worker handler，没有任何 `pluginRunner.request('lifecycle.health')` 调用者。只有 **Runner 整体重启**时 startup reconciler 会对 running workspace 再 activate plugins，失败后把 workspace journal 标成 failed。

因此一次普通“重启工作区”失败后可以长期处于：

- UI / Backend / Runner runtime：`running`；
- frozen profile 所要求的 Runner plugin：没有 live instance。

这会让“workspace running”失去“冻结 profile 已完整激活”的语义，后续依赖该 Runner plugin 的能力只能在实际使用时再失败。

**建议修复**：

- restart 与 start 使用同一原子失败语义：plugin activation 失败时至少把 runtime stop，并把 journal workspace 写成 stopped/failed；
- 更稳妥地把 lifecycle transition 做成明确的 `restarting -> running/failed` 投影，而不是先写 running 再做 plugin activate；
- Backend 对 lifecycle command failure 应在 reconcile 时读取 Runner workspace 实际状态/health，而不是对 restart failure 永远保留旧 running projection；
- 如果保留 Runner plugin `lifecycle.health` 协议，就接入 workspace health/reconcile；否则删除死协议，避免产生虚假的健康保证；
- 增加 regression：restart 时 runner plugin activate 抛错后，workspace 不能仍对外呈现 running。

**修复（2026-09-24）**：Runner `workspaceAction('restart')` 在关闭 ACP/Terminal/Browser 并 dispose 旧插件后，把 `runtimeEngine.restart()` 与 `pluginRunner.activateWorkspace()` 放进同一失败边界。任一步抛错都会再次 `disposeWorkspace()`，清掉可能只激活了一部分的 Runner Plugin 实例；随后 best-effort `runtimeEngine.stop()`，并在重新抛出原错误前把 Runner journal 的 workspace 状态写成 `failed`。因此即使 stop 本身也失败，Runner 的权威生命周期投影也不会继续声称该 workspace `running`。

Backend `syncWorkspaceStatus()` 同步补齐 failed restart 语义：`command.status === 'failed' && action === 'restart'` 时把当前 generation 的 workspace projection 改为 `failed`；`STATE_CONFLICT` 仍沿用原有并发保护。这样 command、Runner journal 与 Backend/UI projection 对 restart failure 的含义一致。

新增 `tests/backend/workspace-restart-plugin-failure.regression.ts` 做行为级覆盖：fake Runner Plugin activate 抛错后断言 restart=1、activate=1、dispose=2、stop=1、Runner journal=`failed`；同一测试再调用 Backend 状态同步，断言 failed restart projection=`failed`。Agent Runner/Backend TypeScript、focused regression、受影响文件 ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.86 toolchain switch 的 delete unknown/failed 可把 Workspace 长期留在 `stopping`（P2 · ✅ 已修复 2026-09-24）

Workspace toolchain/version switch 为了防止并发操作观察到“旧 generation 已删、稳定 workspace 暂时不存在”的中间态，会先：

1. 用 optimistic version 把 workspace 从原来的 `ready/running/stopped` 写成 `stopping`；
2. dispatch 旧 generation 的 `delete`；
3. delete 成功后才把 generation +1 并 provision 新 profile。

这个 reservation 设计本身合理，而且**同步拿到 delete=failed** 时有显式 rollback：用 `switching.version` 把状态恢复成原 `workspace.status`。

缺口在 outcome unknown：

- dispatch 发生 transport/等待异常时会把本地 command 标成 `unknown`，switch 直接返回 `outcome:'unknown'`，workspace 保持 `stopping`；
- lifecycle sweep 会周期调用 `workspaceRuntime.reconcile()` 查询 Runner command；
- 如果后来查询到 `succeeded`，generic `syncWorkspaceStatus()` 会按 delete 把 workspace 改成 `deleted`，后续可以继续人工处理；
- **如果后来查询到 `failed`，generic projection 对 delete failed 什么都不做**；
- 如果一直 query 不到，deadline 后 Backend 会把 command 固化为 `unknown + WORKSPACE_RECONCILIATION_REQUIRED`，projection 同样不改 workspace。

此时原状态快照只存在于最初 `switchToolVersions()` 的局部变量，reconcile command 本身没有记录“rollback 应恢复 ready / running / stopped 哪一个”。所以后台已经没有足够信息自动恢复。

影响：

- workspace 长期显示 `stopping`；
- `switchToolVersions()` 明确只接受 `ready/running/stopped`，因此不能再次尝试版本切换；
- management 把 `stopping` 视为 active status，cleanup 也不会当普通可清理对象；
- 当前 App 面板仍允许用户执行 Delete，因此不是绝对不可恢复；但恢复动作变成“删掉整个 Workspace”，而不是继续/回滚原 version switch。

**建议修复**：

- 将 version-switch reservation 的 `previousStatus` / transition intent 持久化到 command 或 workspace transition record；
- reconcile 得到 delete failed 时按 frozen previousStatus rollback；
- deadline 后若 outcome 真不可证明，显式投影为 `failed/reconciliation_required` 并提供恢复入口，不要无限保留 `stopping`；
- 增加 delayed-failure / query-unavailable regression，覆盖“首个请求 outcome unknown、后台 reconcile 后 failed”的路径。

**修复（2026-09-24）**：复用原本已经存在于 `agent_workspace_runtime_commands.request_json` 的 durable request 字段，将它正式暴露到内部 `WorkspaceRuntimeCommandView.request`。`switchToolVersions()` 发出的旧 generation delete 现在写入 `transition: { kind: 'toolchainSwitch', previousStatus }`，因此即使首个 HTTP/Runner outcome unknown，后台 reconcile 仍能从 command record 恢复 reservation 前的 `ready/running/stopped` 快照，而不依赖函数栈局部变量。

`syncWorkspaceStatus()` 新增 toolchain-switch transition 解码：后续 query 若确认 delete=`failed`，会把 workspace 从 `stopping` 回滚到冻结的 previousStatus；若一直无法 query、deadline 后 command 被固化为 `unknown + WORKSPACE_RECONCILIATION_REQUIRED`，则把 workspace 显式投影为 `failed`，避免长期占用 active/stopping 状态并阻断后续管理。正常 delete succeeded 的 generic `deleted` 投影保持不变。

新增 `tests/backend/workspace-toolchain-switch-reconcile.regression.ts`，行为级验证 delayed failed→原 `running`、deadline unknown→`failed`，并静态锁定 request_json durable mapping 与 transition payload。Backend TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.87 Host Runner 异常重启不会回收旧 detached job / ACP / Runner Plugin 进程树（P1 · ✅ 已修复 2026-09-24）

Runner 对正常 owner 生命周期的进程回收设计是正确的：Workspace job、ACP、Runner Plugin 都用 `detached: MANAGED_PROCESS_DETACHED` 创建独立 process group，正常 cancel/stop/delete 时通过 `signalManagedProcess()/terminateManagedProcess()` 对整个 group 发 TERM/KILL。

缺口出现在 **Runner controller 自己异常退出 / 被单独重启**：

- `JobRunner`、`AcpProcessRuntime`、`PluginRunnerRuntime` 创建的 child 在 Linux 上都是 detached process group；
- active process/group 只保存在当前 Node 进程内的 Map/Set/ChildProcess handle，没有 durable PID/group owner record；
- startup `Reconciler` 对旧 `running` command/job 只写 `unknown(..., 'controller_restarted_during_*')`；
- 对 running workspace 会重新 `activateWorkspace()`，但新的 `PluginRunnerRuntime.instances` 是空 Map，无法识别或杀掉旧 Runner Plugin child；
- reconciler 没有扫描旧 process group/session，也没有 owner marker/cgroup 可用于回收。
- `agent-runner/src/index.ts` 还没有任何 SIGTERM / SIGINT / beforeExit shutdown handler；应用层连正常 service stop 都不会主动 await ACP / Terminal / Runner Plugin / job drain。Docker/systemd 若采用整容器/cgroup kill 可以外部兜底，但 Host 部署的安全性因此完全依赖 supervisor 配置，而不是 Runner 自身生命周期协议。

这在 Docker Runner 中可能被容器生命周期间接兜底：容器主进程退出时 runtime 会终止整个容器进程集合，镜像还使用 tini 回收 zombie。但正式部署文档同时明确支持 **宿主 Host Runner**；Host 模式下单独重启 Node controller 没有这种 cgroup/container kill 保证。

本轮还做了同宿主 Linux 语义探针：短命父 Node 用与 Runner 相同的 `detached:true` 启动 `sleep` child，父进程退出后检查 `/proc/<pid>`，结果为 **`alive_after_parent_exit=true`**；测试 process group 随后已显式 SIGKILL 清理。也就是说这不是理论推测，detached child 确实会越过父 Node 生命周期。

影响包括：

- workspace job 被 journal 标成 unknown，但原命令可能仍在后台继续写 Workspace；
- ACP live session 在 Backend 已失联/按 restart fail-closed 处理后，旧 native agent process 仍可能继续执行自己的本地工作；
- Runner Plugin 可能出现“旧实例仍活着 + 新 controller 又 activate 一个新实例”的双实例；
- 后续 stop/delete 只能关闭**新 controller 已知**的 process handle，无法保证旧孤儿被回收。

这直接违背 SRS-AGENT-010 的约束：**Workspace job、ACP 与 Runner Plugin 的子进程树必须随其 owner 生命周期整组回收**。

**建议修复**：

- Host Runner 使用 durable owner process supervision：例如每个 child group 写入受控 PID/PGID + process start identity，并在 startup reconcile 中安全验证后清理；
- 更稳妥的是让 Runner 自身拥有专属 cgroup/systemd scope，并在 controller restart 前/启动时由 supervisor 清空旧 scope；
- 增加显式 SIGTERM/SIGINT graceful shutdown：停止接新请求，close/drain terminal/browser/ACP/plugin/job owner，达到 deadline 后整组 KILL，再退出 controller；
- 不要只凭裸 PID 杀进程，必须防 PID reuse（记录 Linux starttime / cgroup / pidfd 等稳定身份）；
- Docker 模式继续依赖容器边界也可以，但 Host 模式必须有等价 owner-lifetime 回收机制；
- 增加两类故障注入 regression：① 启动长 job / ACP / Runner Plugin → SIGTERM Runner → 在 deadline 内 owner 全部退出；② SIGKILL Runner controller → 重启 → startup/supervisor 回收旧 process group，且 journal/reconcile 结果与实际进程状态一致。

**修复（2026-09-24）**：`managed-process.ts` 新增 Runner-wide durable registry，文件位于 `<runnerRoot>/state/managed-processes.json`。在 Linux detached 模式下，每个受管 child 注册 `{ pid, /proc/<pid>/stat starttime, kind, ownerId }`；close 时自动删记录。Runner 启动最早期调用 `initializeManagedProcessRegistry(root)`：只对 PID 仍存在且 starttime 与 durable 记录完全一致的旧 process group 发 SIGKILL，因此不会仅凭裸 PID 误杀 reuse 后的无关进程。registry 写入使用同目录 temp→rename，避免半写 JSON 被当作权威 owner state。

`JobRunner`、`AcpProcessRuntime`、`PluginRunnerRuntime` 的 detached child 已全部注册到该 owner registry；正常生命周期仍沿用既有 TERM→KILL 流程，异常 controller 死亡后则由下一次 startup reap 兜底。`index.ts` 同时增加 SIGTERM/SIGINT graceful shutdown：先停止 ACP/Terminal/Browser 接入，再 `terminateAllManagedProcesses()` await 当前 managed process groups，最后关闭 HTTP server。这样 Host-native 模式不再依赖外部 cgroup 才能满足 owner-lifetime 回收语义。

新增 `tests/backend/managed-process-owner-recovery.regression.ts`：真实启动 detached Node child，注册后再次初始化 registry，断言旧 process group 被回收且 durable record 带 Linux starttime；同时锁定 job/ACP/plugin 三个 spawn owner 与 shutdown/startup wiring。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.88 Plugin upgrade 的 draining continuation 只存在前端内存；刷新后 App 会持久拒绝新 Run（P1 · ✅ 已修复 2026-09-24）

Plugin upgrade 在已有 active Run 时采用两阶段 drain，这个设计本身合理：

1. backend 先把 App state 的 `acceptNewRuns` 从 true CAS 成 false；
2. 若 `runningCount > 0`，返回 `{ state: 'draining', targetVersion, app, plugin }`，暂不切 activeVersion；
3. 当前 Run 自然结束后，再次调用同一个 upgrade API；此时 `acceptNewRuns=false` 且 `runningCount=0`，才继续 quiesce / migrate / activate / switch version。

前端也明确把按钮从“升级”改成“继续升级”，因此这里不是“缺少后台自动续跑”本身，而是**续跑身份没有持久 owner**。

`PluginManagementSettings` 把 continuation 需要的两块关键状态都放在组件本地：

- `candidate` 保存 verified package / `stage.id`；
- `drainingUpgradeVersion` 保存第一次 drain 返回后的 App state version，供第二次 upgrade 当 expectedVersion。

第一次请求返回 draining 后，只做：

- `drainingUpgradeVersion = result.app.version`；
- 保留当前 `candidate`；
- 显示 notice，并把按钮改成“继续升级”。

但这两者都只是 Vue ref。页面刷新、设置页卸载/重挂或浏览器会话丢失后：

- `candidate=null`；
- `drainingUpgradeVersion=null`；
- `onMounted(refresh)` 只重拉 publishers / installations / versions / remote catalogs；
- frontend/backend 都没有“列出当前用户 stage / pending upgrade / resume token”的 API；
- App 的服务端 state 却仍然持久化为 `acceptNewRuns=false`。

此后 createRun/checkpoint-resume 等路径会稳定抛 `AGENT_APP_DRAINING`。普通 App summary 也没有足够信息让 Plugin Management 自动重建原 stage continuation。用户实际能做的恢复是**重新获取/上传并 stage + verify 同一个目标包**，再用新的 candidate 调 upgrade；这是偶然可恢复，不是产品化 continuation。

这意味着一个正常操作就能稳定制造“设置页一刷新，App 不再接受新 Run，但 UI 不知道待继续升级”的持久状态。

Uninstall 也复用 backend draining 语义，但当前 UI 只允许对 disabled App 发起 uninstall；正常 disable 已先 quiesce active Run，因此本条重点是**enabled App 的 upgrade**，不把低概率的 uninstall drain 混进结论。

**建议修复**：

- 把 pending upgrade/drain intent 持久化到 backend（至少 appId、from/to version、stage identity/target package hash、开始时 state version），而不是只靠 Vue ref；
- 提供 query/resume/cancel API；Settings mount 时能恢复“继续升级”状态；
- cancel/drain-abandon 必须安全地把 `acceptNewRuns` 恢复为 true，前提是 activeVersion/transition identity 仍匹配；
- stage cleanup 不得在 pending upgrade 存续期间误删 continuation 所需包；
- 增加 regression：active Run → upgrade 返回 draining → reload Settings → Run 结束 → 仍能看到并完成/取消 pending upgrade，不能永久停在 `AGENT_APP_DRAINING`。

**修复（2026-09-24）**：新增 `agent_plugin_pending_upgrades` durable table（migration #46 + schema registry），以 `(user_id, app_id)` 为 owner，保存 `stageId / fromVersion / targetVersion / packageHash / appStateVersion`。`upgrade()` 在关闭新 Run 之前先写 continuation，CAS `acceptNewRuns=false` 后再更新最新 state version；因此即使请求返回 draining 后页面刷新，或 controller 在 drain 期间重启，恢复身份仍在数据库而不是 Vue ref。若同一 App 已有 pending upgrade，只有 stage/from/to/hash 完全一致的调用才能继续，避免用另一个包“接管”旧 transition。

后端新增 `GET /agent/plugins/pending-upgrades` 与 `POST /agent/plugins/:appId/upgrade/cancel`。pending list 会清理已经完成切换的 stale continuation，并返回恢复 UI 所需的 stage/plugin/app/expectedVersion；cancel 只在 activeVersion 仍等于原 fromVersion 且 optimistic version 匹配时重新开放 `acceptNewRuns`。升级成功会在 stage finalization 前清 pending，rollback 也 best-effort 清除并恢复旧 App runtime/new-run gate。

`PluginManagementSettings.refresh()` 现在同时拉取 pending upgrades：刷新/重挂后会重建 `candidate`、artifact label 与 `drainingUpgradeVersion`，按钮恢复为“继续升级”；同时提供“取消升级”入口。新增 `tests/backend/plugin-pending-upgrade-recovery.regression.ts` 固定 durable schema、list/cancel routes、coordinator owner 以及 frontend mount recovery/cancel wiring。Backend/Frontend typecheck、Agent i18n、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.89 runtime cleanup 不等待 ACP / Terminal 子进程真正退出，就可删除整个 Workspace 根目录（P1 · ✅ 已修复 2026-09-24）

Runner cleanup 的规范要求是“preview 冻结集合 → confirm → Runner re-check”，并且执行时仍应跳过 **active job/session**。Jobs 这一半有实现：`CleanupPlanner.runtimeCleanup()` 会从 journal 收集 pending/running job 的 workspaceId，并跳过。

但 ACP / Terminal session 没有进入这个 re-check：

- `AcpProcessRuntime.closeWorkspace()` 调用 active process 的 `close()`；
- `close()` 会**立刻**把 process 从 `active` Set 移除，然后只做 `void terminateManagedProcess(child)`；
- `terminateManagedProcess()` 允许先等 2 秒 graceful exit，再 SIGKILL 后再等 1 秒；
- `WorkspaceTerminalRuntime.closeWorkspace()` 同样立刻从 active Set 移除，发 TERM，并用 2 秒 timer 再 KILL；
- 两类 close 都不是 awaitable，`workspaceAction(stop/delete)` 不会等待这些 child 真正退出；
- Browser tunnel 的 close 也是 socket close，不是 cleanup planner 的可见 session ownership；Runner Plugin dispose 反而会 await `instance.close()`，因此本条主要针对 ACP / Terminal。

随后 lifecycle command 可以立刻：

- `runtimeEngine.stop()` / `remove()`；
- journal workspace 保存为 `stopped` / `deleted`；
- Backend projection 同步成非 active 状态。

Backend 的 `previewRuntimeCleanup()` 使用：

`!retained && !ACTIVE_WORKSPACE_STATUSES.has(status)`

其中 active set 只包含 `creating/starting/running/stopping/deleting`，所以**刚刚变成 stopped/deleted/failed 的 workspace 会立即成为 cleanup candidate**，没有 session-drain 冷却期。

Runner 收到 runtimeCleanup 后再次检查的也只有：

- retained；
- status 是 creating/running；
- journal active jobs。

它没有 ACP/Terminal live/closing session registry，也没有 owner PID/PGID drain barrier。

因此可稳定形成：

1. Workspace running，存在 ACP 或 Terminal child；
2. 用户 Stop/Delete；
3. Runner 发 TERM，但 child 仍可继续 0–3 秒；
4. lifecycle command 已成功，workspace projection 变 stopped/deleted；
5. 用户立即 preview + confirm Runtime Cleanup；
6. Runner 认为可回收，直接 `rm -rf runtime/workspaces/<workspaceId>`；
7. 旧 ACP/Terminal child 仍可能在该目录 / 其派生进程上继续运行，直到稍后 TERM/KILL 生效。

这直接违背 SRS-AGENT-010 的“**Workspace job、ACP 与 Runner Plugin 的子进程树必须随 owner 生命周期整组回收**”以及 cleanup “active job/session 必须跳过”的语义。它也与 §7.87 不同：§7.87 是 controller 异常重启后的 orphan；本条在**正常 stop/delete + 立即 cleanup**路径就可触发。

**建议修复**：

- 让 ACP/Terminal `closeWorkspace()` 返回 Promise，并等待整组 process/session 真正退出后，lifecycle command 才能进入 stopped/deleted success；
- 或为 Runner 暴露统一的 workspace live-owner registry，cleanup re-check 必须同时看到 jobs + ACP + Terminal + Browser + Runner Plugin 都为 0；
- cleanup confirm 时再次检查“closing/draining owner”而不是只看 journal status；
- child 终止超过 deadline 时应 quarantine/reconciliation_required，而不是继续删 workspace root；
- 增加 regression：启动长 ACP/Terminal → Stop/Delete → 立刻 runtime cleanup confirm；在 child 完全退出前 Runner 必须返回 skipped/failed，不得删除 workspace root。

**修复（2026-09-24）**：ACP 与 Terminal 的 workspace owner 关闭路径改成真正的 drain barrier。`AcpProcessRuntime.closeWorkspace()` 现在返回 `Promise<void>` 并等待所有匹配 child 的 `terminateManagedProcess()` 完成；active owner 只在终止完成后移除。`WorkspaceTerminalRuntime.closeWorkspace()` 同样等待所有 session：先 TERM、2 秒后 KILL，只有 child `close` 事件才从 active Set 移除并 resolve；超过终止窗口则以 `WORKSPACE_OWNER_DRAIN_TIMEOUT` 失败，owner 仍保持可见。

`RunnerControllerServer.workspaceAction()` 的 stop/restart/delete 在任何 runtime state 变化或根目录 remove 之前，先 `await Promise.all([ACP closeWorkspace, Terminal closeWorkspace])`。因此 child 仍处于 graceful/forced termination 窗口时 workspace journal 仍保持原 active 状态，Backend cleanup preview 不会把它列成 stopped/deleted candidate；若 owner 无法按 deadline 退出，lifecycle command 直接失败而不是继续清理 workspace root。`terminateManagedProcess()` 也改为 forced wait 超时显式抛 `MANAGED_PROCESS_TERMINATION_TIMEOUT`，不再把“SIGKILL 已发送”误当成“进程已退出”。

新增 `tests/backend/workspace-owner-drain-barrier.regression.ts`，锁定 ACP/Terminal awaitable owner drain、active owner 移除时点、timeout fail-closed，以及 stop/restart/delete 三条 lifecycle 必须先 await owner barrier。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.90 Checkpoint capture 的 owner gate 不完整：Terminal / ACP live writer 与 restart 后 unknown job 可绕过（P1 · ✅ 已修复 2026-09-24）

继续向下核 Runner Engine 后，先纠正本条一个早期判断：**正常、仍由当前 Runner controller 管理的 Workspace background job 不会与 checkpoint archive 并发。** `WorkspaceRuntimeEngine.openCheckpointArchive()` 会检查当前 `jobs.get(workspaceId,generation)`；只要其中还有 controller，就直接抛 `WORKSPACE_CHECKPOINT_NOT_SAFE`。而新 job 被接受后，`executeJob()` 在第一次 await 之前就把 controller 放入该 Map，因此普通 pending/running job 已有真实 gate。

仍然成立的缺口有两类，而且都来自“安全门只看当前进程内 jobs Map”。

**A. user checkpoint 丢掉 durable unknown job。**

Recovery checkpoint 会调用 `liveBackgroundJobs()`：从 durable tool-call 记录还原 jobId，再向 Runner `queryJob()`，遇到 `pending / running / unknown` 或查询失败都 fail closed。User checkpoint 却直接：

`const backgroundJobs = kind === 'recovery' ? await this.liveBackgroundJobs(scope, run.id) : [];`

因此 user checkpoint 从不观察 durable job，manifest 固定写 `backgroundJobs=[]`。

Runner controller 重启时，startup reconciler 会把原 `running` job 标成 `unknown`，但新的 `WorkspaceRuntimeEngine.jobs` 是空 Map。此时 archive gate 已无法看到这条 durable unknown job：

- Docker Runner 即使已由容器生命周期杀掉旧 child，**job outcome 仍然未知**，按 recovery checkpoint 的既有语义本应拒绝建立新 safe point；
- Host Runner 下还会叠加 §7.87：旧 detached job 可能仍在写 Workspace，而新 controller 的 jobs Map 完全不知道它。

User checkpoint 此时仍可 capture，并把 unknown job 从 manifest 中抹掉；后续 manual resume 的 checkpoint validation 也没有 jobId 可再次查询。

**B. Terminal / ACP live writer 从来不在 jobs Map。**

Workspace Terminal shell 与 ACP native process 都以同一 Workspace 的 work directory 运行，能够修改 `/workspace/work`，但它们由各自 runtime 管理，不登记到 `WorkspaceRuntimeEngine.jobs`。因此即使 Runner 没有任何 background job：

- Terminal 正在执行写文件命令时可以同时创建 archive；
- ACP process 正在修改项目时也可以同时创建 archive；
- recovery checkpoint 虽然检查 `liveBackgroundJobs()`，同样没有 Terminal/ACP quiesce barrier。

`createWorkspaceCheckpointArchive()` 的 tar path/link/size 校验是正确的；问题不是 archive 结构安全，而是**多个文件可能取自 writer 的不同时间点，却被当成一致、可恢复的 Workspace safe point**。

前端的“保存检查点”只看 `busy / cancelling / needsReconciliation`，也没有 Workspace owner/session 状态可用于阻止上述情况。

**建议修复**：

- user checkpoint 与 recovery checkpoint 都先检查 durable background job；`unknown` 必须 fail closed，不能写成空数组；
- Runner 建统一的 Workspace live-owner registry / quiesce barrier，checkpoint capture 至少等待 jobs + ACP + Terminal（以及任何能写 core workRoot 的 owner）为 0；
- archive capture 应在 Runner 内获得一个与 workspace mutation owner 互斥的 snapshot lease，而不是只看某一个内存 Map；
- Host Runner restart 后，先解决 §7.87 的 orphan owner，再允许建立新的 checkpoint safe point；
- 增加 regression：① Runner restart 后 journal job=unknown 时 user checkpoint 必须拒绝；② Terminal/ACP 持续交替写两个文件时 user/recovery checkpoint 都必须拒绝或先 quiesce。

**修复（2026-09-24）**：Checkpoint service 不再把 user checkpoint 特判成 `backgroundJobs=[]`；user/recovery 两类 safe point 都统一执行 `liveBackgroundJobs()`。因此 Runner restart 后 durable job 被 startup reconciler 标成 `unknown`、Runner query 失败、或 job 仍为 pending/running 时，两类 checkpoint 都会以 `CHECKPOINT_BACKGROUND_JOB_UNRESOLVED` fail closed，不会再把未知执行历史从 manifest 擦掉。

Runner `WorkspaceRuntimeEngine` 新增 `workspaceWriters` 与 `checkpointCaptures`：`openCheckpointArchive()` 先验证当前 generation 没有 active jobs、ACP/Terminal writer 或另一 capture，再持有 snapshot lease 直到 tar archive 完成；`executeJob()` 与 `acquireWorkspaceWriter()` 都会在 capture lease 存续时拒绝新 writer，因此检查与 archive 之间不再有 TOCTOU 窗口。ACP 与 Terminal 在 WebSocket upgrade 前 acquire writer owner，只有 child 真正结束/owner drain 完成后才 release；正常自然退出同样释放。restore 也沿用 live writer/capture gate。

§7.87 已先解决 Host Runner restart 后 detached owner 的 startup reap，因此新 controller 不会在旧 Host child 仍写 Workspace 时错误建立新的 safe point。新增 `tests/backend/checkpoint-owner-gate.regression.ts`，固定 user checkpoint durable-job gate、Runner snapshot lease、新 job gate，以及 ACP/Terminal writer acquire/release wiring。Agent Runner/Backend TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.91 Checkpoint restore 在目录 rename 中点崩溃后无法 startup reconcile，可留下“ready 但 workRoot 消失”的 Workspace（P1 · ✅ 已修复 2026-09-24）

Runner 的 checkpoint restore 对**正常异常**处理是认真做过的：

- 先把上传 tar 写到 scratch；
- validate archive path/type/size；
- 解到 staging；
- 切换时先 `rename(workRoot, backup)`；
- 再 `rename(staging, workRoot)`；
- 第二次 rename 抛错时，会把 backup rename 回 workRoot；
- `finally` 也会在普通异常下清 archive/staging，并在 `workRoot` 不存在时尝试恢复 backup。

问题是这些回滚全部依赖**同一个 Node 进程继续执行 catch/finally**。如果 Runner controller / 主机恰好在两个 rename 之间异常退出：

1. 原 `workRoot` 已被原子 rename 成 `.control/checkpoints/work-backup-<token>`；
2. staging 还没有 rename 到 `workRoot`；
3. 进程直接消失，catch/finally 不会执行；
4. generation 的 `.control/state` 完全没有变化，仍是 restore 前的 `ready`；
5. journal 也没有“restore transition / backup token”持久事实。

Runner startup `Reconciler` 只调用：

`runtimeEngine.reconcile(workspace)`

而 `WorkspaceRuntimeEngine.reconcile()` 只是读取 `runtime.status(workspaceId, generation)` 并把 `ready/running/stopped/deleted` 映射回 journal；**不会检查 `core/workspace/work` 是否存在，也不会扫描 `work-backup-*` / `restore-*` scratch**。

因此上述 crash 后，重启会继续把 Workspace 保存成 `ready`，但真实：

`runtime/workspaces/<workspaceId>/core/workspace/work`

已经不存在。后续 job / terminal / file / code-intelligence 路径才会在实际访问时暴露 ENOENT/WORKSPACE_NOT_FOUND 类失败；系统没有自动选择“恢复 backup”或“完成 staging”的依据。

这不是 tar traversal 问题：archive 校验与 symlink/path 限制本身是正确的。问题是**目录级事务没有 durable commit marker / startup recovery**。

**建议修复**：

- restore 切换前持久化一个小型 transaction record：workspaceId/generation/token/phase/original path/staging/backup；
- startup reconcile 在普通 workspace 状态判断前处理未完成 restore：
  - 只有 backup、无 workRoot → 恢复 backup 或按 phase 完成 staging；
  - workRoot + backup 同时存在 → 根据 durable phase/hash 明确 finalize，不要静默删任一侧；
- transaction 成功提交后再删除 backup/record；
- 至少在 `reconcile()` 中把“state=ready 但 workRoot 不存在”判为 failed，而不是继续 ready；
- 增加故障注入：在两次 rename 之间 SIGKILL Runner → restart → 必须自动恢复到旧 workRoot 或明确 failed/reconciliation_required，不能继续呈现 ready。

**修复（2026-09-24）**：`workspace-checkpoint-archive.ts` 新增 durable restore transaction。archive 解包并校验完成后、任何目录切换发生前，先原子写入 `<workspace>/.control/checkpoints/restore-transaction.json`，记录唯一 token 与 `prepared` phase；`workRoot -> backup` 完成后推进到 `backup-moved`。transaction 文件采用同目录临时文件 + fsync + rename，确保 crash 后不会把半写 JSON 当成权威状态。

新增 `recoverWorkspaceCheckpointRestore()`，Runner startup 的 `WorkspaceRuntimeEngine.reconcile()` 在读取 generation runtime state 之前先执行恢复。只要 durable transaction 仍存在且 backup 可见，就一律恢复 frozen 旧 workRoot，并清 staging/archive/backup/transaction；这也覆盖“第二次 rename 已执行但 commit marker 尚未来得及清除”的窗口，避免把未 durable commit 的新树误当成功。如果 transaction 存在但 workRoot 与 backup 都不存在，则 reconcile 直接映射为 `failed`；此外 ready/running/stopped 状态下 workRoot 缺失也会 fail closed。

`restoreCheckpointArchive()` 同时持有现有 checkpoint lease 直到目录事务完成，避免 restore 与新 writer/capture 交错。新增 `tests/backend/checkpoint-restore-crash-recovery.regression.ts`，真实构造两次 rename 中点与“新 workRoot 已出现但 marker 未提交”两类 crash 状态，验证 startup recovery 必须回滚旧树；无可恢复 owner 时必须抛 reconciliation 错误。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.92 Terminal / ACP 外部 writer 可穿透 file patch 的 SHA precondition，并被 confirmed mutation 静默覆盖（P1 · ✅ 已修复 2026-09-24）

Workspace coding mutation 表面上已经有两层并发保护：

- Backend governed mutation 有 resource lease 与 inspection 的 frozen SHA；
- Runner 的 `write-file / move / delete / apply-patch` 路由在真正 mutation 前都会拒绝 `hasActiveWorkspaceJob(workspaceId,generation)`。

但第二层只把 **Runner Workspace job** 当 writer。Workspace Terminal 与 ACP native process 都能直接在同一 `/workspace/work` 下写文件，却不登记到 `WorkspaceRuntimeEngine.jobs`，因此不会命中该 guard。

`applyWorkspacePatch()` 自身也做了认真校验：

1. prepare 阶段读取每个文件并核 `expectedFiles.sha256`；
2. patch 全部准备完后，再次逐文件读取并核 `beforeSha256`；
3. 然后才为所有文件创建 temp、写入、fsync；
4. 最后逐个 `renameSync(temp,target)`。

问题是第 2 步到第 4 步之间仍是 OS 级 TOCTOU。Node 主线程虽然同步执行，但 Terminal/ACP 是独立进程，可以在最终 recheck 之后、rename 之前修改目标文件。Runner 没有统一 live-writer lease，也没有文件系统 compare-and-swap primitive；最后 rename 会无条件覆盖这次外部修改。

本轮做了只写 `/tmp` 的真实函数探针，直接调用仓库的 `applyWorkspacePatch()`：

- 建 16 个约 4 MiB 的测试文件，让 patch 同时修改 16 个文件，从而形成可测量的 temp/fsync 窗口；
- 基线整次约 **340 ms**；
- 外部 Python 子进程在 20 ms / 200 ms 改最后一个文件时，都落在最终 hash recheck 之前，函数正确抛 `WORKSPACE_FILE_HASH_CONFLICT`；
- 把外部写入推到 **280 ms** 后，修改发生在 final recheck 之后；
- 结果为：`durationMs=343, applied=true, error=null, externalMarkerSurvived=false, finalStarts="NEW-15..."`。

也就是说同一个 guard **既能证明早期并发被检测，也能证明 recheck 后的真实窗口可触发**。测试目录随后已删除。

这两份 Runner 文件在审计基线 `862a458..HEAD` 没有代码变化，因此探针对应 66-commit 复核范围的当前实现。

这一点和“multi-file rename 中途 I/O failure”不同：后者会抛异常，被 `ToolCallRunner.executeMutation()` 转成 `outcome:'unknown'` 并 quarantine；本条 race 中 Runner 正常返回 `applied:true`，`file_patch` 随即返回 confirmed ToolResult，Backend 会把 mutation **正常 settle 为 confirmed**。被 Terminal/ACP 写入的新内容已经丢失，却没有 conflict / reconciliation 信号。

同一 owner blind spot 也存在于 write/move/delete 路由；其中 move 有 post-rename hash verification，部分 race 会转成 unknown，而 delete 在初次 hash check 后直接 `rmSync`，同样缺少与外部 writer 的统一互斥。本条以已动态复现的 multi-file patch 为确定证据，不扩大到未实测的每一种竞态。

**建议修复**：

- 把 Workspace mutation ownership 从“只看 active job”提升为统一 live-writer owner：jobs、Terminal、ACP 以及其它可直接写 core workRoot 的 runtime 都进入同一个 mutation/quiesce 协议；
- governed file mutation 执行期间必须取得能阻止这些外部 writer 的 Workspace snapshot/mutation lease；仅重复 hash recheck 不能消除 OS 进程并发窗口；
- 如果 Terminal/ACP 无法合作实现细粒度文件锁，至少在其 write-capable session/process 活跃时拒绝 governed file mutation，或先 quiesce 对应 owner；
- confirmed 只能在冻结 precondition 从检查到 commit 都受保护时返回；无法保证时应 fail closed 为 conflict/unknown，而不是把最终 rename 当作成功证明；
- 增加 race regression：外部 writer 在 final hash recheck 后、rename 前改目标文件，mutation 必须拒绝/unknown，绝不能 `applied:true` 后静默覆盖。

**修复（2026-09-24）**：复用 §7.90 已建立的 `workspaceWriters`，在 `WorkspaceRuntimeEngine` 增加 `workspaceMutations` 与统一 `withWorkspaceMutation()`。write/move/delete 以及 non-dry-run patch 在进入任何文件系统 mutation 前，必须确认同一 `workspaceId+generation` 没有 Engine job、ACP/Terminal writer、checkpoint capture/restore 或另一 mutation lease；否则直接抛 `WORKSPACE_WRITER_ACTIVE_CONFLICT`，Runner HTTP 会作为 409 conflict 回传，Backend 不会得到 `applied:true` confirmed 结果。

mutation lease 从最终 owner 检查一直持有到同步文件 mutation 返回；ACP/Terminal 的 `acquireWorkspaceWriter()` 也会拒绝正在持有 mutation lease 的 generation，`executeJob()` 与 checkpoint capture/restore 同样观察该 lease。由于真正的 write/move/delete/apply-patch 是同步临界区，Node controller 在 lease 持有期间不会接受新的 session callback；而已经存在的独立进程 writer 会在进入临界区前被 `workspaceWriters>0` 拒绝，因此 final SHA recheck 到 rename 之间不再存在已登记 Terminal/ACP writer 的静默覆盖窗口。

新增 `tests/backend/workspace-live-writer-mutation-guard.regression.ts`，行为级注入 active writer owner，验证 write/move/delete/patch 全部 fail closed，并验证 mutation lease 存续时新 ACP/Terminal writer 无法进入。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.93 Workspace lifecycle 不等待 background job 真正退出；stop / restart / delete 可在旧进程树仍存活时成功（P1 · ✅ 已修复 2026-09-24）

Runner 对 Workspace background job 的取消机制本身会杀整个 process group，但 lifecycle owner 没有等待这个动作完成。

`WorkspaceRuntimeEngine.stop()/restart()/remove()` 都先调用：

`this.abortJobs(workspaceId, generation)`

而 `abortJobs()` 的实现只是：

- 对当前 Map 中每个 controller 调 `controller.abort()`；
- **立即** `this.jobs.delete(key)`；
- 不保存/await `JobRunner.run()` 返回的 Promise，也不等待 child `close`。

`JobRunner` 收到 Abort 后会同步发 SIGTERM，但允许最多 2 秒 graceful window；超时才 SIGKILL，Promise 只有真正收到 `close` 后才 settle。与此同时 `workspaceAction()` 已继续执行：

- stop：写 runtime state=stopped，journal 保存 stopped，command succeeded；
- restart：写 runtime state=running，重新 activate Runner Plugin，journal 保存 running，command succeeded；
- delete：删除 generation root，journal 保存 deleted，command succeeded。

Backend 在发 stop/restart/delete 前也没有 durable job barrier；`workspaceInvalidated` hook 只关闭 Browser/Terminal，并不会等待 Runner job。

本轮直接调用真实 `JobRunner` 做了无侵入探针：child 使用 shell trap 忽略 SIGTERM，100ms 后触发 Abort。结果：

`elapsedMs=2107, exitCode=null, signal="SIGKILL", stdout="ready", timedOut=false`

即 Abort 发出后，真实 child process group 还能存活约 2 秒；Runner lifecycle 当前不会等待这段时间。

Server 的 `hasActiveWorkspaceJob()` 使用 journal，因此在 job 真正 close、journal 从 running 转终态之前，新的 Workspace job 与 file mutation 仍会被挡住，这是正确的；但仍有三个确定缺口：

1. **restart owner overlap**：新 runtime / Runner Plugin 已重新 active，旧 background job 仍可能继续执行和写 core Workspace；
2. **lifecycle 状态不真实**：API/command 已显示 stopped/running/deleted，但 owner 子进程树尚未完成回收；
3. **Engine 内存 gate 提前消失**：`abortJobs()` 已删除 `WorkspaceRuntimeEngine.jobs`，因此只依赖该 Map 的 owner safety（例如 checkpoint capture，见 §7.90）会在 journal job 尚 running 时提前失去保护。

这与 §7.87 不同：§7.87 是 Runner controller 异常重启后 detached child 彻底失去 owner；本条在**正常 lifecycle 命令**下就能稳定触发，而且 kill 最终通常会成功，但 command 成功边界提前了约 0–2 秒。

**建议修复**：

- `abortJobs()` 改成 async drain：触发 abort 后 await 对应 job Promise/process-group close，再从 live owner registry 移除；
- stop/restart/delete 的 success commit point 必须在所有 background job 子进程树真正退出之后；
- 超过 kill deadline 仍无法确认退出时，不得继续标 lifecycle succeeded；应进入 failed/reconciliation_required；
- owner registry 与 journal 状态应在 child close 后一起收敛，不能先清 Engine Map；
- 增加 regression：job trap SIGTERM → Stop/Restart/Delete；命令在约 2 秒 SIGKILL close 前不得 succeeded，Restart 不得在旧 job 存活时 activate 新 owner。

**修复（2026-09-24）**：`WorkspaceRuntimeEngine.jobs` 从裸 `AbortController` 集合升级为 durable-in-process live owner record：每个 active job 同时保存 controller 与只在 `executeJob()` finally / `JobRunner.run()` 已完成后 resolve 的 `done` Promise。`cancelJob()` 仍只触发单 job abort；而 stop/restart/remove 统一走 `drainJobs()`，先为该 `workspaceId+generation` 建立 `workspaceJobDrains` gate，再 abort 当前全部 job 并 `await Promise.all(done)`，最后才调用 runtime `stop/restart/remove`。

Engine 不再在 abort 时提前删除 `jobs` Map；owner 只有在 JobRunner 收到 child `close` 后、`executeJob()` finally 中才移除。JobRunner 现有 TERM→2s→KILL 语义保持不变，因此 lifecycle 会真实等待 graceful/forced termination 完成。drain gate 从 abort 前一直持有到 runtime state commit 完成；新的 `executeJob()` 在 gate 存续时直接 `WORKSPACE_JOB_ACTIVE_CONFLICT`，避免 snapshot drain 后又插入新 owner。

新增 `tests/backend/workspace-job-lifecycle-drain.regression.ts`：真实启动忽略 SIGTERM 的 shell job，随后调用 `engine.stop()`；验证约 2 秒强杀窗口内 live owner 仍在 Map、late job 被拒绝、`runtime.stop()` 只有 child close 后才执行。Agent Runner TypeScript、focused regression、Prettier 与 `git diff --check` 均通过。

---

### 7.94 toolchain switch 可在旧 generation ACP / Terminal 仍存活时启动新 generation，旧代进程可继续写新代 workRoot（P1 · ✅ 已修复 2026-09-24）

继续沿 generation lifecycle 反查后，确认 §7.89 / §7.93 的“owner drain 不是 success barrier”会在 **toolchain/version switch** 上形成一个更具体的跨代污染窗口。

Backend 的 `switchToolVersions()` 顺序是：

1. 把稳定 workspace 状态 reservation 成 `stopping`；
2. dispatch 旧 generation 的 `delete`；
3. **只要 delete command 返回 succeeded**，立即把 generation +1 并更新 frozen profile；
4. dispatch `provision(g+1)`；
5. 如果旧 workspace 原本 running，再立即 `start(g+1)`。

Runner 的 old-generation delete 则是：

- `acpRuntime.closeWorkspace(workspaceId, generation)`；
- `terminalRuntime.closeWorkspace(workspaceId, generation)`；
- `browserTunnel.closeWorkspace(...)`；
- await Runner Plugin dispose；
- `runtimeEngine.remove(oldGeneration)`；
- journal 保存 `deleted`，command succeeded。

问题在前两步不是 drain barrier：

- ACP `close()` 立即把 instance 从 active Set 移除，然后 `void terminateManagedProcess(child)`；
- `terminateManagedProcess()` 允许约 2 秒 SIGTERM grace，再 SIGKILL 后继续等待；
- Terminal close 同样立即移出 active Set / close socket，发 TERM 后用约 2 秒 timer 再 KILL；
- `workspaceAction(delete)` 不 await ACP/Terminal 的真实 child close。

而 Workspace 项目目录本来就是 workspace-scoped 持久目录：

`runtime/workspaces/<workspaceId>/core/workspace/work`

**不随 generation 重建**。generation 只冻结运行环境/toolchain。

因此可稳定形成：

1. generation N 正在 running，Terminal/ACP child 当前 cwd 位于持久 `/workspace/work`；
2. 用户切换 toolchain；
3. Runner 对旧 child 发 TERM，但它忽略/延迟退出；
4. old-generation delete 已返回 succeeded；
5. Backend 立即 provision/start generation N+1；
6. 新代已经对外呈现 ready/running；
7. 旧 generation child 仍可在后续 0–3 秒继续读写同一个 workRoot。

后果：

- generation freeze 只冻结 profile/toolchain，却没有冻结**writer ownership**；
- 新 generation 的 job / Runner Plugin / checkpoint / governed file mutation 可以与旧代 ACP/Terminal 同时作用于同一项目树；
- 旧代使用的是上一代环境/profile，但写入会直接成为新代可见文件状态，且没有“来自 stale generation”的标记；
- 这不是单纯的 cleanup race：即使永远不执行 runtime cleanup，跨代 writer overlap 已经发生。

§7.93 已证明 background job 也存在 restart owner overlap；本条补的是 **ACP/Terminal + toolchain generation switch**，它们不在 job journal/Engine jobs Map 里，因此不能靠 §7.93 当前的 job guard 自动覆盖。

**建议修复**：

- old-generation delete 的 succeeded commit point 必须等待 **所有** generation-owned writer 真正退出：jobs + ACP + Terminal + Runner Plugin（Browser socket 也应关闭确认）；
- generation switch 在 owner drain 未确认前不得 reconfigure/provision N+1；
- 建统一 `WorkspaceGenerationOwnerRegistry`，所有可写 core workRoot 的 runtime 都按 `workspaceId+generation` 注册/退出；
- drain 超时进入 failed/reconciliation_required，不能把旧代 writer 留给新 generation；
- 增加 regression：旧代 ACP/Terminal trap/忽略 SIGTERM → toolchain switch；N+1 在旧 child close 前不得 provision/start，且旧 child 不得在 N+1 ready 后继续修改 workRoot。

**修复（2026-09-24）**：在 §7.89 的 ACP/Terminal awaitable close 与 §7.93 的 job drain 之上，再为 generation lifecycle 增加 admission gate。`WorkspaceRuntimeEngine.beginWorkspaceLifecycleDrain(workspaceId,generation)` 在 stop/restart/delete 开始时 claim `workspaceLifecycleDrains`；Runner `workspaceAction()` 在任何 ACP/Terminal close 之前建立 gate，并一直持有到 runtime state / journal commit 完成。gate 存续期间新的 ACP/Terminal writer、background job、governed file mutation 与 checkpoint capture/restore 都 fail closed，消除“已经 snapshot owner 集合后又插入旧 generation writer”的窗口。

old-generation delete 现在必须依次跨过：生命周期 admission gate → ACP/Terminal 真实 close barrier → Browser close → Runner Plugin dispose → `runtimeEngine.remove()` 内 background job drain → journal `deleted`。Backend `switchToolVersions()` 原有顺序保持不变：只有 delete command `succeeded` 才会 reconfigure 到 generation N+1，再 dispatch provision/start。因此 N+1 的创建边界严格位于 N 全部 write-capable owner 已退出之后。

新增 `tests/backend/toolchain-generation-owner-drain.regression.ts`：验证 lifecycle gate 存续时旧代 ACP/Terminal 与 Job 无法进入，并静态锁定 Runner delete barrier 在 remove/success 前完成，以及 Backend delete-succeeded gate 位于 reconfigure/provision 之前。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.95 普通 Workspace restart 也不等待 ACP / Terminal 真正退出，旧 session 可与已重启 runtime 同时存活（P1 · ✅ 已修复 2026-09-24）

§7.94 是 toolchain switch 的跨 generation writer overlap；继续回看普通 `restart` 后，确认即使 **generation 不变化**，成功路径也存在同类 owner drain 提前。

Runner `workspaceAction(restart)` 的顺序是：先 `acpRuntime.closeWorkspace()`、`terminalRuntime.closeWorkspace()`、关闭 Browser，await Runner Plugin dispose；随后直接 `runtimeEngine.restart()`、重新 `pluginRunner.activateWorkspace()`，最后把 journal 保存为 `running`。

问题是 ACP / Terminal 的 close 都不是 drain barrier：ACP 会立刻从 active Set 移除，然后 `void terminateManagedProcess(child)`；Terminal 也先移出 active Set/关 socket，再发 TERM 并用 timer 延后 KILL。两者都可能再存活约 2–3 秒。

因此普通 restart 可以在旧 ACP/Terminal child 仍活着时重新启动 runtime / Runner Plugin，并把 Workspace 对外标成 running。旧 child 与新的 owner 共享同一个持久 `runtime/workspaces/<workspaceId>/core/workspace/work`，仍可并发修改项目文件。

这与 §7.93 的 background job restart overlap 是并列缺口：只把 `abortJobs()` 改成 awaitable 并不能处理 ACP/Terminal；也与 §7.94 不同，本条不需要 generation switch，普通“重启工作区”即可触发。

**建议修复**：ACP/Terminal `closeWorkspace()` 返回可 await 的 drain Promise；restart 在所有 write-capable owner 真正 close 前不得 restart runtime、activate plugin 或 commit running；与 §7.93/§7.94 收敛成统一 Workspace owner-drain barrier，超时进入 failed/reconciliation_required，并补“旧 shell/ACP 忽略 SIGTERM → restart 不得提前成功”的 regression。

**修复（2026-09-24）**：该缺口现在由三层已落地 barrier 共同关闭：§7.89 把 ACP/Terminal `closeWorkspace()` 改为真正可 await，ACP 直到 `terminateManagedProcess()` 完成才删除 active owner，Terminal 直到 child `close` 才 resolve；§7.93 让 `runtimeEngine.restart()` 在真正写入 restarted state 前 abort 并 await 全部 background job；§7.94 又在 restart 一开始 claim generation lifecycle admission gate，阻止 close snapshot 之后新的 ACP/Terminal/job/file mutation/checkpoint owner 插入。

`workspaceAction(restart)` 的成功顺序因此固定为：claim lifecycle gate → await ACP + Terminal close → Browser close → await old Runner Plugin dispose → `runtimeEngine.restart()`（内部 job drain）→ activate Runner Plugin → journal `running` → finally release lifecycle gate。任何 ACP/Terminal drain timeout、job drain failure 或 restart/plugin activation failure都会中断成功路径；旧 session 不再能与已重启 runtime/plugin 同时存活并写同一个 workRoot。

新增 `tests/backend/workspace-restart-owner-barrier.regression.ts`，独立锁定 restart 分支的 owner-close/dispose/restart/activate/running-commit 顺序，以及 ACP/Terminal owner 只有真实 child termination 后才释放、Engine restart 先经过 job drain、lifecycle gate 覆盖整个 restart critical section。focused regression、Agent Runner TypeScript、Prettier 与 `git diff --check` 均通过。

---

### 7.96 手动 checkpoint resume 先提交新 Run、后 restore Workspace；restore 失败后重试会因新幂等 key 再创建一个 Run（P1 · ✅ 已修复 2026-09-24）

Checkpoint resume 的 Backend 幂等机制本身可以 replay，但手动 UI 没有保留同一个恢复意图的 key，且 durable commit point 放在 Workspace restore 之前。

`CheckpointService.resume()` 的顺序是：先完成 checkpoint/model/provider/definition/workspace manifest validation；随后调用 `stateCommit.createRun(...)` 创建新的 resumed Run；**只有 createRun 已 durable commit 后**，才根据新 Run 的 runtimeId 调 `workspaceCheckpoints.restore(...)`。如果 restore 抛错，方法直接失败退出，此时新 Run 已经存在，后续 source audit、approval supersede、`onCreated()` 尚未执行。

前端 `agentApi.resumeRun()` 每次调用都现场生成 `crypto.randomUUID()` 作为 Idempotency-Key。`AgentAppSurface.resumeCheckpoint()` 失败时调用 `recoverRuntimeFailure(cause, snapshot.id)`，这里传的是**source Run id**；由于客户端从未拿到 `committed.run.id`，无法查询刚刚已经创建的新 Run。

于是可形成：① source Run 点击“恢复为新 Run”；② Backend 已创建 resumed Run；③ Workspace restore 失败/连接中断；④ API 返回失败，UI 仍停在 source Run；⑤ 用户再次点击恢复；⑥ 前端生成新 key；⑦ Backend 把它当成新 create command，再创建第二个 resumed Run。

自动 backend-restart recovery 不受同一问题影响：它把 `checkpoint.id` 作为稳定 idempotency key；失败后 retry 会 replay 同一个 resumed Run，再次尝试 restore。这说明正确恢复模式已经存在，缺口集中在手动 UI 的 key 生命周期。

**建议修复**：手动 resume 在用户恢复意图层生成并持有稳定 key；restore outcome 未确认前重试必须复用同 key。更稳妥地把 resumed Run 的“created但workspace restore pending”做成 durable recovery phase，restore 失败时标 reconciliation_required/failed，而不是让 API 只抛错；前端也应能按 stable request key 查询/恢复已创建的新 Run。

**修复（2026-09-24）**：手动 resume 已改成与 create-run 相同的 caller-stable intent identity 模式。`AgentAppSurface` 新增 `pendingCheckpointResumeIdentity`，fingerprint 固定为 `[sourceRunId, checkpointId, sourceVersion]`；第一次恢复为该 intent 生成 UUID，后续同 intent 无论上一次是 restore 失败、transport failure 还是 outcome unknown 都复用同一个 key。只有 `facade.resumeRun()` 成功返回 resumed Run 后才清除 identity；catch/recovery 路径不会清 key。切换到不同 checkpoint、不同 source run 或新的 source version 会自然生成新的 operation identity，避免不同 payload 误复用同一 key。

`agentApi.resumeRun()` 与 `run-facade.ts` 现在要求 caller 显式传入 idempotency key，API 层不再 `crypto.randomUUID()`。Backend 原有语义保持：`CheckpointService.resume()` 先 `requireIdempotencyKey()`，`stateCommit.createRun()` 以该 key + request hash 做 durable replay；即使第一次调用已提交 Run、随后 Workspace restore 抛错，第二次相同 key 会 replay 同一个 `committed.run`，随后再次执行 workspace restore，而不会再次随机分配 run/runtime id。backend-restart recovery 继续使用 `checkpoint.id` 作为稳定 key。

新增 `tests/backend/checkpoint-resume-idempotency.regression.ts`，锁定 API 不再内部生成 key、facade 完整透传、UI 失败路径保留 intent identity 且成功后才清除，并核对 Backend createRun replay 位于 Workspace restore 之前、restart recovery 仍使用 checkpoint identity。Frontend `vue-tsc`、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.97 Workspace lifecycle 的 expectedVersion 不是原子 claim；并发不同 action 可同时通过并由最后完成者覆盖（P1 · ✅ 已修复 2026-09-24）

继续反查 Workspace lifecycle 的 optimistic concurrency 后，确认当前 `expectedVersion` 只做**读时检查**，并没有在 dispatch 前原子占用该版本。

Backend `action()` 的顺序是：

1. `repository.getWorkspace()`；
2. 比较 `workspace.version === expectedVersion`；
3. 直接 `dispatch(...)` 创建 runtime command。

这里没有 `UPDATE ... WHERE version=?` 把 Workspace 先推进 `starting/stopping/deleting`，也没有 lease/command epoch。不同 action 的 `operationHash` 不同，因此两个请求即使都基于同一个 version，也会各自创建命令。

Runner 侧同样没有 per-workspace 串行器：`beginCommand()` 把每条 pending command 设成 running 后直接：

`void this.executeWorkspaceCommand(command)`

所以两个不同 lifecycle command 会真实并发执行 `workspaceAction()`。

这在多 tab 下是可达的：tab A / B 都拿到 Workspace version `v`，一个发 `stop`，另一个发 `restart`（或 `start/delete` 等），两边的 Backend 请求可以在任一 projection 落库前同时读到 `v` 并通过校验。

更关键的是 completion projection 并不会使用“命令创建时的 expectedVersion”做 CAS。`syncWorkspaceStatus()` 会：

- 命令完成后重新 `getWorkspace()`；
- 基于**此刻最新**的 `workspace.version` 计算 next status；
- 调 `setWorkspaceStatus(..., workspace.version, next)`；
- `STATE_CONFLICT` 还会被静默吞掉。

因此 optimistic concurrency 实际退化成了**完成顺序语义**：

- stop 先完成 → projection 把 `v` 改成 stopped / `v+1`；
- restart 后完成 → 再读到 `v+1`，照样把它改回 running / `v+2`；
- 两个请求最初明明都提交了同一个 stale `expectedVersion=v`，却都可以返回成功。

Runner 的物理副作用同样会交叉：ACP/Terminal close、Plugin dispose/activate、runtime state 写入、background job abort 都没有单 workspace command barrier；这会放大 §7.93–§7.95 已确认的 owner-drain 窗口。

这不是“用户连续点两次同一按钮”的重复请求：同 action + 同 payload 会被 operationHash replay；问题集中在**不同 action**，例如 Stop vs Restart、Restart vs Delete，或两个 tab 对同一旧状态作出不同决策。

**建议修复**：

- 在 Backend dispatch 前做原子 lifecycle claim：`UPDATE workspace SET status=<transitional>, version=version+1 WHERE id=? AND version=? AND status IN (...)`；claim 失败直接 `STATE_CONFLICT`；
- command 记录绑定 claimed workspace version / lifecycle epoch，completion projection 只能提交到该 epoch，不能重新读最新 version 后“顺手继续”；
- Runner 再增加 per-`workspaceId:generation` lifecycle queue / mutex 作为第二道防线，避免即使 Backend 重复 dispatch 也并行执行物理副作用；
- 加双请求 regression：同 version 并发 `stop + restart`、`restart + delete`；最多一个 command 能取得 lifecycle claim，另一个必须 conflict，不能出现两个都 succeeded。

**修复（2026-09-24）**：`WorkspaceRuntimeService.action()` 现在在任何 runtime command 创建前先做 lifecycle CAS claim。基于用户提交的 `expectedVersion`，start 原子推进到 `starting`，stop/restart 推进到 `stopping`，delete 推进到 `deleting`；repository 的 `UPDATE ... WHERE version=?` 同时把 version+1，因此两个 tab 即使都先读到同一个旧快照，也只有第一个 action 能得到 claim，第二个 action 会在 `dispatch()` / `createCommand()` 之前直接 `STATE_CONFLICT`。如果 dispatch 在 command durable 记录前抛错，会以 claimed version best-effort rollback 到 previous status；remote outcome unknown 则保留 transitional state，不伪造终态。

每条 lifecycle command 的 durable request 现在携带 `lifecycleClaim: { version, previousStatus }`。`syncWorkspaceStatus()` 先校验当前 Workspace 仍处于该 claimed version；只有 epoch 完全匹配时才允许 success/failure projection，并使用 claim version 做最终 CAS。command replay、late completion 或其它 action 已把 Workspace 推进到新 version 时，旧 command projection 直接退出，不再“重新读取最新 version 后顺手覆盖”。failed stop/start/delete 会恢复 claim 前状态，failed restart 保持既有 fail-closed 到 `failed` 语义。

Runner 的 `workspaceLifecycleDrains` 也扩展到 start：`workspaceAction()` 现在在区分 start/stop/restart/delete 之前就 claim generation lifecycle gate，任何并发第二条物理 lifecycle command 会 fail closed。新增 `tests/backend/workspace-lifecycle-atomic-claim.regression.ts`，用 barrier 强制 stop/delete 两请求同时读到 version 7，验证仅一个创建 runtime command、另一个 `STATE_CONFLICT`，且 completed command 不能再次投影穿过 version 9；既有 restart-plugin-failure fixture 同步补上 gate stub。Backend/Agent Runner typecheck、focused regressions、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.98 Toolchain 的全局 canonical symlink 会让不同 frozen digest 的 Workspace 互相改写 PATH 解析（P1 · ✅ 已修复 2026-09-24）

Runner 对 Toolchain Pack 的**存储身份**是 content-addressed 的：

`<packsRoot>/<family>/<version>/<contentDigest>`

Workspace metadata 也冻结完整 `familyId / versionId / contentDigest`，`prepareExecution()` 不会拿旧 Workspace 的 digest 重新对当前 catalog 做替换；这允许旧 generation 在 catalog revision 更新后继续使用已经安装的旧 digest。

但进程实际执行时没有直接使用 digest path，而是每次 `prepareExecution()` 都先：

`this.store.activate(pack)`

`ToolchainStore.activate()` 把一个**全局共享** canonical symlink：

`/opt/nexus/packs/<family>/<version>`

切到当前 ref 的 content-addressed target。随后 job/ACP/Terminal 的 `PATH` 里加入的也是：

`/opt/nexus/packs/<family>/<version>/bin`

而不是冻结 digest 的真实目录。

这与存储/cleanup 语义矛盾：

- `ToolchainStore.path(ref)` 明确把 contentDigest 纳入路径；
- cleanup / uninstall 的 in-use 判断也按精确 `family/version/contentDigest`；
- 因此系统允许两个 Workspace 同时保留同 family/version 的不同 digest，例如 Runner 重启后 catalog 对同一 version 更新了内容，而旧 Workspace 继续引用旧 digest。

此时任何另一个 Workspace 的 `prepareExecution()` 都会改写全局 canonical symlink。已经运行中的 Terminal / ACP / 长寿命 shell 虽然环境变量 `PATH` 字符串不变，但下一次按 PATH 查找 `node/python/go/...` 时会重新沿 symlink 解析，可能落到**另一 Workspace 的 digest**。

同一个 alias 还有 crash-consistency 缺口：`activate()` 先创建 temporary symlink，随后对现有 canonical 执行 `rmSync(canonical)`，最后才 `renameSync(temporary, canonical)`。这不是原子 replace；Runner 若恰在 rm 与 rename 之间退出，canonical path 会直接缺失。由于旧 Terminal/ACP/job 的 PATH 也引用这个 alias，它们下一次解析 tool binary 会立即失败，直到某个后续 `prepareExecution()/activate()` 再次重建链接。

本轮做了无侵入 `/tmp` 探针验证这一文件系统语义：

- 长寿命 bash 的 PATH 固定为 `<canonical>/bin`；
- 第一次 `nxprobe` 输出 `digest-one`；
- 仅把 canonical symlink 从 d1 切到 d2，不改 shell 的 PATH；
- 同一个 shell 第二次执行 `nxprobe` 输出 `digest-two`。

因此这不是“新进程才会读新链接”的理论风险。

影响：

- Workspace generation 声称冻结的 toolchain contentDigest 不能真正约束长寿命执行环境；
- 两个 Workspace/两代 generation 可以通过普通执行互相改写对方后续命令解析；
- Terminal 用户在会话中先后执行同一命令，二者可能来自不同 digest，而 UI / metadata 仍显示原 frozen snapshot；
- 如果同 versionId 的 pack 被重新构建/重签、行为发生变化，这会成为不可审计的环境漂移。

**建议修复**：

- Workspace execution PATH 直接使用 `ToolchainStore.path(ref)/bin` 的 digest-qualified 目录，不依赖全局 family/version canonical symlink；
- canonical symlink 只可作为管理员/调试便利入口，不进入 frozen Workspace 的执行环境；
- 若仍保留 canonical alias，更新至少必须使用 filesystem atomic replace，禁止 `rm → rename` 暴露 missing-path crash window；
- 如果某些工具内部硬编码 canonical prefix，需要为每个 workspace/generation 建独立 immutable view（例如 generation-scoped symlink tree），而不是全 Runner 共享一个 alias；
- 加 regression：同时保留 same family/version + two digests，启动 Workspace A Terminal 后让 Workspace B activate 另一 digest；A 后续命令仍必须解析 A 的 digest。

**修复（2026-09-24）**：保留既有 source-pack / catalog digest 契约，不对已安装的 verified tree 做原地迁移。`ToolchainStore` 新增 `executionPath(ref)`：先确认 source pack 的 install marker 仍匹配 frozen `contentDigest`，随后以 digest 为 key，在 `<packsRoot>/.runtime/<family>/<version>/<digest>` 创建独立 runtime view。view 从只读 source pack 复制到 deterministic staging，验证相对 symlink 不逃逸、仅对 UTF-8 小型文本执行 relocation，把 source pack 中 `/opt/nexus/packs/<family>/<version>` canonical 前缀替换为最终 digest view 的绝对路径；完成后整棵 tree 锁成只读并原子 rename 到目标。这样旧 schema/source pack 也能在首次执行时安全得到自包含视图，无需修改已被长寿命进程读取的 source bytes。

`WorkspaceRuntimeManager.prepareExecution()` 不再调用 `store.activate()` 或把 canonical alias 放进 PATH；Job、ACP、Terminal 都只使用 `store.executionPath(pack)/bin`。同 family/version 的多个 digest 可同时存在并拥有不同 execution root，另一 Workspace 创建/使用 digest B 不会改变已经运行的 Workspace A PATH 或 pack 内绝对引用。`ToolchainStore.remove()` 同步清理对应 digest runtime view/staging；canonical alias 方法保留为兼容/调试入口，但 `activate()` 改为直接 `renameSync(temporary, canonical)` 覆盖旧 symlink，不再先删除 canonical，因此不存在 crash 时 alias 暂时消失的 `rm→rename` 窗口。

新增 `tests/backend/toolchain-digest-execution-view.regression.ts`：真实构造同 family/version 的两份 frozen digest source pack，验证两个 execution view 路径不同、内部 canonical 前缀各自 relocation 到自己的 digest root，并在生成 B view 后用 A 的既有 PATH 再次执行 probe，结果仍为 digest A；同时锁定 `prepareExecution()` 不再依赖 activate/canonical，且 pack remove 会回收 execution view。Agent Runner TypeScript、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.99 Safety Network 一次连接加载失败后不会自恢复，共享 store 已恢复也仍永久显示失败态（P2 · ✅ 已修复 2026-09-24）

`SafetyNetworkSettings.vue` 只在 `onMounted()` 执行一次 `loadConnections()`：成功时设置 `connectionsResolved=true`，失败时设置 `connectionLoadFailed=true`。组件没有 Retry 按钮，也没有 watch `connectionsStore.loaded/connections` 来清这个本地失败标志。

这不是单纯“首次 GET 失败要刷新页面”这么弱：连接数据来自全局 Pinia `connectionsStore`，其它页面/组件（ConnectionsView、TaskRail、Dashboard 等）随后都可能再次调用同一个 store 的 `load()/revalidate()` 并成功恢复 `items/loaded`。但 Safety Network 的本地 `connectionLoadFailed` 不会因此变回 false。

模板顺序又是 `v-if=loadingConnections` → `v-else-if=connectionLoadFailed` → 正常列表，因此即使共享 store 已经有完整 connections，本卡片仍只显示 `connectionLoadFailed` 错误，denylist 连接选择器与 orphan-id 判定都继续被遮住；由于 Agent Settings 的访问分组使用 `v-show` 保持挂载，切分组再回来也不会重新触发 `onMounted()`。

**建议修复**：失败态提供显式 Retry；更重要的是把失败状态绑定到 store 的实际 load generation/loaded 状态，后续共享 store 成功时自动清除本地 error 并设置 `connectionsResolved=true`。不要把一次 mount-time promise rejection 持久化成独立于权威 store 的永久 UI 状态。

**修复（2026-09-24）**：`SafetyNetworkSettings.vue` 不再把 `connections.length > 0` 当成“完整列表已解析”的代理条件，而是直接使用 `useConnections().loaded`。这同时修复了“服务端合法返回空列表时 `connectionsResolved` 永远 false”的隐性边界：只有共享 store 真正完成一次权威 list load，组件才允许基于完整集合计算 orphan denylist IDs。

连接加载逻辑收敛为可复用 `loadConnections(force)`；mount 调普通 load，错误卡 Retry 调 `loadConnections(true)`。组件 watch `connectionsStore.loaded`：任何其它 Connections 页面/TaskRail 后续成功 load/revalidate 后，只要共享 store 进入 `loaded=true`，立即把 `connectionsResolved=true` 并清 `connectionLoadFailed`，不再要求 Safety Network remount。catch 也只在 store 仍未 loaded 时保留失败态，避免并发共享请求已恢复却被旧本地 catch 再覆盖成错误。

新增 `tests/backend/safety-network-connection-recovery.regression.ts`，锁定 resolved 状态以 `store.loaded` 为准、共享 loaded 恢复会清本地 failure、mount/Retry 共用 load path 且 Retry 强制刷新。Frontend `vue-tsc`、focused regression、ESLint、Prettier 与 `git diff --check` 均通过。

---

### 7.100 Migration #23 / #34 只检查第一列，配合“duplicate column 视为成功”可把 partial schema 永久标成已迁移（P1 · ✅ 已修复 2026-09-24）

继续补审此前附录明确未覆盖的 SQLite 老库升级路径时，确认 migration runner 对**部分已应用 schema**的兼容策略存在确定缺口。

Runner 的通用行为是：

1. 每个 migration 开事务；
2. 先执行可选 `check()`；
3. `check=false` 时**跳过整段 SQL**；
4. `db.exec(migration.sql)` 若抛错，只要 error message 含 `duplicate column name`，就把错误当成“可接受”并继续；
5. 最后无条件写入 `migrations(id,...)` 并 commit。

这个策略对“单列 ADD COLUMN”通常可工作，但 Agent 至少有两个 migration 在**一条 migration 里新增多列**，而 check 只看第一列。

**Migration #23：**

- check 只判断 `agent_tool_calls.source_model_step_id` 是否不存在；
- SQL 实际依次新增：
  - `source_model_step_id`
  - `batch_index`
  - `batch_size`
  - 再创建 batch-lineage index。

若数据库已经有 `source_model_step_id`，但缺 `batch_index/batch_size`，check 会直接返回 false；runner 跳过整段 SQL，却仍把 #23 记录成已完成。随后 #25 会直接引用 `batch_index/batch_size` 做 UPDATE，升级会在**更晚的 migration**才因缺列失败，错误归因也会被误导。

反方向的 partial state 同样危险：若 `source_model_step_id` 缺失、但 `batch_index` 已存在，check=true；第一条 ALTER 成功，第二条因 duplicate column 抛错。通用 catch 吞掉 duplicate，**不会继续执行剩余 SQL**，却仍记录 #23。结果可能是 `batch_size` / index 缺失。

**Migration #34：**

- check 只判断 `agent_approvals.kind` 是否不存在；
- SQL 实际新增 `kind` 和 `inspection_json` 两列。

因此“kind 已有、inspection_json 缺失”会被直接 skip+record；“kind 缺失、inspection_json 已有”则会在第二条 ALTER duplicate 后被吞错+record。当前 approvals decode / HTTP 路径会读取 `inspection_json`，这种半迁移库不是纯 metadata 偏差，而会变成运行期查询/解码失败。

这类 partial state 并非只能由手工破坏产生：代码已经专门保留了历史 migration ID、folded base schema 与 duplicate-column 容错，说明项目明确支持长期数据库 / schema drift；既然选择兼容 partial schema，check 与错误处理就必须按**完整 postcondition**判断，不能只看第一列。

需要限定触发面：#23 与 #34 的 migration 和对应 current base-schema 列是在各自同一 commit（`8fe4d7b` / `bd6c714`）进入历史的，因此标准“上一正式 schema → 下一正式 schema”的线性升级不会自然只得到其中一列；本条主要针对项目已经主动兼容的长期/灰度/恢复型 schema drift，不应表述成所有正常升级必现。

本轮同时排除了两个疑似 migration 问题：

- #36 把旧 Subagent file capability 统一收紧到 workspace scope，是 `1aef733` 同次改造里明确的 `restrictTargets(..., ['workspace'])` 设计，不是 SSH scope 遗漏；
- #43 的 legacy `workspace_job.data.status` 来自当时 `WorkspaceJobView.status`，历史集合与当前 semantic decoder 的 6 个状态一致，没有额外 timeout 枚举漂移。

现有 migration regression 也没有覆盖该边界：`capability-grant-migration`、`legacy-machine-inspection-migration`、`durable-context-checkpoint` 都从**完整 legacy baseline**起步再跑到 current version，没有构造“multi-column migration 只存在部分列”的 fixture。

**建议修复**：

- 每个 multi-column migration 的 `check()` 检查**完整 postcondition**：全部列 / index / trigger 都存在才允许 skip；
- 不要全局吞任意 `duplicate column name` 后把整条 migration 视为完成；应按 statement/postcondition 恢复，或把 migration 写成逐列条件式操作；
- migration commit 前增加 `verify()` / schema assertion，#23 明确验证 3 列 + index，#34 验证 2 列；
- 加 partial-schema regression：分别构造“只已有第一列”“只已有第二列/中间列”的 SQLite fixture，跑 migration 后必须得到完整当前 schema，且 migration id 只有在 postcondition 全满足后才能记录。

**修复（2026-09-24）**：migration 定义新增可选 `apply()` / `verify()` 钩子，并把 #23 / #34 迁移到专用 partial-schema 恢复路径。#23 的 `check()` 现在只有在 `source_model_step_id / batch_index / batch_size / agent_tool_call_batch_lineage` 四项全部存在时才允许 skip；`apply()` 对三列逐项 `columnExists()` 后分别 ALTER，最后幂等创建 index。#34 同样要求 `kind + inspection_json` 两列都存在才 skip，并逐列补缺。这样“第一列已有、后续列缺失”和“中间/第二列已有、前一列缺失”都不会再因整段 `db.exec()` 的 duplicate-column 中断而留下半迁移状态。

`runMigrations()` 在 SQL/apply 完成或 check skip 之后、写入 `migrations(id,...)` 之前执行 `verify()`；目标表存在但完整 postcondition 不满足时抛 `MIGRATION_POSTCONDITION_FAILED:<id>` 并回滚，因此 migration id 不可能领先于真实 schema。目标表根本不存在时 #23/#34 的 verify 视为 vacuously satisfied，保留项目历史上对“该功能表尚未进入这份 legacy DB”的 no-op 版本推进兼容。通用 duplicate-column 容错仍只为其它尚未迁移到 statement-aware apply/verify 的历史 migration 保留，#23/#34 已完全绕开它。

新增 `tests/backend/agent-partial-schema-migrations.regression.ts`，真实使用内存 SQLite 覆盖四种 partial fixture：#23 已有首列、#23 已有中间列、#34 已有 `kind`、#34 已有 `inspection_json`；每种都必须补齐完整 postcondition，并验证 repair 后 `check=false`。同时锁定 verify 位于 migration record 之前。Backend TypeScript、focused regression、完整 Agent scenarios、Prettier 与 `git diff --check` 均通过。

---

### 7.101 “完整备份”遗漏全部 Agent / AI 表与权威 Artifact / Plugin 文件，导入后形成跨时点混合状态（P1 · ✅ 已修复 2026-09-24）

继续审 Provider / Integration credential 的加密与备份边界时，确认 AES-GCM 与 backup envelope 本身没有明显密码学缺口，但发现更基础的覆盖问题：当前所谓 **full backup 根本没有把 Agent 持久数据纳入 snapshot**。

`SqliteBackupSnapshotAdapter.TABLES` 目前只包含传统产品表：

- settings / settings_migrations / notification_settings；
- proxies / ssh_keys / connections；
- tags / command_history / path_history / quick commands；
- terminal themes / appearance / favorite paths。

列表到 `favorite_paths` 就结束，**没有任何 `agent_*` 或 `ai_*` 表**。因此以下数据都不会进入 `.nexus-backup`：

- Agent apps / grants / settings / denylist；
- AI Providers（包括 Provider 配置与 credential revision）；
- Threads / Runs / ledger / model attempts / tool calls / approvals / checkpoints；
- Artifacts metadata / grants / quota；
- MCP / ACP integrations 与 protected credential；
- Subagent / Memory / mailbox / scheduler durable state；
- Plugin publisher keys / stages / installed versions / installations；
- Workspace runtime metadata / commands / confirmations；
- App Intent receipts / artifact grants 等。

restore 同样不是“先清整库再恢复”：`restoreTables()` 只对 **同一个 TABLES 白名单**做 reverse DELETE + forward INSERT。于是导入一个历史“完整备份”后：

- settings / connections 等传统数据退回备份时点；
- 目标实例原来已有的 Agent/AI 行**完全不动**；
- API 仍返回“备份导入成功”。

最终数据库是两个时间点的混合状态，而不是一个可恢复的一致性快照。跨实例导入同样会保留目标实例自己的 Agent 数据，而不是恢复来源实例的 Agent 状态。

**这个混合状态还会直接错绑授权。** `connections.id` 是 AUTOINCREMENT 整数，而 Agent 的 SSH target grant 通过 `scope_json.targets.ssh.ids` 保存字符串化 connection id，`CapabilityRegistry.allows()` 只做 `selection.ids.includes(target.id)`；它不绑定 connection configuration hash。restore 会 DELETE 当前 `connections` 再按备份行的原 id INSERT，但不会恢复 `agent_app_grants`。因此目标实例原有的 grant（例如 ssh id `"5"`）会继续存在，并可能自动授权备份中 id=5 的另一台主机。反方向也有明确后果：`agent_target_denylist.connection_id` 对 `connections(id)` 使用 `ON DELETE CASCADE`，restore 删除当前 connections 时会把现有 Agent denylist 一并级联删除，而 backup 又不包含 denylist，恢复完成后硬 deny 规则直接消失。

**文件层也同时遗漏权威 Agent 数据：**

- `LocalArtifactStore` 把 Artifact 实体文件存到 `data/agent/artifacts/objects`，DB 的 `ai_artifacts.storage_key` 只负责指向这些 blob；
- 已安装 Plugin 的 DB version/installation 记录依赖 `data/agent/plugins/<appId>/versions/<version>` 的 immutable package tree 与 `.nexus-package-hash`；目录缺失时 Skill/runtime 会直接判 `PLUGIN_INSTALL_CORRUPT`；
- backup 的 `FILE_DIRECTORIES` 却只有 `background`、`custom_html_theme`，没有任何 `data/agent/**`；
- `data/agent/model-capability-registry.json` 还保存 auto-update / cached snapshot，虽然更偏可重建状态，也同样不会进入备份。

因此即使未来只把 Agent DB tables 加入 TABLES，而不同时纳入 Artifact / Plugin package 文件，也会得到“元数据存在、实体文件缺失”的损坏恢复结果。

**这不是 ENCRYPTION_KEY 设计问题。** Backup codec 已把 data key 同时用 instance key 和用户密码派生 key包裹；跨实例可用密码解开。传统敏感列也会先解密进 envelope 内的 `__backup_plaintext`，restore 时再用目标实例 cipher 重加密。真正的问题是 Agent rows 根本没被 capture。等 Agent tables 纳入后，还必须把至少：

- `ai_providers.protected_credential`
- `agent_integrations.protected_credential`

加入敏感列迁移逻辑，不能把来源实例 AES-GCM 密文原样写进目标实例。

现有 E2E 也解释了为什么这条一直没被门禁抓住：

- HTTP 用例名是 `full backup restores settings and connection data`，只创建/销毁/恢复一个 SSH connection 和普通 setting；
- 它明确验证 connection credential 可在 restore 后继续 test，但**没有创建任何 Agent Provider / Integration / Thread / Artifact / Plugin**；
- UI backup 用例只验证下载格式、文件选择上传、响应成功与页面仍登录，同样不验证 Agent roundtrip。

**建议修复**：

1. 明确 full backup 的持久化 ownership map，所有 canonical Agent/AI tables 纳入 snapshot；按 FK 依赖做 restore 的 reverse-delete / forward-insert；
2. Agent sensitive columns 走与 connection/SSH key 相同的 plaintext-in-envelope → target-instance re-encrypt 路径；
3. 把 `data/agent/artifacts`、已安装 `data/agent/plugins` 等 DB 依赖的权威文件纳入文件 snapshot，并校验 size/hash/path；cache 类文件可明确排除并在 restore 后重建；
4. `beforeRestore/afterRestore` 增加 Agent runtime/session/cache invalidation 与 restore 后 reconciliation，不能只处理传统 SSH/workspace session；
5. 增加真实 E2E：创建 Provider+credential、MCP/ACP integration、Thread/Run、Artifact blob、Plugin installation → export → 改坏/删除 → import → 验证数据与 secret、blob/package 都完整恢复；
6. 增加跨实例 password restore fixture，证明 Agent credential 会用新实例 ENCRYPTION_KEY 重加密，而不是依赖来源实例 key。

**修复（2026-09-24）**：`SqliteBackupSnapshotAdapter` 现在把 current schema 中全部 canonical `agent_*` / `ai_*` 持久表按 FK-safe 创建顺序纳入 full backup，restore 继续以 reverse-delete / forward-insert 恢复，因此目标实例原有 Agent 行会被清掉而不再与来源快照混合；`ai_providers.protected_credential` 与 `agent_integrations.protected_credential` 也进入既有 `__backup_plaintext` 路径，跨实例 restore 时由目标 `SecretCipher` 重加密。文件 ownership 同步扩到 `agent/artifacts/objects` 与 `agent/plugins`，而 `agent/model-capability-registry.json` 被明确作为可重建 cache 排除且 restore allowlist 会拒绝该路径。

新增 `tests/backend/agent-full-backup.regression.ts`，使用两份真实 SQLite schema、两把不同 AES-GCM key 与两个临时 data directory 做 source capture → target restore：锁定旧 target Agent/Provider 行清除、Provider/Integration secret 目标 key 重加密、Artifact blob / Plugin immutable package tree roundtrip、旧目标文件移除、model capability cache 不进入快照且非法注入被拒绝。focused regression、Backend TypeScript、Prettier 与 `git diff --check` 均通过。

---

### 7.102 Backup 文件目录 swap 的 rollback 漏掉“已移走但尚未登记”的当前目录，且崩溃后没有 startup recovery（P1 · ✅ 已修复 2026-09-24）

在 §7.101 之后继续审 restore 的原子性，确认当前文件目录切换存在一个**正常 I/O 异常即可触发**的数据丢失窗口，同时还缺崩溃恢复。

`restore()` 的顺序是：

1. 把备份文件内容写进 `.backup-restore-<uuid>`；
2. `swapStagedDirectories()` 依次切换 `background`、`custom_html_theme`；
3. 文件目录全部切完后，才进入数据库 `restoreTables()` transaction；
4. 全部成功后删除 `.backup-previous-*` / staging。

每个目录的 swap 代码却是：

- 如果原 target 存在，先 `rename(target, previous)`；
- 再 `rename(staged, target)`；
- **两次 rename 都成功后**才 `swaps.push({ target, previous, hadPrevious })`。

因此若第二次 rename 抛错（磁盘 / 权限 / filesystem I/O / 目标冲突等）：

- 原目录已经从 target 移到 previous；
- 当前目录还没被 push 到 `swaps`；
- catch 的 `rollbackSwaps(swaps)` 只会恢复**前面已经完整切换过**的目录，不会恢复当前目录；
- 错误继续抛到外层；
- 外层 `finally` 又会 `rm(previousRoot, recursive=true)`；
- 原目录副本随 previousRoot 被删除，target 保持缺失。

所以这不是仅在 SIGKILL 时才存在的理论 crash window；**一个普通的第二次 rename failure 就可能让恢复前文件数据丢失。**

另外即使修正 push 顺序，当前 restore 仍不是 crash-safe：

- 文件目录 swap 发生在 DB transaction 之前；
- 进程若在 `target→previous`、`staged→target`、或文件 swap 完成但 DB restore 尚未 commit 的任意时点退出，JS catch/finally 都不会执行；
- 全仓只有该 adapter 引用 `.backup-restore-*` / `.backup-previous-*`，启动流程没有扫描/恢复这些目录；
- 重启后可能得到“文件已经是备份时点、数据库仍是导入前时点”，或者 target 暂时缺失但 previous 仍遗留的状态。

还有一个不需要进程崩溃的反向混合窗口：`restoreTables()` 的 database transaction 在返回时已经 commit；但随后删除 `previousRoot` / `stagingRoot` 仍位于同一个 inner `try`。如果这两个 cleanup `rm()` 任一抛错，catch 会调用 `rollbackSwaps(swaps)` 把文件恢复成**导入前版本**，数据库却已经无法回滚，最终得到“备份时点 DB + 导入前文件”的另一种混合状态。`rollbackSwaps()` 自己又会吞掉每个 `rm/rename` 的恢复异常，外层 finally 仍继续删除临时根目录，因此 rollback failure 也没有 durable evidence 可供下次启动修复。

这与 §7.91 checkpoint restore 的 crash-consistency 问题同类，但影响的是产品级 full backup restore，而且当前正常错误路径本身就已经有 rollback bookkeeping bug。

**建议修复**：

- 在移动原 target **之前**建立 durable swap intent，或至少在第一步 rename 成功后立即记录当前 swap，使第二步失败能恢复；
- 文件 restore 使用明确的 journal / transaction marker，记录每个 directory 的 `original/staged/committed` 状态并 fsync；
- startup 在打开服务前扫描未完成 restore journal，按明确规则 roll forward / rollback，不能只依赖进程内 finally；
- DB 与文件需要一个可恢复的两阶段协议：文件 staged → durable intent → DB transaction / swap → durable commit marker → 清理 previous；
- fault-injection regression 覆盖：第一/第二个目录的 first rename、second rename、DB restore 前、DB commit 后、cleanup 前分别抛错/kill；最终必须得到完整“旧快照”或完整“新快照”，不能混合，也不能丢原目录。

**修复（2026-09-24）**：full backup restore 现在使用 data directory 内的 durable `.backup-restore-journal.json` 记录每个文件 ownership root 的 `pending → moving_original → installing → swapped` 状态，并在每个破坏性 rename 前先持久化 intent。DB restore transaction 的最后一步会原子写入独立的 `nexus_backup_restore_state` commit token：启动恢复若看不到 token 就 rollback 到旧文件，看见同一 token 则只 roll forward 清理，彻底移除了“DB 已 commit 后 cleanup 失败又 rollback 文件”的反向混合路径。journal/文件写入与关键目录 rename 都增加 fsync，rollback 不再吞恢复错误；恢复失败会保留 journal/evidence，而不是继续删除 previous。

composition root 在 `database.initialize()` 后、`agent.initialize()` 前调用 `recoverInterruptedRestore()`，所以 Agent/runtime owner 不会先读到半恢复状态。新增 `tests/backend/backup-restore-journal-recovery.regression.ts` 直接构造“原 target 已移到 previous、第二次 rename 尚未完成”和“DB commit token 已落盘但 cleanup 未完成”两种 crash fixture，分别证明 startup rollback 保留旧快照、roll-forward 保留新快照；同时重跑 7.101 full-backup regression 与 Backend TypeScript 均通过。

---

### 7.103 Memory import 先消费 confirmation、再单独创建目标 Memory，unknown outcome 后既无法 replay 又可二次导入（P1 · ✅ 已修复 2026-09-24）

跨 App Memory import 使用 preview → confirm 的一次性 confirmation，但 confirmation 的消费和最终 published Memory 的创建不在同一 durable transaction。

`confirmImport()` 当前顺序是：

1. `takeImportConfirmation(scope, id)`；repository 在一个 transaction 里 SELECT 后立即 DELETE confirmation；
2. 返回 service 后再检查 confirmation expiry、target intent、source Memory status/version/expiry；
3. 最后另起 `importPublished()` transaction，用新的 `randomUUID()` 插入目标 `ai_memories` 并发 `memory.changed`。

因此 confirmation 一旦被 take，就已经不可重放，而真正副作用尚未发生：

- 进程在 take commit 后、`importPublished()` 前退出：confirmation 永久消失，目标 Memory 没创建；
- source/target 校验在 take 后发现变化：confirmation 也已经被消费，用户只能重新 Preview；
- `importPublished()` 已 commit、HTTP 响应在客户端收到前丢失：目标 Memory 已存在，但原 confirmation 已删除；重试同一 confirm 只会得到 `MEMORY_IMPORT_CONFIRMATION_NOT_FOUND`。

前端又放大了最后一种 unknown outcome：

- `MemorySettings.confirmImport()` 只有成功返回后才 `importPreview=null` 并 `loadMemories()`；
- `mutate()` 的失败 recovery 只对 `MEMORY_VERSION_CONFLICT / MEMORY_REVIEW_STATE_INVALID / NOT_FOUND` 触发 `loadMemories()`，不识别 import-confirmation-not-found；
- 因此响应丢失后 UI 仍保留旧 preview，却看不到已提交的新 Memory；
- 用户随后重新 Preview → Confirm，会得到新 confirmation，并由 `importPublished()` 再生成一个随机 Memory id。

`ai_memories` 只有随机 `id` 主键，没有 `(target app, source app, source memory id, source version)` 或 confirmation/submission identity 唯一约束，因此第二次导入会正常生成另一条 published Memory，而不是 replay/去重。

这与 §7.78 的普通 create idempotency 缺口不同：这里产品已经设计了 confirmation token，却把 token 的“consume”提交点放在实际副作用之前，造成 confirmation 生命周期和 mutation commit point 分裂。

**建议修复**：

- 将 confirmation consume + source-version recheck + target Memory insert + `memory.changed` 放进同一个 DB transaction；
- 或 confirmation 增加 `pending/completed + result_memory_id` durable 状态，同一个 confirmation 重放时返回原结果；
- 目标 Memory 持久化来源 submission/confirmation identity，并对同一 import submission 做唯一约束；
- frontend 对 import confirm 的 unknown/not-found 先刷新目标 memories，并按 source refs/confirmation result reconcile，再决定是否允许重新 Preview；
- 加 fault-injection regression：take 后 crash、insert commit 后 response loss、audit failure、重复 confirm；最终只能是 0 或 1 条目标 Memory，不能静默复制。

**修复（2026-09-24）**：Memory import 的 commit point 已下沉到 `SqliteMemoryRepository.confirmImport()` 单一 transaction：同一事务内读取 confirmation、检查 expiry、重新读取并校验 source Memory 的 published/version/expiry、以 confirmation 派生的稳定目标 id 插入 published Memory、追加 `memory.changed`，最后消费 confirmation。任一步失败都会整体 rollback，source 变化或暂时错误不再提前烧掉 token。

目标 Memory 的 `sourceRefs` 现在持久化 `importConfirmationId`，目标 id 固定为 `memory-import:<confirmationId>`；因此 insert 已 commit 但响应丢失时，重放同一 confirmation 会从 durable target row 直接返回同一结果，而不是 `NOT_FOUND` 或生成第二个随机 Memory。replay 不重复发 audit/hook。`memory-product-closure` scenario 已改为并发两次 confirm 都成功但返回同一 id，并额外断言目标表只有一条对应 published Memory；focused scenario 与 Backend TypeScript 均通过。

---

### 7.104 Root Scheduler 在出队后读取 settings 失败会永久丢 Run，durable 状态仍停在 created/running（P1 · ✅ 已修复 2026-09-24）

`AgentScheduler` 与持久化的 Subagent scheduler 结构不同：Root scheduler 只维护内存队列，没有周期 durable runnable scan。

`pump()` 当前顺序是：

1. `nextQueued()` 先从对应 app queue `shift()` 出一个 Run；
2. 随后 `await this.settings.get(next.run.userId)` 读取并发限制；
3. 再根据 capacity 决定 `start()` 或 requeue。

问题是整个 `pump()` 只有 `try/finally`，没有 catch/requeue。若第 2 步发生一次瞬时数据库/settings 读取异常：

- Run 已经被 `shift()` 从队列移除；
- `pump()` 直接 reject，`finally` 只把 `pumping=false`；
- 没有把 `next` 放回队列；
- `void this.pump()` 的调用方也没有 recovery callback。

这个 Run 的 durable row 并没有同步失败：它仍可能是 `created` 或 `running`。Root scheduler 后续也没有像 Subagent scheduler 那样每 500ms 从 durable work 表重新扫描。

同一丢队列路径还覆盖 Backend 外层异常恢复本身失败的情况。`NativeAgentBackend.execute()` 通常会 catch 执行异常并调用 `interruptUnexpectedRootExecution()` 把 Run durable 收口；但如果这次 recovery commit 自己因瞬时 DB/StateCommit 异常失败，异常会继续逃回 `AgentScheduler.start()` 的 catch。scheduler 此时只记录 `Agent scheduler run failed outside persisted harness`，随后从 `active` 删除 Run并 `pump()` 其它任务，同样**不会 requeue 当前 Run，也没有 durable scan**。因此“异常处理的持久化失败”也能留下 created/running 的假运行态。

启动恢复同样不是兜底：`initialize()` 会先把所有非终态 Run 统一 interrupt，再只恢复 checkpoint 可恢复的 Run；正常运行期间没有定时“查询所有 created/running root runs 并 enqueue”的 sweep。因此除非后续恰好有另一个业务动作再次对**同一个 Run**调用 enqueue/signal，它会长期保持“数据库显示正在运行、实际上没有 executor”的假运行态。

对照实现可以确认这不是 Subagent scheduler 的同类问题：Subagent scheduler 的 candidate 来自 durable `agent_scheduler_work`，有 500ms control poll；`settings.get()` 即使使当前 `pump()` 失败，work 尚未 claim，下一轮仍能重新发现。

**建议修复**：

- Root scheduler 不要在所有可能失败的 async preflight 之前永久 dequeue；至少在异常 catch 中 requeue 当前 Run；
- 更稳妥的是给 Root scheduler 也建立 durable runnable claim / periodic scan，内存队列只做 wake hint；
- `void pump()` 必须有统一 `.catch()` 日志与恢复策略，避免 unhandled rejection；
- 增加 fault-injection regression：① enqueue created/running Run → `settings.get()` 单次抛错；② backend 执行抛错且 `interruptUnexpectedRootExecution()` 单次失败；两种情况下都不提供额外用户动作，下一轮必须自动再次执行/收口该 Run，不能永久停在假 running。

**修复（2026-09-24）**：`AgentScheduler` 现在把 dequeue 后的整个 preflight 放在 per-Run fault boundary 内；`runBlocked`、settings 读取、capacity 计算或 `start()` 前异常都不会丢掉候选 Run，而是进入自动 retry。retry 使用 100ms 起步、最大 5s 的指数退避并持续保留 Run，避免瞬时故障造成永久假 running，也避免持续故障形成 hot loop；cancel/quiesce 会清掉对应 retry timer，保持原有生命周期语义。所有外部 pump 触发统一经 `requestPump()` 收口 `.catch()`，不再留下裸 `void this.pump()` rejection。

`start()` 的 outer catch 若收到 backend 未能 durable 收口而逃出的异常，会在 active bookkeeping 清理后自动保留同一 Run 重试；显式 abort（cancel/input/quiesce）不会走该异常 retry。新增 `tests/backend/agent-root-scheduler-retry.regression.ts` fault injection：首次 `settings.get()` 抛错后无需额外用户动作即可启动同一 Run；backend 首次抛出模拟 recovery commit transient failure 后会再次执行同一 Run；测试同时监听并锁定零 `unhandledRejection`。既有 `app-disable-scope` scenario 与 Backend TypeScript 也通过。

---

### 7.105 `agent_host_events` 没有 ack / prune / compaction，会按用户永久无界增长（P2 · ✅ 已修复 2026-09-24）

Host 事件使用独立的 durable outbox：每次 `appendHostEvent()` 都推进 `agent_host_cursors.next_sequence`，并向 `agent_host_events` 插入一行。

当前读链路只有 cursor replay：

- `/agent/summary` 只返回当前 host cursor；
- `/ws/agent` subscribe 带客户端 cursor；
- session `drain()` 反复调用 `readHostEvents(userId, cursor, 100)`；
- 每成功发送一条，只更新当前 WebSocket subscription 的**内存 cursor**。

全仓没有 `DELETE FROM agent_host_events`，也没有 host event ack、per-device low-watermark、TTL、max-row retention 或 snapshot compaction。客户端 unsubscribe / disconnect 也只释放内存 subscription。

因此该表会随用户所有 Host 级变化永久累积。它不是低频审计表：Run 状态变化会分配 `summary.changed`，App / Memory / configuration 等产品事件也持续进入同一个序列。长期使用、自动化 Agent 或高频 Run 会持续放大数据库。

这与 `agent_events` 不同：Run events 绑定 `run_id`，Run 删除时可跟随 durable Run 生命周期回收；Host events 是 user 级全局序列，没有自然 owner 删除点。

无界历史还会影响新设备 / 丢失本地 cursor 的 replay：客户端从旧 cursor 重新订阅时，服务端会按 100 条分页一直重放全部历史，而当前协议没有“cursor 已过 retention，改用 fresh summary snapshot”的分支。

**建议修复**：

- 定义 Host event retention 协议，而不是简单物理 DELETE；
- 推荐“最新 summary snapshot + bounded durable delta window”，只保证最近 N 条 / N 天可 replay；
- 服务端保存 oldestAvailableCursor；客户端 cursor 早于 retention 时返回明确 `CURSOR_EXPIRED`，重新拉 `/agent/summary` 后从 high-water 继续；
- 或做 per-user compacted outbox，只保留语义上仍有价值的最新 app/config/memory invalidation；
- 加长期回归：连续生成大量 host events，执行 retention 后 DB 行数有上界，最新客户端能继续增量订阅，过旧 cursor 能通过 summary resync 恢复。

**修复（2026-09-24）**：Host durable outbox 现在采用“当前 summary snapshot + 最近 2048 条 durable delta”的有界协议。`agent_host_cursors` 新增 `oldest_cursor`，migration #47 会为旧库初始化窗口并一次性裁掉窗口外历史；后续 `appendHostEvent()` 在同一 transaction 内推进 high-water / oldest cursor、插入新事件并删除过期行，因此每个用户的 `agent_host_events` 行数有硬上界。

`SqliteRunRepository` 暴露 `{ oldestAvailableCursor, highWater }` 并同时拒绝过旧 / 超前 cursor；Host WebSocket subscribe 在过旧 cursor 时返回 `CURSOR_EXPIRED`。Frontend 收到后会重新拉 `/agent/summary` 取得当前 snapshot 的 `eventCursor`，先向 Host surface 投影一次 disconnect 触发 summary refresh，再从新的 high-water 续订；如果 summary resync 本身瞬时失败，会保留旧 cursor 并指数退避重试，401 则仍明确转成认证失效，不会让协调流静默永久退出。

新增 `tests/backend/agent-host-event-retention.regression.ts`，覆盖 legacy migration、连续写入超过窗口后仅保留 2048 行、retained boundary / expired cursor、WebSocket `CURSOR_EXPIRED` 与 frontend summary-resync 接线。focused regression、Backend `tsc --noEmit`、Frontend `vue-tsc --noEmit` 均通过。

---

### 7.106 Plugin stage 没有 TTL / delete 生命周期，正常换包即可永久留下大体积 staging 目录与历史 stage 行（P1 · ✅ 已修复 2026-09-24）

Plugin package staging 的持久生命周期目前没有终点。

`agent_plugin_stages` schema 只有 `created_at / updated_at / status / version`，没有 `expires_at`；repository 只有 create/get/list/update，没有 deleteStage。Coordinator 的 startup `reconcileStages()` 又把 `repository.listStages()` 返回的**所有历史 stage**都传给 verifier，作为“active stage”保留。

这和 verifier 的目录清理语义组合后会形成两类泄漏：

1. **安装完成的 DB 行永久增长。** install/upgrade 最后会把 stage 更新为 `status='installed'` 并 `discardStage()` 删除磁盘目录，但不会删除 stage row。每一次安装/升级都会永久新增一条 `agent_plugin_stages` 历史记录。
2. **放弃的 staged/verified package 会永久占磁盘。** 前端 `preparePackage()` 开始新包时只 `candidate=null`，不会 discard 上一个 candidate 的 stage；用户验证 A、随后选择 B，A 的 DB stage 仍存在，因此 startup reconcile 也会把 A 视为 active，磁盘 staging 目录不会清。

这个磁盘占用并不小：Verifier 允许单个 archive 最大 50 MB，展开树最大 200 MB；一个 verified stage 同时保留 package tar 与 unpacked tree。正常反复“选择包 → 验证 → 换包”即可累积数百 MB / GB 的孤儿 stage，而不需要异常请求或管理员权限。

失败场景只解决了一半：如果 `repository.createStage()` 本身失败，coordinator 会 discard 刚写的目录；但**DB row 已成功建立之后**没有统一 TTL、cancel/discard endpoint 或 maintenance sweep。

现有 UI 也没有显式“丢弃候选包”动作。离开设置页/刷新页面只丢失前端 `candidate/stageId`，反而让这条 stage 更难再清理。

**建议修复**：

- stage 增加 `expires_at` / terminal retention，并提供 repository delete / purgeExpired；
- lifecycle sweep 或 plugin startup maintenance 只把未过期的 staged/verified/reconciliation stage 当 active，清理失联 DB rows 与目录；
- installed/failed terminal stage 仅保留有限审计期，之后删除 row；
- 前端换包、关闭 candidate、离页时 best-effort 调 discard，但后端 TTL 必须是最终兜底，不能依赖浏览器 cleanup；
- 增加回归：连续验证多个接近上限的包但只安装最后一个，maintenance 后 staging 磁盘与 stage rows 应回落到有界数量。

**修复（2026-09-24）**：Plugin package stage 的生命周期改由 Backend 统一维护，不再依赖浏览器是否显式丢弃 candidate。`PluginInstallRepositoryPort` / SQLite repository 新增 `deleteStage()`；install / upgrade 已提交 authoritative installation 后，会先删除 staging 目录、再删除对应 `agent_plugin_stages` row，若 finalization 失败则保留 installed row 供后续 reconciliation 重试。

对未安装 stage 使用现有 `updated_at` 作为 activity lease：staged / verified / failed 连续 24 小时无活动且未被 `agent_plugin_pending_upgrades` 引用时视为过期。startup `reconcileStages()` 与每次新的 local/remote stage 前都会执行 maintenance；只有 `discardStage()` 成功后才删除 DB row，磁盘 I/O 失败会保留 row 与路径身份，下一轮继续重试。pending upgrade stage 即使超过 TTL 也保持 active，避免清掉 durable upgrade continuation。

新增 `tests/backend/agent-plugin-stage-retention.regression.ts`，锁定 expired stage 与 installed terminal row 被同时清理、fresh stage 保留、过期但被 pending upgrade 引用的 stage 受保护；focused regression 与 Backend TypeScript 均通过。

---

### 7.107 Artifact 上传完成 rename 与 ready commit 之间可被并发 Delete，留下永久未计费 orphan blob（P2 · ✅ 已修复 2026-09-24）

`LocalArtifactStore.write()` 把 upload 从 tmp 切到最终 object 的顺序是：

1. 写完/`fsync` 临时文件；
2. `rename(tmpPath, objectPath)`，此时真实 blob 已位于 `data/agent/artifacts/objects/...`；
3. `fsync` object directory；
4. 最后才用 `finalizeReady()` transaction 把 `ai_artifacts.status` 从 `staging` 改为 `ready` 并把 reserved quota 转成 used quota。

这段时间 DB row 仍是 `staging`。而 Artifact DELETE 对 staging 的处理是直接 `releaseStaging(row)` → row 变 `deleted` + 释放 reserved quota，只删除 `tmpPath`，**不会删除 `objectPath`**，也没有检查 `activeWrites`。

因此跨 tab / 并发请求可以形成：

1. 上传 writer 完成 `tmp → object` rename；
2. 在 `finalizeReady()` 提交前，Library 对同一 staging Artifact 发 DELETE；
3. DELETE transaction 把 row 终结为 `deleted` 并回收 quota；
4. writer 的 `finalizeReady()` 因 row 已不再 staging 返回 false；
5. writer 进入 catch，但 `renamed=true`，所以不会删除最终 object；
6. DB 已没有任何 non-deleted row owner，quota 也不再计入这份文件，但 object blob 仍永久存在。

现有 maintenance 不能收敛：

- `reconcile()` 只扫描 `status IN ('staging','deleting')`；
- `sweepExpired()` 只扫描 `ready/unavailable`；
- 没有遍历 objectsRoot 查找“storage_key 无有效 DB owner”的 orphan scanner。

这个竞态从正常 UI 可达：Artifact Library 明确展示 `staging` 状态，而 Delete 按钮只禁用 `busy`，不像 Retain 那样要求 `item.status === 'ready'`。另一个标签页/窗口可以在上传接近完成时删除 staging row。

它不像普通响应丢失那样只影响 UI：留下的 blob 已脱离 DB/配额生命周期，重复触发会造成真实磁盘泄漏。

**建议修复**：

- staging delete 如果 `activeWrites.has(id)`，应拒绝/取消 writer 并等待它进入确定状态；
- staging delete 无论 tmp/object 哪个边界，都按 storage_key 同时清理可能存在的 object；
- 更稳妥的是把 `staging → ready` 与 filesystem finalize 设计成有 durable intermediate state（例如 `committing`），delete/reconcile 都能识别；
- 增加 objectsRoot orphan maintenance：只在安全校验 DB ownership 后删除没有 canonical row 的 blob；
- 加并发 fault-injection：在 rename 后、finalizeReady 前阻塞 writer，同时 DELETE；最终只能是 ready+blob 或 deleted+无 blob，不能 deleted+blob。

**修复（2026-09-24）**：staging Delete 现在首先检查 `activeWrites`；只要 upload writer 仍持有进程内 owner（包括 tmp 已 rename 到 object、但 `finalizeReady()` 尚未提交的窗口），删除就以 `ARTIFACT_UPLOAD_BUSY` fail closed，不再允许并发请求把 reservation 提前释放。

无活跃 writer 的 staging Delete 不再直接 `releaseStaging()`，而是先以 version/status CAS 把 row 推进现有 durable `deleting` 状态，再复用 `finalizeDeleting()` 同时清理最终 object 与 tmp。`finalizeDeleting()` 已扩展为识别 `reserved_bytes`：staging 来源扣 reserved quota，ready/unavailable 来源继续扣 used quota。这样即使进程在 CAS、文件删除或 quota transaction 之间退出，`reconcile()` 已有的 `deleting` 扫描也能安全重试，不会形成 deleted row + orphan object。

新增 `tests/backend/agent-artifact-staging-delete-race.regression.ts`：直接把 `finalizeReady()` 卡在 rename 之后，确认并发 Delete 必须返回 `ARTIFACT_UPLOAD_BUSY` 且 writer 最终得到 ready；另构造无 writer 但 object 已存在的 staging row，确认 Delete 后 object 消失、row deleted、reserved quota 归零。focused regression 与 Backend TypeScript 均通过。

---

### 7.108 AppStorage 的 16MB quota 只统计 value bytes，不计 key / row / index 开销且没有 entry-count 上限（P2 · ✅ 已修复 2026-09-24）

`SqliteAppStorageRepository` 已经主动实现单 value 64KB、单 App 总量 16MB 的 quota，但总量计算只使用表里的 `bytes` 字段，而该字段仅等于 `Buffer.byteLength(JSON.stringify(value))`。

因此以下成本完全不计入 quota：

- key 本身，允许最多 256 bytes；
- SQLite row / page / record header；
- `(user_id, app_id, key)` 主键 / index 存储；
- 每条记录的 version / updated_at 等列。

同时没有最大 entry count。于是插件可以持续创建不同 key、使用极小 JSON value 来绕过“16MB 总量”的实际资源目标。例如 value `0` 序列化只有 1 byte，理论上可写约 1670 万条记录才达到 16MB `SUM(bytes)`；若 key 接近 256 bytes，仅 key payload 就已经是数 GB，尚未计算 SQLite/index 开销。

这个入口不只存在于 Frontend SDK：Backend Plugin SDK 同样走同一个 AppStorage port，因此一个有 bug 或恶意的已安装 Plugin 可以长期写入大量小 key。单次 RPC 大小限制不能解决累计行数问题。

`restore()` 的 snapshot 校验也复用 `snapshot.totalBytes`（value bytes）作为 16MB 边界，没有 entry-count / key-overhead 总预算，所以 Plugin upgrade migrate 返回大量小 entries 时同样能把巨大 row set 写回数据库。

现有测试覆盖 storage.put、retained-data stats 和 `APP_STORAGE_QUOTA_EXCEEDED` error taxonomy，但没有覆盖 entry-count、长 key 或实际 DB footprint。

**建议修复**：

- 增加 per-App 最大 entry count；
- quota 计费至少包含 key bytes，最好使用保守固定 row/index overhead（或单独同时限制 valueBytes / keyBytes / entries）；
- snapshot restore 对 entries 数量、key bytes 总量做同一套限制；
- stats/API 不要只展示 value bytes，至少明确其口径，避免用户看到“<16MB”但 DB 实际已膨胀数百 MB；
- 增加 regression：大量 1-byte value + 256-byte unique keys 应在受控的 entry/key budget 处被拒绝。

**修复（2026-09-24）**：AppStorage 保留现有 `bytes` / Stats 的 value-bytes 兼容语义，但资源门禁改为独立的 conservative charged footprint：每条记录按 `serialized value bytes + UTF-8 key bytes + 128B row/index overhead` 计费，单 App 同时增加 **4096 entries** 硬上限；`put()` 在同一 transaction 内读取当前 entry count / charged total，更新既有 key 时扣掉旧记录的 charged bytes 后再判断，避免把版本更新误算成新增 entry。

`restore()` 在删除现有 scope 前先完整 preflight：限制 entry count、拒绝重复 key，重新序列化核对每条 `bytes` / version / updatedAt，并累计与在线写入完全相同的 charged footprint；只有全部通过后才进入 DELETE+INSERT transaction。因此 Plugin upgrade/migrate snapshot 也不能再利用大量小 value + 长 key 绕过磁盘资源边界。

新增 `tests/backend/agent-app-storage-quota.regression.ts`：4096 条 1-byte value 后第 4097 条稳定返回 `APP_STORAGE_QUOTA_EXCEEDED`；另构造 value-only 总量仍低于 16MB、但加入 256-byte keys + row overhead 后超限的 snapshot，确认 restore 以 `APP_STORAGE_SNAPSHOT_INVALID` fail closed，同时小型合法 snapshot 仍可 roundtrip。focused regression 与 Backend TypeScript 均通过。

---

### 7.109 Backup export 不是一致性 snapshot，import 也没有全局 restore 串行化（P1 · ✅ 已修复 2026-09-24）

继续审 Backup 的并发边界，确认 §7.101 / §7.102 之外还有一层独立问题：**export 不是一致性快照，import 也没有全局互斥。**

**A. exportFull() 逐表 / 逐文件读取，没有同一 read transaction。**

`SqliteBackupSnapshotAdapter.capture()` 当前只是：

- 按 `TABLES` 顺序逐个 `captureTable(table)`；每次都是独立 `SELECT *`；
- 全部表读完后，再递归读取 `background/custom_html_theme` 文件。

期间没有 `database.transaction(...)` 包住所有表，也没有 product-wide quiesce / snapshot barrier。于是正常业务写入即可让一个备份同时包含多个时间点。

一个确定的 FK 例子：`connections` 在 `connection_tags` 之前读取。若 export 已读完 `connections`，随后业务创建新 connection 并写入 tag association，等 export 后面读取 `connection_tags` 时会把这条 association 收进去，但 backup 的 `connections` 里没有对应 connection。这个备份文件本身就不是可恢复的 relational snapshot，import 时可能直接因 FK 失败。

同样地，文件是在 DB 表之后读取；任何“DB 行先变、文件后变”或反方向的写入，都可能让 backup 里的 metadata 与文件内容来自不同时间点。

**B. importFull() 没有 restore mutex / in-progress guard。**

`BackupService.importFull()` 只是 `decode → beforeRestore → snapshots.restore → afterRestore`，HTTP `/backup/import` 也没有锁。两个并发 import A/B 会各自创建独立 `.backup-restore-*` / `.backup-previous-*`，但同时操作同一 target 目录与同一个 SQLite 数据库。

例如可以形成：A 先把文件 swap 成备份 A；B 再把 A 的文件当成自己的 previous 并 swap 成备份 B；随后 B 的 DB transaction 先提交、A 的 DB transaction 后提交。最终文件来自 B，数据库来自 A。

即使 SQLite 把两个 write transaction 串行化，也只保证**每个 DB transaction 内部**原子；它无法把 transaction 顺序绑定到前面已经完成的 filesystem swap 顺序。

这与 §7.102 不同：§7.102 讨论单个 restore 的 rename/cleanup/crash recovery；本条在没有任何 I/O failure、没有进程崩溃时，仅靠两个正常并发请求或 export 期间的正常业务写入就可触发。

**建议修复**：

- export 使用真正一致的数据库 read snapshot，并定义文件一致性策略；更稳妥的是 product-wide read barrier / quiesce 后统一 capture；
- 对 DB+文件 snapshot 引入 manifest revision / snapshot id，确保文件与数据库属于同一逻辑时点；
- backup import 建立 process-wide restore mutex，第二个 import 明确返回 `BACKUP_RESTORE_IN_PROGRESS`；
- export 与 import 之间也采用读写锁：restore 期间不能 capture，capture 建立 snapshot 期间不能开始 restore；
- 加并发 regression：export 过程中创建 connection+tag、并发两个不同 backup import、export/import 交叠；结果必须是完整可恢复快照，不能出现 FK-invalid backup 或 DB/file 跨备份混合。

**修复（2026-09-24）**：`SqliteBackupSnapshotAdapter.capture()` 现在把所有 canonical tables 与文件 capture 放进同一个 `DatabaseAdapter.transaction()` 生命周期。该 adapter 的 transaction 是 exclusive scheduler barrier，因此 table scan 开始后新的 DB reads/writes 都不能穿插；所有表共享同一 SQLite transaction snapshot，消除了 connection/tag 等 FK 图跨时点读取。

文件侧不再只递归 `readFile()` 一遍：capture 在同一 DB snapshot 内先构造完整 inventory（relative path / size / mtime / ctime / inode），读取内容后重新构造 inventory，只有 before/after 完全一致才接受；路径消失、size 变化或目录树变化会最多重试 3 次，持续活跃则以 `BACKUP_SNAPSHOT_FILES_UNSTABLE` 让 export 整体失败，而不是输出 torn file snapshot。Artifact / Plugin 等 DB-backed 文件仍受同一 DB barrier 与其既有 durable transitional-state reconciliation 保护。

`BackupService` 新增 process-local exclusive operation lane，`exportFull()` 的 capture+encode 与 `importFull()` 的 beforeRestore→restore→afterRestore 共用同一队列；并发两个 import 会顺序执行，export/import 也不会交叠。新增 `tests/backend/backup-consistency-serialization.regression.ts`：在 capture 已读表、正停在文件阶段时发起正常 DB writer，证明 writer 必须等 capture 完成且备份保留旧一致视图；并发 export/import/import 的 capture/restore 最大并发锁定为 1。focused regression、既有 full-backup roundtrip 与 Backend TypeScript 均通过。

---

### 7.110 Plugin AppStorage 与 Host governance 共用裸 keyspace，插件可直接改写 Execution / Subagent Policy（P1 · ✅ 已修复 2026-09-24）

继续审 Plugin AppStorage owner 边界时，确认 Host 自己的治理状态与 Plugin SDK 暴露的“插件私有存储”共用了同一个 `{userId, appId, key}` keyspace，而且没有 reserved-key 隔离。

Host 当前至少把两类策略直接存进 `agent_app_storage`：

- `AgentExecutionPolicyService`：`agent.execution-policy.v1`；
- `SubagentPolicyService`：`subagent.profiles.v1`。

而 Plugin Frontend RPC 的 `storage.get / storage.put / storage.delete` 只校验 key 非空且 ≤256 bytes，随后直接调用同一个 `AppStoragePort`。Backend Plugin SDK 也复用同一 store；它只做 App lifecycle/storage access authorization，不区分 Host-owned key 与 Plugin-owned key。

因此一个已启用 Plugin 可以：

- `storage.get('agent.execution-policy.v1')` 读取 current value/version，再用正常 optimistic version 直接改写或删除用户在 Settings 中配置的 App Execution Policy；
- `storage.put('subagent.profiles.v1', ...)` 直接改写 Subagent profiles、role、peerMessaging、mutationMode、profile maxSteps 等，而不经过 `replaceProfiles()` 的 Settings 写入口；
- 写入结构非法值，让 `AgentExecutionPolicyService.get()` / `SubagentPolicyService.get()` 后续直接抛 `VALIDATION_FAILED`，使该 App 的 Settings / Run / delegation 路径进入稳定失败。

需要限定影响边界：这不是“插件可以越过所有 Agent 安全限制”。当前仍有后续防线：

- Execution Policy `get()` 会再次校验 global hard limits，超出 hard limit 的 override 会 fail closed；
- Subagent create 会重新验证 Provider/version/model；
- profile capabilities 会与 App grant、父 delegation grant 求交集；
- Run 本身仍受 `run.budget.maxRunSteps` 等全局预算约束。

但这些二次防线不能消除 owner 违约。插件仍能在 hard limit 内**自行提高/降低用户设置的 App 预算与行为策略**，或者直接删/破坏 Host policy；而 `doc/AGENT.md` 明确把 AppStorage 描述成 App 的内建私有状态服务，架构文档又明确 Subagent 创建/调度/capability delegation 由 Runtime/Tool policy 拥有。Host governance state 不应成为插件可任意读写的私有 key。

这还会绕过专用 Settings service 的校验、日志与未来审计钩子：例如 `replaceProfiles()` 会检查 hard-limit/model 可用性，直接 `storage.put()` 不执行这些 write-time checks。

**建议修复**：

- 将 Host-owned state 移出 Plugin-visible AppStorage，或至少使用不可由 SDK 访问的 reserved namespace；
- AppStorage SDK 在 get/put/delete 三条路径统一拒绝 Host-reserved keys/prefix，Backend Plugin SDK 同样执行；
- policy repository 使用独立 typed table/port 会更清晰，避免后续新增 Host policy 再踩同一 keyspace；
- 对现有数据库做兼容迁移，并在启动时检测/隔离被 Plugin 写坏的 reserved rows；
- 加安全 regression：Plugin Frontend/Backend 对两个 reserved key 的 get/put/delete 全部被拒绝；Settings 专用 API 仍能正常读写；App grant / global hard limits 的现有二次防线保持不变。

**修复（2026-09-24）**：新增 `app-storage-ownership.ts` 作为 AppStorage ownership 的单一事实来源，集中定义 `agent.execution-policy.v1` 与 `subagent.profiles.v1` 两个 Host-owned key；Execution Policy / Subagent Policy service 也改为引用同一常量，避免 reserved-key 列表与实际写入 key 漂移。Plugin Frontend RPC 的 storage get/put/delete 在 key 解码后统一调用 `assertPluginOwnedAppStorageKey()`，命中 reserved key 返回 `APP_STORAGE_KEY_RESERVED`；Backend Plugin child 的 storage request 在 dispatch 到 repository 前执行同一 guard，HTTP error mapping 明确投影为 403。

ownership 同时覆盖 lifecycle/migration 和 data cleanup：`PluginDataManager.capture()` 只把 plugin-owned rows 交给 `lifecycle.migrate`，因此插件升级代码看不到 Host policy；`restore()` 在落迁移结果前重新 capture 当前完整 scope，并把**当前 Host-owned rows**与 plugin migration output 合并，迁移结果若偷偷返回 reserved key 会 fail closed。卸载后的 `deleteData()` 也由整 scope `clear()` 改为仅保留 Host-owned snapshot，removed-installation 的 retained-data 统计同样只计算 plugin-owned rows。

新增 `tests/backend/agent-plugin-storage-ownership.regression.ts`，用真实 SQLite AppStorage 锁定：Plugin capture 不暴露两个 Host key、Host policy 在 migrate 期间更新后 restore 仍保留最新 value/version、migrate output 注入 reserved key 被拒绝、Frontend reserved-key 读取被拒绝、Backend storage path 接入同一 guard、卸载后删除 retained data 只删 plugin row 且 retained stats 不把 Host policy 计入。focused regression、Backend TypeScript、针对性 Prettier 与 `git diff --check` 均通过。

---

### 7.111 Manual checkpoint 没有 delete / retention / count 上限，Workspace archive Artifact 会被 checkpoint link 永久保护（P2 · ✅ 已修复 2026-09-24）

继续审 checkpoint 的 create/idempotency/retention 后，确认 user checkpoint 与 recovery checkpoint 的生命周期不对称。

`CheckpointService.save()` 每次手动保存都会直接调用 `saveCheckpoint(..., kind='user', force=true)`，并生成新的 `randomUUID()` checkpoint id。Frontend `saveCheckpoint()` 也不发送 `Idempotency-Key`，因此响应丢失后用户再次点击会正常再创建一个 checkpoint。

更关键的是 user checkpoint 没有任何有界生命周期：

- repository 对 `kind='recovery'` 会在保存新 recovery checkpoint 前删除旧 recovery rows，并通过 `cleanupCheckpointArtifactLinks()` 释放旧 checkpoint Artifact links；
- user checkpoint 不走这段 supersede 逻辑；
- repository 只有 `deleteRecovery()`，全仓没有 user checkpoint delete API / UI；
- `CheckpointService.list()` 还把 repository limit **硬编码为 50**，HTTP/Frontend 没有 cursor/limit surface；因此第 51 条以后更老的 checkpoint 会从正常 API/UI 枚举里直接消失，但底层 row 与受保护 Artifact 继续存在；
- 没有 per-Run max checkpoints、TTL、retention sweep 或“只保留最近 N 个”策略。

每个带 Workspace 的 checkpoint 又不是小记录。`WorkspaceCheckpointService.capture()` 会：

1. 从 Runner 打包 `/workspace/work` archive；
2. 通过 ArtifactService 新建一个 archive Artifact；
3. 再新建一个 manifest Artifact；
4. 将二者加入 checkpoint snapshot / `agent_artifact_links(role='checkpoint')`。

Artifact cleanup 明确把任何 `role='checkpoint'` link 视为永久 protection：`artifactProtectionReason()`、`storageSummary()`、`cleanupPreview()` 都无条件排除 checkpoint-linked Artifact，不管 Run 是否已经 terminal。只有删除整个 Run 时 `DELETE FROM agent_artifact_links WHERE run_id=?` 才统一释放这些 links。

因此一个长期保留的 Run 可以通过正常 UI 反复“保存检查点”持续累积 checkpoint rows 与 archive/manifest Artifact，并把它们从普通 cleanup 中永久保护，直到整个 Run 被删除。若 Workspace 较大，很快会把用户 Artifact quota 吃满；而超过 50 条后，更老的 checkpoint 连常规 API/UI 都无法枚举，形成“**仍占 quota、仍被保护、但用户已看不到 owner**”的隐藏占用。

这和 §7.90/§7.91 不同：前两条关注 checkpoint capture/restore 的一致性；本条是 user checkpoint 自身没有 retention / delete ownership。也和 §7.105/§7.106 同属有界持久化问题，但这里会直接锁住 Artifact quota。

**建议修复**：

- user checkpoint 增加显式 delete，并在同一 transaction 里删除 row + 释放只由该 checkpoint 持有的 Artifact links；list API 增加真正 cursor pagination，不能把 50 当永久可见上限；
- 定义 per-Run / per-user checkpoint 数量或总字节上限，必要时提供自动 retention（例如最近 N 个 + pinned）；
- save checkpoint 接受 caller-stable `Idempotency-Key`，response loss 重放返回原 checkpoint；
- Artifact Storage 页面区分 checkpoint-protected bytes，并提供跳转/删除 owner 的操作；
- 加 regression：长生命周期 Run 连续保存 >N 个带 Workspace archive 的 checkpoint，达到策略上限后必须拒绝/回收，且删除旧 checkpoint 后 quota 与 blob 都正确释放。

**修复（2026-09-24）**：user checkpoint 现在由 repository 强制执行 **每 Run 最多 32 条** 的有界 retention。新 checkpoint 与 retention prune 在同一个 SQLite transaction 内完成；prune 按 `created_at DESC,rowid DESC` 保留最新 32 条，删除更老 rows 后复用现有 `cleanupCheckpointArtifactLinks()`，只有当 archive / manifest / evidence Artifact 不再被其它 checkpoint 引用时才释放对应 `role='checkpoint'` link，并同步清掉已失去 owner 的 Workspace `retained_manifest_ref`。因此快速重复 Save 即便发生 response loss，也只能产生有界数量的 durable owner，不会无限隐藏在 list=50 之后。

同时 `CheckpointRepositoryPort` / `CheckpointService` / `AgentRunFacade` 增加 scoped `deleteUser()` / `deleteCheckpoint()`，HTTP 新增 `DELETE /runs/:runId/checkpoints/:checkpointId`。删除是 idempotent scoped cleanup：只允许删除当前 `{userId,appId,runId}` 下的 user checkpoint，row 消失后重新计算 remaining checkpoint refs 并释放最后一个 protection owner。现有 list 上限 50 已覆盖 32 个 user + 1 个 recovery，因此不再有“仍占 quota 但常规 API 永远枚举不到”的 checkpoint。

扩展 `checkpoint-workspace-evidence.scenario.ts`：真实创建带 Workspace archive/manifest 的 user checkpoint 后连续写到 33 条，确认只保留 32 条且首条被淘汰；随后显式删除全部剩余 user checkpoints，确认 durable row=0、archive/manifest checkpoint links=0、Workspace retained manifest owner=null。focused regression 与 Backend TypeScript 均通过。

---

### 7.112 Provider model discovery 的 1MB response limit 在全量 `response.text()` 之后检查，无法限制真实内存峰值（P2 · ✅ 已修复 2026-09-24）

`OpenAiProviderAdapter.fetchModelsFromEndpoint()` 明确声明 `MAX_MODELS_RESPONSE_BYTES = 1MB`，并在响应头有可信 `Content-Length` 时提前拒绝超大响应。但对 chunked / 缺失 / 虚假 Content-Length 的正常 HTTP 响应，当前顺序是：

1. `await fetch(...)`；
2. 可选检查 `Content-Length`；
3. `const text = await response.text()`；
4. **整个 body 已经被 undici/Fetch 缓冲成 string 后**，才 `Buffer.byteLength(text) > 1MB` 并抛 `PROVIDER_MODELS_RESPONSE_TOO_LARGE`。

因此这个 1MB 限制只限制“后续 JSON 解析的数据大小”，并不限制 Backend 在读取阶段的内存占用。一个已配置但异常/恶意的 OpenAI-compatible endpoint 可以不发送 Content-Length，持续发送远大于 1MB 的 body；Backend 会先完整缓冲，再发现超限。`discoverModels()` 虽有 10 秒 AbortController，但在高吞吐连接上 10 秒足以推送远高于预期上限的数据，并造成明显内存峰值甚至进程 OOM。

这不是项目缺少可复用实现：同仓 `ModelsDevCapabilityRegistrySource` 的 `readBoundedResponse()` 已经使用 `response.body.getReader()` 按 chunk 累加 bytes，超过 `MODEL_REGISTRY_MAX_RESPONSE_BYTES` 立即 `reader.cancel()` 并停止读取。Provider discovery 没有复用同样的 bounded-reader 语义。

影响边界需要限定：Provider endpoint 是用户/管理员配置的外部服务，且 SRS 明确不把 Provider transport 当 private-host/network sandbox，因此这不是 SSRF 边界问题；本条只针对**代码已声明的 response-size resource limit 实际无法在读取阶段生效**。

**建议修复**：

- 将 Provider `/models` 响应改为逐 chunk bounded read；累计超过 1MB 立即 cancel body 并抛 `PROVIDER_MODELS_RESPONSE_TOO_LARGE`；
- `Content-Length` 继续作为 fast-fail，但不能替代流式计数；
- decoder 直接从 bounded bytes 解码 UTF-8/JSON，避免先生成不受控大 string；
- 增加 regression：无 Content-Length 的 chunked stream 连续输出 >1MB，reader 必须在越界 chunk 后立刻 cancel，测试观察到的累计读取量保持在 `limit + one chunk` 的有界范围；
- 同步扫其它 Agent 外部 HTTP body，统一复用一个 bounded-response helper。

**修复（2026-09-24）**：新增共享 `providers/bounded-response.ts`，以 `response.body.getReader()` 逐 chunk 累计 bytes；总量首次越过 caller 指定 limit 时立即 `reader.cancel()`，并抛 caller 指定的稳定 error code。`OpenAiProviderAdapter.fetchModelsFromEndpoint()` 保留 `Content-Length` fast-fail，但实际 body 一律通过该 bounded reader 读取，随后仅对已受限的 `Uint8Array` 做 `TextDecoder` + JSON parse，因此没有 Content-Length 或服务端虚报长度也不能再让 Backend 先完整缓冲任意大 response string。

同仓 `ModelsDevCapabilityRegistrySource` 也切到同一 helper，删除重复 bounded-reader 实现，使两条外部模型元数据读取链共享相同的 cancel / byte-budget 语义。

新增 `tests/backend/provider-model-discovery-bounded.regression.ts`：构造没有 Content-Length 的 fake reader，前 4 个 chunk 正好累计 1MB，第 5 个 chunk 多 1 byte；确认 Provider 在第 5 次 read 立即抛 `PROVIDER_MODELS_RESPONSE_TOO_LARGE`、调用 `cancel()` 且不再继续读取。随后用小型合法 JSON 验证正常 discovery 仍可解析。focused regression 与 Backend TypeScript 均通过。

---

### 7.113 Plugin 成功 upgrade 不回收已无人安装的旧 immutable version，正常升级会永久累积 package tree（P2 · ✅ 已修复 2026-09-24）

继续审 Plugin version/package retention 时，确认成功 upgrade 与 uninstall 的 cleanup 语义不对称。

upgrade 从 oldVersion 切到 nextVersion 成功后的流程是：

1. quiesce/dispose old runtime；
2. migrate AppStorage；
3. activate/health-check new runtime；
4. `activateInstallation(userId, appId, oldVersion, nextVersion, ...)` 把该用户 installation 切到新版本；
5. finalize stage 并 `discardStage()`。

之后**没有**对 `oldPlugin.version` 做 `countInstalled()`、`removeInstalled()` 或 `updateVersionStatus(...,'removed')`。

对照 uninstall 路径，只有“当前版本最后一个 installation 被卸载”时才会：

- `countInstalled(appId, version) === 0`；
- `verifier.removeInstalled(appId, version)`；
- version status → `removed`；
- 从 runtime registry 移除 version。

全仓 `removeInstalled()` 的实际调用也只有两处：upgrade **失败回滚时删除新 target 包**，以及 uninstall 当前版本；成功 upgrade 后的 old version 没有 cleanup 调用。

这意味着单用户产品中每次成功升级后，旧版本 installation 已不存在，但：

- `agent_plugin_versions` 旧 row 仍保持 installed；
- `data/agent/plugins/<appId>/versions/<oldVersion>` 的 immutable tree 仍存在；
- startup `initializeInstalledVersions()` 还会把所有 status=installed 的历史版本重新注册进 registry；
- 用户侧 `listVersionsForUser()` 只 join 当前 installation，因此这些旧版本在普通管理视图中也不可见。

Verifier 允许一个包展开到 200MB；installed tree 就是该 verified unpacked tree rename 到 `versions/<version>`。连续正常升级因此可永久累积多个接近该上限的旧 package，不需要异常请求或中断。

当前也没有用户可见 rollback/downgrade 功能证明这些旧版本是有意保留的 rollback cache；upgrade failure 的 rollback 使用的是**切换提交前仍存在的 old tree**，并不要求成功升级后永久保留所有历史版本。

**建议修复**：

- upgrade commit 成功后，对 oldVersion 做 `countInstalled()`；为 0 时进入 best-effort/durable cleanup：remove package tree、version status→removed、runtime registry removeVersion；
- 如果产品希望保留 rollback cache，必须显式定义数量/字节/时间上限，并在 UI/Storage summary 中可见，而不是无限保留；
- startup reconciliation 扫描 `status='installed'` 但 `countInstalled=0` 的 orphan version，按策略回收/降级状态；
- 加 regression：单用户连续升级 v1→v2→v3，最终只有当前版本（或明确策略允许的有限历史版本）保留磁盘 tree，旧 package bytes 有界。

**修复（2026-09-24）**：把 immutable Plugin package 的 ownership cleanup 收口到 `cleanupUnreferencedInstalledVersion()`：成功 `activateInstallation()` 后先清 pending upgrade，再对 old version 做 `countInstalled()`；若已经没有任何用户 installation owner，则删除 `versions/<version>` tree、把 `agent_plugin_versions.status` 持久化为 `removed`，并从 runtime/App registry 与 frontend version hook 移除该版本。uninstall 也复用同一 helper，不再维护第二套 cleanup 分支。

startup `PluginInstallService.initializeInstalledVersions()` 在 stage reconciliation 后、runtime version registration 前新增 `reconcileInstalledVersions()`：逐个扫描 persisted `status='installed'` version，只有 `countInstalled()==0` 才尝试回收。若 count/read 或 filesystem/status cleanup 暂时失败，保留 `installed` 状态供下次 startup 重试；有 installation owner 的当前版本不会被触碰。`AppRegistryService` 同时补上真正的 `removeVersion()`，会删除 version definition 并只在没有其它同 App version/builtin 继续声明时释放 intent ownership，避免此前 `runtimeLifecycle.removeVersion()` 只通知 hook、registry definition 仍残留。

新增 `tests/backend/agent-plugin-version-retention.regression.ts`：构造 orphan v1、owned v2、failed historical v0，确认 startup 只删除 v1 package/status/registry，v2 保持；并直接验证 App registry 删除 v1 后 v2 definition 仍可用。focused regression 与 Backend TypeScript 均通过。

---

### 7.114 Plugin upgrade 在 quiesce 之前 capture AppStorage，Frontend/Backend 并发写会被后续全量 restore 静默覆盖（P1 · ✅ 已修复 2026-09-24）

继续交叉审 Plugin upgrade 与 AppStorage authority 时，确认 storage migration 的 freeze 点放错了顺序，正常成功升级即可出现 lost update。

当前 upgrade 在 active Runs drain 为 0 后的顺序是：

1. `snapshot = data.capture(scope)`；
2. `runtimeLifecycle.quiesce(scope, oldPlugin, ...)`；
3. dispose old Backend runtime；
4. `migrate(oldVersion, nextPlugin, snapshot)`；
5. `data.restore(scope, migrated)`；
6. activate / health-check new runtime；
7. 最后 `activateInstallation()` 把 installation / App activeVersion 切到新版本。

问题在第 1→2 步已经成立：**snapshot 在 old Backend Plugin 被 quiesce 之前创建。** old runtime 在 capture 返回后到 quiesce 完成前仍可通过 Backend Plugin SDK 对 AppStorage `put/delete`；这些写已经真实 commit 到 `agent_app_storage`，但 migration 输入仍是更早的 snapshot。

Frontend 路径窗口更长。`PluginDataManager.frontendRpc()` 对 storage get/put/delete 的 gate 只要求：

- installation 仍为 installed；
- `state.activeVersion === installation.version`；
- desired enabled；
- observed running/degraded。

upgrade 只先把 `acceptNewRuns=false`，并不会改变这些 Frontend gate。直到最后 `activateInstallation()` commit 前，旧 iframe 的 AppStorage RPC 仍会被 Host 接受。因此整个 capture → migrate → restore 窗口里 Frontend 都可能提交新 storage write。

`SqliteAppStorageRepository.restore()` 又是严格的 full replacement：一个 transaction 先

`DELETE FROM agent_app_storage WHERE user_id=? AND app_id=?`

再按 snapshot entries 全量 INSERT，且保留 snapshot 内旧 version/updatedAt。它没有基于 capture revision 的 CAS，也不 merge 当前 rows。

因此可形成确定 race：

1. AppStorage key K=v1；
2. upgrade capture 得到 K=v1；
3. old Backend / Frontend 正常 `put(K,v2,expectedVersion=...)` 成功；
4. migration 基于 v1 输出 v1'；
5. restore 删除当前 K=v2，再插回 v1'；
6. upgrade 成功返回，用户/插件刚刚确认成功的 v2 已静默丢失。

即便先 quiesce Backend，也还不足以修复，因为 Frontend bridge 当前没有对应 draining/frozen storage gate；需要一个统一的 App mutation barrier。

**建议修复**：

- 在 storage capture 前先进入 durable `upgrading/draining` mutation barrier，阻止 Frontend/Backend AppStorage mutation 与 App Intent create；
- quiesce old Backend runtime **完成后**再 capture；Frontend RPC 也必须看到该 barrier 并对 mutating method fail/retry；
- capture/restore 增加 storage revision / snapshot generation，restore 只能在 scope revision 仍等于 capture revision 时提交，否则 abort/retry migration；
- 更稳妥地把 migration 做成同一数据库 transaction 内的 typed transformation，避免全量 delete/insert 跨出 owner freeze；
- regression：在 capture 后、quiesce 前以及 migrate 期间并发 `storage.put`，upgrade 要么序列化该写入并保留结果，要么明确拒绝；绝不能返回双方成功但静默覆盖其中一方。

**修复（2026-09-24）**：upgrade 现有 `acceptNewRuns=false` durable draining 状态被提升为 Plugin mutation fence。`PluginDataManager` 为每个 `{userId,appId}` 建立 FIFO mutation lane；Frontend `storage.put/delete` 与 App Intent `create/revoke` 在真正副作用前进入 lane、重新读取当前 App state/version，并在 `acceptNewRuns=false` 时稳定返回 `AGENT_APP_DRAINING`。这不仅阻止 fence 之后的新 mutation，也解决“请求在 fence 前已通过初始 gate、但副作用尚未落地”的 in-flight 窗口：migration capture 必须排在这些已经获准的 mutation 之后。

upgrade 顺序调整为 **drain → old Backend quiesce → dispose → mutation lane 内 capture→migrate→restore → activate/health → installation commit**。`PluginDataManager.migrateStorage()` 在同一 lane 内 capture plugin-owned snapshot、运行 migration transform、再以当前 Host-owned rows 合并后 restore；只有 restore 已成功时才把原 snapshot 返回给 caller 作为后续 activation/health failure 的 rollback 基线。old Backend child 的 `close()` 现在设置 closing fence，并等待所有已经在途的 Host storage/intent operation settle 后再 kill，因此 dispose 返回后不会还有旧 child storage write 追在 capture 后提交。

新版本 `lifecycle.migrate` 的临时 Backend process 以 `allowHostMutations=false` 启动：可读取 live storage，但 `storage.put/delete` 与 intent `create/revoke` 会返回 `AGENT_APP_DRAINING`，避免 migration callback 一边返回 transformed snapshot、一边偷偷写 live Host state再被 restore 覆盖。新增 `tests/backend/agent-plugin-upgrade-storage-fence.regression.ts`：人为卡住 fence 前已进入的 Frontend put，确认 migration capture 必须等待并包含其成功值；fence 后第二个 put 在 storage side effect 前被拒绝；同时锁定 dispose-before-capture 与 migration child read-only mutation bridge。focused regression 与 Backend TypeScript 均通过。

---

### 7.115 Host durable event 已提交但 wake publication 失败时，在线订阅没有 periodic drain，会无限期停在旧状态（P2 · ✅ 已修复 2026-09-24）

继续审 Host durable outbox 时，确认 §7.105 之外还存在一个**已提交事件的在线可见性**缺口。

Host mutation 的常见顺序是：

1. repository / state-commit transaction 向 `agent_host_events` append durable event，并推进 host cursor；
2. transaction commit；
3. caller 再执行 `publishHostWake(userId)` 通知内存 EventHub。

`publishHostWake()` 本身不是把已知 cursor 直接广播，而是额外异步执行一次 `runRepository.hostCursor(userId)`；这次查询失败时只：

`logger.warn(..., 'Agent Host wake publication failed')`

然后吞掉错误，不重试、不排队 durable wake。

WebSocket Host subscription 的消费模型又完全依赖 wake：subscribe 时读取 high-water 并 `scheduleDrain()` 一次；此后只有 `eventHub.onHostWake(... => scheduleDrain())` 会触发下一次数据库读取。`AgentEventHub` 是纯内存 listener map，没有 durable queue / timer / periodic poll。

因此可以形成：

1. App/Provider/Memory/Plugin 等 mutation 已成功 commit，host event 也已写入 DB；
2. commit 后那一次 `hostCursor()` 瞬时失败；
3. API mutation 仍可成功返回，因为 wake failure 被吞掉；
4. 已在线的 Host WebSocket subscription 不会再次查询 outbox；
5. UI 保持旧 summary/app/version/config，直到**另一个 unrelated host wake**恰好发生，或 WebSocket 重连/重新 subscribe。

durable event 本身没有丢，因此重连后能 replay；问题是在线 session 没有“DB 中 cursor 已推进但内存 wake 丢了”的自愈机制。对低频用户，如果后面没有其它 Host 事件，这个 stale window 没有时间上界。

这也会放大 Plugin upgrade 等 versioned UI：例如 upgrade 已 durable 切到新 app version，但该次 Host wake 丢失时，当前 Hub 仍可能暂时保持旧 descriptor/version，直到下次 wake/reconnect。

**建议修复**：

- append host event 的 commit 结果直接携带 committed host cursor，由 caller 用该 cursor publish，避免 commit 后再做一个可失败的 cursor query；
- wake 只应是 hint：Host subscription 增加低频 high-water poll / bounded retry，检测 durable cursor 已前进时主动 drain；
- 或维护 durable/monotonic wake generation，使一次内存 publish 丢失也能在下一周期自愈；
- 对 `publishHostWake` failure 做 retry/backoff，而不是 warn 后永久放弃；
- regression：host event commit 后注入一次 `hostCursor()` failure，保持 WebSocket 不重连且没有第二个业务 mutation；客户端最终仍必须收到该 durable event。

**修复（2026-09-24）**：Host WebSocket subscription 现在把 EventHub wake 明确降级为 latency hint，而不是唯一的 durable outbox 驱动源。订阅建立时仍执行一次原有 drain，并继续监听 `onHostWake()`；此外每个 Host subscription 创建 **2 秒**低频 durable cursor poll，调用同一个 `AgentEventFacade.hostCursor()`。当 high-water 大于 subscription 当前 cursor 时只调用既有 `scheduleDrain()`，后续仍由同一 `readHost(..., limit=100)` bounded replay 路径发送事件，因此没有第二套 cursor/ack 状态机。

poll 自身是 self-healing：一次 `hostCursor()` 异常只 warn，不关闭 subscription；下一周期继续查询。这样 `publishHostWake()` 在 durable commit 后那次额外 cursor query 即使失败、且后续没有任何 unrelated mutation/wake，在线 session 仍会在有界时间内发现 durable cursor 已推进并 replay。每个 subscription 的 poll timer 在 unsubscribe 与 session close 时明确 `clearInterval()`，并 `unref()` 避免成为进程退出 owner。

新增 `tests/backend/agent-host-event-wake-recovery.regression.ts`：Host subscribe 初始 drain 为空后模拟 durable event commit，但不发送任何 in-memory wake；第一次 periodic `hostCursor()` 还故意失败，第二次返回 high-water=1，确认同一 WebSocket 最终收到 sequence=1 durable event，随后 close 后 poll 停止。既有 `agent-host-event-retention.regression.ts`（retention/CURSOR_EXPIRED/replay）与 Backend TypeScript 也均通过。

---

### 7.116 Backend Plugin child→Host 的 20MB protocol limit 在 `readline` 收齐整行后才检查，无换行 stdout 可把内存压力转移到主 Backend（P2 · ✅ 已修复 2026-09-24）

Backend Plugin 使用独立 Node child + stdio line protocol。Host 定义 `MAX_PROTOCOL_BYTES = 20MB`，表面上对 protocol frame 做了大小保护，但 child→Host 方向的检查发生得太晚。

`BackendPluginProcess` 当前是：

1. `readline.createInterface({ input: child.stdout, crlfDelay: Infinity })`；
2. 等 `line` event；
3. `handleLine(line)` 里才 `Buffer.byteLength(line) > MAX_PROTOCOL_BYTES`；
4. 超限后 `failAll()` + SIGKILL child。

`readline` 必须先在父进程内接收/拼出完整行才会触发 `line`。因此插件只要向 stdout 持续写一个**没有换行**的超大 frame，Host 就会先把该数据累计进 readline buffer；20MB 检查在 frame 已经完整进入父进程内存后才有机会执行。

这个不对称在同一 adapter 里很明显：

- Host→child lifecycle request 在 `child.stdin.write()` **之前**先检查 encoded bytes；
- Host 对 storage/intent response 回 child 也会在写 stdout 前检查；
- child stderr 由 Host 逐 chunk 接收，但只保留最后 8KB；
- 只有 child stdout 的 inbound frame 依赖 post-line 检查。

当前测试搜索也没有看到针对“无换行持续 stdout”的 bounded-reader regression；现有 `PLUGIN_BACKEND_RESPONSE_TOO_LARGE` 只能在完整 line 已经形成后生效。

影响边界需要限定：已安装 Backend Plugin 并不是 OS CPU/RAM sandbox，插件自己的 child 本就可能自耗资源；本条不是新的 privilege escape。问题在于产品**特意把动态 Backend code 放进独立 child**，却允许该 child 通过 protocol pipe 让主 Backend 代为无界缓冲，削弱了故障隔离和 `MAX_PROTOCOL_BYTES` 的资源保护语义。

**建议修复**：

- 不用无界 `readline` 作为不可信 child frame parser；直接消费 stdout chunks，维护 bounded frame buffer，累计超过 20MB 且尚无换行时立即 destroy/kill child；
- 每次只解析完整 bounded line，并对剩余 bytes 保留同样上限；
- 将 stdout 总吞吐/空闲超时也纳入 child runtime 资源策略，避免高频小 frame 造成另一种 flood；
- regression：child 连续写 >20MB 无换行 payload，Host 应在 buffer 达到 `limit + one chunk` 前后立即 kill child，主进程内存不得随完整 payload 线性增长。

**修复（2026-09-24）**：移除 `readline.createInterface()` 对不可信 Plugin stdout 的依赖，新增 `BoundedProtocolLineBuffer`。parser 直接消费 stdout chunks：有换行时只组装该 bounded frame；没有换行时先检查 `buffered + incoming` 是否超过 20MB，越界 chunk 不进入 retained buffer，立即抛 `PLUGIN_BACKEND_RESPONSE_TOO_LARGE`，`BackendPluginProcess` 随即 fail pending requests 并 SIGKILL child。这样 limit 约束的是父进程真实 retained frame memory，而不是完整 line 已经形成后的事后检查。

新增 `tests/backend/plugin-backend-bounded-stdout.regression.ts`：小 limit 下验证跨 chunk frame、CRLF、多 frame；已占满 limit 后追加无换行 byte 会在 append 前失败且 retained bytes 不增长；单个巨大无换行 chunk 也直接拒绝、buffer 保持 0，并静态锁定 adapter 不再 import `node:readline`。focused regression 与 Backend TypeScript 均通过。

---

### 7.117 Jump SSH 中间 hop 的 keepalive timeout 可冒成 uncaughtException 杀死整个 Backend（P1 · ✅ 已修复 2026-09-24）

线上日志已给出确定复现：

- `2026-09-23T16:53:54.153Z`，`ssh2/lib/client.js:720` 抛出 `Error: Keepalive timeout`，`level='client-timeout'`；
- Backend 把它记录为 `Uncaught exception / Backend fatal error`；
- 紧接着挂起当前 Workspace、输出 `Closing all connections and exiting...`，容器重新启动。

根因不是 §7.87 的 Runner orphan，也不是 dev watcher。SSH connection helper 在握手阶段临时监听 `error`，但 `ready` 后会移除该 listener。direct / proxy 的最终 client 随后会被 `SshExecutionTransportAdapter` 接管，因此有长期 error owner；**jump route 的 intermediate `ssh2 Client` 则只保存在 connector 局部数组里，没有任何长期 `error` owner**。所有 hop 都启用了 `keepaliveInterval=5000 / keepaliveCountMax=10`，所以任一跳板约 50 秒无响应就会由 ssh2 发 `Keepalive timeout`；Node 对无 listener 的特殊 `'error'` event 直接抛 uncaughtException，杀死整个 Backend。

之前 `06f5e0f fix(ssh): contain client socket errors` 只把 final transport/shell 内部转发事件从特殊 `'error'` 改成 `transport-error/shell-error`，没有覆盖 jump intermediate client 生命周期，因此本次不是旧修复回归，而是旧修复覆盖面不完整。

本轮已做完整 ownership 修复，而不是加空 listener：

- 引入 `ConnectedSshClient`：raw `ssh2 Client` 在 `connect()` 前就安装永久 error/close owner，并保留 `lastError/isClosed`，消除 `ready → transport handoff` 空窗；
- 引入 `SshClientRoute`：统一拥有 direct / proxy / jump 的整条 client chain；
- jump 每个 intermediate hop 与 final client 都加入同一路由，任一 hop error/close 会把 route 标失败并反向级联 `end()` 全链；
- `SshExecutionTransportAdapter` 改为持有 route，而不是单个 raw client；route failure 统一映射为正常 transport error/close，SFTP/command/shell owner 一起收敛；
- handoff 后若 route 已在竞态中关闭，`SshTransportAdapter.connect()` fail closed，不返回“看似成功但已死亡”的 transport；
- `SshExecutionTransportAdapter` 现在缓存 terminal transport error/close；即使 route 在 `ExecutionSession` / Workspace owner 注册 listener 之前就失败，late `onError/onClose` 也会异步 replay，避免 ready→attach→subscribe 的第二个观察空窗；
- safe-dispatch 被提升为 Backend shared 基础设施，SSH Route / Transport / Command / Shell 与 Runner Workspace Terminal 共用同一条事件隔离规则；业务 listener 即使自己 throw，也只影响该订阅者，不会沿 ssh2/ws/Node EventEmitter 调用栈升级成 Backend uncaught；
- Command session 不再依赖 EventEmitter 特殊 `'error'` 语义，内部错误事件改为普通 `session-error`，teardown 的 `destroy()` 也做 best-effort 隔离；Shell 的 `data/stderr/error/close/drain` 转发全部走 safe-dispatch。
- 同类扫描还发现 `RunnerWorkspaceTerminalSession` 会把 WebSocket/Duplex error 再 emit 成内部特殊 `'error'`；现已改成普通 `session-error`，socket+tunnel 双错误只上报一次，Terminal 的 `data/drain/error/close` consumer 也全部 safe-dispatch，消除同一类未订阅/consumer-throw fatal。
- 同轮继续扫 Browser transport：Direct Browser WebSocket 与 Runner Browser tunnel 原本都直接执行 `message/close` consumer；现已统一改用 shared `invokeListenerSafely`。Puppeteer/CDP consumer 即使自身 throw，也不会沿 `ws` callback 栈升级成 Backend uncaught。

新增/扩展 `tests/backend/ssh-error-events.regression.ts`：

- direct raw client error 不得逃成 EventEmitter uncaught；
- observed error 仍能到达 transport subscriber；
- jump intermediate `Keepalive timeout` 必须传播到 logical transport、同时关闭 intermediate + final client；
- ready 后、route handoff 前发生 raw error，后续 adopt 必须识别旧 error 并拒绝开放 route。
- 直接调用 `connectSshClient()`：ready 后临时 connect listener 已移除，再触发 `Keepalive timeout`，永久 raw-client owner 仍必须接住并保存 `lastError`；
- transport 在业务 owner 订阅前已经失败时，late `onError/onClose` 必须 replay 既有 failure/closed 状态；
- transport / command / shell subscriber 自身抛异常不得反弹进 raw ssh2 event stack；
- route 已关闭后的 late socket error 继续被 raw-client guard 吸收，但不得再制造新的 transport fault。

新增 `tests/backend/runner-terminal-error-events.regression.ts`：

- Terminal socket error 在没有业务 `onError` subscriber 时不得成为 uncaught；
- Terminal error/data/close subscriber 自己 throw 必须被基础设施隔离；
- 原 SSH regression 继续同时通过，证明 shared safe-dispatch 没破坏既有 route ownership。

新增 `tests/backend/browser-transport-listener-isolation.regression.ts`：

- 本地真实 WebSocket tunnel 注册两个 message / close consumer；第一个故意 throw，第二个仍必须收到事件；
- regression PASS，证明 Browser transport 也遵守“consumer fault 不能反向炸宿主 event stack”的统一规则。

验证：

- `pnpm --filter @nexus-terminal/backend build`：PASS；
- `pnpm --filter @nexus-terminal/backend exec tsx ../../tests/backend/ssh-error-events.regression.ts`：PASS；
- `pnpm --filter @nexus-terminal/backend exec tsx ../../tests/backend/runner-terminal-error-events.regression.ts`：PASS；
- `pnpm --filter @nexus-terminal/backend exec tsx ../../tests/backend/browser-transport-listener-isolation.regression.ts`：PASS；
- `pnpm --filter @nexus-terminal/backend exec tsc --noEmit`：PASS；
- SSH/Problem 相关 `git diff --check`：PASS。

当前 WebCodex Runner 是 Node 22，项目声明 Node >=24，因此验证过程会出现 engine warning；TypeScript build 与 regression 本身均实际通过。

上述完整 SSH / Runner Terminal / Browser listener ownership 修复已随 `97560f1` 提交进入 `dev`；§7.117 不再依赖 dirty 工作树。

---

### 7.118 Runner journal 永不回收 unknown command/job，长期重启后会撞 16,384 项上限并让 Runner 无法启动（P2 · ✅ 已修复 2026-09-24）

`RunnerJournal.compact()` 只清理 terminal command 的 `succeeded/failed` 与 terminal job 的 `succeeded/failed/cancelled`，明确不清 `unknown`。与此同时 startup reconciler 会把 controller 重启时仍为 `running` 的 command/job 永久改成 `unknown`。

全仓没有 unknown command/job 的 delete API、unknown→reconciled/terminal 状态迁移、age/count retention，cleanup planner 也不会回收这些 evidence。

但 journal decoder 对 `commands` / `jobs` 各自设置 `MAX_JOURNAL_COLLECTION_ITEMS = 16_384`。某一 collection 超过上限后，下一次启动 `decodeRecordCollection()` 会直接判 `JOURNAL_STATE_INVALID`；constructor 保存 `.corrupt.*` evidence 后抛 `RUNNER_JOURNAL_INVALID`，Runner 无法继续启动。

因此长期不稳定环境会形成单调累积：running command/job 遇重启 → startup 标 unknown → compact 保留 → 重复发生 → 主 journal 最终超过 decoder hard limit。

这与 §7.87 不同：§7.87 是旧 child process orphan；本条即使旧进程被外部 cgroup/systemd 正确回收，journal evidence 本身仍会无限积累并最终破坏 Runner startup。

**建议修复**：

- unknown 增加 durable reconciliation lifecycle（例如 reconciled/expired evidence）；
- Backend 已完成对应 reconciliation/quarantine 后，老 unknown 按 age/count 有界裁剪；
- collection hard limit 前增加 watermark/预警与主动归档；
- 需要长期 forensic evidence 时写入独立归档，而不是继续占主启动 journal；
- regression：构造 >16k historical unknown + 少量 active state，归档/compact 后主 journal 仍可启动，recent/active evidence 不丢。

**修复（2026-09-24）**：`RunnerJournal.compact()` 现把 command/job 的 `unknown` 与其它 terminal status 一样纳入历史 retention。常态仍保留最近 4096 条 terminal evidence，并尊重 24h 最小年龄；但 collection 超过 12,288 safety watermark 时会优先删除最老 terminal evidence，即使尚未满 24h，也不会为了 forensic history 把主启动 journal 推近 16,384 decoder hard limit。

为兼容旧版已经写出的超限 journal，commands/jobs decoder 增加有限的 32,768 recovery ceiling（Workspace collection 仍保持原 16,384 strict bound）。构造 `RunnerJournal` 后立即 compact；如果历史超限主要由 unknown/terminal evidence 组成，会先压回安全范围并原子 flush；如果 compact 后仍超过 16,384，说明超量主体是 active/nonterminal state，继续按 corrupt fail-closed。新 `begin()` / `beginJob()` 在创建记录前也做容量保护：到达 hard limit 时先 compact，仍无可裁记录则抛 `RUNNER_JOURNAL_CAPACITY_EXCEEDED`，不再写出下次启动无法 decode 的文件。

新增 `tests/backend/runner-journal-unknown-retention.regression.ts`：真实构造 16,500 unknown commands + 16,500 unknown jobs 并保留 active command/job，确认旧 journal 能启动、active/recent evidence 保留且 oldest unknown 被裁；另构造 16,384 条全 pending commands，确认第 16,385 条被拒绝且磁盘仍保持可解码上限。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.119 Runner builtin Toolchain 的 command-scoped download cache 缺 owner 自动回收，正常安装流会持续积累大 archive（P2 · ✅ 已修复 2026-09-24）

继续审 Runner pack installer 的本地持久目录后，确认 builtin pack 的 download cache 实际上是一次性安装临时副本，却没有任何 owner cleanup。

`PackInstaller.cachedArchive()` 对每次 install command 都创建：

`<cacheRoot>/download/<commandId>/<family>-<version>-<arch>.tar`

流程会从 catalog-bound builtin source copy 一份 archive 到该目录，校验 size / sha256、fsync 后再用于 `tar.t` / `tar.x`。同一次 `ensure()` 的 dependency pack 会共用 commandId，但下一次安装使用新的 commandId，因此旧目录不会被后续请求复用。

成功安装后的 cleanup 只处理：

- `ToolchainStore.commit()` 将 staging tree rename 到 content-addressed installed path；
- `discardStaging()` 删除 `.staging/<commandId>-...`。

正常 install/failure 路径**都不删除 `cacheRoot/download/<commandId>`**；`uninstall()` 也只删除 installed pack tree / canonical link，startup 没有针对 command cache 的 sweep/TTL。需要限定的是：Runner 的显式 `cacheCleanup()` 会直接删除整个 `root/cache`，而 `PackInstaller.cacheRoot` 正是 `root/cache`，所以这些副本并非绝对不可回收；问题是它们没有跟所属 command 自动收口，只能等另一次全局 cache cleanup 顺带清掉。

这不是一个有复用价值的 content-addressed cache：key 是 caller commandId，不是 digest；旧 command directory 永远不会命中未来 `cachedArchive()`。因此它本质上是 transient verification copy 在 owner command 完成后继续滞留，直到另一次全局 cache cleanup。

资源上限也不小：`MAX_ARCHIVE_BYTES = 512MB`。连续安装不同 builtin packs，或 uninstall 后用新 commandId 重装同一 pack，都可以重复留下完整 archive 副本；在没有另行执行全局 cache cleanup 的时间窗口内，download bytes 会单调增长，而且 SpaceReporter 只把它汇总为 `cacheBytes`，无法定位到已经结束的 command owner。

**建议修复**：

- 将 command-scoped archive 视为临时文件：一次 `ensure()` 完成后在 `finally` 删除整个 `download/<commandId>`；
- 若确实需要共享 cache，改成 digest-addressed cache，并定义总字节/年龄 LRU，而不是按 commandId 永久保留；
- startup 清理遗留 command-scoped cache，避免异常中断留下垃圾；
- Storage/space reporter 应计入 toolchain cache bytes；
- regression：install → uninstall → reinstall 同一 builtin pack 多次，cacheRoot 总占用必须保持有界，且每次失败/成功后 command-scoped目录均被回收。

**修复（2026-09-24）**：`PackInstaller.ensure()` 现在把 `cache/download/<commandId>` 明确作为一次 install/provision command 的临时 owner 目录；dependency expansion、digest validation、builtin copy/verify/install 与 activate 全部包在同一 `try/finally`，owner 结束时递归删除 command download tree。成功、失败、部分 dependency install 后异常三条路径都不再留下不可复用 archive 副本。

PackInstaller 构造时还会在任何新 command 接收前清空并重建 `cache/download`，用于回收上一次 Runner 崩溃/kill 留下的 command-scoped cache；共享的 `cache/mise` 不受该 sweep 影响。新增 `tests/backend/runner-pack-download-cache-retention.regression.ts`，验证 startup orphan、成功 ensure、失败 ensure 均释放 command directory。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.120 Runner admin packInstall / packUninstall 没有 per-pack 串行化，互斥命令可同时成功且最终状态只服从最后落盘者（P1 · ✅ 已修复 2026-09-24）

继续审 Runner admin command 调度时，确认 Workspace lifecycle 的并发问题（§7.97）之外，Toolchain admin mutation 也没有资源级互斥。

Runner 的 `beginAdminCommand()` 对 `cacheCleanup / runtimeCleanup / packInstall / packUninstall` 都采用同一模式：journal `begin()` → pending→running → `void this.executeAdminCommand(...)`，不等待其它 admin command，也没有 per-pack / per-cache queue、mutex 或 lease。

Backend 侧同样允许独立请求：`installPack()` 直接提交 `packInstall`；confirmed uninstall 在 revision/candidate recheck 后提交独立 `packUninstall`。command dedupe 的 `operationHash` 包含 action/payload，所以 install 与 uninstall 是两条不同 durable command。

同一 pack 可形成确定 race：

1. `packInstall(P)` 正在 copy/hash/validate/extract；
2. `packUninstall(P)` 此时执行，若 journal 没有 active Workspace 引用 P，`installer.uninstall(P)` 会完成并把 command 记 `succeeded`；
3. 第一个 install 随后 `store.commit()` + `store.activate()`，也记 `succeeded`；
4. 最终 P 是 installed，但 uninstall command 也永久显示 succeeded。

反过来，uninstall 若落在 install commit 之后、install journal succeed 之前，两条命令也都可 succeeded，而最终磁盘是 uninstalled。结果只取决于最后一次 filesystem mutation。

`cacheCleanup` 也与 installer 没有共享 barrier：它会直接删 `root/cache`，而 pack install 同时使用 `root/cache/download` / `root/cache/mise`，可在正常安装中途删掉工作目录。

这与 §7.97 不同：§7.97 是 Backend Workspace lifecycle optimistic-version 竞态；本条是 Runner admin plane 自身缺资源串行化。

**建议修复**：

- 以 `(familyId, versionId, contentDigest)` 为 resource key 串行 packInstall/packUninstall；
- `cacheCleanup` 与任何 active pack install/uninstall 使用全局 cache/install barrier；
- `packUninstall` 的 in-use recheck 与 remove 放进同一资源锁；
- command succeeded 前验证 final installed state 与该 command postcondition 一致；
- regression：同 pack install/uninstall、install+cacheCleanup 交错执行，必须得到明确 serialization/conflict，禁止互斥命令都 succeeded。

**修复（2026-09-24）**：新增 `ToolchainMutationCoordinator`，由 Runner composition 创建单实例并同时注入 `PackInstaller` 与 `CleanupPlanner`。所有 `ensure()`（包括 Workspace provision）、`uninstall()` 和 `cacheCleanup()` 都通过同一 FIFO mutation lane，filesystem pack tree 与 `cache/download` / `cache/mise` 不再并发互相改写；因此 cache cleanup 也无法在 provision/install 中途删除工作目录。

admin plane 额外增加 `toolchainAdminActive` conflict fence：`packInstall / packUninstall / cacheCleanup` 一旦已有一条执行中，第二条 durable admin command 直接失败为 `RUNNER_TOOLCHAIN_MUTATION_BUSY`，而不是排队后形成两条互斥 command 都 `succeeded` 的歧义。`packUninstall` 的 Workspace in-use recheck 与实际 remove 在同一 admin owner 内；pack install/uninstall 返回成功前都会通过 `installer.installed()` 验证最终 postcondition，不一致则抛 `WORKSPACE_TOOLCHAIN_POSTCONDITION_FAILED`。

新增 `tests/backend/runner-toolchain-admin-serialization.regression.ts`：先卡住 Workspace/provision 风格 ensure，确认共享 `cacheCleanup()` 必须等待；再卡住 admin install 并并发提交 uninstall，确认 uninstall durable command 明确失败 busy、`installer.uninstall()` 没被调用，install 释放后正常成功。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.121 ACP WebSocket → child stdin 忽略 Writable backpressure，合法 256KB 帧可把 Runner 内存队列持续堆高（P2 · ✅ 已修复 2026-09-24）

Runner 的 ACP transport 有单帧大小限制，但输入方向没有总量/backpressure 控制。

`AcpProcessRuntime` 的 WebSocket server 设置 `maxPayload = 256KB`，message handler 也再次检查 `bytes.byteLength <= MAX_FRAME_BYTES`。但通过校验后直接：

`child.stdin.write(bytes);`

完全忽略 Node Writable 的 boolean 返回值，也没有监听 `child.stdin 'drain'` 去 pause/resume WebSocket。

因此只要 ACP child 暂停读取、处理速度低于上游输入，连续合法 binary frame 就会不断进入 `child.stdin` 的内部 write queue。`maxPayload` 只限制**单帧**，并不限制累计 queued bytes；WebSocket 仍会继续派发后续 message，Runner 内存可持续增长。

同仓 Terminal runtime 已经实现了正确对照：

- `if (!child.stdin.write(bytes)) websocket.pause()`；
- `child.stdin.on('drain', () => websocket.resume())`。

说明这个差异不是 Node/ws 无法做 backpressure，而是 ACP 路径遗漏了同一层流控。ACP 输出方向已有 `websocket.bufferedAmount > 1MB` 保护，只有输入方向缺口。

**建议修复**：

- ACP binary input 与 Terminal 一样，在 `stdin.write()` 返回 false 时 pause WebSocket，`drain` 后再 resume；
- close/error/child exit 时确保不会把 paused socket 错误 resume；
- 可再加明确的 queued-input byte/time deadline，child 长期不 drain 时主动关闭 ACP session；
- regression：用不读取 stdin 的 fake ACP child，连续发送合法帧；超过 Writable highWaterMark 后 WebSocket 必须 pause，内存队列保持有界，drain 后才恢复。

**修复（2026-09-24）**：ACP binary input 现在与 Workspace Terminal 使用相同的 Node Writable backpressure 语义。每个通过 256KB frame limit 的 binary message 在写入 child stdin 时检查 boolean 返回值；若 `write()` 返回 false，立即记录 paused 状态并调用 `websocket.pause()`，停止继续从网络侧派发输入。`child.stdin` 的 `drain` handler 只有在确实处于 paused、ACP session 尚未 closed、stdin 仍 writable 且 WebSocket `OPEN` 时才 `resume()`，避免 close/error/child exit 后的 late drain 把已结束连接重新拉起。

新增 `tests/backend/runner-acp-stdin-backpressure.regression.ts`：使用真实 detached Node child，先故意暂停读取 stdin，发送一个合法 256KB frame 并确认 WebSocket pause；child 延迟开始消费后确认 drain→resume；随后关闭 Workspace ACP session，确认不会出现 late resume，且 Workspace writer ownership 只释放一次。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.122 Runner Plugin 的 generation HOME 不属于任何 cleanup owner，Workspace runtime cleanup 后仍永久残留（P2 · ✅ 已修复 2026-09-24）

`PluginRunnerRuntime.start()` 会为每个 `(workspaceId, generation, pluginId)` 创建独立 HOME：

`runtime/plugin-processes/<workspaceId>/<generation>/<pluginId>`

并通过 `HOME` 环境变量交给 Runner Plugin。插件可以把正常运行期 cache/config/state 写进该目录。

但生命周期没有对应 owner cleanup：

- `disposeWorkspace()` 只关闭 child process，不删除 HOME；
- stop/restart 继续保留 HOME 可以解释为同 generation 复用；
- delete 也只 dispose process + `runtimeEngine.remove()` generation；
- confirmed `runtimeCleanup()` 只删除 `runtime/generations/<workspaceId>` 与 `runtime/workspaces/<workspaceId>`，没有删除 `runtime/plugin-processes/<workspaceId>`；
- 全仓 `plugin-processes` 只有创建点，没有 rm/sweep/startup reconciliation。

因此 generation 切换会不断创建新的 HOME；即使 Workspace 已 delete 并执行了产品提供的 runtime cleanup，旧 Plugin HOME 仍留在 Runner managed root。

Space accounting 还会掩盖这个 owner 漏口：`SpaceReporter.runtimeBytes` 对整个 `root/runtime` 求和，所以总数包含 plugin-processes；但 `runtimeEngine.runtimeBytes(workspace)` 只统计 generationRoot + workspaceRoot，`runtimeReclaimableBytes/byWorkspace` 不包含 Plugin HOME。用户会看到 runtime 总空间仍占用，却无法从 Workspace cleanup preview 归因/回收这部分 bytes。

Runner Plugin 不是 OS sandbox，因此本条不是权限逃逸；问题是 Runner 自己分配的 HOME 没有跟 Workspace/generation owner 生命周期闭合。

**建议修复**：

- PluginRunnerRuntime 提供 workspace/generation HOME cleanup，并在 generation delete/runtimeCleanup 的 durable owner 流程中调用；
- runtimeCleanup 删除整个 `runtime/plugin-processes/<workspaceId>`，但必须在 Plugin process 确认退出后执行；
- `runtimeEngine.runtimeBytes()/SpaceReporter.byWorkspace` 把对应 Plugin HOME 纳入可回收字节；
- startup 扫描 journal 不再拥有的 plugin-process HOME，按安全策略回收/隔离；
- regression：多次 generation switch + delete + runtimeCleanup 后，旧 generation plugin HOME 不得残留，总/按 Workspace reclaimable bytes 必须一致。

**修复（2026-09-24）**：`PluginRunnerRuntime` 现在显式拥有 `plugin-processes` lifecycle：`cleanupGeneration()` 删除指定 Workspace generation HOME，`cleanupWorkspace()` 删除整个 Workspace Plugin HOME，`reconcileHomes()` 在 startup workspace reconciliation 完成后，以最终 journal `(workspaceId,generation,status)` 为权威 owner，删除不存在 Workspace、`deleted` Workspace 以及同 Workspace 的旧 generation 目录。Workspace delete action 在 `runtimeEngine.remove()` 成功后立即清当前 generation HOME；confirmed runtimeCleanup 则先 `disposeWorkspace()` 等待 Plugin child 退出，再删除 generation/workspace runtime 与整棵 Plugin HOME。

SpaceReporter 的 `byWorkspace.runtimeBytes` 现为 core runtime bytes + `runtime/plugin-processes/<workspaceId>` bytes，因此 stopped/deleted/failed Workspace 的 `runtimeReclaimableBytes` 与实际 cleanup 可回收内容一致。新增 `tests/backend/runner-plugin-home-retention.regression.ts`：构造 current/old/orphan/deleted HOME，确认 startup sweep 只保留当前 owner；验证 HOME bytes 进入 Workspace space projection；最后执行真实 CleanupPlanner runtimeCleanup，确认 Workspace Plugin HOME 被删除。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.123 Workspace Job 允许 1MB 输出，但 Backend protocol 只解 16KB、Runner journal 只解 64KB，正常成功 Job 可立即不可读并在下次重启阻断 Runner（P1 · ✅ 已修复 2026-09-24）

继续对齐 Runner wire/journal/resource bounds 时，确认同一个 Workspace Job result 在三个层面使用了互相矛盾的字符串上限。

**执行层允许的范围：**

- Runner `beginWorkspaceJob()` 接受 `input.maxBytes <= 1MB`；
- `JobRunner` 自身 `MAX_OUTPUT_BYTES = 1MB`，默认 maxBytes 还是 256KB；
- stdout/stderr 共用这个 byte budget，结果会原样写进 `WorkspaceJobResult`；
- `journal.succeedJob()` 随后把完整 result 持久化。

**Backend wire decoder 只允许 16KB：**

`runner-http-protocol.ts` 的通用 `MAX_PROTOCOL_STRING_BYTES = 16KB`，而 `decodeWorkspaceJobView()` 对 `result.stdout` / `result.stderr` 直接调用该 `stringValue()`，没有使用 Job 请求中的 maxBytes，也没有专门的较大 bound。

因此一个完全合法、例如 stdout=32KB 的成功 Job：Runner 会接受、执行、持久化并从 HTTP 返回；Backend 在 status/wait/cancel decode 时却会报 `WORKSPACE_RUNTIME_PROTOCOL_INVALID`。后面的 `jobControlResult(maxOutputBytes)` 虽然本来有 UTF-8 tail truncation，但根本到不了那一层。

**Runner 自己的 journal decoder又是 64KB：**

`journal.ts` 的 `MAX_JOURNAL_STRING_BYTES = 64KB`，`decodeJobResult()` 对 stdout/stderr 同样用通用 `stringValue()`。所以合法输出若 >64KB：

1. 当前 Runner 进程可以正常完成并 `succeedJob()`，journal JSON 也能成功写盘；
2. 当前进程内 Map 仍能继续使用这个 Job；
3. 下一次 Runner 启动 `decodeJournalState()` 读取自己刚写的 result；
4. stdout/stderr 超 64KB → `invalidJournal()` → 主 journal 被判坏并抛 `RUNNER_JOURNAL_INVALID`。

这不是恶意输入才可触发：默认 Job output budget 256KB 已经同时高于 16KB 与 64KB。普通构建/测试命令打印几十 KB 日志就足够进入故障区。

**建议修复**：

- 定义一份共享 Workspace Job result contract，Runner request bound、journal decoder、Backend wire decoder 使用同一上限；
- 更合理的是 journal/wire 不持久化整段大 stdout/stderr：按统一 max result bytes 截断，或把大输出写 Artifact，仅在 durable record 保存 bounded tail + artifact ref；
- `succeedJob()` 在写 journal 前就验证/normalize 到 decoder 可重新读取的 canonical form，保证 writer 永远不会写出 reader 拒绝的状态；
- Backend decoder 的 output bound 必须和协议声明一致，不能在 Tool 层 truncation 之前先拒绝合法 Runner result；
- regression 至少覆盖 32KB、128KB、1MB 三档：完成后 status/wait 可解码，Runner restart 可重放，超策略上限时必须在写 journal 前明确 truncation/reject，而不是把坏状态持久化。

**修复（2026-09-24）**：Workspace Job output 现在使用明确的 **1MB** durable/wire contract，而不是复用各层通用 string limit。Runner `journal.ts` 增加 Job 专用 `MAX_WORKSPACE_JOB_OUTPUT_BYTES=1MB`：`decodeJobResult()` 的 stdout/stderr 可各自读取到该 bound，通用 journal string 仍保持 64KB；`succeedJob()` 在 mutation/flush 之前验证 stdout+stderr UTF-8 bytes 合计不超过 1MB，越界直接 `JOB_OUTPUT_LIMIT_INVALID`，因此 writer 不会再生成下次启动 decoder 自己拒绝的 journal。

Backend `decodeWorkspaceJobView()` 对 stdout/stderr 改用 Job 专用 1MB bound，通用 Runner protocol string 仍保持 16KB；同时 Job start/query/wait/cancel 的 HTTP response envelope 提升到 2MB，以容纳 1MB output 加 JSON metadata，而其它 Runner route 继续使用原 1MB response cap。新增 `tests/backend/workspace-job-output-contract.regression.ts`，覆盖 32KB、128KB、1MB 三档 Backend decode + Runner restart replay，以及 1MB+1 byte 在 journal writer 前 fail-closed；并锁定四条 Job HTTP response path 都使用专用 envelope。focused regression、Agent Runner TypeScript 与 Backend TypeScript 均通过。

---

### 7.124 排除：`terminateManagedProcess()` 单独只等 leader，但 ACP / Runner Plugin 的真实 exit handler 会对 detached group 补 SIGKILL（❌ 非独立缺陷，2026-09-24）

逐文件复核 `managed-process.ts` 时曾发现一个看似严重的 helper contract 缺口：`terminateManagedProcess()` 对整个 process group 发 SIGTERM，但 graceful wait 只观察 leader child 的 `close`。本轮 Linux 探针直接调用 helper，构造“leader 收 TERM 立即退出、同 group grandchild 忽略 TERM”，得到：

`{"elapsedMs":1,"leaderExited":true,"grandchildAlive":true}`

这证明**孤立看 helper**，它返回时并不保证 process group 已经消失。但继续检查两个真实 caller 后，最初的 P1 产品结论被推翻：

- `AcpProcessRuntime` 注册 `child.on('exit', ...)`，leader 一退出就同步调用 `signalManagedProcess(child, 'SIGKILL')`，再次按负 PGID 对整个 detached group 强杀；
- `RunnerPluginProcess` 同样在 `child.once('exit', ...)` 中先 `signalManagedProcess(child, 'SIGKILL')`，再 fail pending lifecycle；
- Node 的 `exit` event 先于 `close`，而 `terminateManagedProcess()` 的 `waitForExit()` 等的是 `close`，因此真实 caller 在 helper 因 leader close 返回之前，已经向残留 group 发出 SIGKILL。

所以“leader 退出后 stubborn grandchild 可无限存活、正常 Plugin dispose 误报完成”这一结论不成立，不应新增独立 P1。

仍然存在的较窄事实是：当前代码没有**等待 SIGKILL 后整个 PGID 确认消失**，因此 force-kill dispatch 与下一代 owner activate 之间理论上仍有一个很短的进程消亡窗口。但 ACP 本来就有 §7.94/§7.95 的非 await drain/跨 generation overlap；把 group-liveness wait 纳入统一 owner drain 应作为那些条目的修复细节，而不是再计一个独立问题。

探针 finally 已显式 SIGKILL 测试 process group / grandchild，不留测试残留。

---

### 7.125 Workspace lifecycle 的 durable postcondition 与 command unknown 没有权威重同步，Runner 重启可让 Backend / Runner 状态永久分叉（P1 · ✅ 已修复 2026-09-24）

继续对齐 Runner command outcome 与 Backend Workspace projection 时，确认问题不只存在于 provision；所有会“先改变真实 Workspace，再最后标 command succeeded”的 lifecycle action，都缺一个 authoritative postcondition reconcile。

Runner 的 durable 顺序有共同模式：

- **provision**：`journal workspace=creating` → runtime create/state=ready → plugin workspace prepare → `journal workspace=ready` → 最后 command succeeded；
- **start**：runtime state=running → Runner Plugin activate → `journal workspace=running` → 最后 command succeeded；
- **stop**：关闭 session/plugin → runtime state=stopped → `journal workspace=stopped` → 最后 command succeeded；
- **delete**：关闭 owner → 删除 generation root → `journal workspace=deleted` → 最后 command succeeded。

因此每个 action 都存在“真实 postcondition 已经落盘，但 command 仍是 running”的 crash window。Runner controller 若在这个窗口重启：

1. startup `Reconciler` 会先从 runtime state 把 Runner journal Workspace 收敛到真实 `ready/running/stopped/deleted`；
2. 随后把仍为 running 的 command 改成 `unknown(controller_restarted_during_command)`；
3. Backend 只能 query command，没有 Runner workspace status/projection query。

Backend `syncWorkspaceStatus()` 对这个 unknown 的处理又分成两类，但都错误：

- provision：`unknown` 与 `failed` 被等价处理，直接把本地 Workspace 写成 `failed`；
- start/stop/restart/delete：unknown 完全不修改 Workspace projection，继续保留 action 前的旧状态。

于是至少会形成：

- Runner ready / Backend failed（provision）；
- Runner running / Backend ready|stopped（start）；
- Runner stopped / Backend running（stop）；
- Runner deleted / Backend ready|running|stopped（delete）。

remote command 已 durable unknown，后续 reconcile 反复得到的仍是 unknown；Backend 又没有读取 Runner `journal.workspace` / runtime state 的 API，因此这些分叉没有自动修复路径。尤其 delete 分叉会让 Backend 继续把已在 Runner 删除的 Workspace 当 active，后续操作稳定失败；provision 分叉则把真实 ready Workspace 当 failed 排除，用户可能重建第二个 Workspace。

这与 §7.85 不同：§7.85 是 restart 的 Runner Plugin activate 失败后 Runner 自己留下 running 半状态；本条是**真实 Runner Workspace 已经处于正确 postcondition，但 command outcome 因 crash 变 unknown，Backend 缺 authoritative state reconcile 而投影错误**。也与 §7.86 不同，后者是 toolchain switch 的 Backend `stopping` continuation 问题。

**建议修复**：

- Runner 为 workspace 暴露 generation-bound authoritative projection/status query，至少返回 `(workspaceId,generation,status)`；
- startup reconcile 对 interrupted lifecycle command 根据真实 Workspace postcondition判断：postcondition 已成立时将 command reconcile 为 succeeded，而不是一律 unknown；
- Backend `syncWorkspaceStatus()` 不得把 provision unknown 直接等价成 failed，也不能对其它 lifecycle unknown 永久保持旧 projection；unknown 必须进入 reconciliation_required 并核 Runner authoritative state；
- 更彻底地把 Workspace postcondition 与 command terminal outcome做成一个可恢复状态机/事务日志，startup 可从 postcondition完成 command；
- regression：分别在 provision ready、start running、stop stopped、delete generation removed 之后且 command succeed 之前注入 Runner restart；重启后 Backend/Runner 必须收敛到同一 Workspace status，command 也必须明确 succeeded/reconciled，禁止 unknown + stale projection。

**修复（2026-09-24）**：Runner startup `Reconciler` 不再把所有 interrupted command 一律改成 unknown。它先完成 Workspace runtime reconciliation，然后对仍为 `running` 的 lifecycle command检查真实 postcondition：`provision→ready`、`start/restart→running`、`stop→stopped`、`delete→deleted`；若当前 journal Workspace 已满足目标，则调用 `journal.succeed()` 补写 `{reconciled:true, workspaceStatus}`，只有无法证明 postcondition时才保留 `unknown(controller_restarted_during_command)`。因此“真实状态已完成、只差 terminal command commit”的 crash window会在 Runner restart 自行闭合。

Runner controller 同时新增 `GET /v1/workspaces/:id/status?generation=N`，严格校验 generation并返回 `{workspaceId,generation,status}`；Backend `WorkspaceRuntimeControllerPort` / Runner HTTP adapter / protocol decoder 增加对应 authoritative projection。`WorkspaceRuntimeService.syncWorkspaceStatus()` 遇到普通 `provision/start/restart/stop/delete` 的 `unknown` 时，不再自行猜测 failed/旧状态，而是查询 Runner projection并按真实 status收敛。Toolchain-switch 的内部 delete transition会先被排除，继续走原有 `WORKSPACE_RECONCILIATION_REQUIRED` 路径，避免回归 §7.86。

新增 `tests/backend/workspace-lifecycle-authoritative-reconcile.regression.ts`：真实 RunnerJournal 中 ready Workspace + interrupted provision 会在 startup补为 succeeded，postcondition 不成立的 interrupted start仍为 unknown；Backend 本地 `starting` + remote `running` 的 unknown start会收敛为 running。旧 `workspace-toolchain-switch-reconcile.regression.ts` 同时重跑 PASS；Agent Runner 与 Backend TypeScript 均通过。

---

### 7.126 JobRunner 按原始 byte budget 截断后逐 chunk `toString('utf8')`，会把合法多字节输出静默改成 `�`（P2 · ✅ 已修复 2026-09-24）

继续审 Workspace Job output contract 时，确认除了 §7.123 的执行/wire/journal 上限不一致，Runner 自身的 UTF-8 截断语义也不正确。

`JobRunner.append()` 当前是：

1. 根据剩余 byte budget 对原始 `Buffer` 做 `chunk.subarray(0, remaining)`；
2. 直接对这个 accepted chunk 调 `accepted.toString('utf8')`；
3. 将解码后的 string 拼到 `stdout/stderr`。

这有两个正常路径都能触发的问题：

- 一个 UTF-8 code point 如果跨 Node pipe 的两个 `data` chunk，两个 chunk 会被分别解码，半个字符会变 replacement character；
- 即使 chunk 本身完整，只要 `maxBytes` 恰好截在一个多字节字符中间，`subarray()` 后的非法 UTF-8 也会被 `toString('utf8')` 静默替换成 `�`。

本轮直接调用真实 `JobRunner` 做了无侵入探针，只输出一个中文字符 `中`（UTF-8 3 bytes）：

- `maxBytes=1` → `stdout='�'`, `utf8Bytes=3`, `truncated=true`；
- `maxBytes=2` → `stdout='�'`, `utf8Bytes=3`, `truncated=true`；
- `maxBytes=3` → `stdout='中'`, `utf8Bytes=3`, `truncated=false`。

因此当前 byte limit 不仅会破坏用户可见日志文本，还会出现“输入只接受 1/2 bytes，结果 string 再编码却占 3 bytes”的语义反转；后续 journal/wire 再按 UTF-8 byteLength 做限制时，观察到的大小也不再等于 JobRunner 原始 budget。

这与 §7.123 不重复：§7.123 是三层最大尺寸契约不一致，会导致 protocol invalid / restart journal invalid；本条在远低于那些上限时就能发生，是 byte→text decoding/truncation 本身的数据正确性问题。

**建议修复**：

- stdout/stderr 用增量 `TextDecoder` / `StringDecoder` 维护跨 chunk UTF-8 state，不能逐 chunk 独立 `toString()`；
- 达到 byte budget 时只输出最后一个完整 code point 前缀；未完整的尾字节丢弃并置 `truncated=true`，不要生成 replacement character；
- 明确定义 budget 是 raw bytes 还是 encoded result bytes，并让 JobRunner / journal / wire 共用同一 helper；
- regression 覆盖：单个 3-byte/4-byte 字符在 1/2/3/4 byte 边界、字符跨两个 pipe chunk、stdout+stderr 共用 budget，以及截断后重新 `Buffer.byteLength(result,'utf8')` 不得超出约定。

**修复（2026-09-24）**：`JobRunner` 不再在每个 Node pipe `data` chunk 上独立 `toString('utf8')`。stdout/stderr 现在分别保存被共享 raw-byte budget 接受的 `Buffer` 副本（避免 `subarray` 意外保留超大原 chunk）；进程 close 后再按每个 stream 拼接，并通过 `completeUtf8Prefix()` 去掉最后一个未完整 UTF-8 code point 的尾字节后一次性解码。这样 pipe chunk 边界不会再改变文本语义，budget 仍严格按原始 bytes 计数。

当 maxBytes 恰好截断多字节字符时，未完整尾字节不会被 TextDecoder 替换成 `�`，而是直接不进入最终 string；由于原始 chunk 确实存在未接受 bytes，`truncated` 继续为 true。新增 `tests/backend/runner-job-utf8-truncation.regression.ts`：覆盖 3-byte 中文字符在 1/2/3 byte 边界、跨两个 pipe chunk、4-byte emoji 的 1/2/3/4 边界，以及 stdout+stderr 共享 budget；所有截断结果均无 replacement character，且 `Buffer.byteLength(stdout)+Buffer.byteLength(stderr)` 不超过约定。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.127 Runner Toolchain install 的 `.staging/<commandId>-...` 缺 startup / owner cleanup，安装中断可留下最高约 1GB 的不可归因 orphan tree（P2 · ✅ 已修复 2026-09-24）

继续审 PackInstaller / ToolchainStore 的 filesystem owner 生命周期时，确认 §7.119 之外还有一类不在 `cacheRoot` 的 crash orphan。

每次 builtin / mise 安装都会先构造 command-scoped staging path：

`<runnerRoot>/packs/.staging/<commandId>-<family>-<version>-<digest-prefix>`

正常路径的生命周期是闭合的：

- install 开始前会 `rmSync(staging, recursive)` 清同 commandId 的旧目录；
- builtin extract 或 mise materialize 失败时 catch 会 `discardStaging(staging)`；
- 成功时 `ToolchainStore.commit()` 把 staging rename 到 content-addressed installed path，mise 路径随后再 discard 外层 staging。

但如果 Runner 在 **extract / materialize / relocate / verify / lockAndSyncTree / commit 之间直接退出**，JavaScript finally/catch 不会运行，`.staging` tree 会留在 `packs` 下。startup 只构造 `ToolchainStore` 并 `mkdir .staging`，没有 sweep；`Reconciler` 只处理 journal/workspace；`cacheCleanup()` 只删除 `<runnerRoot>/cache`，不会碰 `<runnerRoot>/packs/.staging`。

这个 orphan 也很难被未来请求自然复用：path key 包含 commandId。Runner restart 后原 running command 会被 §7.118 所述流程改成 unknown；Backend 正常 reconcile/query 不会重放原 command，后续新的 install command 通常使用新的 commandId，因此旧 staging owner 不会再次命中其“install 开始前 rm”逻辑。

资源上限并不小：builtin archive 最多 512MB，expanded tree 上限 `MAX_EXPANDED_BYTES = 1GB`；mise materialized tree 也会在该 staging 目录里经历完整校验。一次 install crash 因而可留下接近 GB 级的残留。

`SpaceReporter` 还会把这个状态变成隐藏占用：

- `packBytes = size(root/packs)` 会把 `.staging` 全部算进总 Pack 空间；
- `byPack` 只遍历 catalog 的正式 content-addressed installed path，不会列 staging owner；
- `reclaimableBytes` 只包含 `cacheBytes + runtimeReclaimableBytes`，不包含 staging pack bytes；
- 因此用户能看到 Pack 总空间变大，却没有对应 pack 条目，也没有产品 cleanup 动作可以回收。

这与 §7.119 不同：§7.119 是**正常成功/失败安装也会留下** `cache/download/<commandId>` archive，但还能被显式全局 cacheCleanup 回收；本条只需一次 Runner 中断即可留下更大的 unpacked staging tree，而且当前没有任何 cleanup surface。

**建议修复**：

- ToolchainStore startup 扫描 `.staging`，只保留能证明仍由 active/running install command 拥有的目录；其余按 age + journal owner 安全删除；
- PackInstaller 的 command lifecycle 增加 durable staging ownership，command terminal 后 finally 删除所有 command-scoped staging；
- Runner startup 将 unknown install command 与 staging 做 reconciliation：已 commit 的 pack 收敛 succeeded，未 commit 的 staging 回收后收敛 failed/unknown evidence；
- `SpaceReporter` 增加 stagingBytes / orphanPackBytes，并把可安全删除的 staging 纳入 reclaimable bytes；
- regression：在 extract 中段、manifest verify 后、fsync 后、commit 前分别注入 process exit；重启后 `.staging` 必须被正确回收或恢复，Pack 总空间不能出现无 owner 的永久增长。

**修复（2026-09-24）**：`ToolchainStore` constructor 现在把 `packs/.staging` 明确定义为跨进程不可恢复的 transient owner root：Runner startup 在创建新 staging owner 之前先 best-effort 解除旧 tree 的只读权限并递归删除整个历史 `.staging`，随后以 `0700` 重建空目录。由于 Runner main 在构造 ToolchainStore 之前已经 reaped prior managed process groups、且此时尚未接收新 command，因此这些目录不可能仍由当前进程的合法 active install 持有。

运行期新增 `discardCommandStaging(commandId)`，按安全 command prefix 一次回收同一 `ensure()` 展开的所有 dependency staging；`PackInstaller.ensure()` 的 `finally` 在清 `cache/download/<commandId>` 前先调用该 owner cleanup，因此成功、普通异常与 dependency 中段失败都会收口。进程 hard crash 来不及执行 finally 的残留由下一次 startup sweep兜底。

SpaceReporter 同时新增 `stagingPackBytes = size(packs/.staging)`，并通过 Backend `WorkspaceRuntimeStorageView`、Runner HTTP decoder、HTTP DTO 与共享 `AgentWorkspaceRuntimeStorageDto` 全链路暴露；`packBytes` 仍保留 Runner managed pack root 总量语义，而 staging 子集不再是无法解释的隐藏占用。新增 `tests/backend/runner-toolchain-staging-retention.regression.ts`：构造 startup orphan 确认 ToolchainStore 初始化即回收；构造同 command 两个 dependency staging + 另一个 active command，确认 command cleanup 只删 owner 对应两棵；并验证 `stagingPackBytes` 可从 Runner report 经 Backend decoder保真读取。focused regression、Agent Runner TypeScript 与 Backend TypeScript 均通过；protocol 包没有独立 tsc/build script，其 TS exports 已由 Backend typecheck 直接消费验证。

---

### 7.128 Runner `/storage` 可合法返回 4,097+ Workspace，但 Backend decoder 硬限 4,096，长期实例会把 Storage 管理面解码成 protocol invalid（P2 · ✅ 已修复 2026-09-24）

继续对齐 Runner HTTP response 总量 / collection contract 时，确认 Workspace storage surface 的生产者与消费者使用了不同集合上限。

Runner `SpaceReporter.report()` 直接：

`const workspaces = journal.workspaces();`

随后为**全部** journal Workspace 生成 `byWorkspace`。Runner journal 的 decoder 对 `workspaces` collection 允许 `MAX_JOURNAL_COLLECTION_ITEMS = 16_384`；Workspace 没有另一个产品级总数 hard limit。deleted / failed Workspace 只有用户实际执行 runtime cleanup、`journal.deleteWorkspace()` 后才会从 journal 消失。

Backend `runner-http-protocol.ts` 却把所有协议 collection 共用：

`MAX_PROTOCOL_COLLECTION_ITEMS = 4096`

`decodeStorage()` 在解析具体 row 之前先检查：

`record.byWorkspace.length > 4096 → WORKSPACE_RUNTIME_PROTOCOL_INVALID`

因此 Runner 自己完全合法的 journal 状态可以生成 Backend 永远无法消费的 `/v1/storage` response。

本轮直接调用真实 `decodeStorage()` 做 synthetic contract probe，使用最小合法 storage shape：

- 4,096 workspace rows → `PASS`，JSON body 约 **244,825 bytes**；
- 4,097 workspace rows → `FAIL WORKSPACE_RUNTIME_PROTOCOL_INVALID`，JSON body约 **244,885 bytes**。

所以这个失败与 Backend HTTP 默认 1MB body cap 无关；在远低于 1MB 时就能稳定触发，根因就是 collection bound mismatch。

达到该状态后 Runner 自身仍可启动、Workspace 仍可运行，只有 Backend `storage()` / Settings Storage 管理面开始稳定失败；用户反而更难看到并执行 cleanup，从而不利于把 journal/workspace 数量降回 4096 以下。

同轮还看到 `/catalog` 与其它管理 response 共用 Backend 默认 1MB transport cap；Runner catalog 虽与 Backend decoder 都允许最多 4,096 packs，但合法长 metadata 可能先撞 transport size。该点应在统一 response contract 时一起校正，但本条确定证据只计 `/storage` collection mismatch。

**建议修复**：

- Runner/Backend 为每个 response DTO 共享同一 collection limits，而不是 journal=16k、wire=4k 各自定义；
- `/storage` 不应一次返回全部历史 Workspace：增加 cursor pagination / summary aggregate，byWorkspace 按页读取；
- deleted/failed Workspace 的 runtime cleanup / journal retention 应有明确生命周期，避免管理历史无限推高 response cardinality；
- Backend HTTP `maxResponseBytes` 应由 DTO/分页 contract 推导，不能再与 decoder 数量上限独立漂移；
- regression：构造 4,096 / 4,097 / >10k workspace journal，Storage API 均应通过分页稳定读取，不得因合法 Runner state 返回 protocol invalid。

**修复（2026-09-24）**：Backend storage wire contract 现在把两个 collection 分开约束：`byPack` 继续使用通用 4,096 上限，`byWorkspace` 新增 `MAX_STORAGE_WORKSPACES=16_384`，与 Runner journal 的合法 Workspace collection 上限一致，因此 4,097+ 长期历史不再被 consumer 自行判坏。

同时 `RunnerHttpAdapter.storage()` 使用独立 `MAX_STORAGE_RESPONSE_BYTES=8MB`，避免接近上限的 Workspace/Pack metadata 先在通用 1MB bounded read 处失败；其它 Runner route 的默认 response cap 不变。新增 `tests/backend/workspace-storage-collection-contract.regression.ts`：4,096 / 4,097 / 10,000 / 16,384 Workspace rows 均通过真实 `decodeStorage()`，16,385 明确抛 `WORKSPACE_RUNTIME_PROTOCOL_INVALID`，并锁定 `/storage` route-specific envelope。focused regression 与 Backend TypeScript 均通过。

---

### 7.129 Runner 遇到 corrupt journal 时每次启动都会复制一份完整 `.corrupt.*` evidence 后再次退出，supervisor restart loop 可持续放大磁盘占用（P2 · ✅ 已修复 2026-09-24）

`RunnerJournal` constructor 对非 ENOENT / 非 schema-upgrade 的 journal decode failure 会：

1. `quarantineCurrent('corrupt')`；
2. `copyFileSync(journal.json, journal.json.corrupt.<timestamp>-<pid>)`；
3. fsync evidence；
4. **保留原始坏 `journal.json` 不动**；
5. 抛 `RUNNER_JOURNAL_INVALID`，Runner startup 失败。

因此如果 systemd / Docker / process supervisor 配置自动 restart，下一次启动仍读取完全相同的坏主 journal，再复制一份新的 evidence，再退出；没有“已保存 evidence”标记、digest 去重、数量/字节上限或 rename-away。

本轮用 `/tmp` 真实 `RunnerJournal` 做了无侵入探针：同一坏 journal 连续构造两次，结果为：

- attempt 1 → `RUNNER_JOURNAL_INVALID`，生成 `journal.json.corrupt.<t1>-<pid>`；
- attempt 2 → `RUNNER_JOURNAL_INVALID`，又生成 `journal.json.corrupt.<t2>-<pid>`；
- 原 `journal.json` 仍存在；目录最终同时包含主坏文件 + 两份完整 evidence。

临时探针目录随后已删除。

这个放大器不只依赖手工损坏：§7.118 的 collection hard-limit、§7.123 的 writer/reader Job output mismatch 都可能让一个原本由 Runner 自己写出的 journal 在下一次启动进入 `JOURNAL_STATE_INVALID`。一旦 supervisor 自动重启，Runner 已经不可用的故障会进一步演化为持续磁盘写入；journal 越大，每次 restart 的 copy 成本越高。

schema unsupported 路径反而采用 `renameSync`，只保留一次旧文件后创建新 journal，不会发生同样的重复 copy；说明 corrupt 路径缺少一次性 quarantine ownership。

**建议修复**：

- corrupt journal 首次失败时 atomic rename 到唯一 evidence path，主路径写入一个小的 fail-closed marker / recovery state，而不是每次 copy 原文件；
- 或按 content digest 去重 evidence，同一坏内容最多保留一份；
- evidence 定义数量/总字节 retention，避免不同 corruption 事件长期无限积累；
- startup error 明确区分 `evidence already preserved`，supervisor restart 不应再次复制；
- regression：同一 corrupt journal 连续启动 N 次，evidence 数量/总字节必须保持有界；同时保留至少一份完整 forensic evidence。

**修复（2026-09-24）**：corrupt journal 现在采用一次性 quarantine ownership。首次 decode/collection validation 失败时，`quarantineCurrent('corrupt')` 不再 `copyFileSync()` 后保留坏主文件，而是把 `journal.json` 原子 rename 为带 timestamp/pid/high-resolution 唯一后缀的 `.corrupt.*` evidence，fsync evidence 后写一个很小的 `journal.json.corrupt-marker` 并 fsync parent directory。Runner constructor 在读主 journal 前先检查 marker；marker 存在时直接 fail-closed 抛 `RUNNER_JOURNAL_INVALID`，所以 supervisor 连续 restart 不会再生成第二份相同 evidence，也不会自动以空 journal 启动。

不同显式 recovery 后再次发生 corruption 时，`pruneCorruptEvidence()` 对 evidence 做数量 retention，仅保留最近 4 份；retention 删除失败为 best-effort，不会牺牲最新 forensic evidence。新增 `tests/backend/runner-journal-corrupt-evidence-retention.regression.ts`：同一 corrupt 内容连续启动 5 次 evidence 数保持 1；随后模拟 6 次显式 marker 清理+新 corruption，最终 evidence 数稳定为 4，且首次完整原文可校验。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.130 Runner 副作用完成后 terminal journal 写失败可被 catch 反写成 `failed`，把真实成功的 destructive/admin/lifecycle 操作持久化为失败（P1 · ✅ 已修复 2026-09-24）

继续审 Runner command/job 的 durable commit boundary 时，确认 `executeWorkspaceJob()` / `executeWorkspaceCommand()` / `executeAdminCommand()` 都把“业务副作用”和“写 terminal journal 状态”放在同一个 try/catch 里：

- try 内先执行真实 Job / Workspace lifecycle / pack install-uninstall / runtime cleanup；
- 副作用返回成功后调用 `journal.succeed*()`；
- **只要 `journal.succeed*()` 自己因为 filesystem I/O 抛错，也会进入同一个 catch**；
- catch 随后无条件调用 `journal.fail*()`。

`RunnerJournal.patchCommand/patchJob()` 又是先修改内存 state，再 `flush()`：

`this.state.commands[id] = { ...current, ...patch }; this.flush();`

所以 terminal success flush 失败时，内存已经先变成 `succeeded`；catch 再 patch `failed`，第二次 flush 如果恢复正常，就会把真实已成功副作用永久记录成 failed。

本轮用 `/tmp` 真实 `RunnerJournal` 做了无侵入探针：先 begin+running 一个 `packInstall` command，仅让第一次 terminal `renameSync(temp,journal)` 模拟一次 transient `EIO`：

`{"succeedError":"simulated transient rename failure","afterSucceed":"succeeded","failError":"","afterFail":"failed","reopened":"failed"}`

这证明错误不是理论分支：一次成功副作用后的 terminal-record 瞬时写失败，现有 catch 结构可以让重开的 durable journal 明确显示 `failed`。

对不同 command 的影响都很危险：

- `packInstall` 已把 pack commit/activate，但 command durable failed；调用方可再次 install / 与 uninstall 交错；
- `runtimeCleanup` 已删除 Workspace runtime / journal workspace，command 却 failed；Backend 不会应用 succeeded cleanup projection；
- Workspace start/stop/delete/provision 已完成真实 postcondition，却被 command failed，进一步放大 §7.125 的 Backend/Runner projection 分叉；
- Workspace Job child 已执行完成、结果已知，但 `succeedJob()` flush 失败后可被 `failJob()` 覆盖成 failed，丢掉真实 result。

还有第二层 failure：`begin*()` 用 `void this.execute...()` 启动这些 async executor，没有外层 `.catch()`。若 success flush 失败后 catch 内的 `journal.fail*()` 也因持续 I/O 故障再次抛错，executor Promise 会直接 reject 且没有 owner；现代 Node 默认 unhandled rejection 可升级为进程级故障。即使 supervisor 重启，磁盘上最后 durable state 仍可能只是 `running`，再进入 §7.118/§7.125 的 unknown reconciliation。

这与 §7.125 不重复：§7.125 是**进程在真实 postcondition 与 command succeed 之间重启**；本条不需要进程重启，只要 terminal journal commit 出现一次可恢复 I/O failure，就能主动把成功副作用写成 failed。

**建议修复**：

- 把业务执行错误与 terminal journal commit 错误分开：副作用返回成功后，`succeed()` 写失败绝不能进入业务 `fail()` 分支；
- terminal durable write 失败应进入 `outcome_unknown / reconciliation_required`，保留真实 postcondition/result evidence，不能伪造 failed；
- RunnerJournal mutation 改成 copy-on-write：先构造 next state、durably flush/rename 成功后再替换内存 state，避免 flush 抛错后内存先越过 durable commit point；
- 所有 `void execute*()` 都必须带统一顶层 `.catch()`，记录 fatal executor persistence failure并进入 fail-closed/reconciliation 状态，禁止无 owner rejection；
- 对 Workspace lifecycle/admin side effect 增加 authoritative postcondition reconcile，与 §7.125 一并让 startup 可以补写 terminal outcome；
- regression：副作用成功后分别在 journal temp write / fsync / rename / parent fsync 注入一次和持续 I/O failure；不得把成功操作记录成 failed，且不得产生 unhandled rejection。

**修复（2026-09-24）**：`RunnerJournal` 核心 mutation 现在采用 copy-on-write durable commit。`begin/beginJob`、command/job patch、Workspace save/delete、compact 都先构造独立 next state；`flushState(nextState)` 完成 temp write、file fsync、rename、parent fsync 后才 `this.state = nextState`。因此任何 terminal write 阶段抛错时，当前进程内 state 与最后 durable journal 都仍停留在旧状态，不会再出现 success flush 失败后内存已是 succeeded、随后被 catch 改写 failed 的越界。

`executeWorkspaceCommand()`、`executeAdminCommand()`、`executeWorkspaceJob()` 同时拆成明确的业务阶段与 terminal persistence 阶段：业务失败才写 failed/cancelled；业务已经成功后若 `succeed/succeedJob` 写失败，则只尝试写 `unknown/unknownJob('RUNNER_TERMINAL_PERSISTENCE_FAILED')`，并记录 error log，不进入业务失败分支。若连 unknown 持久化也持续失败，Promise 向外抛给 begin path 上显式的 `.catch()` owner，统一记录 `Agent Runner executor persistence failure`，禁止 unhandled rejection。

新增 `tests/backend/runner-terminal-persistence-boundary.regression.ts`：对真实 RunnerJournal 注入一次 terminal rename EIO，确认 command/job 内存与重开 journal 都保持 running；随后验证可明确持久化 unknown。另用真实 `RunnerControllerServer` 私有 executor 边界注入 admin/Job `succeed*()` 失败，确认事件只有 unknown、不会触发 fail，并锁定三个 `void execute*()` 都显式接 `.catch()`。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.131 Project Instructions 可合法产生 >32 条 omission，但 Backend decoder 只允许 32，深层 `AGENTS.md` 链会被误判 protocol invalid（P2 · ✅ 已修复 2026-09-24）

继续对齐 Runner producer / Backend consumer 的集合上限时，确认 Project Instructions surface 还有一处比 §7.128 更容易达到的 contract drift。

Runner `resolveProjectInstructions()` 的设计是：

- 最多返回 `MAX_INSTRUCTION_FILES = 16` 个真正的 instruction；
- targetDirectory 最多 8 个，但单个 logical path 最长 4096；
- 对 project root → target 的每一级目录都检查 `AGENTS.md`；
- 当已经收满 16 个 instruction 后，后续每发现一个 `AGENTS.md` 就继续 `omitted.push({ reason:'too_many_files' })`。

因此 `omitted` 数量并没有 32 的 producer 上限；深层 monorepo / generated tree 完全可以返回几十到上百条 omission。

Backend `decodeProjectInstructionProjection()` 却要求：

`record.instructions.length <= 16`

`record.omitted.length <= 32`

超过 32 条 omission 直接 `WORKSPACE_RUNTIME_PROTOCOL_INVALID`。

本轮用 `/tmp` 构造一个 `.git` project root + 50 层子目录，每层都放合法 `AGENTS.md`，目标指向最深层，直接调用真实 Runner resolver 再送入真实 Backend decoder：

`{"instructions":16,"omitted":35,"decoded":"FAIL:WORKSPACE_RUNTIME_PROTOCOL_INVALID","bytes":11716}`

整个 response 只有约 11.7KB，远低于该 route 的 256KB response cap；失败完全来自 collection contract mismatch，而不是总量限制。探针目录随后已删除。

这会让 Project Instructions 在最需要“告诉模型哪些文件因为数量限制被省略”的深层项目里反而整体失败，调用方拿不到前 16 个本来完全合法的 instruction，也拿不到 omission evidence。

这与 §7.128 同属 producer/consumer limit drift，但触发 surface 与修复 contract 独立：§7.128 是长期 Workspace storage cardinality；本条是单个普通项目目录结构即可触发。

**建议修复**：

- Project Instructions 的 limits 定义移动到共享 protocol contract，Runner producer / Backend decoder 引用同一常量；
- 更好的输出语义是 omission 本身也做 bounded aggregate：例如最多 N 条详细 omission + `omittedCount/truncated`，而不是无限累积；
- decoder 必须接受 producer 所有合法输出，不能让“截断证据”自身把整个 response 变 invalid；
- regression：16 instruction + 0/32/33/100 omission 均按共享策略稳定解码；超策略时只截 omission detail，不丢已收集的 instruction。

**修复（2026-09-24）**：Runner Project Instructions producer 现在定义 `MAX_OMISSION_DETAILS=32`，并通过单一 `recordOmission()` 入口约束所有 omission reason，而不是仅在 Backend decoder 末端硬拒绝。达到 32 条 detail 后仍继续扫描潜在 instruction scope，但不再增长 omission array，因此 `instructions` 的 16-file contract保持不变，response cardinality 也与 consumer 一致。`PROJECT_INSTRUCTION_LIMITS` 新增 `maxOmissionDetails`，让该 producer limit 可由回归/调用方显式观察。

新增 `tests/backend/project-instruction-omission-contract.regression.ts`：构造 `.git` root + 64 层目录、每层合法 `AGENTS.md`，真实 resolver 返回 16 instructions + 32 `too_many_files` omissions；随后直接送入真实 `decodeProjectInstructionProjection()` 成功解码，证明 producer 的全部合法输出均在 Backend wire contract 内。focused regression、Agent Runner TypeScript 与 Backend TypeScript 均通过。

---

### 7.132 Workspace provision 失败可把 Runner workspace 永久留在 `creating`，Backend 已标 `failed` 但 runtime cleanup 仍会被 Runner 持续 skip（P2 · ✅ 已修复 2026-09-24）

继续反查 Workspace filesystem / journal commit 顺序时，确认 provision 的普通失败路径没有收口 Runner workspace owner state。

Runner `provision()` 当前顺序是：

1. toolchain `installer.ensure()`；
2. 构造 `WorkspaceRecord(status='creating')`；
3. **先** `journal.saveWorkspace(creating)`；
4. `runtimeEngine.create(command)` 创建 generation/workspace/profile 目录并依次写 metadata + state=ready；
5. `pluginRunner.prepareWorkspace(ready)`；
6. 最后才 `journal.saveWorkspace(ready)`。

`executeWorkspaceCommand()` 外层 catch 只把 command `journal.fail(commandId, error)`，**不会把 workspace journal 从 creating 改成 failed，也不会 rollback 已创建的目录**。

因此只要第 4/5 步发生普通异常（例如 mkdir/write/fsync/permission/ENOSPC，或 Plugin workspace prepare I/O failure），就会得到：

- Runner command = failed；
- Runner journal workspace = creating；
- filesystem 可能已经有部分 generation / persistent workspace / toolchain profile 内容；
- Backend `syncWorkspaceStatus()` 对 failed provision 明确把本地 Workspace 改成 `failed`。

随后两个控制面会发生长期分叉：

- Backend Runtime Cleanup preview 把 failed、non-retained Workspace 视为 candidate；
- Runner `CleanupPlanner.runtimeCleanup()` 却把 `creating` 和 `running` 都列入 `activeStatuses`，所以同一个 workspaceId 每次都只返回 `skipped`；
- Backend `requireLiveWorkspace()` 又把 failed 当 NOT_FOUND，普通 start/stop/restart/delete 都无法再作为恢复动作。

当前只有 Runner **整体重启**时 `Reconciler.reconcile()` 才会根据 generation state 重新映射 creating workspace：缺 state/半创建目录会变 failed，之后 cleanup 才可能成功。正常运行中没有 periodic reconcile，所以“重启 Runner”成为唯一隐式恢复机制。

这与 §7.125 不同：§7.125 是真实 postcondition 已完成、command terminal outcome 因重启变 unknown；本条是 provision 自己明确 failed，Backend 也知道 failed，但 Runner owner journal 留在 pre-operation `creating`，导致官方 cleanup path 自相矛盾。

**建议修复**：

- provision failure catch 必须执行 workspace-level rollback/reconcile：未达到 ready 时把 Runner workspace durable 标 failed，并清理可证明只属于本次 generation 的 partial runtime；
- `runtimeEngine.create()` 建议采用 staging generation + atomic commit，避免 metadata/state 多步写留下半目录；
- CleanupPlanner 对 command 已 terminal failed 的 `creating` workspace 不应永久视作 active；应结合 active command/job owner 证明后安全清理；
- Backend/Runner 暴露 authoritative workspace status/reconcile surface，与 §7.125 统一处理 projection drift；
- regression：在 generation mkdir 后、metadata write 后、state write 前、plugin workspace prepare 时分别注入失败；command failed 后无需重启 Runner，runtime cleanup 必须能回收 partial owner，Backend/Runner 状态最终一致。

**修复（2026-09-24）**：`provision()` 现在在写入 `creating` 之后，对 `runtimeEngine.create()`、Plugin workspace prepare 与最终 ready commit 建立显式失败 owner boundary。任一步普通异常都会先尝试 `journal.saveWorkspace({...creating,status:'failed'})`，随后 best-effort `runtimeEngine.remove(workspaceId,generation)` 回收本 generation partial runtime，并调用 `pluginRunner.cleanupGeneration()` 收口 generation Plugin HOME；清理失败只记录 bounded warning，Workspace 的 failed durable owner 仍允许后续官方 runtime cleanup 重试。若连 failed owner state 自身都无法持久化，则把 persistence error向上交给 §7.130 的 terminal persistence owner，而不伪装成成功闭环。

CleanupPlanner 同时改为 owner-aware：`running` Workspace 始终 skip；`creating` 只有在 journal 中确实存在同 workspaceId 的 `pending/running provision` command 时才视为 active。因旧版本/异常留下的 `creating`，只要其 provision command 已 terminal failed/unknown 或不存在，就可走正常 cleanup；active provision 期间仍不会被并发删除。

新增 `tests/backend/workspace-provision-failure-owner.regression.ts`：分别注入 runtime create failure 与 Plugin prepare failure，确认无需 Runner restart 即得到 command failed + workspace failed、partial generation cleanup 被调用；再构造 legacy `creating + failed provision` 与 active `creating + running provision`，确认前者 runtimeCleanup 删除、后者 skip，待 command terminal 后同样可删除。focused regression 与 Agent Runner TypeScript 均通过。

---

### 7.133 Runner catalog 与 Backend decoder 都允许 4,096 packs，但 HTTP adapter 默认只收 1MB，合法 catalog 会在 decode 前被 transport 拒绝（P2 · 🟠 开放 2026-09-24）

继续对齐 Runner management response 的 collection / byte limits 时，确认 `/v1/catalog` 存在第三套彼此独立的上限。

Runner `WorkspaceRuntimeCatalog` 允许：

- `MAX_CATALOG_PACKS = 4096`；
- 单个 catalog string 最多 16KB；
- 每个 pack 可带 displayName、digest/downloadRef map、capabilities、dependencies、architectures 等 metadata。

Backend `decodeCatalog()` 同样允许最多 4,096 packs，字符串上限也是 16KB；从 DTO decoder 角度，这个规模是合法的。

但 `RunnerHttpAdapter.catalog()` 直接调用：

`decodeCatalog(await this.get('/v1/catalog', signal))`

没有给 `get()` 传 route-specific response limit，因此落到通用 `MAX_RESPONSE_BYTES = 1MB`。HTTP adapter 会在 decoder 前读取 body 并对超过 1MB 的 response 抛 `WORKSPACE_RUNTIME_RESPONSE_TOO_LARGE`。

本轮用临时合法 catalog 做真实 producer/consumer contract probe：生成 4,096 个 pack，每个只使用约 320B displayName 和很小的其它字段；

- Runner `WorkspaceRuntimeCatalog.load()` → PASS，`runnerPacks=4096`；
- 构造成 `/catalog` wire shape 后 JSON body = **3,399,500 bytes**；
- Backend `decodeCatalog(wire)` → **PASS**；
- 但 Backend HTTP 默认 cap = **1,048,576 bytes**。

因此生产者、DTO decoder 都认为 response 合法，只有 transport 自己会提前拒绝。该探针使用的 metadata 远低于单字段 16KB 上限，所以不需要极端 catalog 才能超过 1MB。

这与 §7.128 不同：§7.128 是 `/storage` 的 collection 数量上限不一致；本条的 collection 上限完全一致，错误来自**第三套未由 DTO contract 推导的 transport byte cap**。

**建议修复**：

- catalog surface 明确定义可传输总量；优先增加分页/版本化按需查询，而不是一次返回全部 4,096 pack metadata；
- 若仍保留单 response，Backend `maxResponseBytes` 必须从共享 catalog contract 推导，并与 Runner 最大合法 serialization 做静态/测试校验；
- catalog string/collection limits 与 HTTP byte limit 放入同一 shared protocol module，禁止三处独立常量继续漂移；
- regression：构造接近最大合法 catalog，Runner serialize → HTTP bounded read → Backend decode 全链必须成功；超过共享 contract 时由 producer 明确分页/truncate/reject，不能由 consumer transport 意外拒绝。

---

### 7.134 Backend Plugin 的 async line handler 无 Promise owner，合法 JSON 但非法 protocol frame 可把插件错误升级成 Backend unhandled rejection（P1 · 🟠 开放 2026-09-24）

`BackendPluginProcess` 用 readline 消费 child stdout：

`lines.on('line', (line) => void this.handleLine(line));`

但 `handleLine()` 是 async，外层既不 await 也不 `.catch()`。它只有最外层 JSON.parse 自己做了 try/catch；后续 decoder 并非全部被包住。

例如一个很小的 JSON frame：

`{"kind":"lifecycle.result","requestId":1,"ok":"not-a-boolean"}`

会先通过 `protocolRecord()`，随后进入 lifecycle 分支并直接调用 `decodeLifecycleResult(message)`。该 decoder 会抛 `PLUGIN_BACKEND_PROTOCOL_INVALID`；异常变成 rejected `handleLine()` Promise，而 readline callback 已经用 `void` 丢掉这个 Promise。

storage / intent 分支也有相同结构：`decodeStorageRequest()` / `decodeIntentRequest()` 在进入各自 handler 前就可能 throw，同样越过内部业务 try/catch。

这意味着动态 Backend Plugin 不需要超长 stdout 或破坏 JSON parser，只需要发送一个字段不合法但 framing/JSON 都正常的 protocol line，就可以把“插件协议错误”升级成 Host Backend 的 unhandled rejection。现代 Node 默认 unhandled rejection 可进程级终止，因此这是和 §7.117 SSH keepalive 同类的 error-ownership 破口。

这与 §7.116 不重复：§7.116 是 readline **收齐无换行超长 frame 后才检查 size**导致内存峰值；本条 frame 可以非常小，问题是 async decoder failure 没有生命周期 owner。

**建议修复**：

- readline callback 必须显式 `void this.handleLine(line).catch(error => this.protocolFailure(error))`；
- `protocolFailure` 统一 fail pending request、kill child、记录 bounded error，绝不能让 plugin-originated rejection 逃出 process owner；
- `handleLine()` 最外层再设一个统一 decoder boundary，任何 protocol decode/response-send 错误都转换为 plugin process failure；
- 对 child stdin response 也复用带 backpressure/error ownership 的 writer，不让 EPIPE/close 形成第二个 rejected line handler；
- regression：malformed lifecycle/storage/intent frame、child stdin close、decoder throw 均只能杀该 plugin instance，Backend 进程保持存活。

---

### 7.135 Backend Plugin Host→child response path 忽略 stdin backpressure，插件停读 stdin 时合法小请求可让主 Backend Writable queue 无界增长（P2 · 🟠 开放 2026-09-24）

继续复核 Backend Plugin IPC 的反向数据流后，确认 child→Host 与 Host→child 两边都有独立的资源隔离缺口。

插件可以从 stdout 连续发送 `storage.get/put/delete`、`intent.*` 等 Host RPC。`readline` 的 `line` callback 使用 async `handleLine()`，但 EventEmitter 不会等待上一条处理完成，因此多条请求可以并发进入 Host storage / AppIntent service。

Host 返回结果时：

- `sendStorageResult()` → `this.child.stdin.write(encoded + '\n')`；
- `sendIntentResult()` → 同样直接 `child.stdin.write(...)`；
- Host 发 lifecycle request 的 `request()` 也直接 `this.child.stdin.write(...)`。

这些路径都只对**单条 encoded frame**做 `MAX_PROTOCOL_BYTES = 20MB` 检查，没有检查 `Writable.write()` 返回值，也没有等待 `drain`、限制 `writableLength` 或暂停 child stdout。

Node Writable 的 `write()` 返回 false 只表示内部 queue 已超过 highWaterMark，并不会自动阻止调用者继续 write；如果 child 进程停止读取 stdin，但仍持续向 stdout 写很多合法小请求，Host 会继续处理并把响应追加到 `child.stdin` queue。于是动态插件可以把自己的“不读 stdin”反压转化为主 Backend heap/stream buffer 增长。

这与 §7.116 不重复：§7.116 是 child→Host **单个无换行 frame**让 readline 先无界聚合；本条是 Host→child **大量合法 bounded frame 的 aggregate queue**。也与 §7.134 不同：本条不需要 malformed protocol，只需不消费 response。

**建议修复**：

- 所有 Host→child frame 统一走一个串行 bounded writer；`write()` false 时 await `drain`，close/error 时 reject；
- writer 设置 aggregate queued-byte / pending-frame 上限，超过即 fail plugin instance，而不是继续让 Backend 缓冲；
- child stdout request ingestion 与 response writer 做联合 backpressure：response queue 高水位时暂停 stdout/readline，drain 后恢复；
- 限制 plugin-originated Host RPC 并发数，避免大量 async storage/intent 请求同时占内存；
- regression：child 持续发小 storage.get request 但不读取 stdin，Host queue 必须保持有界并最终 kill/throttle plugin，Backend RSS 不随请求数线性增长。

---

### 7.136 `af543606` 默认模型 optimistic state 只缓存 modelId，跨 Provider 同名模型会解析/过滤到错误 Provider（P1 · 🟠 开放 2026-09-24）

继续按“commit → Problem 闭环 → 当前 HEAD”复核 `af543606` 时，确认这次为默认模型下拉加入的 optimistic 回显把模型身份从 `(providerId, modelId)` 降成了单独的 `modelId`。

当前 `ModelProviderSettings.vue` 的关键链路是：

- `optimisticDefaultModelId` 只保存 model id；`selectDefaultModel()` 选中后也只写 `opt.model.id`；
- `defaultModelKey` 一旦存在 optimistic id，就执行 `modelOptions.find(item => item.model.id === optimisticDefaultModelId)`，直接取**第一个同 id 模型**，不再校验 Provider；
- watcher 只监听 `props.defaultModelId`。如果从 Provider A 的 `gpt-4o` 切到 Provider B 的 `gpt-4o`，服务端返回后 Provider 已改变但 modelId 没变，watcher 不会触发；
- 父级 `patchSection()` 在 mutation 失败时只统一 toast 并返回，没有通知子组件 rollback optimistic 值；
- `validFallbackModels` / `fallbackOptions` 又复用了这个错误的 `defaultModelKey` 做排除，因此问题不只是一行标签显示错：它可能排除错误 Provider 的同名模型，同时把真实默认 Provider/model 暴露成 fallback 候选。

最小复现不依赖真实模型调用：配置两个 enabled Provider A/B，并让二者都包含同一个 model id（例如 `gpt-4o`）。当服务端默认值是 `B/gpt-4o` 时，当前 UI 会按 `modelOptions` 顺序命中第一个 `gpt-4o`；如果 A 排在前面，页面首帧就显示 A。再做 A→B 且 modelId 不变的切换，Provider 维度仍不会进入 optimistic/watch identity。

这与 §7.82 不重复：§7.82 是跨 tab/version conflict 后整个 Settings 不 reconcile stale revision；本条即使没有 409、单 tab、请求完全成功也能由**同名 model id**稳定触发，是 `af543606` 新引入的局部 identity regression。

**建议修复**：

- optimistic state 保存完整 `{ providerId, modelId }` 或已经存在的复合 key `${providerId}\0${modelId}`，禁止仅按 modelId 做 `find`；
- watcher 同时观察 `defaultProviderId + defaultModelId`，服务端 props 收敛后清掉/同步 optimistic state；
- mutation 失败时显式 rollback 到 props，而不是继续保留未提交的 optimistic key；
- regression 至少覆盖：两个 Provider 同名模型的首屏解析、同 modelId 跨 Provider 切换、保存失败 rollback、fallback 候选始终排除真正的默认复合 key。

---

### 7.137 `a6371f9` 重新打开 §7.38：Launcher 从“长按 320ms 才拖动”回退为 4px 位移即拖动（P1 · 🟠 重新打开 2026-09-24）

§7.38 已经把 Launcher 原先“6px 位移阈值拖拽”明确判为误触问题，并在真实 CDP 探针里验证：**快速移动 <320ms、80×60px 时位置不变且 Hub 不打开；只有长按 320ms 后才进入拖动**。该条因此标为已关闭。

但后续 `a6371f9` 在“设置布局/提示清理”提交中同时修改了 `AgentLauncher.vue`，直接删除 `HOLD_MS = 320` 与长按 timer，改为：

- `DRAG_THRESHOLD_PX = 4`；
- pointer down 后只要 `Math.hypot(dx, dy) >= 4` 就立即 `dragging=true`；
- 同一 pointer move 马上调用 `setLauncherPosition(...)`。

因此当前 HEAD 又回到了比 §7.38 修复前 **6px 阈值还更敏感的 4px 阈值**。普通点击时轻微手抖就可能把 Launcher 拖离位置，历史文档里的“长按拖动”闭环与实际实现已经失真。旁证是 `window-manager.ts` 当前注释仍写着 “Dragging it away is now an explicit long press”，说明行为改回去了但契约/文档没有同步。

`97560f1` 又进一步删除了 §7.38 同轮加入的可见“重置位置”气泡：`RESET_VISIBLE_MS`、`resetVisible`、reset timer 与 `data-agent-launcher-reset` 按钮整段被移除；拖动完成后不再出现可发现的恢复入口，当前只剩 `@contextmenu="onContextMenu"` 调 `resetLauncherPosition()`。因此此前“误拖后可发现恢复”的验收也再次失效：触屏设备没有这个显式入口，键盘用户也没有可聚焦的恢复按钮。

本条不是重新争论 UX 偏好，而是对一个已经有明确验收标准、真实 probe 和“已关闭”状态的问题做 regression 记录。

**建议修复**：

- 恢复 §7.38 的 hold intent gate，或采用等价的“时间 + 位移意图”状态机；未满足拖动意图前不得改写持久化位置；
- 恢复可见、键盘与触摸可达的“重置位置”入口；右键还原只能作为补充，不能作为唯一恢复路径；
- 直接恢复/固化 §7.38 的 regression：down/up 可打开；<320ms 的 80×60 快速移动不得改变位置；>320ms 后拖动才更新位置；pointercancel 不落盘；
- 修复后同步 `window-manager.ts` 与 Launcher 注释，避免“代码 4px、注释长按”的双契约。

---

### 7.138 Provider discovery 最多返回 1,000 模型，但“导入全部/一键添加全部”会越过 100-model 持久化上限（P2 · 🟠 开放 2026-09-24）

`a6371f9` 新增未落库 endpoint model discovery 后，拉取端与保存端出现了确定的数量契约分叉：

- `OpenAiProviderAdapter.fetchModelsFromEndpoint()` 对 provider `data` 使用 `slice(0, 1000)`，所以一次 discovery 合法返回最多 1,000 个去重模型；
- 添加 Provider 弹窗在 `importAllPulled=true` 时直接对 **全部** `pulledModels.map(...)`，同一数组既用于测试连接前的 create，也用于最终 submit；
- 已有 Provider 的“添加所有模型”同样把 `availableDiscoveries(provider)` 全部拼到 `[...provider.models, ...newModels]` 再 update；
- Backend `validateProviderInput()` 则明确要求 `raw.models.length <= 100`，超过直接抛 `VALIDATION_FAILED`。

因此只要一个 OpenAI-compatible endpoint 正常返回 101–1,000 个不同模型，UI 就会展示“导入全部（N）/添加所有模型”这一合法操作，但 create/test/update 必然被 Backend 拒绝。已有 Provider 更早触发：例如已配置 90 个模型、discovery 再发现 11 个新模型，“添加所有”就会构造 101 个模型并失败。

这与 §7.112 不重复：§7.112 讨论的是 `response.text()` 在 1MB resource limit 之前全量缓冲造成的内存上限失效；本条讨论的是**成功解析后的模型数量与持久化业务上限不一致**，即使响应很小、网络完全正常也可稳定复现。

**建议修复**：

- 把 `MAX_PROVIDER_MODELS = 100` 提升为共享协议/领域常量，Frontend 与 Backend 使用同一约束；
- 新 Provider 的“导入全部”最多允许 100 个；已有 Provider 按 `100 - provider.models.length` 计算剩余槽位；
- 若 discovery 超过剩余容量，UI 必须明确显示“发现 N 个 / 可添加 M 个”，并要求筛选/选择，而不是发送注定失败的 payload；
- regression：endpoint 返回 101 和 1,000 个模型时，前端不得提交 >100；已有 90 + 新 11 时不得提交 101；恰好 100 必须可成功通过 Backend validation。

---

---

### 7.139 Runner coding projection 的 count/relevance 截断没有可靠暴露 `truncated`，Repo Map 还会在相关性排序前提前停止扫描（P2 · 🟠 开放 2026-09-24）

继续逐文件审 `packages/agent-runner` 的 Workspace coding projection 时，确认 `workspace_repo_map` 与 `workspace_code_intel` 共用一个“结果有界，但完整性标志不可信”的契约缺口。它不改变 canonical Workspace 文件本身，但会让 Agent 把不完整的导航证据当成完整结果。

**Repo Map 有两个独立触发面：**

1. `repoMap()` 先按 `logical.localeCompare()` 的路径字典序遍历 index；每个文件收 symbols 后递减全局 `symbolBudget`。一旦 `symbolBudget <= 0 && candidates.length >= maxFiles` 就直接 `break`；
2. **相关性排序发生在这个 break 之后**。因此当前面已有 `maxFiles` 个普通文件并耗尽 symbol budget 时，路径排序更靠后的精确 query match 根本不会进入 candidates；
3. 返回的 `truncated` 却只看 `entry.scanTruncated || candidates.length > maxFiles || bounded.truncated`。如果恰好在 `candidates.length === maxFiles` 时 break，后面还有未扫描文件，`candidates.length > maxFiles` 仍为 false；
4. 即使只看单个文件，`collectSymbols(..., symbolBudget)` 因 maxSymbols 停止后也没有把“symbol 列表被预算裁掉”传播到 repo-map 的 `truncated`。

这使 `workspace_repo_map(query=...)` 可能同时满足“没有扫描后面的更相关文件”与“`truncated=false`”。Backend host tool 又把这个布尔值直接作为 `ToolResult.truncated` 返回给模型。

**Code Intel 同类但更机械：**

- symbols：`collectSymbols(..., maxResults)` 已先裁；
- diagnostics：先 `diagnostics.slice(0, maxResults)`；
- definition：结果先 `.slice(0, maxResults)`；
- references：循环在 `references.length >= maxResults` 时停止；
- 最后统一写成 `truncated: bounded.truncated || results.length > request.maxResults`。

由于 `results` 在进入最后判断前已经不可能超过 `maxResults`，**纯 count limit 截断时 `results.length > maxResults` 基本天然为 false**。例如实际 101 条 references、请求 `maxResults=100`，返回恰好 100 条且 output-byte budget 未触发时会报告 `truncated=false`。

这与 §7.131/§7.133 不重复：那两条是 Runner producer 与 Backend decoder / HTTP body 的**上限契约不一致导致整个合法响应被拒绝**；本条是响应成功返回，但 completeness metadata 错误，且 repo-map 的提前 break 还能改变相关性选择本身。

`doc/AGENT.md` 明确把 Repo Map / Code Intelligence 定义为 bounded navigation projection，并要求 mutation 前再做 canonical read；因此这里不把它定成 canonical 数据损坏，但它会直接误导模型的代码定位、诊断与“是否还需要继续查找”的决策。

**建议修复**：

- Repo Map 遍历时不要因为 `maxFiles`/symbol budget 在相关性排序前停止发现候选；至少先完成轻量 relevance scan，再对 top-K 做 symbols；
- 所有 count budget 使用“多取 1 条”或显式 `hasMore`，只要因为 `maxFiles/maxSymbols/maxResults` 停止就置 `truncated=true`；
- `collectSymbols` 返回 `{symbols,truncated}`，不要只返回裁后的数组；
- Code Intel 的 diagnostics/definition/references 同样按 `limit+1` 探测，而不是裁完再比较长度；
- regression：精确匹配文件排在第 `maxFiles+1` 个、101 references→maxResults 100、单文件 symbols > maxSymbols 三种场景都必须保留高相关结果并正确报告 truncation。

---

### 7.140 MCP HTTP/SSE response 没有 pre-decode 字节上限，10MB `MCP_OUTPUT_TOO_LARGE` 只能限制解码后的业务结果（P2 · 🟠 开放 2026-09-24）

继续审 Backend 外部 integration transport 后，确认 MCP 虽声明 `MAX_OUTPUT_BYTES = 10MB`，但这个限制并没有约束实际网络读取/JSON 解析阶段。

当前链路：

- `SafeMcpFetch` 为每个请求创建独立 undici `Agent`，固定单连接并做 DNS pinning、禁止 redirect，但 **没有配置 `maxResponseSize`**；
- MCP SDK 的 Streamable HTTP transport 在 `application/json` 响应上直接执行 `await response.json()`，整个 response body 会先被 undici/Fetch 读入并 JSON decode；
- SSE 路径使用 `TextDecoderStream → EventSourceParserStream`，得到完整 `event.data` 后才 `JSON.parse(event.data)`，同样没有 Nexus-owned per-event byte ceiling；
- 直到 `McpAdapter` 拿到已经构造好的 JS object 后，`jsonValue()` 才再次 `JSON.stringify(value)` 并用 `Buffer.byteLength(...) > 10MB` 抛 `MCP_OUTPUT_TOO_LARGE`。

因此这个 10MB 常量只限制“最终允许进入 Nexus JsonValue 的序列化尺寸”，不能阻止一个已配置但异常/恶意的 MCP endpoint 先发送远大于 10MB 的 JSON body 或单个 SSE event。请求有 60s timeout，但高吞吐连接仍可以在超时前制造远高于业务上限的 Backend heap / parser 内存峰值。

列表接口还有同一顺序问题：`listTools/listResources/listPrompts` 的数量限制（256 / 2048 / 512）也都是 SDK 已完整解码结果后才检查，不能作为 wire resource bound。

这与 §7.112 不重复：§7.112 是 OpenAI-compatible Provider `/models` 自己声明的 1MB limit 在 `response.text()` 后才检查；本条是独立的 MCP Streamable HTTP/SSE transport，且底层 SDK 同时存在 JSON body 与 SSE event 两种无 pre-decode 上限路径。

**建议修复**：

- 在 `SafeMcpFetch` 的 undici dispatcher 配置 transport-level `maxResponseSize`，并给协议握手/错误响应与普通 RPC 选择明确上限；
- 对 SSE 再增加**单 event**与累计 pending bytes 上限，不能只依赖 HTTP response 总量（长寿命 SSE 本身可以持续）；
- 若 SDK 暂不暴露 event ceiling，包装/替换其 stream parser，在 JSON parse 前按 UTF-8 bytes fail closed；
- 保留 `jsonValue()` 作为第二层业务投影限制，但不要把它当 wire memory bound；
- regression：无 Content-Length 的 >10MB JSON response、单个 >10MB SSE event 都必须在完整 body/event 被 materialize 前中止；合法小流继续正常工作。

---

### 7.141 Provider version 推进后 Subagent Profile 的旧模型 ref 在 UI 中消失，正常重选还会保留隐藏 stale ref，导致 Profile 无法保存/运行（P1 · 🟠 开放 2026-09-24）

继续逐页复核 Subagent 设置与 Backend policy 契约后，确认 Profile 的 `ModelRef.configurationVersion` 冻结语义在 Provider 版本变化后缺少可见的 rebind / migration 路径，并且当前 UI 的精确 key 逻辑会把旧引用隐藏起来。

**Frontend 当前行为：**

- `modelOptions` 只由**当前 enabled Provider**生成，key 是 `providerId\0modelId\0provider.version`，ref 也写当前 `configurationVersion=provider.version`；
- 已保存 Profile 的 `defaultModel / allowedModels` 原样带旧版本；`modelKey()` 同样把 `configurationVersion` 纳入 identity；
- default select 与 allowed checkbox 都按完整 key 精确匹配。Provider 从 v1 变 v2 后，旧 `P/model@v1` 在 UI 中不再命中任何 option：默认选择看起来为空/失配，allowed checkbox 也全部显示未选；
- 用户再勾同一个 `P/model` 时，`toggleAllowedModel()` 只判断“当前 v2 key 是否存在”，于是会**追加** `P/model@v2`，不会删除隐藏的 `P/model@v1`；
- `setDefaultModel()` 也只会把 default 改成 v2，并在 allowed 中追加 v2；同样没有清理 v1；
- `saveProfiles()` 最终把整个 `allowedModels` 数组送回 Backend，所以用户通过正常控件重选后，payload 仍同时含隐藏的旧 v1 ref。

**Backend 是严格 fail-closed：**

- `SubagentPolicyService.replaceProfiles()` 对每一个 `profile.allowedModels` 调 `assertModel()`；
- `assertModel()` 明确要求 Provider enabled 且 `provider.version === model.configurationVersion`，否则抛 `SUBAGENT_MODEL_UNAVAILABLE`；
- 新 delegation 的 `SubagentService.create()` 也要求同一版本一致，已有 delegation 的 model-step executor 同样按冻结版本检查；
- Provider repository 普通 update 会 `version = version + 1`，因此不仅换模型，display name / endpoint / enabled 等正常 Provider 更新也会推进版本。

所以最小复现是：保存一个 Profile，allowed/default 为 `P/m@v1` → 对 Provider P 做一次正常 update 得到 v2 → 打开 Subagent 设置。旧模型在 UI 中不显示为已选；重新选择当前 `P/m@v2` 后保存，隐藏的 `P/m@v1` 仍在 `allowedModels`，Backend 继续拒绝。用户没有普通的单项入口删除这个 stale ref，只能删掉/重建整个 Profile 或依赖未来专门迁移逻辑。

这里不把 Backend 的版本冻结本身判为错误：`configurationVersion` 作为 fail-closed model binding 是合理安全机制。问题是**持久 Profile 也使用这个冻结引用，却没有“stale 可见 + 显式 rebind”的生命周期**，并且 UI 正常重选会制造“新旧版本并存、旧项不可见”的不可修复草稿。

这与 §7.53 不重复：§7.53 是快速切 App 的旧响应把 A 的 Profile draft/version 写到 B；本条单 App、无并发请求即可由 Provider version 正常推进稳定触发。

**建议修复**：

- load Profile 时按 `providerId + modelId` 识别 stale generation，明确显示“Provider 配置已更新，需要重新绑定”，不要让旧 ref 静默消失；
- rebind 必须是显式动作：若版本冻结有安全含义，不应静默迁移；用户确认后原子地把 default 与 allowed 中同一 `providerId+modelId` 的旧版本替换成当前版本；
- `toggleAllowedModel/setDefaultModel` 在加入当前版本前，应去重/替换同一 provider+model 的其它 configurationVersion，避免隐藏 stale ref 残留；
- Save 前对 stale refs 做本地 preflight，并给可操作的 rebind UI，而不是只显示 Backend 机器错误；
- regression：保存 v1 profile → Provider update 到 v2 → UI 必须显示 stale；执行 rebind 后 payload 只剩 v2；保存通过且后续 delegation 可创建。

### 7.142 Settings `?tab=` deep-link 只在 mount 时读取，与 route-name KeepAlive 缓存脱节（P2 · 🟠 开放 2026-09-24）

`a6371f9` 为新的 Settings 导航增加了 `/settings?tab=<section>` 深链入口，但当前实现只在组件首次 mount 时消费 query；同一页面又被全局按 route name 做 KeepAlive，因此 URL 与实际选中分区会稳定失同步。

**当前链路：**

- `SettingsPage.vue` 的 `onMounted()` 读取一次 `route.query.tab`，合法时才写 `active.value`；没有 watch `route.query.tab`，也没有 `onActivated` 重新同步；
- `selectTab()` 只修改本地 `active` / `mobileView`，不会 `router.replace()` 更新 query；
- Router 把 `/settings` 标记为 `meta.keepAlive=true`；
- `App.vue` 的缓存实例 key 固定为 `String(route.name)`，即 `Settings`。query 从 `?tab=agent` 变为其它值，或离开后再返回同一个 URL，都不会因为 query 变化创建新 Settings 实例。

因此可以稳定复现两种失配：

1. 首次打开 `/settings?tab=agent`，页面正确进入 Agent；随后在页面内切到 Workspace。URL 仍保留 `?tab=agent`，当前内容却已经是 Workspace；
2. 此时离开 Settings，再导航回 `/settings?tab=agent`。KeepAlive 恢复原实例，`onMounted` 不会再执行，页面仍停在 Workspace；同理，在 Settings 已激活时只改变 `route.query.tab` 也不会更新 `active`。

结果是新增的 deep-link 语义对浏览器返回/前进、重复导航、复制当前 URL 与未来任何 `router.push({ name: 'Settings', query: { tab: ... } })` caller 都不可靠；地址栏声明的 section 与用户实际看到的 section 可以长期不一致。

这不是普通“记住上次 tab”的产品偏好：代码已经把 `tab` 暴露为路由状态并在首次加载时赋予导航语义，KeepAlive 后却不再遵守同一个路由状态，属于同一公开状态源内部不一致。

**建议修复**：

- 用 `watch(() => route.query.tab, ... , { immediate: true })`（或等价 route update hook）统一处理首次进入与后续 query 变化；
- 若产品希望 URL 始终表示当前 section，`selectTab()` 同步 `router.replace({ query: { ...route.query, tab } })`，并做好双向同步防循环；
- KeepAlive 的 `onActivated` 至少要再次 reconcile 当前 route 与本地 active，不能只依赖 mount；
- regression：首次 `?tab=agent`、同页 query agent→security、切本地 tab 后 URL、一度离开再返回相同 `?tab=agent`、浏览器 back/forward 五条路径都应保证 URL 与 active section 一致。

---

### 7.143 Agent Settings 取消 visitedGroups lazy mount 后，未访问的隐藏分组也会立即发起网络请求并弹全局错误（P2 · 🟠 开放 2026-09-24）

`a6371f9` 把 Agent Settings 从旧的三组卡片重排为四个 `v-show` 分组时，保留了 `visitedGroups` 状态，却删除了模板里所有 `v-if="visitedGroups.has(...)"`。结果不是“访问过的分组继续保活”，而是父级首次拿到 settings 后，**四个分组的全部子组件都会立即 mount**，即使用户一直停在默认的“模型与预算”。

**提交前后差异：**

- `862a458` 中 runtime / plugins 等分组都有 `v-if="visitedGroups.has(...)" + v-show`，只有首次进入该分组后才挂载；
- `a6371f9` 后模板只剩 `v-show="activeGroup === ..."`；`visitedGroups` 仍在 `selectGroup()` 里维护，但已经没有 template consumer；
- 因此隐藏的 Tools / Runtime / Safety 子树与 Models 同时创建，所有子组件 `onMounted` 副作用都会执行。

这会产生真实的隐藏 I/O，而不只是额外渲染：

- `PluginManagementSettings` mount 后直接 `refresh()`，并继续请求 official catalog + **每一个配置的 remote repository**；任何 catalog 失败都会通过 `operationFeedback.notifyError({ operation: 'load-catalogs', ... })` 发全局错误；
- `McpIntegrationSettings` mount 后请求 MCP integrations，失败同样发全局错误；
- `WorkspaceRuntimeSettings` mount 后并发请求 runtime catalog + storage，失败发全局错误；
- `AcpRuntimeSettings` mount 后请求 ACP integrations；
- `SafetyNetworkSettings` mount 时如果共享 connection store 为空，会主动 `connectionsStore.load()`。

最小复现：给 Plugin Settings 配一个当前不可达的 remote repository → 新开 Settings > Agent，**不要离开默认 Models 分组** → 隐藏的 PluginManagementSettings 仍会请求该仓库，并可能在模型页上弹出插件仓库加载错误。MCP / Workspace 等请求也会在未访问相应分组时提前发生。

这与 §7.54 不重复：§7.54 讨论“**已经挂载**的隐藏卡片”在全局 revision 变化后覆盖未保存草稿；本条是 `a6371f9` 新取消 lazy mount 后，“**从未访问过**的分组”也被强制挂载并产生网络/错误副作用。

**建议修复**：

- 恢复 `v-if="visitedGroups.has(group)" + v-show` 的“首次访问才 mount、之后保活”语义，按新的 models/tools/runtime/safety 四组实现；
- 或把每组包成独立 lazy component，确保未访问组不会创建其请求型子组件；
- regression：首次进入 Agent/Models 时断言 Plugin/MCP/ACP/Workspace/Connections loader 为 0 次；首次进入对应分组时各自只触发一次；离开再返回仍保留该组状态且不重复初始化；
- 额外验证隐藏 remote catalog 失败不会在用户未进入 Tools/Plugins 时产生全局错误提示。

---

### 7.144 `a6371f9` 删除 Agent panel 的 DOM id，Settings tab 的 `aria-controls` 现在指向不存在的目标（P2 · 🟠 开放 2026-09-24）

Settings 页的两套导航都会给 Agent tab 输出 `aria-controls="settings-panel-agent"`：mobile pills 与 desktop rail 都使用 `:aria-controls="`settings-panel-${item.value}`"`。其它 Settings panel 由父页显式提供对应 id，但 Agent 依赖 `AgentSettingsPanel` 自己的根 id。

`862a458 → a6371f9` 的 committed diff 明确把：

`<section id="settings-panel-agent" ...>`

改成了：

`<div class="space-y-4">`

而 `SettingsPage.vue` 当前只渲染 `<AgentSettingsPanel v-if="visited.has('agent')" v-show="active === 'agent'" />`，没有把 id 传给子组件。当前 `packages/frontend/src` 搜索也没有任何静态 `settings-panel-agent` target。

因此 Agent tab 暴露了一个不可解析的 accessibility relationship：辅助技术看到“此 tab 控制 settings-panel-agent”，DOM 里却没有该 panel。这个缺口是 `a6371f9` Settings 重构直接引入的，与纯视觉布局无关。

**建议修复**：给 Agent panel 恢复稳定的 `id="settings-panel-agent"`（最好同时补标准 `role="tabpanel"` / `aria-labelledby`），或由 SettingsPage 用统一 wrapper 持有所有 panel id；加 DOM regression，遍历每个 `[role=tab][aria-controls]` 并断言目标 id 唯一存在。

---

### 7.145 Settings 页面把导航声明为 ARIA tabs，却没有 tab widget 的键盘/焦点模型（P2 · 🟠 开放 2026-09-24）

继续从 a11y 反向扫描后确认，这是一个**历史遗留而非 `a6371f9` 首次引入**的问题：`413f2e99` 已经给旧 Settings 导航加了 `role="tablist"/"tab"`，而该提交早于本轮 66-commit 审计起点 `b0d7b220`。所以本条补的是此前矩阵范围之外的当前缺口，不把责任错误归给后续增量提交。

当前 `SettingsPage.vue` 又把同一模式复制成两套响应式导航：

- mobile 横向 pills：`role="tablist"` + 每个 button `role="tab"`；
- desktop 纵向 rail：同样 `role="tablist"` + `role="tab"`，但没有声明 vertical orientation；
- 全文件没有 tab 导航所需的方向键处理，也没有 roving `tabindex`；所有原生 button 默认都进入顺序 Tab 链；
- panel 容器没有统一的 `role="tabpanel"` / `aria-labelledby` 关系。

实际键盘行为因此仍是“按 Tab 逐个经过 8 个 tab button，方向键不切换”，与代码声明的 composite tab widget 语义不一致；desktop rail 视觉上是纵向导航，但 tablist 默认方向语义也未同步。

**建议修复**二选一：

1. 如果它真的是 tab widget：只让 active tab `tabindex=0`、其余 `-1`，实现对应方向键 + Home/End，desktop 标 `aria-orientation="vertical"`，并给 panel 补 `role="tabpanel"` / `aria-labelledby`；
2. 如果产品只需要普通 Settings 导航：移除 tablist/tab 角色，使用 `nav` + button/link 的原生键盘语义，不伪装成复合 tab 控件。

regression 至少覆盖 mobile/desktop 两种布局：Tab 只进入一次 composite、方向键可移动 active/focus（若保留 tab pattern），每个 `aria-controls` 都有真实 panel target。

---

### 7.146 `a6371f9` 用无运行语义的假 i18n 引用绕过 §7.40 dead-key 可达性门禁（P2 · 🟠 开放 2026-09-24）

继续逐文件复核 `a6371f9` 时，发现这次 Settings 分组从旧的 `plugins` 重构为 `tools / safety` 后，没有真正删除旧翻译 key，而是新增了一条没有任何运行 consumer 的源码字面量：

```ts
const _legacyPluginGroupKey = 'agent.settings.groups.plugins';
```

当前 committed HEAD 的事实闭环是：

- `groups` 真正渲染的分组 key 已经是 `agent.settings.groups.models / extensions / runtime / safety`，不再使用 `groups.plugins`；
- 全 `packages/frontend/src` 搜索 `agent.settings.groups.plugins` 只有上面这一条 `_legacyPluginGroupKey`，变量自身也没有任何 consumer；
- en-US / ja-JP / zh-CN 三份字典仍各保留 `agent.settings.groups.plugins`；
- §7.40 新增的 `check-agent-i18n.mjs` 会扫描所有源码中的 `['"`](agent\.[A-Za-z0-9_.-]+)['"`]` 字面量并放进 `referencedLiterals`，随后只要 `referencedLiterals.has(key)` 就认为该 key reachable；
- 因此这个无运行语义的常量恰好会让真正已经死亡的 locale key 通过“不可达 key”门禁。

这不是普通“多留了一个翻译”的清理问题，而是**门禁被伪引用规避**：§7.40 的目的就是让死 key 不再靠人工记忆存活；如果任何重构都能塞一个未使用字符串常量让检查通过，门禁就无法证明“key 有真实 caller”。当前 §7.52 里原先“committed HEAD 仍有真实导航引用”的判断也因此已经失效——当前 HEAD 只有这个 dummy literal。

**建议修复**：

- 删除 `_legacyPluginGroupKey` 与三语 `agent.settings.groups.plugins` 死 key；
- 强化可达性扫描：不要把任意源码字符串都当 caller，优先识别 `t/$t/translateOrRaw` 等真实翻译调用、模板绑定或显式受控的动态 prefix；
- 至少在 lint 里区分“定义但未被代码消费的普通常量字符串”与真正 i18n lookup；若必须保留动态 key，用集中、可审计的 allowlist / prefix 声明，不要靠 dummy variable；
- regression：加入一个只存在于未使用 const 的 `agent.*` key，检查必须失败；真实 `$t('agent.*')`、受控动态 prefix 仍必须通过。

---

### 7.147 `97560f1` 把 MCP Unix-seconds 时间戳当毫秒传给 Date，最近刷新时间会显示到 1970 年（P2 · 🟠 开放 2026-09-24）

`McpIntegrationSettings.vue` 在 `97560f1` 中重写状态卡片时，把原来的：

```ts
new Date(value * 1000);
```

改成了：

```ts
new Date(timestamp);
```

但 Integration 时间字段的协议单位没有改变：Backend 仍以 `clock.nowUnixSeconds()` 写 `lastAttemptAt / lastSuccessAt`，同一 Agent 前端其它 Unix 时间字段也继续使用 `* 1000` 后再构造 `Date`。

因此典型的当前 epoch（约 17 亿）会被浏览器解释成“17 亿毫秒自 1970-01-01 起”，MCP 卡片的“最近成功/最近尝试”会稳定落在 **1970 年 1 月附近**，而不是当前时间。无效日期 guard 无法发现这一点，因为该数值仍是合法毫秒时间戳。

这与 §7.71 的 locale/format 展示问题不同：这里是时间单位错误，任何 locale 都会显示错误时刻。

**建议修复**：

- 明确 protocol DTO 的 epoch 单位，并恢复 `new Date(timestamp * 1000)`；更稳妥地使用共享 `fromUnixSeconds()/formatUnixSeconds()`；
- 对 Integration / Run / Plugin 等 epoch 字段统一禁止直接 `new Date(number)`；
- regression 固定输入一个已知 Unix-seconds 值，断言显示年份/小时与预期一致，并覆盖 `null`。

---

### 7.148 `97560f1` 多个 Settings 子组件把父级 async mutation 当成同步成功，失败时仍 toast“已保存”并保留未提交本地状态（P2 · 🟠 开放 2026-09-24）

本次设置卡片重构新增了多条“子组件先改本地状态 → `emit(...)` → 立即成功提示/关弹窗”的路径，但 Vue emit 不会 await 父级 listener 的 Promise。

已确认三组路径：

- **Browser Runtime**：新增/删除 Target、添加/删除 Endpoint 都先写 `targets.value`，随后 `emit('save', ...)`，紧接着 `notifySuccess(targetCreated/targetDeleted/endpointAdded/endpointDeleted)`；新增 modal 还会立即关闭；
- **ACP Profile**：新增/删除 Profile 先改 `profiles.value`，`emit('saveProfiles', ...)` 后立即成功提示，新增 modal 立即关闭；
- **Model fallback**：`addFallbackModel()` 发出 `fallbackModels` 后又新增了一次 `saveNoticeFallback` success toast，而父级 `setFallbackModels()` 自己也异步 `patchSection()` 并在真正成功后提示。

父级 Browser/ACP/Model 最终都进入 `AgentSettingsPanel.patchSection()`。该方法通过 `execute()` 调 Backend；validation、network、revision conflict 等任一失败都会在父级报错并返回，但**不会让子组件刚才的 emit 变成 rejected Promise**。

稳定后果：

1. Backend 拒绝 Browser/ACP 保存时，用户先看到“added/deleted and saved”，modal 已关闭，本地列表也已变化；
2. authoritative settings revision 没推进，watcher 不会因为失败自动 rollback，本地与 Backend 可长期分叉；
3. 成功路径又可能出现“子组件 success + 父级 patch success”的重复成功提示；
4. Model fallback 至少会在真实 patch 完成前提前宣告成功，失败时形成 success/error 相互矛盾的反馈。

这与 §7.82 不重复：§7.82 是 stale revision/conflict 后整个 Settings 不 reconcile；本条对**任意 mutation failure**都成立，根因是子组件把 fire-and-forget emit 当成了可确认的 commit boundary。

**建议修复**：

- 需要确认持久化结果的子组件不要用普通 emit 表达 async command；传入 `() => Promise<Result>` callback，或让父级完全拥有 optimistic state/toast/modal close；
- 若保留 optimistic UI，失败必须 rollback 到 props authoritative snapshot；
- success toast 只由真正 await Backend commit 的唯一一层发出；
- regression：Browser add/delete、ACP profile add/delete、fallback add 分别注入 400/409/network failure，断言无 success toast、modal/本地状态可恢复；成功时只出现一次 success。

---

### 7.149 `97560f1` 设置卡片重构删除既有 Browser / ACP Profile / MCP 配置的编辑入口（P1 · 🟠 开放 2026-09-24）

`97560f1` 不只是换布局，它把三类原本可修改的持久配置改成了只读展示，现有用户配置失去正常 update 路径。

**Browser Runtime：**

- 旧版既有 Target 可编辑 `id`、`allowedUrlPatterns`；
- 旧版既有 Endpoint 可编辑 `url / scope / via / priority / allowPlaintext / verifyTls`；
- 当前卡片只展示这些值，操作只剩“添加 Endpoint / 删除 Endpoint / 删除 Target”；模板里已没有任何 `v-model="target.*"` 或既有 Endpoint 编辑控件。

**ACP Profile：**

- 旧版既有 Profile 卡片有 `profile.id / argvText / cwd` 三个编辑字段和 Save；
- 当前 Profile 卡片只读显示 id/cwd/argv，只剩删除；新增 modal 只创建新 Profile，没有 edit modal/action。

**MCP Integration：**

- 旧版有 `changeEndpoint()` 与 `toggleTrustAnnotations()`，现有 Integration 可以直接更新 endpoint / trustToolAnnotations；
- 当前两个 update handler 已删除。已有 Integration 的 endpoint 只剩“复制链接”，trust 只剩 badge；仍能改 enabled/credential，但不能改 endpoint/trust。

“删掉再重建”不是等价编辑：ACP Integration 持有 `profileId` 引用，删除 Profile 会制造引用缺口；Browser/MCP 删除也会丢失原对象 identity/version/credential 等上下文，并把普通配置调整升级成 destructive workflow。

这是明确的功能回归，而不是 UI 密度偏好：同一 committed diff 删除了原本存在的 update controls / handlers。

**建议修复**：

- 为 Browser Target/Endpoint、ACP Profile、MCP Integration 恢复 Edit action/modal，复用现有 typed update API；
- edit modal 必须以当前 authoritative object/version 初始化，成功后 reload/reconcile，失败不丢草稿；
- Browser 至少覆盖 patterns 与完整 endpoint 字段；ACP Profile 覆盖 id/argv/cwd 并处理被 Integration 引用时的 rename/rebind；MCP 覆盖 endpoint/trust；
- regression 从已有 persisted config 出发，逐字段修改并 reload，证明值真正持久化；同时保证 delete/recreate 不是唯一修改路径。

---

### 7.150 Plugin 仓库分组只按 URL path“owner”聚合，可把不同 host/source 合成同一个“官方仓库”头部（P2 · 🟠 开放 2026-09-24）

`97560f1` 新增 Plugin catalog 分组时，`extractGithubUser(repositoryUrl)` 只提取 pathname 第一段作为 `owner`；`groupMap` 也只以这个 owner 字符串为 key，没有 host / repository URL / catalog identity。

因此下列不同来源会被合并到同一个组：

- `https://github.com/acme/catalog.json`
- `https://gitlab.com/acme/catalog.json`
- `https://plugins.example.com/acme/catalog.json`

组合后的 UI 还会进一步错配 provenance：

- 只要组内**任意** source 是 official，就执行 `group.official = true`，整个组头显示“官方仓库”；
- 组头复制按钮/URL 固定使用 `group.catalogs[0].catalog.repositoryUrl`，不一定是让该组变成 official 的那条来源；
- 包级 install/trust 操作仍携带各自真实 `catalog + official`，所以当前没有发现 publisher trust 的权限绕过；问题在于用户看到的仓库来源与官方身份可以与实际 package 来源不一致。

最小复现：同时配置一个与官方 catalog pathname owner 相同、但 host 不同的 remote catalog。两者会合并；若 remote 排在第一条，组头可以同时出现“官方仓库”徽章和 remote URL，组内第三方 package 也被视觉归到官方来源下。

在插件供应链 UI 中，provenance/official 标识属于安全决策信息，不能用可能碰撞的 display owner 代替 source identity。

**建议修复**：

- group key 至少使用 canonical `hostname + owner`，更稳妥直接用 repository/source id；owner 只作为展示字段；
- official badge 必须绑定具体 catalog/source，不能用组内 OR 后覆盖整个混合组；
- 多 catalog 真要合并时，每个 package/子组都展示真实来源；
- regression 覆盖 GitHub/GitLab/自定义域同名 owner，以及“remote first + official later”顺序，断言来源 URL / official badge 不交叉污染。

---

### 7.151 `97560f1` ACP 新增 Profile 的“shell command string”正则 tokenizer 会静默改写 argv 语义（P2 · 🟠 开放 2026-09-24）

`97560f1` 把 ACP Profile 新增流程从直接编辑 JSON `argv` 改成“启动命令与参数”输入框；三语提示允许 command string，英文明确写 **“Supports shell command string”**。但 `parseCommandToArgv()` 只用 `/[^\s"']+|"([^"]*)"|'([^']*)'/g` 切 token，不实现 shell 的反斜杠 escaping，也不会把相邻 quoted/unquoted segment 合并成同一个 word。

用当前实现做纯函数探针已稳定复现：

- `acp-agent --name foo\\ bar` → `["acp-agent","--name","foo\\","bar"]`，而 shell word 应是单一参数 `foo bar`；
- `acp-agent --name foo" bar"baz` → `["acp-agent","--name","foo"," bar","baz"]`，而 shell word 应合并成 `foo barbaz`；
- 带转义引号的 `"a\\\"b"` 也会被拆坏。

这些结果仍满足当前 `isArgvValid` 的 1–64 token 检查，随后会被 `JSON.stringify(argv)` 持久化，并由 Runner 按错误 argv 启动 ACP 进程，所以不是单纯 placeholder 文案问题。旧版要求直接输入 JSON argv，没有这层有损 command-string 转换，因此该回归由 `97560f1` 新增。

**建议修复**：

- 最稳妥是保留 JSON argv 为 canonical，并把普通输入明确限定为“简单空白分隔”；遇到引号/反斜杠复杂语法时要求 JSON；
- 若继续承诺 shell command string，则使用经过测试的 shell-word parser，只做 argv parsing，**不要**改成真正执行 shell，以免扩大命令注入面；
- regression 覆盖 escaped space、单双引号、quoted/unquoted 拼接、escaped quote、空参数 `""` 与 JSON argv，断言最终持久化数组准确。

---

### 7.152 `a6371f9` 移动端 Settings 总览头部误用 Agent 专属描述，整页目录被说明成 AI 设置（P2 · 🟠 开放 2026-09-24）

`a6371f9` 新增移动端 Settings catalog 后，目录页头部写成：

```vue
<h1>{{ t('settings.title') }}</h1>
<p>{{ t('settings.descriptions.agent') }}</p>
```

但这个页面下面列的是 Workspace、System、Appearance、Agent、Security、IP Control、Data、About 等**全部 Settings 分组**。同一 Settings 三语字典已经提供专门的 `settings.mobile.settingsOverview`（en: `Settings Overview`、zh: `设置中心`、ja: `設定センター`），当前 committed HEAD `97560f1` 却没有在 `SettingsPage.vue` 使用该 key。

因此窄屏打开“所有设置”目录时，页面标题虽然是 Settings，副标题却把整个目录解释为 Agent/AI 配置范围；其它七个设置类别与 header 说明直接冲突。

这不是文案偏好：通用 overview key 已经存在，组件却稳定接到了具体 tab 的 description key。

**建议修复**：

- mobile catalog header 改用 `t('settings.mobile.settingsOverview')`，`settings.descriptions.agent` 只保留在 Agent item 自身；
- regression 在 mobile menu 模式断言 header subtitle 使用 overview key，同时每个 item 仍使用自己的 `descriptionKey`；
- 增加 Settings mobile catalog 的三语 snapshot/semantic regression，避免“key 存在但 caller 接错 key”。

---

### 7.153 `a6371f9` 每个 Provider 抽屉都显示全局 defaultModelId，非默认 Provider 会展示别家模型（P2 · 🟠 开放 2026-09-24）

`a6371f9` 给每个 Provider 的展开抽屉新增底部状态条时，直接写了：

```vue
<span>{{ $t('agent.settings.providers.defaultModel') }}:</span>
<span>{{ defaultModelId || provider.models[0]?.id }}</span>
```

这里的 `defaultModelId` 是**全局默认模型** prop，不属于当前循环中的 `provider`。表达式没有检查 `provider.id === defaultProviderId`，所以只要系统存在全局默认模型，所有 Provider 抽屉都会优先显示同一个 model id。

最小复现：

1. Provider A 有 `gpt-4o`，并设为全局默认 Provider/Model；
2. Provider B 只有 `claude-3-5-sonnet`；
3. 展开 Provider B 的配置抽屉；
4. 底部仍显示“默认模型: `gpt-4o`”，即使 B 根本没有这个模型。

多 Provider 环境下，这会把 Provider A 的状态伪装成 B 的配置事实。`provider.models[0]?.id` 只在**全局没有任何 defaultModelId** 时才会生效，不能修正非默认 Provider。

这与 §7.136 不重复：§7.136 是 `af54360` 的 optimistic default selection 丢 Provider identity，影响默认项解析/切换/fallback 过滤；本条是 `a6371f9` 新增的 Provider drawer status footer 无条件消费全局 model id，即使不做 mutation 也会稳定显示错误数据。

**建议修复**：

- 只有 `provider.id === defaultProviderId` 时展示“默认模型”，并用完整 `providerId + modelId` identity；
- 非默认 Provider 若需要 footer，展示真实局部事实，不要把 `provider.models[0]` 冒充“默认模型”；
- 全局 default pair 指向当前 Provider 但 model 已不存在时显示 stale/missing 状态；
- regression 覆盖两个 Provider 各自不同模型、同名模型、无全局默认模型三种情况。

---

## 附录 A：核查方法与证据

- **构建产物核对**（§1.1）：`packages/frontend/dist/assets/index-*.css` 中 `bg-header` 58 次、`bg-background` 27 次、`border-border` 32 次，而 `bg-card` / `border-hover` / `primary-hover` 为 **0** 次；`src/app/styles/tokens.css` 的 `@theme inline` 未定义 `--color-card`。
- **源码计数**：`grep -roF 'text-[9px]' ...`、`grep -roF 'bg-card' ...` 等（字号 563 处 ≤11px；`bg-card` 164 处，其中 agent 158 处）。
- **i18n 校验脚本**：展开三份 locale 得到 1,148 个叶子 key；从 `features/agent/**/*.{vue,ts}` 提取 `$t('agent.*')` 静态引用 811 个；差集仅 `agent.ui.saveFailed` 缺失；反向差集 274 个未使用。
- **事件名统计**：`grep -rho "type: '[a-z_.]*'" modules/agent infrastructure/agent | sort -u` ⇒ 75 个（含无关 JSON schema 类型），涉及 55 个文件。
- **依赖方向**：`grep -rn "modules/agent" --include=*.ts src` 确认无其他 backend module 越权 import；前端 `grep -rn "@/features/agent" src` 只有 `app/App.vue` 与 `SettingsPage.vue`。
- **设置区扫描**（§6）：脚本提取 `features/agent/**/*.vue` 的 `<template>` 段落，统计含 CJK 的非注释行（settings 目录 38 行 / 9 个文件，`ai/ConversationMessage.vue` 另有 4 行）；`grep` 统计 settings 目录按钮 class 与 `rounded*` 分布（152/55/123/80/15）；`<select>` 22 处、`type="checkbox"` 27 处、`type="number"` 7 处。
- **类名有效性全量比对**（§7.1、§7.8）：用脚本抽取 `features/agent/**/*.vue` 中 `class= / :class=` 里的 token（去掉 `hover:`/`md:` 等变体前缀），逐个在 `dist/assets/index-*.css` 里查找转义后的选择器。确认**真正无规则的只有** `bg-card` 全族、`border-border-hover`、`bg-primary-hover`、`text-warning-foreground`、`from-card/to-card/via-card`，以及非 0.25 倍数的间距类（`py-0.2 / py-0.8 / py-1.8`，共 36 处；同文件的 `py-0.5 / py-1.5 / py-2.5` 均正常生成，可排除构建陈旧）。
- **构建产物新鲜度**：`find src -newer dist/assets/index-*.css` 结果为空，说明 dist 是最后一次改动的产物，可用作有效证据；`doc/imgs/e2e/agent-*.png` 生成于 2026-09-17，可能早于最近改动，仅作观感对照。
- **截图核对**（§7.7）：用 `ffmpeg` 裁剪/放大 `doc/imgs/e2e/agent-*.png` 局部，并对关键坐标做像素采样（例如 `(600,215) = #faf7fd`：浅紫 = 消息气泡/环境光晕，而非背后的深色页面透过来），用于区分"真透明"与"缺失填充"。

**第二轮新增：真机实测（2026-09-21）**

- **环境**：后端 `packages/backend` → `tsx src/index.ts`（`NODE_ENV=development`、`:3001`、使用真实数据目录）；前端 `packages/frontend` → vite `--port 9998`；反向代理 `https://api.honus.top` → 本地 9998；账号 `honus / honustest`。
- **浏览器**：AgentDock 里已登录的 Chrome，通过 **CDP**（`chromium.connectOverCDP('http://172.30.31.11:9223')`）接管**已有窗口**，用 `browser.contexts()[0]` + 复用同一个标签页。
  **窗口保持 1620×953、`devicePixelRatio 1` 未做任何改动**（遵循"不要改浏览器分辨率"的要求），因此所有尺寸数字都是该窗口下的真实布局值。
- **脚本**：`tests/e2e/.tmp/cdp-review/*.mjs`（纯 node ESM + `@playwright/test`；`cdp-lib.mjs` 负责复用同一标签页 + 重复登录）。截图输出目录 `/tmp/shots/`，其中关键 9 张已归档到 **`doc/imgs/review-2026-09-21/`**（含 §1.9 的"500 静默"证据）。
- **计算样式实测**（§7.10/§7.11/§7.12 的所有数字）：`page.evaluate` 里对目标元素取 `getBoundingClientRect()` + `getComputedStyle()`，逐条打印 `font-size / background-color / backdrop-filter / border / border-radius / overflow-x / scrollWidth vs clientWidth`。关键取证：
  - `.agent-toolbar-controls` → `clientWidth 617 / scrollWidth 659`，末枚 `高` 的 `getBoundingClientRect().right >` 容器 `right`（**被裁切**）；
  - 模型弹层面板 → `background-color: rgba(0,0,0,0)` + `backdrop-filter: blur(12px)` + `border-radius: 16px`（确认 §7.1 的"透明质感 = 死 token 副产物"）；
  - 设置区按钮矩阵 → `添加 Provider 144×38/16px`、`关闭 Agent 109×40/16px`、`立即更新 77×28/11px`、备用模型链 5 枚 × 40px/16px（确认 §7.10）；
  - 空态 pager → 可点元素 12×16、内部点 6×6；任务栏空态框 295×176；Hub 右下缩放手柄 16×16。
- **受控探针实验**（§7.10 的决定性证据）：在同一页面里 `document.createElement` 注入 `<button|input|select|textarea|div|span|a class="text-xs">`，逐个读计算字号 → 前四者 **16px**、后三者 **12px**；再给 button 加内联 `font-size:12px` 或 `!important` → **12px**。这一次实验把"字号失效"精确定位到 `global.css:26-33` 的那条 unlayered 选择器，而不是任意其它规则。
- **后端 500 的复现与归因**（§1.9）：① 在后端日志里按 `errorCode=AGENT_DURABLE_STATE_INVALID` 找到 8 次 `GET` 500；② 在已登录的 CDP 上下文里用 `ctx.request.get()` 逐个回放候选接口，锁定只有 `/runs/:runId/approvals` 返回 500（同 Run 的其它接口 200）；③ 用 `node:sqlite` 只读打开 `packages/backend/data/nexus-terminal.db`，对比 `agent_approvals` 与 `agent_tool_calls` 的行值，发现 `inspection_json.target.kind = "machine"`，再与 `durable-state-decoders.ts` 的白名单对照，定位到解码器拒绝旧别名。
- **浏览器自动放大的甄别**（§7.12-6）：发现侧栏某 span 声明 `text-[10.75px]` 却计算成 `13.975px` 时，用三组对照排除 CSS 原因——① 遍历所有样式表递归匹配（含 `@layer`/`@media`/`@container`）只有 `.text-[10.75px]` 一条命中；② 写内联同名值立刻回到 10.75px；③ 克隆到 `body` 下也是 10.75px ⇒ 判定为 Chrome Text Autosizing，而非产品样式缺陷。
- **i18n 实测**：`localStorage['user-locale'] = 'en-US'` → 刷新 → 遍历所有"叶子文本节点"筛 CJK（排除 `display:none/visibility:hidden/opacity:0`），Hub 主界面 0 处、**Settings > Agent 29 处**（清单见 §6.5/§7.11）。测完已把 locale 还原为 `zh-CN`。
- **第六轮（收尾复核，寻找"两遍无新问题"）**：
  - 回到 Hub 重新打开模型弹层，验证 Escape 后 `document.activeElement` 是否回到触发按钮（结果：是，且 `aria-expanded=false`）；
  - 用「可访问名」判据复查全部可交互元素：在 Hub（空态 + 有会话）与设置区面板内枚举 `button/a[href]/[role=button]`，要求 `aria-label` 或 `title` 或 `textContent` 至少一项非空 → **未命名控件 0 个**；同时筛选 `opacity:0 / visibility:hidden / pointer-events:none` 的按钮 → **0 个**；
  - 逐一核对"尺寸为 0 的按钮"：实测 3 个（`关闭会话列表`、`打开会话列表`、`删除当前会话`）全部是 `display:none` 的窄屏专用控件，**不是缺陷**（避免误报）；
  - 复核遮罩色值 `agent-hub-backdrop` = `rgba(15,23,42,0.4)` + `blur(10px)`（硬编码 slate-900/40，印证 §2.7）；
  - 复核「文件」视图空态与筛选器、发送按钮禁用态计算值（见 §7.17）。
  - 本轮**未发现新问题**（唯一"疑似新问题"是 3 个 0 尺寸按钮，核对后被排除）。
- **第五轮（设置区逐页扫描）**：进入 `/settings` → Agent，依次点三个分组胶囊（`button[aria-controls="agent-settings-{models,runtime,plugins}"]`），每个分组等渲染稳定后取 `fullPage` 截图（`documentElement.scrollHeight` 依次 2008 / 3825 / 1883），并在可见面板内批量读取按钮/输入控件的 `fontSize`、`getBoundingClientRect()`、原生 checkbox 尺寸与中文文本节点。**期间有一次误判被自己推翻**：全页缩略图上看似「MCP Integrations」标题重复出现两次，回到真实 DOM 用 `textContent === "MCP Integrations"` 精确匹配后确认**只有一个 `<h3>`**，属于缩略图阅读误差，故未记入问题。
  - 词典体检：把 `i18n/{zh-CN,en-US,ja-JP}.json` 拍平成 `key→value`，逐 key 比较三语取值（`zh==en` 34 个；`zh` 中"不含 CJK 且含 ≥2 个英文单词且长度 >12"的 14 条）；
  - i18n 插值体检：在 `zh-CN.json` 里用正则找出所有含 `{state}/{status}/{kind}/{phase}/{mode}` 的文案，再回到 `.vue` 里核对传入的是不是原始枚举。
- **第四轮（2026-09-21，窗口 1600×773）**：
  - **Run 详情整体失败**：在任务栏「Run 历史」里点击一条 Run，同时用 CDP 监听 `page.on("response")` 记录该次点击触发的全部 `/api/v1/` 请求与状态码（得到"只有 `/approvals` 是 500"），再读 DOM 判断详情头部（返回按钮/`#hash`/检查点区块）是否出现、错误横幅的文本；最后用 `ctx.request.get()` 遍历 22 个 Run 逐个回放 `/approvals`，量化受影响面（8/22）。
  - **composer 裁切根因**：读 `.agent-toolbar-controls` 的 `clientWidth/scrollWidth` 与容器右边界，再遍历其内部每个叶子控件（button/input/select/`.agent-config-*`）的 `getBoundingClientRect()`，用"叶子右边界 > 容器右边界"判定被裁控件；随后用 `addStyleTag` 把 composer 外层的 `max-width` 临时改成 `none` 做 A/B 对照（现状 617/659 裁 42px vs. 解封后 1159/1159 不裁），测完还原。
  - **任务栏 / 审批卡**：逐屏截图（`doc/imgs/review-2026-09-21/agent-hub-task-rail-cards-zh.png`）＋代码对照；同时把 6 个拖拽把手的可聚焦性与键盘行为在 DOM 里核对（`<button>` 无 click/keydown）。
  - **硬编码文案计数**：用 Python 遍历 `features/agent/**`（排除 `i18n/`），剔除 `//`·`*`·`/*`·`<!--` 开头的注释行后，统计含 CJK 的行数（118 行，分布见 §7.14-c）。
  - **a11y / 级联 / token 复核**：与第三轮同法重跑（Tab 12 次全部落在 Hub 之外；`button.text-xs` 仍为 16px、`div.text-xs` 为 12px；`--color-card` 仍为空、12 个 `[class*=bg-card]` 里 11 个计算为 `rgba(0,0,0,0)`）。
- **第三轮（窄窗口 / 深色 / 键盘）**：
  - 窄窗口：用 Playwright 的 `mouse.down/move/up` 拖 Hub 窗口右下角的缩放手柄（`.agent-hub-window button.group.absolute`）到 1200 / 740 / 560 宽，每次读取窗口、侧栏、消息区、composer、`.agent-toolbar-controls` 的 `getBoundingClientRect` 与 `clientWidth/scrollWidth`；弹层是否"跑出窗口"用「面板 rect 是否落在窗口 rect 内」判定。**测完把窗口拖回原尺寸**（localStorage 里 `nexus.agent.surface.v1.user.N`）。
  - 深色主题：不点界面里的"深色模式"（它会 `saveUiTheme` 持久化到服务端），改为把 `features/appearance/config/default-theme.ts` 的 `darkUiTheme` 变量**注入 `documentElement.style`** 做对照截图/取色，测完 `removeProperty` 还原（已确认 `--app-bg-color` 恢复 `#ffffff`）。同时用相对亮度公式现算对比度（如顶栏 `rgb(173,181,189)` on `rgb(52,58,64)` = **5.55:1**，深色下这一处是合格的）。
  - 键盘：打开 Hub 后读 `document.activeElement`、检查背景 `inert`、连按 Tab 观察焦点是否留在 `role="dialog"` 内。
  - 缩放对照：只改 `localStorage['nexus.agent.thread-list-scale.v1']`（1 与 1.3）后重新加载，读同一枚 span 的计算字号，用于区分"CSS 失效"与"运行时内联样式"。
- **未做（第二轮仍然）**：未跑单测/E2E 套件；未做深色主题与窄窗口（<1040px 容器断点）的实测截图；未在真实 Run 执行中观察流式/取消/审批路径的后端行为；`.agent-config-verbose` 在 ≤1040/760/560 断点下的表现只做了代码阅读。

**第三轮新增：跨切面静态深审（2026-09-23）**

- **异步 / mutation 状态机**：从 selector generation、分页 cursor、modal 生命周期、optimistic revision、commit boundary、caller-stable idempotency、KeepAlive/stream/terminal/plugin bridge 生命周期、Runner process owner、Workspace checkpoint、durable queue/retention、Plugin upgrade storage/version 生命周期与 backup crash-consistency 反向扫描；已继续扩展到 §7.53–§7.114，并把 §7.80 经跨组件复核标成排除项。多处疑似问题在继续取证后被主动推翻（Memory preview selector、appendInput 重复提交、Workspace create duplicate、Host leader lock、Plugin iframe origin、Run delta replay、Runner Plugin workspace 跨 generation 目录复用、Mailbox send idempotency、Artifact staging TTL、Memory expiry physical purge、MCP retry restart revival 等）。
- **Plugin package trust chain**：静态复核 `TarPluginPackageVerifier` 与 install coordinator：archive 只允许 file/directory、拒绝 linkpath/symlink/hardlink，限制 entry/单文件/展开体积；签名覆盖 raw `manifest.json + files.json`，payload 必须精确落在签名 file list 且逐文件 size/SHA-256 一致；frontend/backend/runner entry 必须在签名列表；install tree 最终只读。未发现 tar traversal / 未签名 payload 注入；普通 install 的“主提交后 stage finalization 冲突”已补入 §7.62。
- **Runner 控制面 / session**：HTTP 与 WebSocket upgrade 共用 Bearer token + 显式 protocol version；Terminal 的 browser→Backend sessionId 会绑定 user/app/workspace/generation，Backend 保留 Runner socket 并做 bounded replay，stop/restart/delete 会跨 Backend/Runner 关闭 terminal/browser/ACP/plugin owner；Browser tunnel 对 frozen target id/revision 与 endpoint 全字段校验，并把 discovery 得到的 DevTools authority 钉回管理员配置 host。
- **Workspace file boundary**：logical root 固定 `/workspace/work`，路径 normalize/containment、逐层 symlink 拒绝、目标 `O_NOFOLLOW`、write/move/delete SHA precondition、patch exact declared location + `fuzzFactor=0` 已核；Runner 路由会拒绝 active Workspace job，但该 guard **不包含 Terminal / ACP 外部 writer**，实际 TOCTOU 已动态复现并记录 §7.92。多文件 patch 的中途 I/O failure 仍会被上层统一归类 outcome unknown 并 quarantine，§7.92 的问题则是 race 后 Runner 正常返回 confirmed。
- **Runner lifecycle/reconcile**：确认 restart 的 Runner Plugin activate 半失败状态（§7.85）、toolchain switch delete unknown→failed 后 `stopping` 无 rollback（§7.86）、Host Runner detached child orphan（§7.87）、ACP/Terminal drain 与 cleanup 的 owner 缺口（§7.89）、checkpoint live-writer / crash recovery（§7.90–§7.91）、normal lifecycle background-job drain（§7.93）与 toolchain switch 跨 generation writer overlap（§7.94）；同时排除 journal replay、普通 provision retry、Runner Plugin workspace 跨 generation 目录复用等候选。
- **ownership/scope 机械复核**：对 Agent repository 外部资源 mutation 扫描“按 id 更新/删除但无 user/app scope”的候选；剩余命中均落在已绑定 Run/owner 的内部事务、lease owner 校验或内部 command lifecycle，未发现新的可由 HTTP resource id 跨 user/app 修改的路径。

## 附录 B：本次未覆盖 / 需要进一步确认

- 后端运行期行为（真实 Provider/ACP/MCP/Browser 外部交互、网络中断、进程崩溃、并发故障注入）本轮仍以静态状态机复核为主，没有对这些真实外部系统做动态破坏性验证。
- `packages/agent-runner` 已补做高风险链路深审：journal/idempotency、HTTP/WS Bearer + protocol gate、Workspace lifecycle/reconcile、Runner Plugin lifecycle、local Terminal reattach、Browser tunnel frozen-target binding、Workspace coding file/path/symlink/hash/patch 边界、cleanup；**仍未逐文件逐行审完全部 Runner 实现，也未做故障注入**。
- Plugin 签名/校验/安装主链已补做静态深审：tar entry 类型与 path/size/count 限制、禁止 symlink/hardlink、manifest + files.json Ed25519 签名、payload exact file-list/hash、target entry、immutable install tree 与 verify→install 路径均已核；未做恶意 tar corpus / 并发 stage fuzz / 文件系统故障注入。
- Backup/restore 已补做覆盖范围、secret re-encrypt、filesystem swap、并发/一致性 snapshot 审计：确认 Agent/AI 数据覆盖遗漏与 connection-scope 授权错绑（§7.101）、restore rollback/crash consistency（§7.102）、export/import 缺 snapshot/全局串行化（§7.109）。仍未做真实磁盘 fault-injection、双并发 import 动态复现或跨实例完整 Agent roundtrip。
- 数据迁移与历史数据兼容已补做高风险静态深审：系统复核 Agent migration #21–#45 的 multi-column ADD、表重建、scope/semantic JSON 转换与 current-schema 启动顺序；确认 #23/#34 partial-schema 误判（§7.100），排除 #22 额外 FK、#36 Subagent SSH scope、#43 legacy status、#28 FTS 自定义函数注册顺序等候选。仍未用真实历史数据库逐版本跑完整升级矩阵，也未做 migration fault-injection。
- 视觉结论已升级为实测（§7.10–§7.13），覆盖浅色 + 深色对照、1620×953 与 1200/740/560 三档窗口宽度；但**未测"最大化/最小化"、未在真实触屏设备上验证触控目标、也未做日文界面的 i18n 实测**（只做了中/英）。§7.1 的玻璃配方仍是建议值，需设计确认。
- 未逐帧核对全部 agent 截图（只看了解析出的关键几张）；**第四轮已补审任务栏（TaskRail）与 Run 详情入口**（§7.14-b），但 Artifact library / 插件多实例 / checkpoint 恢复的**成功路径界面**、以及审批卡的**真实渲染态**（当前库里没有 `requested` 状态的审批可点，只能代码侧复查）仍未截图核对。
- 设置区除「Agent」首屏之外的页面（运行与环境 / 插件与安全 / 子代理 / 记忆 / 存储 / 护栏…）本轮仍未逐页截图；只有 §7.14-c 的"硬编码文案行数"做了全目录统计。
- 未在真实 Run 执行过程中（流式输出、取消、审批、多 Run 并发）做界面观察，因此 §1.7（流式文本丢失）、`§4` 的产品问题、以及任务栏/Run 列表的"动态状态"观感属于静态推断。
- 深色主题只做了"变量注入 + 取色/对比度"的静态对照，**没有逐屏截图核对**（快照：`agent-hub-dark-popover.png`）；顶栏对比度 5.55:1 合格，但 hub 顶栏渐变、窗口阴影里的白色 inset、以及深色下的 `ring/shadow` 仍未逐条验证。
- 设置区其余页面（运行与环境 / 插件与安全 / 子代理 / 记忆 / 存储 / 护栏 …）本轮只实测了「Agent」首屏与英文界面的 i18n 缺口，未逐页截图核对控件尺寸。
