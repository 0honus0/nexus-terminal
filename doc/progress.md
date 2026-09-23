# Nexus Agent UI 问题收敛 · 进度

> 状态：进行中（一次只处理一条，改完实测截图确认后再进入下一条）
> 来源清单：`doc/problem.md`（§7.9 优先修列表）
> 实测环境（2026-09-22）：后端 `tsx src/index.ts`（:3001，`NODE_ENV=development`，**必须带 `AGENT_PUBLIC_ORIGIN=https://api.honus.top`**，否则所有 Agent 变更请求会被 CSRF 拒绝）+ 前端 vite（:9998）+ 反代 `https://api.honus.top`；浏览器为 AgentDock 的 Chrome，经 CDP（`http://172.30.31.11:9223`）接管**已有窗口/标签页**，账号 `honus / honustest`。
> 复现/验证脚本：`tests/e2e/.tmp/cdp-review/`（`.tmp/` 已 gitignore）。

---

## ✅ 已解决：设置区默认模型下拉统一到 Gen2 Popover

| 项       | 内容                                                                                     |
| -------- | ---------------------------------------------------------------------------------------- |
| 状态     | **已闭环 2026-09-23；静态/构建 + CDP 验收通过**                                          |
| 对应问题 | `doc/problem.md` §7.6 / §7.9-6（设置区自绘下拉缺 Escape / 焦点 / Portal / 统一玻璃表面） |

- `ModelProviderSettings` 删除手写 `document.click` + `absolute top-full` 下拉，默认模型选择改为 Gen2 `UiPopover`。
- `UiPopover` 增加 `wrapperClass / triggerClass` 透传，设置页可保持 `w-full` trigger 与现有内容布局；若 Popover 已打开后 `disabled` 变为 true，会通过 guarded `applyOpen(false)` 自动收起并保持 `open-change` 一致。
- 搜索与模型列表继续保留；空结果从硬编码中文改为 `agent.settings.providers.noMatchingModels`，en-US / ja-JP / zh-CN 已补齐。
- 真实设置页当前无已配置模型，因此 trigger 按设计为 disabled；CDP 实测 `384×36`、13px、8px radius、`cursor:not-allowed`。
- 同一 `UiPopover` 在 DEV Gallery CDP 实测：trigger 高 32px；玻璃 panel `322×202`，背景 alpha ≈ `0.7544`、`blur(16px)`、16px radius；Escape 关闭后焦点回 trigger。
- 最终门禁：`git diff --check`、Prettier、Agent ESLint、frontend `vue-tsc --noEmit`、Vite production build 全部通过。Foundation 目录当前未接 Vue+TS ESLint parser，因此 `UiPopover.vue` 由 Prettier + `vue-tsc` + build 覆盖。

---

## ✅ 已解决：无效间距 utility + 助手气泡填充 + saveFailed i18n

| 项       | 内容                                                                                                |
| -------- | --------------------------------------------------------------------------------------------------- |
| 级别     | P0/P2                                                                                               |
| 状态     | **已解决 2026-09-23；静态/构建验收通过**                                                            |
| 对应问题 | `doc/problem.md` §7.1 / §7.5-1（card 表面）、§7.8（无效 spacing utility）、§5 第 1 条（saveFailed） |

- 助手消息气泡从失效的 `bg-card/45` 改为有效 `bg-card`；Gen2 前置已让 `--color-card` 真正接到主题 token，浅/深主题都使用对应 card 色。
- 全 `features/agent` 清理 Tailwind 不生成规则的 `py-0.2 / py-0.8 / py-1.8`：徽章统一到 `py-0.5`，较大按钮/状态块分别收敛到 `py-1 / py-2`。最终源码扫描三类残留 **0**。
- 涉及会话侧栏、TaskRail、Provider/App/Plugin/Safety/Budget 设置区；修复此前“类名写了但实际垂直 padding=0”的机械问题，不改变业务逻辑。
- `agent.ui.saveFailed` 已补齐 en-US / ja-JP / zh-CN；`ModelProviderSettings` 的保存失败路径已有真实引用，不再出现缺 key fallback。
- 验证：相关 Vue 文件 ESLint 通过、三份 i18n JSON parse 通过、Prettier 通过；本轮之前完整 frontend `vue-tsc --noEmit` 与 Vite production build 已在同一 worktree 上通过。

---

## ✅ 代码闭环：Agent Hub 模态键盘边界

| 项       | 内容                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 级别     | P0                                                                                                       |
| 状态     | **已闭环 2026-09-23；静态/构建 + 真实 CDP 运行时验收通过**                                               |
| 对应问题 | `doc/problem.md` §7.13-c / §7.14-d（`aria-modal` 但焦点留在背景、Tab 可操作背后页面、Escape 不关闭 Hub） |

- Hub 打开时先保存当前焦点，再把 `#app` 设为 `inert`；Hub 本身通过 Teleport 位于 `body`，因此不会被背景 inert 误伤。
- Hub 根节点增加 `tabindex="-1"` 并在打开后的 `nextTick` 获取初始焦点；Tab / Shift+Tab 在 Hub 可聚焦元素首尾循环。
- Hub 注册进已有 `overlayStack`（z=50）；更高层 `BaseModal / OverlayPanel` 打开时，Hub 自动暂停 Escape 与焦点强制，不抢上层弹窗焦点。
- `AgentConfigPopover` / `AgentAppSwitcher` 的 body Teleport 面板增加 `data-agent-hub-portal`；`BaseListboxSelect` 则通过 Hub 内 trigger 的 `aria-controls` 与 panel id 自动识别为 Hub-owned portal。焦点可合法进入这些浮层，Tab 到边界后回到 Hub。
- Hub 内部控件先处理 Escape：Hub 的 Escape 监听使用 bubble 而非 capture；例如打开的 `BaseListboxSelect` 会先 `preventDefault` 并关闭自身，未被内部控件消费的 Escape 才关闭 Hub。
- 关闭或最小化 Hub 后恢复打开前焦点；launcher 因 `v-if` 会在 Hub 打开时卸载，因此新增 `data-agent-launcher-trigger` 作为重建后的稳定 fallback。
- 背景滚动锁与 inert 都在关闭 / 最小化 / unmount 时恢复；document 级 `focusin` / portal Tab 监听同步清理。
- 本轮同时纳入此前已独立验收并记录的 Hub 活动数间距修正与右下角缩放手柄最终视觉，不引入其它窗口布局改动。
- 最终门禁：`git diff --check`、Prettier、相关文件 ESLint、frontend `vue-tsc --noEmit`、Vite production build 全部通过。
- 真实 CDP（`http://172.30.31.11:9223`，页面 `https://api.honus.top/`）复验：打开 Hub 后 `#app.inert=true`、初始焦点落在 Hub、`aria-modal=true`、29 个可聚焦元素首尾 Tab/Shift+Tab 循环均通过；打开 AppSwitcher 后 Escape 只关闭子浮层，Hub 继续可见；随后 Escape 关闭 Hub 后 `#app.inert=false` 且 launcher 重新获得焦点。
- CDP 首轮曾发现关闭后焦点错误落到 `BODY`，根因是焦点恢复判断把任意可见 HTMLElement 视为可聚焦；已收紧为必须匹配真实 focusable selector 后复测通过。

---

## ✅ 已完成：Foundation UI Gen2 基础库封版

| 项       | 内容                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 状态     | **已完成 2026-09-23；停止继续扩组件，后续按 `problem.md` 实际迁移需求使用**                                                                            |
| 组件     | `UiBadge / UiButton / UiCheckbox / UiDialog / UiFormField / UiInput / UiPopover / UiSelect / UiSlider / UiSpinner / UiSurface / UiSwitch / UiTextarea` |
| 行为底座 | `reka-ui`；Switch / Slider / Popover / Checkbox / Select / Dialog 的键盘、焦点、dismiss、portal / collision 等行为由 primitive 承担                    |
| 诊断页   | DEV-only `/__ui`；生产 build 已确认不包含 Gallery 文案或 chunk                                                                                         |

- 统一 `data-ui-gen="2"` runtime marker、三档 density、tone / surface token、focus-visible、disabled、reduced-motion、forced-colors。
- `.glass-surface` 成为浮层玻璃表面的单一配方；普通 raised / inset surface 不使用 blur。
- 旧自定义主题兼容：缺少 `--card-bg-color` 的旧暗色主题会按背景亮度补暗色 card；显式自定义 card 值保持不变。
- 最终门禁：`git diff --check`、Prettier、frontend `vue-tsc --noEmit`、Vite production build 全部通过。
- Foundation 封版当时的隔离执行环境无法直连 CDP；后续已从 Runner 的 `tests/e2e` 环境成功复用 `172.30.31.11:9223`。Gallery `UiPopover` 已补做真实浏览器验收：32px trigger、玻璃 panel alpha≈0.7544 / blur(16px) / 16px radius，Escape 后焦点回 trigger。

---

## ✅ 已复验：Hub 模态键盘边界 + 560px Composer / Popover

| 项                | 结果                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| CDP               | `http://172.30.31.11:9223`，复用既有 Chrome；页面直接使用 `https://api.honus.top/`                               |
| Hub / Composer    | Hub `560×709`；composer shell `542px`；toolbar `37px`；controls `462/462`（clientWidth/scrollWidth），无横向裁切 |
| 右侧动作          | 附件 `28×28`，发送 `28×28`                                                                                       |
| 附件 Popover      | `520×366`；相对 Hub inset：left `28` / right `12` / top `293` / bottom `50`，四边均在 Hub 内                     |
| 空模型状态        | hover 前后 background / border / text / cursor 全部一致；保持透明、secondary、`cursor:auto`                      |
| Hub 打开          | 初始焦点落在 `section.agent-hub-window`；`#app.inert=true`；`aria-modal=true`                                    |
| Focus trap        | 连续 35 次 Tab，逃出 Hub / Hub-owned portal **0 次**                                                             |
| Escape / 焦点归还 | Escape 关闭 Hub 后 `#app.inert=false`，焦点回到「打开 Agent」Launcher                                            |
| Hub-owned portal  | 附件 Popover 内连续 8 次 Tab 逃出 **0 次**；Escape 仅关闭 Popover，Hub 保持打开，焦点回附件按钮                  |

- §7.13-c 旧的「Tab 会跑回背景应用」复现证据保留在 `problem.md` 作为历史记录，本轮已用真实 CDP 数据确认关闭。
- §7.13-a 的 viewport clamp 回归也用 560px Hub 重新复验，附件选择器不再越出 Hub。

---

## ✅ 已解决：Agent 浮层限制在 Hub 内 + Composer 状态行收口

| 项       | 内容                                                                                                                                      |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 状态     | **代码闭环 2026-09-23；静态/构建验收通过，CDP 因当前执行环境无法访问既有 9223 端口而未执行**                                              |
| 对应问题 | `doc/problem.md` §7.13-a / §7.16-a（弹层按 viewport clamp）、§7.1（玻璃表面/token 前置）、§7.3 / §7.4 / §7.14-a（Composer 裁切/回到最新） |

- `AgentConfigPopover`：Teleport 面板优先取最近的 `.agent-hub-window` 矩形作为边界，12px inset；同时限制 `maxWidth/maxHeight`，并观察 panel + Hub resize，只有不在 Hub 内时才回退 viewport。
- `AgentAppSwitcher`：同步改为 Hub-bound clamp，限制最大宽高，Hub resize 时重定位；Escape 关闭会把焦点还给触发按钮。
- `.glass-surface` 已成为浮层统一配方，`--color-card / --color-border-hover / --color-primary-hover / --color-warning-foreground` 已接入 Tailwind token。
- 旧自定义深色主题迁移验证：缺失 card key → `rgb(43 48 53 / 90%)`；显式 `--card-bg-color` 保持原值；旧浅色主题补 `rgb(246 247 249 / 92%)`。
- Composer token 状态只在 **真实 token 总量 > 0** 时显示，不再因为 steps>0 显示 `0` token；「回到最新」与 token 移到 composer 上方状态行。
- 配置工具条改为 composer 自身 container query，保持单行；附件迁到右侧固定 `+`；思考等级前移。已有 2026-09-22 CDP matrix 证据保持有效。
- 「尚未配置模型」保持 26px 统一结构，但作为非交互状态不再有 hover 边框/底色/文字变化，避免伪装成可点击入口。
- 本轮验证：`git diff --check`、Prettier、相关文件 ESLint、frontend `vue-tsc --noEmit`、Vite production build 全部通过。

---

## ✅ 已解决：Composer 工具条静默裁切「思考强度」

| 项       | 内容                                                                                        |
| -------- | ------------------------------------------------------------------------------------------- |
| 级别     | P1（用户实测反馈）                                                                          |
| 状态     | **已解决 2026-09-22（含下方两个子项，均已实测）**                                           |
| 同时关闭 | `doc/problem.md` §7.4（「回到最新」按钮位置）、§7.3-3.1（空态模型项与正常模型项视觉不一致） |

### 问题

输入框底部工具条把 7 个配置触发和右侧动作组（回到最新 / token 胶囊 / 发送）挤在同一行，容器是 `overflow-x: hidden`：容器一窄，靠后的控件被直接裁掉——没有省略号、没有滚动条、没有渐隐、没有「更多」入口；「思考强度」排在最后一位，因此最先消失。用户反馈的「思考等级有时候看不到」由此而来，且是否可见取决于当前会话内容多寡，无法预测。

### 改前实测（CDP，Hub 窗口 1600×711）

| 场景         | `.agent-toolbar-controls`           | 右侧动作组 | 结果                                 |
| ------------ | ----------------------------------- | ---------- | ------------------------------------ |
| 空会话       | `684 / 684`（`overflow-x: hidden`） | 61px       | 不裁切                               |
| 有内容的会话 | `584 / 624`                         | 160px      | **末枚「思考强度」60px 只露出 21px** |

根因：composer 外壳被 `max-w-3xl` 封顶 768px，而折叠断点写在实测 1343px 的 `agent-conversation-pane` 上 → 永不触发。

### 实施内容

- `features/agent/ai/AgentConversation.vue`
  - 新增 **Composer 上方状态行**：左侧 token 状态、右侧「回到最新」（`rounded-full` 玻璃胶囊，带文字）；两者都不需要时整行不渲染；只显示其一也保持对应左/右对齐。
  - token 胶囊与「回到最新」移出配置工具条 → 右侧组不再随 Run 状态变长。
  - `ArtifactPicker` 从配置区迁到右侧操作区，改为紧凑 `+`（28×28，带数量 badge），与发送/停止同为 `shrink-0` 固定操作区。
  - 工具条保持**单行**（`flex-nowrap`），移除 `overflow-x: hidden`。
  - `.agent-composer-shell` 建立 `agent-composer` container（`container-type: inline-size`），原挂在 `agent-conversation-pane` 上的工具条相关规则迁到该 container，阈值 730 / 620 / 520；消息区自身的响应式仍留在 conversation pane。
- `features/agent/host/AgentAppSurface.vue`
  - 配置顺序固定为 **模型 → 思考等级 → 执行模式 → 批准策略 → 运行环境 → SSH 目标**（思考强度从末位前移）。
  - 「尚未配置模型」空态不再用裸 `span + flex-1`，改为与模型入口同规格的 26px 单行状态项（`fa-microchip` 图标 + `.agent-config-summary` 节奏、`shrink-0`、非交互）。
  - 配置项压缩规则从 `agent-conversation-pane` / `agent-hub-window(1040/760)` 迁到 `agent-composer`；删除 `.agent-run-config { overflow: hidden }` 这一处静默裁切。
- `features/agent/files/ArtifactPicker.vue`：新增 `compact` 触发形态，仅改 trigger 外观，附件选择/上传/10 引用上限/搜索逻辑全部复用原 panel。
- `features/agent/files/AgentConfigPopover.vue`：新增 `triggerVariant`（`square`）与 `triggerClass`；方形变体在 scoped 样式里用双类选择器声明，避免被容器查询里的 `height: 25px` 覆盖（§7.10 的同类层叠陷阱）。

### 验收结果（`composer-matrix.mjs`，注入「思考强度 + token 状态行」做压力测试）

| Hub 宽                 | composer 宽 | 工具条高 | `.agent-toolbar-controls` | 溢出/裁切 |
| ---------------------- | ----------- | -------- | ------------------------- | --------- |
| 1148（本机浏览器上限） | 768         | 40px     | `650 / 650`               | 无        |
| 1000                   | 711         | 37px     | `598 / 598`               | 无        |
| 900                    | 623         | 37px     | `510 / 510`               | 无        |
| 800                    | 527         | 37px     | `447 / 447`               | 无        |
| 740                    | 707         | 37px     | `594 / 594`               | 无        |
| 660                    | 639         | 37px     | `526 / 526`               | 无        |
| 600                    | 579         | 37px     | `499 / 499`               | 无        |
| 560（最小）            | 543         | 37px     | `463 / 463`               | 无        |

- `scrollWidth === clientWidth`、`overflow-x: visible`、`clipped = []`，**所有宽度零溢出**；
- 工具条高 37–40px（两行会是 ~72px）→ 确认**始终单行**，未使用换行兜底；
- 模型（microchip）、思考等级、`+`、发送/停止在全部宽度均可见可点；
- 环境 / SSH 在 compact 后仍保留入口（图标 + 短标签）；
- `+` 实测 `aria-label = 文件（0）`、28×28，打开的是原附件面板（搜索/上传齐全）；
- 截图：`/tmp/shots/composer-w1148.png`、`/tmp/shots/composer-w560.png`、`/tmp/shots/attach-panel.png`。

### 静态检查

- `vue-tsc --noEmit`：通过
- `eslint`（4 个改动文件）：通过
- `prettier --check`：通过
- `composer-repro2.mjs` 改后：`550 / 550`，注入的「思考强度」可见宽度 60/60（改前 21/60）

### 遗留子项（同一问题内的反馈）：空态模型项 hover 无边界

| 项   | 内容                                                                 |
| ---- | -------------------------------------------------------------------- |
| 状态 | **已修复 2026-09-22（用户选定方案 A）**                              |
| 位置 | `host/AgentAppSurface.vue` 配置行首项「尚未配置模型」（1600 行附近） |

**已修部分（待人工确认）**：「尚未配置模型」字底被裁。根因是 `.agent-config-summary` 的 scoped 规则 `line-height: 1` 压过 Tailwind `leading-*`，叠加文本 span 的 `truncate`（`overflow: hidden`）→ 行框 11px、内容 13px，被裁 2px。已改为 `line-height: 1.3`。

实测（CDP，用户浏览器 dpr 1.5，原生像素放大 8×）：

| 宽度档                    | font-size / line-height | 行框  | 字墨下沿 | 裁切 |
| ------------------------- | ----------------------- | ----- | -------- | ---- |
| hub 1148（composer 768）  | 11px / 14.3px           | 14.3  | 12.65    | 无   |
| hub 760（composer 727）   | 10.5px / 13.125px       | 13.13 | 11.56    | 无   |
| hub 640（compact 图标态） | 10px / 12.5px           | —     | —        | 无   |

**已修部分（方案 A）**：hover 无边界。实测改前 `hover-border-color: rgba(0,0,0,0)`、`hover-background: rgba(0,0,0,0)`、`cursor: auto`；相邻的「执行」hover 是 `border/50 + header/70 + 文字加深`。空态项是 `<div>`，类名里只有 `border-transparent`，没有 hover 规则，属于本次改造引入的视觉落差。已补 `transition-colors duration-150 hover:border-border/50 hover:bg-header/70 hover:text-foreground`，「运行中锁定模型」项同步对齐；仍是不可点击（无 `cursor: pointer` / `tabindex` / 点击）；顺带删掉该锁定项上已失效的 `leading-[1.25]`（被 scoped 规则的 `line-height: 1.3` 压制，留着是陷阱）。

改后实测（hub 1148 / composer 768，鼠标悬停空态项）：`border: oklab(0.845 0 0 / 0.5)`、`bg: oklab(0.955 0 0 / 0.7)`、`color: rgb(51,51,51)`、`cursor: auto` —— 与邻居 hover 值逐项一致；`transition` 生效。截图 `/tmp/shots/fix-hover-empty.png`（4× 放大 `/tmp/shots/fix-hover-4x.png`）。

**候选方案**：

- **A（推荐）**：给空态项补与邻居一致的 hover 反馈（`hover:border-border/50 hover:bg-header/70 hover:text-foreground` + `transition-colors duration-150`），保持非交互（不加 `cursor: pointer` / `tabindex` / 点击）；同槽位的「运行中锁定模型」项一并对齐。
- ~~**B**：改成真交互入口（可点 → 打开模型 Provider 设置）。需新增 composer → 设置页通路，且会离开/遮挡当前 Agent 窗口。~~
- ~~**C**：不加 hover，改为常驻淡边界（`border-border/40`），明确它是状态徽章而非控件。~~

### 遗留子项 2（同一问题内的反馈）：窄模式下「运行环境」小圆点不居中

| 项   | 内容                                                                              |
| ---- | --------------------------------------------------------------------------------- |
| 状态 | **已修复 2026-09-22**                                                             |
| 位置 | `host/AgentAppSurface.vue` 配置行「运行环境」触发项 + `agent-composer` 紧凑档规则 |

实测（CDP，hub 640 / composer 619，即 `@container agent-composer (max-width: 620px)` 档）：

| 触发项           | 内容宽  | chip 宽 | 内容中心 − chip 中心 |
| ---------------- | ------- | ------- | -------------------- |
| 模型（图标态）   | 11.3px  | 25px    | −0.21px              |
| 执行（图标态）   | 11.3px  | 25px    | −0.21px              |
| 全授权（图标态） | 11.3px  | 25px    | −0.21px              |
| **运行环境**     | **6px** | 25px    | **−2.83px**          |
| SSH（带短标签）  | 43.8px  | 57.2px  | 0                    |

根因：紧凑档把 `.agent-config-verbose` / `.agent-config-affordance` 全部 `display: none`，chip 只剩内容项，但 chip 仍是 `min-width: 25px` + `padding-inline: 6px` + `justify-content: normal`（= flex-start）。11.3px 的图标刚好填满 13px 内容盒，所以看着居中；6px 的圆点则贴在左内边距上 → 左偏 2.83px（垂直方向 `dy = 0`，正常）。

**实施**：在 `@container agent-composer (max-width: 620px)` 的 `:deep(.agent-config-summary)` 里加一行 `justify-content: center;`。

> 注：一开始同时写了 `padding-inline: 0`，但实测发现只加 `justify-content: center` 就能精确居中（内容盒在 chip 内左右对称，内容在内容盒内居中 ⇒ 内容中心 = chip 中心），而保留原 `padding-inline: 6px` 可避免顺带改窄本档仍显示文字的 chip（SSH 57.2px、思考强度），故最终**只加 `justify-content`**。

改后实测（padding 保持 `0px 6px`，chip 宽度与改前完全一致）：

| 档位                    | 运行环境圆点 内容中心 − chip 中心 | 图标态 | SSH（带短标签） |
| ----------------------- | --------------------------------- | ------ | --------------- |
| hub 640（composer 619） | **0**（改前 −2.83）               | 0      | 0               |
| hub 560（composer 543） | **0**                             | 0      | 0               |

截图 `/tmp/shots/center-640.png`、`/tmp/shots/center-560.png`（5× 放大 `/tmp/shots/center-560-5x.png`）。回归：`composer-matrix.mjs` 八档全部零溢出、工具条仍单行、`+` 仍 28×28；`vue-tsc` / `eslint` / `prettier` 均通过。

---

## ✅ 已解决：Agent Hub 右下角缩放手柄（最终：加粗圆弧 + 无 hover 高亮）与按钮 cursor 失效

| 项   | 内容                                                                                    |
| ---- | --------------------------------------------------------------------------------------- |
| 级别 | P2（用户实测反馈：原提示「不好看」）                                                    |
| 状态 | **已解决 2026-09-22（先按方案 A 改成加粗圆弧，用户看完后要求去掉圆弧 → 最终不带图形）** |
| 位置 | `features/agent/host/AgentHubWindow.vue:588-593`                                        |

### 问题

右下角拖拽缩放手柄原来是一个 16×16 小盒：`bg-header/60` + 0.67px 的顶/左边（`border-border/40`）+ `rounded-tl-md rounded-br-2xl`，里面塞 3 个 `r=0.8` 的小圆点（8×8 viewBox，`text-text-secondary/50`）。整体读起来像一块浅色"药丸"，点又小又灰，既是唯一的缩放提示又几乎看不出是把手。

### 关键事实（用户问「是基础样式还是单独样式」）

- **纯一次性样式**：class 全内联在这一个 `<button>` 上，图形是内联 SVG；全项目**没有**共用的 resize-handle 组件或 CSS 类。
- **行为层也是手写的**：`AgentHubWindow.vue:162 handleResizePointerDown` + `host/window-manager.ts`，**未使用**公共的 `foundation/interaction/useResizeHandle.ts`（该 composable 只有行为、无样式）。
- 项目另有 4 处右下角把手，风格各不相同（`WorkspaceSessionSurface.vue:1420`、`:1472`、`RemoteDesktopModal.vue:802`、`ProgressCenter.vue:610`、`QuickCommandForm.vue:388`）→ 本次**只改 Agent Hub**，其余不受影响；若要统一需另立一条（抽公共把手）。

### 实施（方案 A：透明底 + 加粗圆弧）

- 去掉盒子描边与浅色底：`border-l border-t border-border/40 bg-header/60` → 删除；`transition-all` → `transition-colors`。
- 图形换成单个加粗圆弧：`svg.h-3.w-3 viewBox="0 0 12 12" fill="none"` + `<path d="M10.4 1.6A8.8 8.8 0 0 1 1.6 10.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />`（圆心贴右下角，半径 8.8，圆头）。
- 颜色：静默 `text-text-secondary/50` → `/70`；hover 保留圆角填充 `hover:bg-foreground/10`（沿用本文件 448 行关窗按钮的写法）+ `hover:text-foreground`。

### 中间态（方案 A 实测，已被下一步取代）

| 项       | 结果                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 静默态   | `background: rgba(0,0,0,0)`、`border-width: 0px`、`border-radius: 6px/16px`（与窗口 `rounded-2xl` 同角） |
| 图形     | `svg` 12×12、`stroke-width 1.9`、`stroke-linecap round`、旧 `circle` 数量 0                              |
| hover    | `background: foreground/10`、`color: foreground`                                                         |
| 拖拽回归 | 手柄拖动仍生效：hub 1148 → 1268（宽）                                                                    |

截图：`/tmp/shots/resize-after-rest.png`、`/tmp/shots/resize-after-hover.png`；对照用四方案预览图 `/tmp/shots/resize-preview.png`。

### 最终形态（留加粗圆弧，去掉 hover 高亮圆饼）

用户中途先说「去掉那个 1/4 圆的提示」（先按"去掉圆弧"实施），随即澄清「不是那个弧形的 1/4 圆弧，而是放上去高亮的 1/4 圆饼」，最后要求「加圆弧 不要圆饼」。故最终只保留圆弧，去掉 hover 填充：

- 保留内联圆弧：`svg.h-3.w-3 viewBox="0 0 12 12" fill="none"` + `<path d="M10.4 1.6A8.8 8.8 0 0 1 1.6 10.4" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />`；button 恢复 `flex items-end justify-end p-0.5 text-text-secondary/70`。
- 去掉 hover 高亮：删掉 `hover:bg-foreground/10` 与 `transition-colors`；同时不再需要 `hover:text-foreground`（圆弧颜色保持不变）。

最终 class：`absolute bottom-0 right-0 z-40 flex h-4 w-4 touch-none select-none cursor-nwse-resize items-end justify-end rounded-tl-md rounded-br-2xl p-0.5 text-text-secondary/70 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border`

实测：

| 项       | 结果                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 静默态   | `background: rgba(0,0,0,0)`、`border-width: 0px`、`color: text-secondary/70`、无外框                          |
| 圆弧     | 12×12、`M10.4 1.6A8.8 8.8 0 0 1 1.6 10.4`、`stroke-width 1.9`、`linecap round`                                |
| 悬停     | 与静默**逐项相同**：`bg rgba(0,0,0,0)`、`color` 不变、`box-shadow: none`、`outline: none` —— 高亮圆饼已不存在 |
| 键盘焦点 | 保留 `focus-visible` ring（该按钮无其它视觉反馈）                                                             |
| 拖拽回归 | hub 1126 → 1036（宽）仍生效                                                                                   |

截图：静默 `/tmp/shots/resize-arc-rest.png`、悬停 `/tmp/shots/resize-arc-hover.png`（12× 放大同名前缀）。静态检查：`eslint` / `prettier` 通过。

### ✅ 已修复（用户选定方案 A）：`<button>` 上的 `cursor-*` utility 被无层规则整个压掉

发现经过：把圆弧换成"只剩圆弧"的版本时，这一角唯一的提示就是鼠标光标，但实测 `getComputedStyle` 得到 `cursor: pointer` 而非 `nwse-resize`。CSSOM 取证：

- `.cursor-nwse-resize { cursor: nwse-resize }` 确实存在，但位于 `@layer utilities`；
- `packages/frontend/src/app/styles/global.css` 里 `button:not(:disabled) { cursor: pointer; }` 当时是**无层（unlayered）**规则 → 无层压过一切 layer，任何 `cursor-*` utility 在按钮上永远赢不了（与 §7.10 的字体重置同一类陷阱）。

**影响面**（脚本扫描全项目 `<button>` 上的 cursor utility）：**11 个按钮**失效 —— 4 个缩放手柄（`AgentHubWindow.vue:587`、`WorkspaceSessionSurface.vue:1418` / `:1470`、`RemoteDesktopModal.vue:798`）本该显示 `nwse-resize`，7 个拖拽把手（`TaskRail.vue` 六个 + `RemoteDesktopModal.vue:543`）本该显示 `grab`，实测全是手型。`disabled:cursor-*` 前缀的 11 处不受影响（`:not(:disabled)` 不匹配禁用按钮）；`cursor-pointer` 本就等于默认值，无感。

**实施**：把该规则移入 `global.css` 顶部已有的 `@layer base { … }`，并加注释说明"必须留在 layer 内"（本会话早先 `button { font: inherit }` 就是这么修的）。

**验收**：

| 检查项                     | 结果                                                                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 缩放手柄（hover 时）       | `cursor: nwse-resize`（改前 `pointer`）；命中规则 `@layer utilities` 的 `.cursor-nwse-resize` + `@layer base` 的 `button:not(:disabled)` |
| 普通按钮（无 cursor 类）   | 仍是 `pointer`（`执行模式` 触发项、hub 内其它按钮实测）                                                                                  |
| 当前视图 32 个按钮全量扫描 | `pointer 30 / not-allowed 1 / nwse-resize 1`，无「写了 utility 却被压掉」的残留                                                          |
| 静态检查                   | `prettier` 通过                                                                                                                          |

### ⚠️ 同类陷阱仍在（未改，待用户决定）：`placeholder:text-*` 全项目失效

`global.css` 里 `input::placeholder, textarea::placeholder { color: var(--input-placeholder-color); opacity: 1 }` 同样是**无层**规则，压掉 `@layer utilities` 里的 `placeholder:text-*`。实测 composer 输入框（类名含 `placeholder:text-text-secondary/50`）的 `::placeholder` 计算色为 `rgb(102,102,102)`（= 不透明的 `--input-placeholder-color: #666666`），而不是预期的 `text-secondary/50`。全项目有 20+ 处 `placeholder:text-*`（`AgentConversation.vue:763`、`AgentThreadSidebar.vue:242`、`QuantityInput.vue:165`、设置区多处）因而不生效。

修法与本次一致：把这两条挪进 `@layer base`。但这会让所有输入框的占位符颜色立刻变成各组件声明的值（当前是统一的 `#666666`），属于**全应用可见变化**，需要单独确认后再动。
