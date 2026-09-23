# Nexus Agent 复查记录（代码 / 设计 / 模块关系 / UI）

> 状态：持续维护的 Review / 闭环记录；已完成项保留历史证据并标记关闭，开放项按当前代码事实继续复核。
> 复查对象：当前工作区里新增的 Agent 功能（Backend `modules/agent` + `infrastructure/agent`、Frontend `features/agent`、`packages/agent-runner`）。
> 基准文档：`doc/AGENT.md`、`doc/architecture/FRONTEND.md`、`doc/software-requirements/requirements/agent.md`。
> 复核方式：静态阅读 + 计数 + 构建产物核对 + **第二轮起在真实环境用 CDP 浏览器截图 / 读计算样式实测**（方法见文末「附录 A」）。
> 实测环境（2026-09-21）：后端 `tsx src/index.ts`（:3001，dev）+ 前端 vite（:9998）+ 反代 `https://api.honus.top`，账号 `honus`。
> 浏览器窗口：第一~三轮为 **1620×953 / dpr 1**；**第四轮实测时浏览器的真实窗口已是 1600×773 / dpr 1**（本轮起未做任何改动，Hub 窗口沿用持久化的 1600×711）。全文标注了每轮实测所用的尺寸，跨轮数字不要直接互相比较。
> Git 状态可用；闭环过程以 `dev` 分支实际提交、静态门禁与真实 CDP 验收为准。
>
> **当前实施状态（2026-09-23）**：已关闭 §7.12（空态 pager 命中区）、§7.13-d（会话列表缩放入口/重置）、§6.2 批 1/2（设置区主/次/危险/图标按钮收敛到 Gen2 `UiButton`）、§7.20（设置区 27 处原生 checkbox 收敛到 Gen2 `UiCheckbox`）、§7.21（Hub 模型弹层恢复"真毛玻璃 + 无盒选项行"）、§7.22（Provider / 设置写完立即刷新主界面）、§7.23（玻璃配方上收到 Gen2 通用层）、§7.13-e（11 个稳态禁用按钮补齐原因文案）、§7.2（骨架：最小高度 380 → 480 + 矮窗口 composer 压缩、侧栏可折叠、窗口状态持久化、列宽复核、顶栏双击最大化）、§7.24-a（「Agent 功能」卡片瘦身）与 §7.24-b/-c（16 张卡的长句迁入通用 `UiInfoHint`，设置区可见说明 2145 → 1209 字；Hub 侧补 2 处弹层头部说明）、§7.2-g（停靠态侧栏折叠/展开补 200ms 列宽过渡 + 淡出，修掉"闪一下跳到展开位置"）、§6.2 第三批（Agent 设置区分组导航胶囊 `115×36 r12` → `115×32 r8`，并在同轮抓到 `添加备用模型` 触发器误用 comfortable 密度 `137×36 fs13` → `133×32 fs12`）、§7.25（设置区「一层卡片」重构：模块卡并入分组卡、模块内分组框降级为 inset 并把分组导航改为粘性，叶子的带边框祖先 3 层 → 1 层）、§7.26（Composer 配置弹层首帧错位：测量前解除占位尺寸 + 未定位不绘制，模型/思考强度/App 切换器首帧即终值）。默认模型仍是 Gen2 `UiCombobox`（§7.6 / §7.18，trigger / panel 共用同一 glass fill / blur / border）。每条闭环均带真实 CDP 实测数据 + 类型检查；下一条开放 P1 为设置区剩余的顶部 Tab 36px（跨页 chrome，按约定不动）/ `QuantityInput` 单位切换命中区 18×20 / 22 处原生 `<select>`；主界面骨架 §7.2 已整节关闭（最小高度、侧栏折叠、状态持久化、列宽复核、顶栏双击）。本文件现在作为唯一进度/问题状态来源，原 `doc/progress.md` 不再维护。

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

| 级别                                  | 问题                                                                                                                                                                                                                                                                                                                                                                                                                | 关键位置                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| **P0 · ✅ 已关闭 2026-09-23**         | 设计 token 已补齐并接入 Tailwind：`--color-card / border-hover / primary-hover / warning-foreground` 均有真实规则；CDP `.bg-card` 计算背景为 `rgba(246,247,249,.92)`                                                                                                                                                                                                                                                | `app/styles/tokens.css`（见 §1.1）                                                                         |
| **P0 · ✅ 已关闭 2026-09-23**         | `agent.ui.saveFailed` 已补齐 en-US / ja-JP / zh-CN 且保存失败路径真实引用                                                                                                                                                                                                                                                                                                                                           | `settings/ModelProviderSettings.vue`、`i18n/*.json`（见 §1.2）                                             |
| **P0 · ✅ 已关闭 2026-09-23**         | Agent Hub 模态边界已闭环：打开聚焦 Hub、背景 `#app.inert=true`、Tab/Shift+Tab 限制在 Hub 与 Hub-owned portal、Escape 关闭、关闭后焦点回 Launcher                                                                                                                                                                                                                                                                    | `host/AgentHubWindow.vue`（CDP 复验见 §7.13-c）                                                            |
| **P0 · ✅ 已关闭 2026-09-23**         | 玻璃层已固化为唯一 `.glass-surface`：token-based 半透明 fill + blur(16px) + 弱边框/阴影；Gallery CDP 实测 alpha≈0.7544                                                                                                                                                                                                                                                                                              | `app/styles/global.css`、`foundation/ui/UiPopover.vue`（见 §7.1）                                          |
| **P1 · ✅ 已关闭 2026-09-23**         | **默认模型选择框「文字背景 ≠ 框背景」已关闭**：`UiCombobox` 输入框不再被全局未分层表单规则涂成纯白，trigger / panel / 输入区共用同一 glass fill                                                                                                                                                                                                                                                                     | `foundation/ui/uiGen2.css`（见 §7.18）                                                                     |
| **✅ 已确认保留模态 2026-09-23**      | 「模态遮罩 + 浮动窗口」经产品确认是**有意设计**（背景不可交互，避免两边操作冲突；使用 Hub 时不需要同时看终端）；遮罩点击已收敛为真正 no-op，不再有 400ms「闪烁」                                                                                                                                                                                                                                                    | `host/AgentHubWindow.vue`（见 §2.1、§2.2）                                                                 |
| **P1 · ✅ 已关闭 2026-09-23**         | **字号：实测推翻了"563 处 ≤11px 不可读"的整体判断**（181 处 ≤9px 里 95 处是图标；默认首屏只有 6 个 <11px 文本节点）。仍按"阅读文本 ≥11px"全量收敛：两轮共 33 文件 / 274 行，现 `<11px` 只剩图标字形与 5 个 14–16px 圆内计数/勾选，无任何阅读文字低于 11px                                                                                                                                                           | `features/agent/**`（见 §2.3）                                                                             |
| **P1 · ✅ 已关闭 2026-09-23**         | **点击目标：** 关闭 App 标签 `16×16`→`24×24` 常显 + pointer；窄容器纯图标 Run 配置 `25px`→`28px`、字号 `10/10.5px`→`11px`；审批卡按钮追加 `min-h-8`（32px）                                                                                                                                                                                                                                                         | `host/AgentHubWindow.vue`、`host/AgentAppSurface.vue`、`runtime/ApprovalCard.vue`（见 §2.4）               |
| **P1 · ✅ 已关闭 2026-09-23**         | 调色板类 **182 → 0**：新增 `info` 语义 token，其余收敛到 `success/warning/error/primary`；硬编码阴影 / Hub 窗口阴影 / 遮罩改为从 token 推导。CDP 证明改 theme 变量后计算色跟随                                                                                                                                                                                                                                      | `app/styles/tokens.css`、`features/appearance/config/default-theme.ts`、`features/agent/**`（见 §2.7）     |
| P1                                    | 设置区控件风格分裂：**按钮档位已收敛**（主/次/危险/图标四档全部走 Gen2 `UiButton`，实测统一 `32px / fs12 / r8`）；**原生 checkbox 已收敛**（27 处 → Gen2 `UiCheckbox`，实测 `16×16 / r5 / role=checkbox`，见 §7.20）；**仍开放**：顶部 Tab 仍是 36px（胶囊已收敛为 `115×32 r8`，见 §6.2 第三批）、`QuantityInput` 单位切换命中区 18×20、原生 `<select>` 22 处，以及添加/移除模型行里的 11px 纯文字按钮（§6.3/§6.7） | `features/agent/settings/**`（见 §6.2、§6.3、§7.20）                                                       |
| **P1 · ✅ 已关闭 2026-09-23**         | 设置区模板与能力清单里的硬编码中文（能力名称/描述、存储、插件、预算、数值单位）已全部接入词典；中英日三语键位对齐                                                                                                                                                                                                                                                                                                   | `features/agent/settings/**`（见 §6.5、§7.14-c）                                                           |
| **P1 · ✅ 已关闭 2026-09-23**         | `bg-card` 族已恢复真实 surface；助手气泡改为有效 `bg-card`，TaskRail/空态卡继续使用已生效的 card token                                                                                                                                                                                                                                                                                                              | `ai/ConversationMessage.vue`、`ai/AgentConversation.vue`、`runtime/TaskRail.vue`                           |
| **P1 · ✅ 已关闭 2026-09-23**         | Composer 改为自身 container query + 单行 compact；560px Hub CDP 实测 controls `462/462`，无静默裁切，思考等级优先靠前                                                                                                                                                                                                                                                                                               | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`（见 §7.3）                                          |
| **P1 · ✅ 已关闭 2026-09-23**         | 「回到最新」已移到 Composer 上方状态行右侧；token 状态同排左侧，仅真实 token>0 时显示                                                                                                                                                                                                                                                                                                                               | `ai/AgentConversation.vue`（见 §7.4）                                                                      |
| **P1 · ✅ 已关闭 2026-09-23**         | 主界面三层 chrome 压扁消息区：`MIN_HEIGHT` 380 → 480，并在矮窗口下把 composer 压成两行；CDP 实测最小高度时会话区 **94 → 227px**（§7.2 列宽 / 体感已复核，见 §7.2-b、§7.2-f；停靠态折叠闪烁见 §7.2-g）                                                                                                                                                                                                               | `host/window-manager.ts`、`host/AgentHubWindow.vue`、`ai/AgentConversation.vue`（见 §7.2-a）               |
| **P2 · ✅ 已关闭 2026-09-23**         | Agent 内无效 spacing utility 已清零；`py-0.2 / py-0.8 / py-1.8` 当前源码扫描残留 0                                                                                                                                                                                                                                                                                                                                  | `features/agent/**`（见 §7.8）                                                                             |
| P1                                    | 多处「不可发现 / 与产品整体不一致」的交互：会话列表 Ctrl+滚轮缩放、任务栏卡片可拖拽排序、Launcher 6px 阈值拖拽（§2.6 的空态轮播已关闭）                                                                                                                                                                                                                                                                             | `host/AgentThreadSidebar.vue:132-146`、`runtime/TaskRail.vue:107-160`（见 §2.8）                           |
| **P1 · ✅ 已关闭 2026-09-23**         | Composer 的 Send / Cancel Run 已拆成两个独立按钮（停止按钮图标-only + 错误色，运行中才出现）；`sendHint` 已渲染；空草稿按 Enter 不再误取消 Run                                                                                                                                                                                                                                                                      | `ai/AgentConversation.vue`（见 §2.5）                                                                      |
| **P1 · ✅ 已关闭 2026-09-22**         | **切换 App / Files 不再卸载 Agent surface，断线也不再清空已展示 partial text**：Hub 使用持续存在的 `<KeepAlive>`，真正结束 Run / 切线程 / 停止订阅时才清理 streaming presentation                                                                                                                                                                                                                                   | `host/AgentHubWindow.vue`、`host/AgentAppSurface.vue`（见 §1.7）                                           |
| **P1 · ✅ 已关闭 2026-09-22**         | **Nexus 前后端真实 transport contract 已统一到 `packages/protocol`**：HTTP / Workspace WS / Agent HTTP / Agent event WS / Agent terminal WS 均由 canonical DTO/event contract 单一来源约束，并已接入 transport architecture guard；当前 HEAD 收尾复核再次通过 guard、Agent ESLint、Backend/Agent Runner typecheck、Frontend `vue-tsc + vite build` 与 Agent scenario suite **71/71**                                | `packages/protocol/**`、`scripts/check-transport-contract-boundaries.mjs`（见 §3.2）                       |
| **P1 · ✅ 已关闭 2026-09-22**         | **Agent scenario runner 已模块化并支持受控并发**：`runner.ts` 从 22k+ 行降至 258 行，当前 71 个独立 scenario 文件；默认按批次并发、仅显式 `SERIAL_SCENARIOS` 保持串行；当前扫描未发现通过 `readFileSync` 读取 `packages/*/src` 做 source-shape 架构断言                                                                                                                                                             | `tests/backend/agent-scenarios/**`（见 §3.6）                                                              |
| P2                                    | 274/1148（约 24%）i18n key 已无引用，且三种语言各存一份                                                                                                                                                                                                                                                                                                                                                             | `features/agent/i18n/*.json`                                                                               |
| **P2 · ✅ 基础门禁已关闭 2026-09-22** | **Agent review 范围已接入 ESLint flat config**：`no-unused-vars` + Vue `v-if/v-for` 规则成为 error；首跑发现并清理 47 个真实 unused 符号。自定义 i18n / 设计 token 规则仍开放                                                                                                                                                                                                                                       | `eslint.config.mjs`、`package.json` scripts                                                                |
| P2                                    | 巨型文件问题**仍主要集中在 UI**；非 UI owner 已完成一轮拆分：`agent-api.ts` 791 行、`runner-http.adapter.ts` 770 行、`native-agent-backend.ts` 722 行，原 1k+ 行 state-commit 聚合文件已拆为细分 transition owners                                                                                                                                                                                                  | 见 §3.1                                                                                                    |
| P2                                    | 工具结果摘要为英文硬编码，直接展示在中文/日文 UI 里                                                                                                                                                                                                                                                                                                                                                                 | `modules/agent/tools/host/*.ts`                                                                            |
| **P1 · ✅ 已关闭 2026-09-22**         | **历史 Run 的 `GET /runs/:id/approvals` 稳定 500（`AGENT_DURABLE_STATE_INVALID`）**：已由 migration #45 将 legacy `inspection_json.target.kind = "machine"` 规范化为 canonical SSH target；真实数据库副本验证 26 条 legacy tool call → 0、25 条受影响 approval 全部可解码                                                                                                                                           | `sqlite-migrations.ts` migration #45、`tests/backend/agent-scenarios/runner.ts`（见 §1.9）                 |
| **P0 · ✅ 已关闭 2026-09-23**         | 全局 form font/cursor reset 已移入 `@layer base`；CDP 设置页 `text-xs` 按钮均恢复为 12px（旧实测为 16px）                                                                                                                                                                                                                                                                                                           | `app/styles/global.css:27-46`（见 §7.10）                                                                  |
| **P1 · ✅ 已关闭 2026-09-23**         | 设置区「Agent」页在英文界面下的硬编码中文：三个子页可见中文文本节点 **29 → 0**（数值+单位改由 `use-quantity-labels` 注入）                                                                                                                                                                                                                                                                                          | `features/agent/settings/**`（见 §6.5、§7.11、§7.14-c）                                                    |
| **P1 · ✅ 已关闭 2026-09-23**         | 备用模型链已改为 `1..N` 有序列表 + 上移/下移/移除；Add 使用可搜索 Gen2 `UiPopover`，排除默认/已选并限制最多 8 项                                                                                                                                                                                                                                                                                                    | `settings/ModelProviderSettings.vue`（见 §7.11）                                                           |
| **P1 · ✅ 已关闭 2026-09-23**         | 设置区按钮规格已收敛到四档：主操作 `solid/primary`、次操作 `soft/neutral`、危险 `soft/danger`、图标 `ghost/icon-only(28×28)`；实测动作按钮统一 `×32 fs12 r8`，禁用态为中性填充（旧值：`添加 Provider` 144×38 fs16、`立即更新` 77×28 fs11 r6、`模型与测试` 117×26、`添加配置档` 86×34 r6）                                                                                                                           | 见 §7.11                                                                                                   |
| **P2 · ✅ 已关闭 2026-09-23**         | 空态 pager 命中区 **12×16 / 20×16 → 28×32 / 36×32**：透明伪元素外扩，可视圆点与布局不变；每个圆点独占互不重叠的命中格                                                                                                                                                                                                                                                                                               | `ai/AgentConversation.vue:472-486`（实测见 §7.12）                                                         |
| **P1 · ✅ 已关闭 2026-09-23**         | 弹层已改为优先按 Hub 窗口 clamp，并限制 maxWidth/maxHeight、跟随 Hub resize；560px Hub 下附件弹层实测四边均在窗口内                                                                                                                                                                                                                                                                                                 | `files/AgentConfigPopover.vue`、`host/AgentAppSwitcher.vue`（见 §7.13-a）                                  |
| **P0 · ✅ 已关闭 2026-09-23**         | Hub 键盘模态边界已修复并 CDP 复验：初始焦点进入 Hub、背景 inert、连续 35 次 Tab 0 次逃逸、Escape 关闭且焦点回 Launcher                                                                                                                                                                                                                                                                                              | `host/AgentHubWindow.vue`（见 §7.13-c）                                                                    |
| **P2 · ✅ 已关闭 2026-09-23**         | 会话列表缩放（Ctrl+滚轮）现在有可见入口与重置：侧栏头部 `100%` 胶囊（点击展开 放大/缩小/重置为 100%，含边界禁用）；缩放系数改由根节点 `--agent-thread-scale` 驱动，内联 `font-size` 归零                                                                                                                                                                                                                            | `host/AgentThreadSidebar.vue:64/127/310`（见 §7.13-d）                                                     |
| **P0 · ✅ 核心缺陷已关闭 2026-09-22** | **Run 详情不再被单个辅助接口失败整体阻断**：`getRun` 成功即打开详情；checkpoints / approvals / subagents 独立 settled 回填，失败项仍走现有错误横幅。分区重试与错误本地化仍作为 UI 子项开放                                                                                                                                                                                                                          | `host/AgentAppSurface.vue`（见 §1.10）                                                                     |
| **P0 · ✅ 已关闭 2026-09-23**         | **Composer 裁切已关闭**：container query 改为 composer 自身，工具条保持单行；560px Hub 实测 controls clientWidth=scrollWidth，无静默裁切                                                                                                                                                                                                                                                                            | `ai/AgentConversation.vue`、`host/AgentAppSurface.vue`（见 §7.14-a）                                       |
| **P1 · ✅ 已关闭 2026-09-23**         | 任务栏 6 个「拖动排序」把手补上键盘路径：↑/↓ 与相邻可见卡片交换（`aria-keyshortcuts` + `title`），焦点跟随卡片                                                                                                                                                                                                                                                                                                      | `runtime/TaskRail.vue`（见 §7.14-b）                                                                       |
| **P2 · ✅ 已关闭 2026-09-23**         | 任务栏：目标卡改用连接名（ID 退到 `title`）、Run 历史改为 8 条起步 + 「显示更早的 Run」增量展开、卡片顺序新增「重置卡片顺序」入口（顺序一致时隐藏）                                                                                                                                                                                                                                                                 | `runtime/TaskRail.vue`（见 §7.14-b）                                                                       |
| **P2 · ✅ 已关闭 2026-09-23**         | 审批卡：`risk` 枚举已本地化（新增 `agent.approvals.risk.*`）；「`审批状态：approved`」由 §1.4/§7.15-a 关闭（`status` 映射）；「剩余 300s」改为 `agent.approvals.expiresIn`（中/日文为「300 秒」）；「批准」按钮由 `bg-warning text-black` 改成品牌主色 `bg-primary text-white`                                                                                                                                      | `runtime/ApprovalCard.vue`（见 §7.14-b）                                                                   |
| **P1 · ✅ 已关闭 2026-09-23**         | Hub 窗口几何补上键盘路径（标题栏/缩放热区方向键 16px、Shift 64px，`aria-keyshortcuts` + `tabindex`），并新增全局 `prefers-reduced-motion` 基线（未分层），Hub 内 60 个带过渡的元素降级为 0                                                                                                                                                                                                                          | `host/AgentHubWindow.vue`、`app/styles/global.css`（见 §2.10）                                             |
| **P1 · ✅ 已关闭 2026-09-23**         | 前端 agent 区非注释硬编码中文 **116 行 → 0**：能力清单、会话用量、错误解释、存储/插件/预算文案全部走词典（中英日三语）                                                                                                                                                                                                                                                                                              | `features/agent/**`（见 §7.14-c）                                                                          |
| **P1 · ✅ 已关闭 2026-09-23**         | `zh-CN` 词典与 en-US 完全相同的 key 由 35 → 22、整句英文由 15 → 5（`ja` 49 → 31 / 20 → 5），剩 5 条是品牌与协议名（白名单）；枚举不再插进本地化句子（`审批状态：approved` / `当前状态：enabled` 走 `status` / `stateLabels` 映射）；新增 `pnpm lint:agent-i18n` 防回归                                                                                                                                              | `i18n/zh-CN.json`、`ApprovalCard.vue`、`AgentFeatureSettings.vue`（见 §7.15-a）                            |
| **P1 · ✅ 已关闭 2026-09-23**         | 未本地化枚举/内部标识：Subagent 状态与失败模式、审批 `risk`、Workspace 命令 `action`/`status` 全部改为查表（新增 `agent.subagents.status/failureMode`、`agent.approvals.risk`、`workspaceRuntime.commandAction/commandState`）；原始值只保留在折叠的「规范化操作」调试区                                                                                                                                            | `runtime/SubagentCard.vue`、`runtime/ApprovalCard.vue`、`settings/WorkspaceRuntimeSettings.vue`（见 §1.4） |
| P2                                    | 设置区「运行与环境」页实测 **3825px 高、8 个独立「保存」按钮**且多为禁用态，无粘性分区导航                                                                                                                                                                                                                                                                                                                          | `settings/**`（见 §7.15-c）                                                                                |
| P2                                    | 设置区空态是左对齐一行纯文本（`尚未配置 MCP Integration。`），与主界面"图标+居中+引导按钮"的空态卡不是同一套语言                                                                                                                                                                                                                                                                                                    | `settings/McpIntegrationSettings.vue` 等（见 §7.15-d）                                                     |
| **P1 · ✅ 已关闭 2026-09-23**         | 设置区不再把后端原始原因码当"不可用原因"渲染：已知码（`runner_not_configured` / `runner_unavailable` / `runtime_not_configured`）映射成中/英/日文说明，未知码退回通用说明并把原始值放进 `title` 与「后端原因代码」行                                                                                                                                                                                                | `settings/WorkspaceRuntimeSettings.vue`（见 §7.15-b）                                                      |
| **P2 · ✅ 已关闭 2026-09-23**         | 禁用态主按钮**已改为中性填充**（§6.2 批 1/2：`保存` / `预览导入` / `卸载` 等实测 `bg rgb(243,244,246)` + 中性描边，不再是品牌色 × 0.5）；**已补**：11 个稳态禁用按钮全部带原因 `title`（没有未保存的修改 / 没有待预览的改动 / 请先填写必填项 / 请先选择来源与目标 / 请先填写仓库地址，三语齐全）                                                                                                                    | `features/agent/settings/**`（实测见 §7.13-e）                                                             |
| **P1 · ✅ 已关闭 2026-09-23**         | Composer 配置弹层（模型 / 思考强度）**首帧位置错乱**：定位时面板仍是占位尺寸（`max-width:0`/`max-height:300`），首帧算到 `(470,472)` 等错位值、下一帧才跳到 `(426,667.5)`（上偏 195px）→ 改为测量前解除占位上限 + 未定位不绘制；App 切换器同源一并修（见 §7.26）                                                                                                                                                    | `files/AgentConfigPopover.vue`、`host/AgentAppSwitcher.vue`（见 §7.26）                                    |
| **P1 · ✅ 已关闭 2026-09-23**         | Agent 设置区**嵌套框 3~4 层**：叶子控件往上数有 3 层带边框的祖先（面板卡 → 模块卡 → 模块内分组框）→ 收到 **1 层**（只留分组卡），模块间改用细分隔线、模块内分组框降级为无边框 inset；同轮把分组导航改成**粘性**（滚 807px 后停 y=0），`运行与环境` 全页 3625 → 3423px（见 §7.25）                                                                                                                                   | `settings/AgentSettingsPanel.vue` + 14 个 `*Settings.vue`（见 §7.25）                                      |
| **P1 · ✅ 已关闭 2026-09-23**         | Agent 的界面与设置里**提示性文字过多**：新增通用 `UiInfoHint`（`ⓘ`/`⚠` 悬浮说明），设置区 16 张卡的长句已全部收起 —— CDP 三组分区实测可见说明 **2145 → 1209 字（-43.6%）**，`ⓘ` 由 1 个增至 16 个；Hub 侧实测常驻版面已无长句，仅补了 2 处弹层头部说明                                                                                                                                                              | `foundation/ui/UiInfoHint.vue`、`features/agent/settings/**`（见 §7.24）                                   |
| **P2 · ✅ 已关闭 2026-09-23**         | 主操作（Composer 发送按钮）禁用态从「品牌色 + `opacity .2`」改为「中性填充 + 保留描边 + `opacity .5` + `title` 说明原因」，并把全仓禁用态不透明度收敛到单一值 `0.5`（原 20/25/35/40/45 五种）                                                                                                                                                                                                                       | `ai/AgentConversation.vue` 等 9 个文件（见 §7.17-c）                                                       |
| **P1 · ✅ 已关闭 2026-09-23**         | 图标颜色：未分层的 `i/.fas/.far/.fab { color: var(--icon-color) }` 压过 `@layer utilities`，132 个带 `text-primary/success/warning/error/foreground` 的图标一律渲染成 `#666`（`!text-white` 是既有绕过写法）                                                                                                                                                                                                        | `app/styles/global.css:91-110`（见 §7.19）                                                                 |
| **P1 · ✅ 已关闭 2026-09-23**         | 空态便当卡自动轮播已可中断：悬停/焦点暂停、手动分页后固定、`prefers-reduced-motion` 时彻底不轮播（hover 位移与脉冲也一起关掉）                                                                                                                                                                                                                                                                                      | `ai/AgentConversation.vue`（见 §2.6）                                                                      |

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

### 1.8 后端工具摘要英文硬编码，直接进对话 UI（P1）

`modules/agent/tools/host/**` 中 `summary` 是面向模型与用户的同一条字符串，例如：

```ts
// modules/agent/tools/host/file-tools.ts:220
return confirmed(`Read ${data.contentBytes} byte(s) from ${data.path}.`, ...);
```

同类字符串在该目录至少 34 处（`Found ${n} ... matches`、`Waiting for the user to answer ...` 等），会被 `ai/ConversationMessage.vue` 作为工具结果摘要渲染。
即：中文/日文界面里混入英文短句。**一个字符串同时服务模型与用户**本身也是设计问题（建议分离"模型可见证据"与"用户可见摘要"）。

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
2. **仍开放（UI）— 没有重试入口**：横幅只有关闭按钮，用户无法"再试一次"，也不会知道是审批这一路失败。

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

| 交互                           | 位置                                                         | 问题                                                                                            |
| ------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| 会话列表 **Ctrl/⌘ + 滚轮缩放** | `host/AgentThreadSidebar.vue:132-146`                        | 劫持浏览器缩放；只对会话列表生效；靠 `title` 提示；比例写进 localStorage                        |
| 任务栏卡片**拖拽排序**         | `runtime/TaskRail.vue:107-160`、`:475-490`（`vuedraggable`） | 侧边任务栏里的卡片可以拖动重排并持久化，产品上无人会预期；拖拽排序与"点击/滚动"在同一区域       |
| Launcher **6px 阈值拖拽**      | `host/AgentLauncher.vue:39-61`                               | 圆形按钮可按住拖动改位置；拖动/点击共用 pointer 流程；移出视野后只能清 localStorage             |
| 遮罩**闪烁反馈**               | `host/AgentHubWindow.vue:72-80`                              | 见 §2.2                                                                                         |
| **虚拟滚动 + 固定行高**        | `host/AgentThreadSidebar.vue:34`、`:269-272`                 | 列表每页最多 100 条，却按 `45px × scale` 手算 spacer；一旦字号/行高变化，滚动位置与可视项会错位 |

建议：删掉列表缩放与任务栏拖拽排序（收益低、成本高、与产品其余部分不一致）；Launcher 位置改为"长按拖动"并提供"重置位置"。

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

- **i18n**：`features/agent/i18n/*.json` 每种语言 1,148 个叶子 key，其中 **274 个（约 24%）** 在 `features/agent` 源码中已无引用（脚本核对）；三种语言各存一份 ⇒ 约 822 条死文案。典型：`agent.conversation.sendHint`（"Enter 发送"）已定义但未渲染、`agent.operations.environmentRecipes`、`agent.files.status.*`、`agent.hub.appActivity` 等。
- **死变量（✅ 已清理 2026-09-22）**：`taskRailWideViewport` 与无效 `resize` 监听已删除（§1.6）。
- **无效样式类**：§1.1 的 158 处。
- 以上三类问题都能被规则检查拦住（§3.6）。

### 3.6 工程保障与测试策略（P1，✅ 非 UI 核心项已闭合 2026-09-22）

- ✅ **基础 lint 门禁已关闭 2026-09-22**：新增 ESLint flat config 与根级 `lint / lint:agent` 脚本，覆盖 Backend Agent、HTTP/WebSocket Agent interface、Agent Runner、Frontend Agent、Agent scenario runner；启用 `@typescript-eslint/no-unused-vars` 与 `vue/no-use-v-if-with-v-for` 为 error。首跑实际发现 **47** 个 unused import/type/helper/局部变量，逐项确认后清理；backend / frontend / agent-runner build 均已有通过记录。**未定义 utility 类、未使用 i18n key、设计 token 等需要自定义规则，仍开放，但属于后续 UI / i18n / design-system 门禁，不阻塞本轮非 UI 收尾。**
- ✅ **scenario 单文件与串行问题已关闭 2026-09-22**：`tests/backend/agent-scenarios/runner.ts` 当前为 **258 行编排器**，场景已拆为 **71 个独立 `*.scenario.ts` 文件**；runner 以 `SCENARIO_CONCURRENCY` 分批 `Promise.all` 执行可并发场景，仅 `SERIAL_SCENARIOS` 中显式列出的共享资源场景保持串行。失败仍会聚合并最终非零退出，不会因首个失败遮蔽后续结果。
- ✅ **源码形态正则架构测试已关闭 2026-09-22**：当前扫描未发现 scenario 通过 `readFileSync` 读取 `packages/backend/src` / `packages/frontend/src` 源文件做 source-shape 断言。现存 `readFileSync` 与 `assert.match/doesNotMatch` 用于 Workspace 文件内容、checkpoint、projection、fingerprint 等**运行行为/数据结果**断言，不再以源码排版、命名或字符串形态充当架构门禁；transport 等架构约束已迁入独立 guard/lint。
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
> **仍开放**：11px 纯文字按钮（单项「移除」「移除全部」无确认、文本链接式按钮）、协议切换的原生 `<select>`，以及批量动作的视觉权重——按原顺序继续。

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

> ✅ **2026-09-23 进度**：#4 / #8 里的"原生 checkbox"部分已关闭（27 处 → Gen2 `UiCheckbox`，见 §7.20）；#6 / #9 / #10 已由 §6.5（i18n）与 §6.2 批 1/2（按钮三档）关闭。**仍开放**：#2 / #3（11px 文本按钮、无确认的批量移除）、#7（窄屏导航）、#1 / #8 的剩余表单控件（原生 `<select>`）。

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
> `运行与环境` 全页高 3625 → 3423px；**8 个独立保存按钮与本条其余部分仍开放**。原文如下：
> 滚到页面中段时用户既不知道自己在上/下哪一段，也不知道刚才改的那一项有没有生效（§7.13-e 已记"禁用态难识别"，这里是它的放大版）。

**d) 空态风格与主界面不一致（P2，新）**

设置区的空态基本是**左对齐一行纯文本**：`尚未配置 MCP Integration。`、`当前 App 与状态下没有 Memory。`（外面套一层虚线框）；
而主界面（Hub / 会话）的空态是"图标 + 居中 + 标题 + 引导按钮"的卡片。
同一产品两套空态语言，设置区显得没做完。

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
- **未一并处理**（仍开放）：卡片内 8 处独立「保存」按钮（§7.15-c）、设置区空态仍是纯文本（§7.15-d）、
  22 处原生 `<select>`（§7.15-f）—— 本轮只动"框的层数"，不动这些控件本体。
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

## 附录 B：本次未覆盖 / 需要进一步确认

- 后端运行期行为（真实 Provider/ACP/MCP/Browser 交互、并发与恢复路径）只做了静态阅读，未做动态验证。
- `packages/agent-runner`（7,875 行）只做了结构扫读，未逐文件复查。
- Plugin 签名/校验链路（`plugin-package-install-coordinator.ts` 等）未深入。
- 数据迁移与历史数据兼容（`sqlite-migrations.ts`）**只复查到 §1.9 这一条**（迁移 #44 改了 result 语义、没改 inspection 的 `target.kind`）；其余 38 条迁移的正确性、以及"老库升级到当前版本"的完整路径未验证。
- 视觉结论已升级为实测（§7.10–§7.13），覆盖浅色 + 深色对照、1620×953 与 1200/740/560 三档窗口宽度；但**未测"最大化/最小化"、未在真实触屏设备上验证触控目标、也未做日文界面的 i18n 实测**（只做了中/英）。§7.1 的玻璃配方仍是建议值，需设计确认。
- 未逐帧核对全部 agent 截图（只看了解析出的关键几张）；**第四轮已补审任务栏（TaskRail）与 Run 详情入口**（§7.14-b），但 Artifact library / 插件多实例 / checkpoint 恢复的**成功路径界面**、以及审批卡的**真实渲染态**（当前库里没有 `requested` 状态的审批可点，只能代码侧复查）仍未截图核对。
- 设置区除「Agent」首屏之外的页面（运行与环境 / 插件与安全 / 子代理 / 记忆 / 存储 / 护栏…）本轮仍未逐页截图；只有 §7.14-c 的"硬编码文案行数"做了全目录统计。
- 未在真实 Run 执行过程中（流式输出、取消、审批、多 Run 并发）做界面观察，因此 §1.7（流式文本丢失）、`§4` 的产品问题、以及任务栏/Run 列表的"动态状态"观感属于静态推断。
- 深色主题只做了"变量注入 + 取色/对比度"的静态对照，**没有逐屏截图核对**（快照：`agent-hub-dark-popover.png`）；顶栏对比度 5.55:1 合格，但 hub 顶栏渐变、窗口阴影里的白色 inset、以及深色下的 `ring/shadow` 仍未逐条验证。
- 设置区其余页面（运行与环境 / 插件与安全 / 子代理 / 记忆 / 存储 / 护栏 …）本轮只实测了「Agent」首屏与英文界面的 i18n 缺口，未逐页截图核对控件尺寸。
