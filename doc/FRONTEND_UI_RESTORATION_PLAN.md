# Frontend UI Restoration Plan

> 模块化接续计划，更新于 2026-09-05。目标：**完整保留用户功能，完整还原旧 UI 的视觉与交互，并全部落在已经重构的新架构上。**
>
> 本版替代原 P0–P10 顺序执行计划。历史已完成成果不重做；P0–P8 验证证据保存在附录 C，98 个旧 Vue 文件的映射保存在附录 A。后续模型按模块任务 ID 执行，不按旧目录重新搭建应用。

## 0. 接手入口与真实进度

### 0.1 先读这些约束

- 旧 UI 主基线：Git `8ceb5840` 的 `packages/frontend/src`，包括 template、scoped style、全局样式、图标、可见状态和真实入口；旧截图辅助基线：`8ad24a03:doc/imgs/e2e`。
- 新架构目标：[Frontend architecture](architecture/FRONTEND.md)；功能要求：[软件需求目录](software-requirements/README.md)。工程强制规则以 [engineering-constraints.md](software-requirements/engineering-constraints.md) 为准，重点参考 EC-FE-001/002、EC-LEGACY-006、EC-E2E-001/002/004、EC-DOC-004。
- 不通过恢复旧 `components/`、`stores/`、全局 event bus、旧协议 mapper 或兼容 facade 来实现还原。旧代码是视觉和用户行为证据，不是迁移模板。
- 已有功能、当前 SRS 要求与旧截图不同，不能为截图相似而删除功能；先确定需求来源，再在旧视觉语言下整合。真正冲突交由 owner 决策并记录。

### 0.2 当前代码与证据

| 项目                      | 已确认状态                                                                        | 接手注意                                                       |
| ------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| P0–P8 历史实现            | ✅ 已完成；对应模块的已实现子任务继承此结论，详见附录 C.1                         | 不因为本版重新分类就重做；只有新的具体回归证据才重开相关子任务 |
| P9-A 移动预览壳、连接弹窗 | ✅ 本地实现与指定流程验证完成，详见附录 C.2                                       | 仍在工作树；新产品状态尚无最终 canonical 结果                  |
| P9-B 移动批量选择         | ✅ 本地修复与持久 E2E 完成，详见附录 C.3                                          | 保留四按钮事件边界、批量模式点击穿透及新增窄屏 case            |
| Markdown 横屏尺寸争议     | ✅ 已诊断：旧新均为 32px，独立编辑保存流程通过                                    | 不再为临时复用的竖屏 40px 断言修改旧视觉；原断言也未被弱化     |
| 98 行移动追溯             | 历史分布为 70 项源码审计、8 项浏览器验证、20 项待审；后续证据见附录 A 与 C.7–C.12 | 历史分布不是当前完成数或 UI 还原率；以模块任务和逐行证据为准   |
| 13 个移动截图检查点       | `/tmp/nexus-p9-mobile-complete` 有产物，但完整 run 结论及逐图复核尚未交付         | 先恢复证据，无法确认再重跑；不能从 PNG 存在推断测试全绿        |
| 全部 28 图及最终全量验收  | ⏳ 待完成                                                                         | 由 M17 汇总，不能由历史阶段或局部截图代替                      |

**逐模块执行进度（2026-09-06 当前工作树）**：`16 / 18` 个正式模块已完成本地 F/V/A 闭环：**M00 App shell / Foundation / feedback、M02 Dashboard、M03 Connections、M04 SSH keys / Tags / Proxies、M05 Settings / Security / Backup / About、M06 Appearance / Themes / Background / PWA、M07 Notifications / Audit、M08 Workspace / pane / layout / session orchestration、M09 Quick Commands / History / Command Bar、M10 Terminal / Search / Mobile keyboard、M11 Filesystem / catalog / history / context、M12 Editor / Monaco / CodeMirror、M13 Preview providers / shell、M14 Transfers / Archive / Progress、M15 Status / Charts / Docker、M16 Remote Desktop / VNC / SSH suspend**。这里的“模块完成”表示该模块自身适用子任务均已闭环；项目最终完成仍必须经过 M17 的最终产品 SHA/canonical/28 图验收。下一步进入其余未闭合模块的逐项收口，最终由 **M17** 对最终产品 SHA/canonical/28 图统一复核。

当前工作分支历史接续点为 `test/agent-runtime-foundation`，P8 产品锚点 `4e93b1ad`，此前本地 HEAD 为 `d0c4cdb1`。实际接手时先执行 `git status --short`、`git log -5 --oneline`，以当前仓库为准。以下是本版编写时的未提交改动，不得覆盖：

- `doc/FRONTEND_UI_RESTORATION_PLAN.md`
- `packages/frontend/src/features/connections/components/ConnectionEditorModal.vue`
- `packages/frontend/src/features/connections/components/BatchEditConnectionModal.vue`
- `packages/frontend/src/features/connections/views/ConnectionsView.vue`
- `packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`
- `test/e2e/tests/ui/batch-connection-edit.spec.ts`
- `test/e2e/tests/ui/connection-create.spec.ts`
- `test/e2e/tests/ui/ssh-key-management.spec.ts`
- `packages/frontend/src/app/pages/dashboard/DashboardPage.vue`
- `test/e2e/tests/mobile/dashboard-mobile.spec.ts`
- `test/e2e/tests/ui/dashboard-workflows.spec.ts`
- `packages/frontend/src/features/ssh-keys/components/SshKeyManagementModal.vue`
- `packages/frontend/src/features/ssh-keys/components/SshKeySelector.vue`
- `packages/frontend/src/features/tags/components/ConnectionTagPicker.vue`
- `packages/frontend/src/features/proxies/views/ProxiesView.vue`
- `packages/frontend/src/runtimes/workspace/components/WorkspaceTagGroupManager.vue`
- `test/e2e/tests/ui/proxy-management.spec.ts`
- `test/e2e/tests/ssh/connection-list-search.spec.ts`
- `packages/frontend/src/features/appearance/components/AppearanceCustomizerModal.vue`
- `packages/frontend/src/features/appearance/components/BasicAppearancePanel.vue`
- `packages/frontend/src/features/appearance/components/TerminalBackgroundSettingsPanel.vue`
- `packages/backend/src/modules/appearance/appearance-settings.service.ts`
- `test/e2e/tests/ui/theme-switching.spec.ts`
- `test/e2e/playwright.config.ts`
- `test/e2e/support/test-remote-gateway-server.mjs`
- `test/e2e/tests/mobile/suspend-resume-ui.spec.ts`
- `test/e2e/tests/mobile/touch-workflows.spec.ts`
- `test/e2e/tests/ui/rdp-remoteapp-fullscreen.spec.ts`

该清单仅是保护快照，不是允许修改范围；执行者必须重新读取完整 `git status`/相关 diff，并记录非本任务 dirty 文件校验值，结束后确认未被覆盖。

前一轮子代理因使用额度限制中断。该事实只说明未交付部分需要继续，不代表产品、测试或架构失败。当前按用户最新要求先完成 §5.5 的 fresh-reader planning 与 Luna max 小功能 execution trial，再接续其余模块；历史模块闭环不因此重开。每完成一个模块都要回写本节计数、模块表、真实命令/case数及注意事项。

本轮已执行 `git fetch origin` 与 `git merge --ff-only @{upstream}`：远端分支为 `d0c4cdb1`，本地 HEAD 为 `c67c2c70`，ahead/behind 为 `2/0`，无可合入新提交。该结果是本轮同步快照，后续仍需重新确认；不 reset、不覆盖上述工作树，也不自动 commit/push。

## 1. 完成定义：功能、UI、架构分别验收

### 1.1 子任务状态

| 状态                   | 含义                                         | 允许接手模型做什么                             |
| ---------------------- | -------------------------------------------- | ---------------------------------------------- |
| ✅ 已完成〔C.1/Pn〕    | 继承历史实现、审查及该版本 canonical 证据    | 保留成果；做当前模块集成复核，不重写已有功能   |
| ✅ 本地完成〔C.2/C.3〕 | 改动已落盘且指定本地验证通过，远程验收未结束 | 保留改动，补最终集成证据；不可宣称模块整体关闭 |
| ◐ 部分完成             | 有源码审计或部分状态的浏览器/截图证据        | 只补明确缺失状态或验收，不重复已证实部分       |
| ⏳ 待完成              | 尚无足够证据或尚未实现                       | 按任务要求分析、实施、验证                     |
| 不适用（原因）         | 基线无可达入口或确属桌面专用                 | 保留 usage/入口证据，不为凑清单新增页面        |

模块内“实现已完成”和“最终验收待完成”可以同时成立。不能把完成的实现改标待开发，也不能把源码已审标成模块已完成。以下所有模块的最终关闭均依赖其验收子任务和 M17。

### 1.2 每个模块的三项验收

| 维度          | 必须证明的内容                                                                                   | 不能替代它的证据                             |
| ------------- | ------------------------------------------------------------------------------------------------ | -------------------------------------------- |
| F：功能完整性 | 需求对应操作可达；成功/失败/取消/重试、数据持久化与跨表面状态一致；桌面/触控不误触其他操作       | 静态类名一致、只有页面能打开、调用了内部实现 |
| V：UI 还原性  | 同状态下结构、密度、尺寸、字体、主题、图标、边框、滚动归属、弹层、响应式与基线一致；例外有依据   | E2E 全绿、源码看起来相似、单一总像素差异阈值 |
| A：架构一致性 | 状态/协议/生命周期仍单一归属；跨 feature 经 public/port；无旧架构复活、重复 controller、反向依赖 | 仅目录名正确或 architecture 脚本通过         |

每次回报明确 `F / V / A` 分别通过、部分通过或待验证，并绑定产品 SHA 或工作树文件及 diff、命令、视口、证据位置。代码变更后，只使受影响的证据失效，不机械重跑所有历史工作。

## 2. 新架构实施边界与差异处理

### 2.1 归属规则

| 当前层                | 本任务中的职责                                         | 不应为了还原放入的内容                                          |
| --------------------- | ------------------------------------------------------ | --------------------------------------------------------------- |
| `app/`                | 启动、路由、全局 shell、跨域页面组合                   | 新的领域 store、socket/session 生命周期                         |
| `foundation/`         | 无业务语义的控件、弹层、触控/拖动/resize 原语          | Connections/Preview 等业务分支、产品持久化 key、feature imports |
| `shared/`             | 通用 feedback/focus 等应用组合                         | 跨模块共享的业务大 store 或全局事件总线                         |
| `features/<name>/`    | 领域模型、API/store/controller、展示和 capability/port | 对 App/Workspace/Agent 的反向依赖；其他 feature 私有路径        |
| `runtimes/workspace/` | live session、adapter 绑定、布局/弹层组合、操作路由    | 重新实现 filesystem/editor/transfers 的领域状态                 |
| `runtimes/agent/`     | 独立 runtime 边界                                      | 从 Workspace 引入 live session/socket；本计划不扩建 Agent 功能  |
| `client/`             | 纯 HTTP/WebSocket 传输能力                             | 路由、toast、产品 store 或旧 wire DTO 渗入 UI                   |

先判断缺的是样式、局部交互，还是公开能力。样式优先改当前组件；局部交互使用当前 props/emits/controller；确实缺少能力时先给出 feature/port 的归属设计，再实施，不能把旧 composable 整包搬过来。

### 2.2 差异分类

1. **迁移造成的视觉/交互差异**：给出旧新证据，修当前 owner。
2. **当前要求新增的能力**：保留能力，以旧尺寸/颜色/图标等视觉语言适配。例：Clone 不得因旧页只有三动作而删掉。
3. **基线原有问题或验证前提不一致**：单独诊断，不自动变成还原任务。例：横屏 Markdown 32px 与旧版一致。
4. **需求与旧 UI 真正冲突**：记录旧行为、现 SRS/EC ID、可选方案及影响，由 owner 决策；不擅自 redesign。
5. **旧文件无活跃入口**：记录使用核查结果。Tags 独立页、死 PaneTitleBar 不因文件存在而新增。

共同原因优先修复，但 product 特定尺寸不要下沉为全局 CSS 特例。禁止 PNG 替换、截图专用 DOM、内部测试 oracle 和仅为测试通过弱化断言。

## 3. 模块总览与执行顺序

模块是当前用户表面/能力组合；附录 A 的旧文件只是追溯，不是实施目录。新 owner 一对多或多对一时，只指定一个主任务修改共享原因。

| 模块 | 范围                                      | 已实现证据              | 当前未完成重点                                                                                   |
| ---- | ----------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------ |
| M00  | 应用 shell、全局视觉、Foundation/feedback | ✅ 本地闭环〔C.55〕      | 仅待 M17 最终 canonical                                                               |
| M01  | 登录、初始化、认证入口                    | ✅ P3                   | 各认证状态的窄屏可达性与视觉                                                                     |
| M02  | Dashboard                                 | ✅ P3                   | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M03  | Connections                               | ✅ P3 + 本地 P9-A/B     | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M04  | SSH keys、Tags、Proxies                   | ✅ P3/P4                | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M05  | Settings、安全设置、备份、About           | ✅ P3                   | 七 tab 全状态/滚动/保存验证                                                                      |
| M06  | Appearance、主题、背景、PWA               | ✅ P2/P3                | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M07  | Notifications、Audit                      | ✅ P3                   | provider/日志状态的移动视觉验收                                                                  |
| M08  | Workspace 编排、pane、tab、布局           | ✅ 本地闭环〔C.58〕      | layout/locked/focus、sidebar/archive/wheel、窗口高度/虚拟键盘与 mobile Workspace 均有当前 SHA 证据；最终 canonical 仍归 M17 |
| M09  | Quick Commands、History、命令栏           | ✅ P4/P5                | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M10  | Terminal、搜索、虚拟键盘                  | ✅ 本地模块闭环〔C.52〕 | 仅待 M17 最终 SHA/canonical/28 图统一复核                                                        |
| M11  | Filesystem、catalog、history、context     | ✅ 本地闭环〔C.56〕      | 仅待 M17 最终 canonical                                                               |
| M12  | Editor、Monaco、CodeMirror                | ✅ 本地模块闭环〔C.53〕 | 仅待 M17 最终 SHA/canonical/28 图统一复核                                                        |
| M13  | Preview 全部 provider 与外壳              | ✅ 本地模块闭环〔C.51〕 | 仅待 M17 最终 SHA/canonical/28 图统一复核                                                        |
| M14  | Transfers、archive、Progress              | ✅ P7                   | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M15  | Status/Charts、Docker                     | ✅ P8                   | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M16  | Remote Desktop/VNC、SSH suspend           | ✅ P8                   | ✅ 本地模块闭环；仅待 M17 最终 canonical                                                         |
| M17  | 跨模块验收、截图、canonical               | ◐ 历史/局部通过         | 当前产品最终验证与全部 28 图                                                                     |

**建议接续顺序**：先收口 M08 的布局/叠层依赖并复跑 M11 文件操作，再处理 M12 编辑生命周期、M10 终端边界、M00/M01 剩余认证与 shell 状态，最后由 M17 冻结最终 SHA 并全量关闭。M02/M03/M04/M06/M09/M13/M14/M15/M16 已本地闭环，不沿用旧调查或“剩余行数”清单重复开发；仅具体回归证据可重开。

可并行分工：管理模块 M01–M07、Workspace/terminal M08–M10、文件链 M11–M14、辅助模块 M15–M16。`WorkspaceSessionSurface.vue`、Foundation、全局样式和本进度文档分别指定唯一编辑者；跨组变更先协调，不能两个模型同时重写同一文件。

## 4. 模块任务清单

下面路径除另有说明均相对 `packages/frontend/src/`；E2E 路径相对 `test/e2e/tests/`。要求“验收”表示补证据及修复确认问题，不意味着该功能未实现。每个模块执行前同时读取所列 SRS 和附录 A 对应旧文件。

### M00 — 应用 shell、全局视觉、通用控件与反馈

**Owner**：`app/App.vue`、`app/main.ts`、`app/shell/AppHeader.vue`、`app/styles/`、`foundation/ui/`、`shared/feedback/`。基线：App/main/style、OverlayPanel、Alert/Confirm、UINotificationDisplay。需求：[architecture](software-requirements/requirements/architecture.md)、[audit-feedback](software-requirements/requirements/audit-feedback.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                     |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M00.01 | ✅ 已完成〔C.1/P1〕 | 恢复全局 FontAwesome、header/nav/logo、背景/边框/输入焦点禁用态、基础页面几何和 terminal fallback；保留 app bootstrap                                                    |
| M00.02 | ✅ 已完成〔C.1/P2〕 | 恢复 alert/confirm/toast 位置、尺寸、图标、时序和 overlay；feedback 状态留在 shared owner                                                                                |
| M00.03 | ✅ 本地完成〔C.55〕  | tokens/default theme、CSS/资产加载、图片 intrinsic size、favicon/PWA 与附录 D 非 Vue 入口均已按当前 owner 复核；无待修复产品差异                               |
| M00.04 | ✅ 本地完成〔C.55〕  | 320/375/桌面 header/nav、输入/菜单/dialog/footer、长消息、嵌套 overlay、Escape/backdrop/focus 恢复均有当前工作树浏览器证据；最终 canonical 归 M17 |

**验收/架构**：公共原语仍无产品状态；共用改动验证所有受影响模块，不只打开单个弹窗。复用 `ui/protected-navigation.spec.ts`、`ui/dashboard-workflows.spec.ts`、`mobile/dashboard-mobile.spec.ts` 和自然 dialog/feedback 场景；截图归 `dashboard-home.png` 等现有检查点。

### M01 — 登录、初始化、认证入口

**Owner**：`features/auth/`、`app/pages/login/` 和 app 路由组合。基线 Login/Setup。需求：[identity-security](software-requirements/requirements/identity-security.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                  |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| M01.01 | ✅ 已完成〔C.1/P3〕 | 双栏品牌/表单、setup/login card、移动品牌隐藏断点和加载/错误外观                                                      |
| M01.02 | ◐ 部分完成          | 真实初始设置→登录→受保护页面→退出/失效流程，覆盖密码、2FA、CAPTCHA、passkey 可用/失败分支；当前功能不因隐藏控件而丢失 |
| M01.03 | ◐ 部分完成〔C.13〕  | ✅ M01.03-a普通密码失败→同页重试、三个viewport错误间距已本地验收；真实软键盘、其他认证状态、完整表单/语言对照仍待验   |

**验收/架构**：认证 session 仍由 auth 管理，client 不新增 router/toast/store 依赖。复用 `auth/setup-login.spec.ts`、`ui/session-lifecycle.spec.ts`、`http/auth-api.spec.ts`、`http/auth-2fa.spec.ts`、`ui/protected-navigation.spec.ts`；无旧截图的状态用旧源码和真实浏览器证据，不强行添加截图专用测试。

**M01.03 小功能试验的固定切片与验收契约**：

- `M01.03-a`：普通密码登录失败提示→同页正确密码重试，包含桌面1280×800和窄屏320×667、375×812；这三个viewport是同一切片的矩阵，不拆成三个开发任务。真实软键盘、其他认证机制及多语言扩展另列后续任务，不用缩短viewport冒充真实键盘弹出。此切片通过仍不能关闭M01.03或M01。
- 前提固定为seed管理员、setup完成、未认证、2FA/CAPTCHA/passkey关闭，en-US可见label、默认theme；同时记录实际背景/文字色，不能只写“light/default”。错误文本沿用真实后端message（可能为中文），不把英文label与中文服务器错误混排误判为本切片本地化回归；不改后端文案/翻译策略。跨语言UI由另一个任务固定相应前提再验。
- F：同一page/context首次真实POST login返回401，停留`/login`、非空alert、GET auth/status仍401，username/password/submit恢复可操作；只修正密码、不reload、不再次page.goto、不API登录，第二次POST200，到Dashboard且GET auth/status200/user正确，登录错误不残留。Remember Me和安全分支保留。可用真实公开API准备fixture，但被测两次登录必须从UI提交。
- V：每个viewport保存失败状态截图、字段/rememberMe/alert/submit与最近裁切祖先的bbox、可见文字与overflow；检查文字区域非零、没有重叠/横向裁切、提交可真实点击，纵向超出允许自然页面滚动到达。另对照旧LoginView中错误的结构、字号、颜色、对齐、上下间距；比较浏览器实际computed style，不能只对照class字符串或把“能点”当“还原”。无旧运行图时明确“旧源码推导+当前截图”，不声称旧新像素一致。若CSS层叠使间距结论不明，保留该项待验，不猜测旧像素值。
- A/修改边界：产品仅允许`packages/frontend/src/features/auth/views/LoginView.vue`中有证据的展示修复；优先扩展`test/e2e/tests/ui/session-lifecycle.spec.ts`现有invalid-password case，禁止创建并行测试体系、改全局样式/旧store/transport或重写认证控制器。M01.01是继承基线，不是禁止修复具体回归；发现错误间距差异可在M01.03记录旧新证据后局部修复，其他M01.01内容不重开。若before已满足，不要求产品diff，持久E2E与真实验收也可构成有效交付。
- 执行包必须明确如何在现有ui项目跑三个viewport（如既有spec内参数化、保留原测试及另两项矩阵），每个run用独立输出目录，使用Playwright `testInfo.outputPath`和attachments保存状态/metrics，trace保留实际失败或需要复核的成功流程；不改共享playwright.config。先`--list`再定向运行本spec，结束复跑整个spec及相邻`auth/setup-login.spec.ts`。原有logout/保护路由case不得丢失。
- 如需跨owner或遇到基线本身问题，交主代理：`失败操作/真实响应与图 → 旧新归因 → 缺少能力及当前owner → 候选最小改动路径 → 受影响任务/验收 → 请求决策`。不以升级范围完成本小试验。

### M02 — Dashboard

**Owner**：`app/pages/dashboard/DashboardPage.vue`、`features/system-overview/`，组合 Connections/status capabilities。需求：[dashboard](software-requirements/requirements/dashboard.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                            |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M02.01 | ✅ 已完成〔C.1/P3〕 | 恢复顶部统计、本地资源、Quick Connect/SSH 资源并列区、最近活动和工具栏密度                                                                                                      |
| M02.02 | ✅ 本地完成〔C.7〕  | 完成旧 DashboardView→当前 DashboardPage/useSystemOverview 源码补审；恢复连接/活动初始Loading、标签专属空状态及SSH资源刷新周期badge，保留当前本地化projectName而不回退硬编码品牌 |
| M02.03 | ✅ 本地完成〔C.7〕  | 资源开/关、资源loading/error、0/多连接、真实zh-CN下360/412无横溢出且搜索/Connect可达；1440暗色中文dashboard-home与旧拓扑逐图复核通过                                            |

**验收/架构**：只组合现有 API/store，不在 dashboard 重建连接/采样状态。复用 `mobile/dashboard-mobile.spec.ts`、`ui/dashboard-workflows.spec.ts`；复核 `dashboard-home.png`。

### M03 — Connections 管理与协议表单

**Owner**：`features/connections/`；Workspace 的连接入口通过公开 capability 使用同一领域语义。需求：[connections](software-requirements/requirements/connections.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                         |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M03.01 | ✅ 已完成〔C.1/P3〕 | 旧单列连接行、搜索/排序/标签、Basic/Auth/Advanced、SSH/RDP/VNC、proxy/jump、notes、script/range 与 clone 能力保留                                                                            |
| M03.02 | ✅ 本地完成〔C.2〕  | 单连接和批量弹窗在消费者恢复 `90vh/p-6`、对应 max-width；不修改 Foundation 默认业务语义                                                                                                      |
| M03.03 | ✅ 本地完成〔C.3〕  | 恢复按钮级 stop、批量模式点击穿透；desktop/375px 选择→编辑→保存→真实 API 验证；现有 spec 新增持久窄屏 case                                                                                   |
| M03.04 | ✅ 本地完成〔C.5〕  | 320/375px 普通连接行身份区改为上方、四动作2×2；保留 Clone，1280px仍为单行。en-US/zh-CN × 320/375/1280 最终几何6/6及邻接真实E2E 3/3通过，主代理逐图复核                                       |
| M03.05 | ✅ 本地完成〔C.6〕  | 增删改克隆、test/test-all/connect、SSH key/password切换、RDP/VNC/RemoteApp、批量选择/反选/过滤/部分失败、notes和secret保留均有真实E2E/API证据；normal/batch与窄屏长内容继承M03.03/04有效证据 |

**验收/架构**：`selected/toggleSelected/batchSave` 等仍归 Connections；不复活旧 session/connection store。复用 `ui/connection-create.spec.ts`、`ui/batch-connection-edit.spec.ts`、`ui/connection-non-ssh-bulk.spec.ts`、`ssh/connection-edit-delete.spec.ts`、`ssh/connection-list-search.spec.ts`；差异与 SRS-CONN-001/009 对齐。

### M04 — SSH keys、Tags、Proxies

**Owner**：`features/ssh-keys/`、`features/tags/`、`features/proxies/`；Workspace tag assignment shell 在 `runtimes/workspace/components/WorkspaceTagGroupManager.vue`。需求：[ssh-keys](software-requirements/requirements/ssh-keys.md)、[tags](software-requirements/requirements/tags.md)、[proxies](software-requirements/requirements/proxies.md)。

| ID     | 状态                   | 子任务及具体完成条件                                                                                                                                                                                                                                                                                                                                 |
| ------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M04.01 | ✅ 已完成〔C.1/P3/P4〕 | key list/form/selector、tag chip/picker/group assignment、proxy 单列卡片及编辑表单恢复旧样式                                                                                                                                                                                                                                                         |
| M04.02 | ✅ 已完成〔C.1/P3〕    | 旧 Tags 独立 route 已停用；仅恢复可达 tag picker/group manager，禁止新增死页面                                                                                                                                                                                                                                                                       |
| M04.03 | ✅ 本地完成〔C.8〕     | 完成 SSH-key manager/selector、旧 TagInput/TagsView、ManageTagConnections、Proxy form/list/view 到当前 owner 的源码补审；确认旧 `/tags` route 本来就被停用，TokenInput 只保留通用 token 语义，tag API/assignment 仍在 feature/Workspace owner；修复 320px selector/key table、proxy card/modal、tag manager toolbar/footer 溢出与 key/proxy 失败反馈 |
| M04.04 | ✅ 本地完成〔C.8〕     | key import/create/rename/delete/select及加载/删除失败；HTTP↔SOCKS5 proxy create/edit/delete、空密码保留/替换取消clear/显式清除/删除失败；tag UI create、exact Enter、Backspace local remove、rename、filtered assign/deselect、global delete均有真实E2E/API证据，320/360长内容与弹窗无页面横溢出                                                     |

**验收/架构**：跨域仅用各 feature `public.ts`；TokenInput 无 Tag 产品 API；Workspace 只编排 assignment。复用 `ui/ssh-key-management.spec.ts`、`ui/proxy-management.spec.ts`、`http/connections-tags.spec.ts` 和 Workspace 真实 tag 操作；旧 proxy 的 350px 最小宽度须区分基线已有问题。

### M05 — Settings、安全配置、备份与 About

**Owner**：`app/pages/settings/` 组合 `features/preferences/`、`security/`、`backup/` 与 appearance 入口。需求：[preferences-settings](software-requirements/requirements/preferences-settings.md)、[identity-security](software-requirements/requirements/identity-security.md)、[backup](software-requirements/requirements/backup.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                                                                                                                                                      |
| ------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M05.01 | ✅ 已完成〔C.1/P3〕 | 七 tab：Workspace/System/Security/IP Control/Data Management/Appearance/About，默认 Workspace；旧分组/密度/卡片和 About 布局                                                                                                                                                                                                              |
| M05.02 | ✅ 已完成〔C.1/P3〕 | password/passkey/2FA/CAPTCHA、IP白黑名单、备份导入导出及轻量 Appearance 入口的旧展示                                                                                                                                                                                                                                                      |
| M05.03 | ✅ 本地完成〔C.16〕 | 完成 Workspace/System 对旧逐项 section、标题/说明/分隔、独立保存/反馈、loading/disabled 的真实还原；System/Workspace 精确 key patch 不串值。七 tab 继续横向独立滚动；320/375px 下 Workspace/Security/IP Control/Data Management/About 均无页面横溢出，Security 与 Data 长页实际截图复核通过；About 源码与旧卡片/版本状态/仓库链接拓扑一致 |
| M05.04 | ✅ 本地完成〔C.16〕 | 既有密码、2FA、CAPTCHA、IP 与加密备份证据继续有效；本轮真实重跑 System 3/3、backup/CAPTCHA/password/IP 5/5，passkey 注册/命名/reload/删除 1/1；真实 passkey 登录已走通。连接导出通过 UI 真实下载 `nexus_connections_export.zip`；dirty 登录 test 的后半段凭据丢失模拟因当前 Chromium CDP 参数不兼容而停在测试层，不计产品失败             |

**验收/架构**：SettingsPage 只组合；各 feature 保持唯一设置 owner，不汇总成旧 settings mega-store。复用 `ui/system-settings.spec.ts`、`ui/change-password.spec.ts`、`ui/captcha-settings.spec.ts`、`ui/ip-whitelist-settings.spec.ts`、`ui/ip-blacklist-settings.spec.ts`、`ui/backup-ui.spec.ts` 及相关 HTTP E2E；复核 `system-settings.png`、`security-settings.png`。

### M06 — Appearance、主题、背景与 PWA

**Owner**：`features/appearance/`，app 只负责初始化/应用；终端 preset catalog 保留当前后端归属。需求：[appearance-pwa-about](software-requirements/requirements/appearance-pwa-about.md)。

| ID     | 状态                      | 子任务及具体完成条件                                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M06.01 | ✅ 已完成〔C.1/P1/P2/P3〕 | customizer 四类tab、移动全屏/桌面侧栏、颜色/字体/终端主题/背景/other、Settings/PWA 入口恢复                                                                                                                                                                                                                                                                                                                         |
| M06.02 | ✅ 本地完成〔C.9〕        | 完成 StyleCustomizer 与 UI/Terminal/Background/Other 四 tab 到当前 Appearance owner 的源码补审；modal/footer/nav、preset list/scroll/mobile breakpoint 与旧拓扑一致。补审发现 page background 逻辑虽仍存在但当前无可达入口，并发现 customizer 内 HTML preset BaseModal 被 z-1000 外壳压住；均在 owner 内最小修复                                                                                                    |
| M06.03 | ✅ 本地完成〔C.9〕        | dark/default/custom UI、backend terminal preset、custom terminal theme CRUD/import/export/conflict、page/terminal background upload/remove、overlay、local HTML preset create/conflict/apply/rename/delete、真实GitHub remote list/search/download/apply、invalid remote repo failure/clear、terminal/editor desktop/mobile独立字体及文字效果均有真实 UI/API 持久证据；320px customizer无页面横溢出，刷新后字段保持 |
| M06.04 | ✅ 本地完成〔C.9〕        | window theme-color即时更新与刷新持久；manifest、favicon、三枚manifest icon、`/sw.js`均真实200，Service Worker从稳定`/sw.js?v=4`注册并update；precache只含现有public资源，不缓存HTML/hash bundle。terminal preset catalog继续由后端提供，前端未复制catalog                                                                                                                                                           |

**验收/架构**：customizer 的临时编辑状态不是第二个 Appearance store；不引入全局theme事件总线。复用 `ui/theme-switching.spec.ts`、`ui/custom-terminal-theme.spec.ts`、`http/terminal-themes.spec.ts`；复核 `theme-customization.png` 和 terminal受影响截图。

### M07 — Notifications 与 Audit

**Owner**：`features/notifications/`、`features/audit/`；通用 toast/dialog 归 M00。需求：[notifications](software-requirements/requirements/notifications.md)、[audit-feedback](software-requirements/requirements/audit-feedback.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                                                              |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M07.01 | ✅ 已完成〔C.1/P3〕 | notification 单列卡片/inline配置/provider字段和事件网格；audit过滤、显式查询、表格/详情/分页恢复                                                                                                                                                  |
| M07.02 | ✅ 本地完成〔C.16〕 | 320px通知长内容/编辑滚动/空错误及Audit长详情、真实分页与筛选后回到第1页/跨页保留过滤均通过；本轮 `.tmp/manual` 契约验收确认未知 action 直接回退 backend identifier，`{raw, parseError:true}` 畸形 details 仍以 raw 文本可检查，320px 无页面横溢出 |
| M07.03 | ✅ 本地完成〔C.16〕 | notification 真实增改删、启停、测试发送成功/错误、事件选择持久化及 Audit 过滤/分页/详情均通过；本轮三份既有 UI spec 合计 8/8，未知 action / 畸形 details 通过 backend→frontend 契约形态的临时浏览器验收补齐，不为该边界新增仓库测试代码           |

**验收/架构**：provider配置/查询状态留在各 owner，不为双向联动增加跨feature私有import。复用 `ui/notification-settings.spec.ts`、`ui/notification-delivery.spec.ts`、`ui/audit-log-filtering.spec.ts`；无历史截图的状态同样给可复核证据。

### M08 — Workspace shell、pane、tab、布局与 session 编排

**Owner**：`runtimes/workspace/views/`、`components/`、`layout/`、`session/`，消费各 feature public capabilities。需求：[workspace](software-requirements/requirements/workspace.md)、[mobile](software-requirements/requirements/mobile.md)。

| ID     | 状态                                     | 子任务及具体完成条件                                                                                                                                                                               |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M08.01 | ✅ 已完成〔C.1/P4〕                      | desktop sidebar/pane/tab/title/context、layout/focus配置器、no-session composition、tag assignment wrapper；死 PaneTitleBar 不新建                                                                 |
| M08.02 | ✅ 本地完成〔C.58〕                       | 当前 SHA mobile Workspace、状态监控、文件管理器、窗口高度与虚拟键盘/修饰键均通过真实 Pixel 7 流程；`mobile-workspace.png` 等截图证据已生成，最终 canonical 归 M17 |
| M08.03 | ✅ 本地完成〔C.58〕                       | 当前 SHA 的 `H` 添加、5 节点、save/reload、locked splitter、min-size/resize、focus/shortcut、archive unmount 与 immediate-close wheel 均通过独立串行 run |
| M08.04 | ✅ 本地完成〔C.58〕                       | fixed/z-[110]/max-w-[80vw] sidebar、submenu、连接编辑/标签管理 modal 叠层与 focus/shortcut 均有当前 SHA 证据；不恢复旧 store/event bus/transport |

**验收/架构**：Workspace/Agent live state隔离；runtime不复制file/editor/transfer controller。`WorkspaceSessionSurface.vue` 是M10–M14共用组合文件，由一个指定模型修改。复用 `ui/session-lifecycle.spec.ts`、`ssh/reconnect-ui.spec.ts`、`mobile/ssh-workspace.spec.ts`、`mobile/suspend-resume-ui.spec.ts`；复核 `mobile-workspace.png`。

### M09 — Quick Commands、History 与 Command Bar

**Owner**：`features/quick-commands/`、`features/command-history/` 和 Workspace command/mobile tool组合。需求：[quick-commands-history](software-requirements/requirements/quick-commands-history.md)。

| ID     | 状态                                 | 子任务及具体完成条件                                                                                                                                                                 |
| ------ | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M09.01 | ✅ 已完成〔C.1/P4/P5〕               | 旧compact/grouped列表、search/tag/edit/execute、history操作、移动quick modal和command/search模式                                                                                     |
| M09.02 | ✅ 本地完成〔C.37/C.39〕             | 源码滚动/截断/弹层、变量表单、多行值、分组上下文、hover动作与触控可达性均有当前 SHA 真实证据；移动变量/Enter/无hover/搜索流程通过，保留旧紧凑密度与滚动归属                          |
| M09.03 | ✅ 本地完成〔C.14-i/C.20/C.37/C.39〕 | 真实命令新增/搜索/执行/编辑/删除、tag/变量替换/重命名、History操作、双session Send All/无活动反馈及加载/保存/删除/建标签失败反馈均通过；Enter/Escape、空查询失焦折叠和特殊替换值保持 |

**验收/架构**：业务持久化归feature，runtime仅将execute送入现有session capability；菜单与按钮走同一执行语义。复用 `ssh/quick-command-management.spec.ts`、`ssh/quick-command-tags-variables.spec.ts`、`ssh/quick-command-collapsible-search.spec.ts`、`ssh/command-history-management.spec.ts`、`mobile/touch-workflows.spec.ts`；复核 `mobile-quick-commands.png`。

### M10 — Terminal、搜索、选择和虚拟键盘

**Owner**：`features/terminal/`；Workspace绑定TerminalChannel、修饰键与command/search展示。需求：[terminal](software-requirements/requirements/terminal.md)、[mobile](software-requirements/requirements/mobile.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                         |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| M10.01 | ✅ 已完成〔C.1/P5〕 | xterm padding/主题fallback/背景层、SearchAddon外观、选择菜单、虚拟keycap/修饰键与mobile tools旧布局                                          |
| M10.02 | ✅ 本地完成〔C.52〕 | 当前 SHA 移动普通/选中/搜索/重挂载、竖横屏与工具栏几何均有截图和 metrics；断连/重连邻接流程沿用既有真实证据，未发现 owner 回归               |
| M10.03 | ✅ 本地完成〔C.52〕 | 当前 SHA 终端输入、Ctrl+wheel `14→15` 持久化、Ctrl/Alt/Tab/Ctrl+C 编码、搜索高亮、虚拟键盘/IME 与无横溢出均有真实证据；最终 canonical 归 M17 |

**验收/架构**：SearchAddon与terminal API归feature；修饰键编码沿既有单一owner，不恢复旧event bus。复用 `ssh/terminal-ui.spec.ts`、`ssh/terminal-tools-ui.spec.ts`、`ssh/terminal-protocol.spec.ts`、`mobile/terminal-touch.spec.ts`、`mobile/touch-workflows.spec.ts`、`mobile/touch-advanced.spec.ts`；复核 `ssh-terminal.png` 及移动selection/keyboard/modifiers。

### M11 — Filesystem、文件管理与路径工具

**Owner**：`features/filesystem/`，Workspace提供adapter和popup组合。需求：[filesystem](software-requirements/requirements/filesystem.md)。

| ID     | 状态                                      | 子任务及具体完成条件                                                                                                                                                                                                                                         |
| ------ | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M11.01 | ✅ 已完成〔C.1/P6〕                       | file manager toolbar/table/row、favorite/history、context/action/popup恢复；状态仍由当前filesystem/runtime能力提供                                                                                                                                           |
| M11.02 | ✅ 本地完成〔C.56〕                        | 当前 SHA 导航/排序/长列表/路径 history、terminal path sync、context/sidebar 均有真实证据；sidebar rail 层级修复后 `sidebar-pane-fileManager` 可稳定打开/关闭                                                     |
| M11.03 | ✅ 本地完成〔C.56〕                        | 真实 SSH 导航、权限/压缩/解压/拖放/剪贴板/多选/上传/下载失败恢复与 archive progress 均有证据；共享 sidebar unmount 与 immediate-close wheel 在当前工作树最终复跑通过 |
| M11.04 | ✅ 本地完成〔C.56〕                        | mobile single-tap/long-press/multi-select 防误打开、workspace/history overlay、XLSX/DOCX 横向滚动、desktop preview scrollbar 与当前 SHA PDF 均有证据；最终 canonical 截图归 M17       |

**验收/架构**：不在UI直接调用旧SFTP transport；archive任务生命周期归M14，文件选择归M11。复用 `ssh/file-manager-navigation.spec.ts`、`ssh/file-manager-context-menu.spec.ts`、`ssh/sftp-download.spec.ts`、`mobile/touch-workflows.spec.ts`、`mobile/touch-advanced.spec.ts`；复核 mobile file-manager/context-menu。

### M12 — File Editor、Monaco、CodeMirror 与编辑弹层

**Owner**：`features/file-editor/`，`WorkspaceSessionSurface.vue` 仅管理embedded/popup外壳。需求：[file-editor](software-requirements/requirements/file-editor.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                        |
| ------ | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M12.01 | ✅ 已完成〔C.1/P6〕 | editor header/tabs、Monaco/CodeMirror内容/搜索/selection/gutter、desktop resize与mobile fullscreen外观                                                                      |
| M12.02 | ✅ 本地完成〔C.42〕 | editor 移动矩阵已按当前 owner 真实验收：`touch-advanced` 相关 9/9、`touch-workflows` 选定 3/3；完整文件的无关 M11 upload crash 已隔离重跑 1/1，不恢复旧 FileEditor store    |
| M12.03 | ✅ 本地完成〔C.53〕 | 真实 SSH/SFTP 写入失败后 Save error 保留编辑快照并可 Retry；1.5s 延迟保存在后续 dirty 编辑存在时仍提交旧快照，失败/成功截图与命令均已保留                                   |
| M12.04 | ✅ 本地完成〔C.53〕 | A→B 快速打开只保留最新文档，关闭 popup 丢弃迟到 load；既有 mobile `9/9` + touch workflow `3/3` 覆盖全屏/软键盘/长 toolbar，跨 session popup 状态沿当前 Workspace owner 保持 |

**验收/架构**：同一 FileEditorSessionController + FileDocumentPort；popup与embedded不分别维护document副本。复用 `ssh/file-preview-editor.spec.ts`、`mobile/touch-advanced.spec.ts`、`mobile/touch-workflows.spec.ts`；复核 desktop editor/mobile editor/search。

### M13 — Preview 外壳及 Image/Markdown/DOCX/PDF/XLSX

**Owner**：`features/file-preview/` 的session/source/provider/chrome；Workspace组合document popup。需求：[file-preview](software-requirements/requirements/file-preview.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                     |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M13.01 | ✅ 已完成〔C.1/P6〕 | 恢复tabs/header/refresh/close/search、各provider外观、PDF outline/page/scroll、spreadsheet pagination/sheet tabs和横滚                                                                                   |
| M13.02 | ✅ 本地完成〔C.2〕  | mobile preview恢复94dvh、四向 `max(.75rem, env(safe-area-inset-*))`；editor保持fullscreen；两个portrait预览流程2/2通过                                                                                   |
| M13.03 | ✅ 本地完成〔C.3〕  | Markdown横屏32px旧视觉保留，独立编辑保存重开1/1；不做无需求依据的coarse44改版                                                                                                                            |
| M13.04 | ✅ 本地完成〔C.42〕 | 当前 SHA provider SSH 9/9、mobile 10/10；覆盖 PDF/XLSX/DOCX/image/Markdown、refresh、close/cache、outline/zoom/pan、sheet/search/pagination 与 mobile overlay，最终图仍由 M17.05 复核                    |
| M13.05 | ✅ 本地完成〔C.51〕 | 当前 SHA 的 XLSX 末页、empty/invalid provider、unsupported fallback、mobile loading 的 Escape/X 取消均已通过真实隔离 run；PDF refresh/outline race 亦有当前 SHA 1/1 证据。最终 canonical 仍归 M17        |
| M13.06 | ✅ 本地完成〔C.51〕 | 当前 provider 证据覆盖 `412×839` loading/error 外壳；既有当前 owner 几何证据覆盖 `915×412` overlay `891×387.27`、无横溢出与四向 safe-area。实体 notch 仍为 source-verified，最终 toolbar/tabs 图审归 M17 |

**验收/架构**：FilePreviewSessionController保持单一文档状态，provider不引入Workspace/private editor store；PDF worker/SheetJS等现有能力保留。复用 `ssh/file-preview-editor.spec.ts`、`mobile/touch-advanced.spec.ts`、`ingress/pdf-worker-assets.spec.ts`；复核附录B全部preview图，不仅两张mobile图。

### M14 — 上传、传输、压缩与 Progress Center

**Owner**：`features/transfers/` 任务/展示，filesystem提供选中文件，Workspace编排跨session与shared progress入口。需求：[transfers](software-requirements/requirements/transfers.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                                                             |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M14.01 | ✅ 已完成〔C.1/P7〕 | archive/copy/upload三类进度、shared ProgressDisplay、SendFiles、Conflict和密码提示旧几何/图标/状态恢复                                                                                                                                           |
| M14.02 | ✅ 已完成〔C.1/P7〕 | 按当前 GREQ-XFER-005 保留最终task直至用户移除；不恢复旧popup自动过滤terminal任务的行为                                                                                                                                                           |
| M14.03 | ✅ 本地完成〔C.10〕 | 七个旧owner已逐项补审：ArchivePassword/ArchiveProgress/FileTransfer/FileUpload/ProgressDisplay/SendFiles/UploadConflict均映射到当前owner；任务/子任务/card、footer/actions、目的地/冲突/密码、窄容器滚动与旧拓扑一致                             |
| M14.04 | ✅ 本地完成〔C.10〕 | queued/running/success/partial/error/cancel、速率/进度、final remove、发起失败保留输入可修正后重新提交、密码错误、overwrite/skip/apply-all、跨session及Send Files多目标/method/error详情均有真实E2E/API证据；旧版/SRS无独立Retry按钮，不凭空新增 |
| M14.05 | ✅ 本地完成〔C.10〕 | 浮窗隐藏→shared progress恢复、FileManager关闭/卸载后任务不丢、取消后stale事件不复活、移动窗口resize/drag/clamp/minimize、Progress Display恢复与真实文件结果均有当前工作树证据；32轮reset/reconnect压力链通过                                     |

**验收/架构**：任务单一owner；不新增全局progress registry/event bus；密码不进持久化/日志。复用 `ssh/file-upload.spec.ts`、`ssh/cross-session-transfer.spec.ts`、现有 `ssh/progress-display-*.spec.ts`、`mobile/touch-advanced.spec.ts`；复核 upload/hidden-upload/mobile-upload 图。

### M15 — Status Monitor/Charts 与 Docker

**Owner**：`features/status-monitor/`、`features/docker/`，Workspace mobile/pane只负责shell。需求：[status-monitor](software-requirements/requirements/status-monitor.md)、[docker](software-requirements/requirements/docker.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                                                                                                                                 |
| ------ | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M15.01 | ✅ 已完成〔C.1/P8〕 | 资源card/CPU water-wave/history/chart、IP/rate、旧monitor modal；Docker桌面table/mobile cards、status/icons/details恢复                                                                                                                                                                                              |
| M15.02 | ✅ 本地完成〔C.11〕 | StatusMonitor/StatusCharts/StatusMonitorModal/DockerManager四行已补审：资源卡/IP/rate/history与responsive density仍归Status owner；legacy modal的`max-w-2xl h-[min(78dvh,720px)] min-h-[360px]`被当前mobile shell原样保留；Docker table/card/footer/actions/details仍是一套feature owner                             |
| M15.03 | ✅ 本地完成〔C.11〕 | monitor live/history metric切换、1/5/10/30m范围、scale/IP copy、设置驱动采样间隔和modal关闭后的stop；Docker list/details、设置驱动polling/default-expand、start/stop/restart/remove确认、Enter/Logs terminal intent与最终empty state均有真实E2E/WS证据。当前SRS未要求为测试造额外Docker transport API                |
| M15.04 | ✅ 本地完成〔C.11〕 | embedded pane与mobile modal复用同一`StatusMonitorSessionController`，metric/range只改presentation state且不产生额外status.start/stop；mobile独立modal打开/关闭实际产生一对start/stop，30m range可达、history/card与dialog均在viewport内且document无横溢出；Docker窄卡footer通过当前responsive入口完成expand/collapse |

**验收/架构**：sampler/history/downsampling与Docker controller归feature，runtime无第二轮询器。复用 `ssh/status-docker-protocol.spec.ts`、`ssh/docker-manager-ui.spec.ts`、`ssh/panel-wheel-scaling.spec.ts`、`mobile/ssh-workspace.spec.ts`；复核 `mobile-status-monitor.png`。

### M16 — RDP/VNC 与 Suspended SSH

**Owner**：`features/remote-desktop/`、`features/ssh-suspend/`，Workspace负责session启动/恢复组合。需求：[remote-desktop](software-requirements/requirements/remote-desktop.md)、[workspace](software-requirements/requirements/workspace.md)。

| ID     | 状态                | 子任务及具体完成条件                                                                                                                                                                                                                                                                                                                              |
| ------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M16.01 | ✅ 已完成〔C.1/P8〕 | consolidated RDP/VNC toolbar/state/footer、连接错误overlay、fullscreen/minimize/resize；mobile两行footer和Direct/Touchpad稳定hit targets                                                                                                                                                                                                          |
| M16.02 | ✅ 已完成〔C.1/P8〕 | suspended modal/embedded rows、search/status、resume/export/delete/rename/marked外观与现有后台生命周期                                                                                                                                                                                                                                            |
| M16.03 | ✅ 本地完成〔C.12〕 | RemoteDesktopModal/VncModal/SuspendedSshSessionsModal/View 四行已补审：RDP/VNC继续合并为单一window/session owner，canvas/header/footer/fullscreen/minimize/resize层级不分叉；legacy suspended modal的`max-w-2xl max-h-[85vh]`与内部滚动保留，Panel继续在320px标题换行、300px动作转44px icon-only                                                  |
| M16.04 | ✅ 本地完成〔C.12〕 | Direct/Touchpad切换已实测不新增`rdp-session`请求且跨显式关闭/重开持久化；真实Guacamole connected tunnel覆盖RDP/VNC双向clipboard与VNC text→key down/up，既有touch/IME、RemoteApp/fullscreen/resize/minimize/restore均绿；Suspend真实链覆盖mark→reload→同shell resume、search/rename、export失败保留+真实下载、remove Cancel/Confirm及移动modal几何 |

**验收/架构**：Guacamole/current remote ports和ssh-suspend controller不替换；不为RDP/VNC各复制一套旧window/session owner。复用 `ui/rdp-remoteapp-fullscreen.spec.ts`、`mobile/touch-workflows.spec.ts`、`mobile/suspend-resume-ui.spec.ts`、`ssh/suspend-resume.spec.ts`。

### M17 — 集成、证据归档与最终关闭

| ID     | 状态                     | 子任务及具体完成条件                                                                                                                                                     |
| ------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M17.01 | ✅ 本地完成〔C.38/C.41〕 | 完整 mobile 命令、26 case count、exit、报告、13 图与逐项失败归因已记录；25 个产品/适用 case 通过，剩余 1 个受保护未跟踪审计脚本 selector 维护项转入 M17.03，不归因于产品 |
| M17.02 | ✅ 本地完成〔C.35〕      | 附录A 98行与附录B 28图均已逐项建立 disposition；需当前 SHA 浏览器、产品差异、selector、environment/canonical 依赖和 N/A 均有报告索引，最终图审仍由 M17.05 负责           |
| M17.03 | ◐ 部分完成〔C.34/C.38/C.57〕  | 当前 SHA 的 architecture/i18n/vue-tsc/Vite/git diff-check 已通过；test-policy/groups:check 仅被受保护未跟踪移动审计文件阻断，format 需在清理生成物后单独复核 |
| M17.04 | ⏳ 待完成                | 对最终产品SHA的 canonical Docker smoke + G1–G8 及必要ingress验证；CI等待交证据代理，主代理做失败归因与验收                                                               |
| M17.05 | ⏳ 待完成                | 从真实场景生成28图，附录B逐图记录视口/主题/数据/差异结论/产品版本；补无截图UI的浏览器/源码证据，不建立新全局manifest                                                     |
| M17.06 | ⏳ 待完成                | 所有真实差异已修复或有owner决定；当前功能保持、新架构边界通过；记录最终交接结果，清理可丢弃/tmp材料前保留必要证据索引                                                    |

**项目完成条件**：M00–M16适用子任务及F/V/A验收全部有结论，M17.01–06完成；无“源码审计=视觉完成”“旧run=新代码通过”“图片存在=已复核”的替代判断。项目整体完成前保留每个已实现子任务的✅，但模块最终状态不得提前关闭。

## 5. 交给其他模型的执行协议

### 5.1 每次只执行一个可验收批次

1. 读取本计划、对应模块SRS、新架构文档、适用AGENTS；确认当前dirty文件和任务状态。
2. 对照附录A找到旧文件与当前owner。写清旧样式、当前差异、功能影响、修改归属；证据不足先调查。
3. 仅在指定owner实施；共享文件变更交唯一编辑者。出现能力缺口先报告port/controller设计，不移植旧架构。
4. 在自然真实流程验证目标及受影响邻接状态，保存新旧比较。遇到失败先同场景基线复现，不能删断言或凑截图。
5. 运行适用静态门槛，提交F/V/A分项结果；主验收者审查后更新该任务ID及证据。只重开受影响任务。

#### 5.1.1 新模型先拆任务，再进入实现

当输入是整个模块、`Mxx.yy` 仍包含多个独立用户状态，或主代理只说“继续这个模块”时，新模型**不得直接开始改代码**。先输出一次 `Task Split`，主代理确认后只执行其中一个原子子任务。局部子任务可用 `Mxx.yy-a/b/c` 作为本轮临时ID，不改变主计划正式编号。

一个原子子任务必须同时满足：

1. **一个主要用户结果**：能用一句话描述用户最后看到/做到什么，例如“375px普通连接行的身份信息和四个动作均可达”，不能同时写“修Connections全部移动端问题”。
2. **一个主要根因与owner**：预计改动集中在一个feature/runtime owner；若共享文件、Foundation或跨feature port需要变更，单独拆成依赖子任务并指定唯一编辑者。
3. **一个闭合证据回路**：同一fixture下存在修改前失败/差异证据、实现、修改后验证和邻接回归。恢复历史证据、产品实现、全量canonical验收若能独立失败，分别拆开。
4. **一套一致的测试前提**：协议、数据、语言、theme、viewport/device参数若需要明显不同的准备或验收方式，应拆成不同子任务或明确矩阵行，不能用一个模糊“移动端已测”覆盖。
5. **独立可判定**：主代理无需阅读模型聊天历史，仅凭该子任务的prompt、diff、命令、产物就能判定F/V/A。做不到时继续拆分或补任务包。

`Task Split` 固定输出以下字段：`临时ID | 用户结果 | 当前证据/缺口 | owner与允许路径 | 依赖 | F验收 | V验收 | A验收 | 预计命令/产物 | 不在范围`。若任一行的F/V/A仍只能写“正常”“看起来一致”“跑相关测试”，视为拆分未完成，不能进入实现。

相同fixture的不同viewport通常是同一子任务的矩阵，不能通过拆分把原任务必需的窄屏或视觉对照推后，导致本次只验功能。真实软键盘与桌面浏览器viewport模拟必须分开标注。仅为本批次选中的原子任务生成完整prompt与验收卡；其余候选行标为未委派，不必重复长模板。prompt必须包含实际执行命令、输出目录和需复用的注意事项，不能仅在旁边的验收卡给出命令，或依赖上一轮聊天。

#### 5.1.2 原子子任务验收卡

每个执行中的原子子任务都要有一张自包含验收卡，至少写清：

- `Target`：正式任务ID + 临时子任务ID + 一句话用户结果。
- `Baseline`：产品SHA/工作树、旧Git路径/截图、当前before证据；证据不存在时明确“先取证”。
- `Ownership`：允许修改路径、只读参考路径、共享文件唯一编辑者、明确禁止路径。
- `Preserve`：不能因还原而删除/弱化的当前功能、secret/状态/生命周期语义。
- `Acceptance`：F/V/A分别列可观察条件；几何任务必须含目标元素bbox/可读区/overflow归属，持久化任务必须含真实API或刷新后结果。
- `Matrix`：需要覆盖的语言、theme、viewport、protocol、状态；不适用项写原因，不能默认为已覆盖。
- `Commands`：先发现/列出目标case，再给真实执行命令、静态gates和产物目录；环境预检命令也写在这里。
- `Stop/Replan`：出现新需求冲突、需要跨owner、基线本身同样失败、测试环境无法启动时停止产品扩改并报告，不自行放宽验收。
- `Deliverables`：根因、最小方案、changed files、命令exit/case数、before/after或trace、F/V/A、未验范围。

主代理在启动子模型前检查这张卡；缺任一字段时，先补任务包，不把“模型自己去猜”当成模型能力测试。

### 5.2 可直接复制的任务提示词

```text
模式：<planning|execution>。如果是planning或输入仍是父任务，先按§5.1.1输出Task Split和每个原子子任务的完整prompt，不改代码。
任务：完成 doc/FRONTEND_UI_RESTORATION_PLAN.md 中 <Mxx.yy>。
原子子任务：<Mxx.yy-a；一句话用户结果>。execution模式一次只允许一个。
已有成果：<已完成任务/提交/未提交改动>，不得重做或覆盖。
旧UI证据：8ceb5840:<旧路径>；需要时比较8ad24a03对应截图。
当前owner与允许修改路径：<feature/runtime/component/public/port>。
只读参考/禁止修改路径：<path；若无写“无”>。
需求：<SRS/FR/EC链接>。
功能目标：<操作、状态、持久化、失败路径>。
视觉目标：<结构/尺寸/图标/主题/滚动/弹层/视口>。
架构目标：保留现有状态、port、生命周期归属；禁止旧store/event bus/协议兼容层。
必须保留：<新增功能、secret语义、当前生命周期、已完成成果>。
不在范围：<相邻模块、已有需求功能、无需重做的部分>。
验收：<真实E2E命令、桌面/移动状态、截图/人工观察>。
可测条件：<例如视口内bbox、信息可读区、滚动归属、持久化结果；不能只写“样式正常”>。
验收矩阵：<language/theme/viewport/protocol/state逐项列出；不适用写原因>。
对照条件：<相同fixture、语言、theme、viewport、screen、hasTouch/isMobile；保存before/after>。
执行环境：<仓库cwd、模型runner、唯一浏览器端口owner、产物目录、允许的临时配置；先确认runner可启动、目录可写、测试能被发现、浏览器/系统依赖存在>。
停止/重规划条件：<跨owner、需求冲突、baseline同样失败、环境阻塞等>。
交付：根因与旧新证据、diff文件、F/V/A结果、命令/case数、未完成项。
不自动提交/推送/dispatch；不直接改其他模型负责的共享文件。

使用Luna max时必须附带的任务注意事项：
1. 一次完成指定子任务，不自动重做模块、扩改相邻owner或另开子代理。
2. 先检查dirty diff；需要回放旧版时使用隔离副本，不覆盖当前已有改动。
3. 先交旧新证据与最小方案；涉及新增功能排布或交互边界时由主代理验收方案后实施。
4. 使用真实UI/API/现有E2E；不以内部实现、mock响应、复制旧图或弱化断言换取通过。
5. 同条件对比修改前后。先用可见文案/控件确认语言和theme已生效，再命名截图；API成功不等于界面切换。toBeVisible或页面无横滚也不代表未被内部容器裁切；测量边界并目视检查。
6. 若临时配置No tests found，先修testDir/project/testMatch并--list，不把环境问题当产品结果。
7. 不能测试跑完就结束：检查实际截图、数据结果、修改范围和F/V/A；执行明确需要的静态门槛。
8. 只报告已运行的命令、exit/case数和实际产物。区分本地通过、源码已审、视觉已审、canonical待验。
9. 主代理提出具体缺陷后，在同一任务继续修正并验证；不要仅给建议或无理由转交。
10. 额度/环境等真实阻塞须报告已完成步骤、未完成步骤、保留的证据和可重跑命令，不虚报完成。
11. 模型选择由主代理的真实runner调用负责，任务包附调用参数、成功返回的canonical/run标识；执行代理引用该调度凭据，不要求自己再次启动模型或寻找模型CLI。通用身份文案、缺少模型环境变量不等于调度失败；不得自行推断具体底层型号。无调度凭据、runner明确拒绝指定模型或明确降级时才报告`BLOCKED(model-runner)`，不能冒充其他模型。
12. 浏览器、系统库、输出目录权限等环境预检失败时标记`BLOCKED(environment)`；可修复的环境问题先修复再重试，同一失败不能计入产品case失败数。
```

按用户最新约束，后续子代理仅允许 `gpt-5.6-luna`，禁止使用Sol或其他模型。当前runner支持推理等级 `low / medium / high / xhigh / max`，不支持Luna `ultra`。日志/清单/已授权Actions跟踪可用low或medium，明确局部实现用high，复杂交互取证与执行试验用xhigh或max；复杂度超出可控范围时由主代理进一步拆任务，不换其他模型。主代理负责架构归属、任务拆分和最终结论。证据代理可以并行检查，多个本地Playwright run必须协调端口与后端测试数据，不能同时抢同一环境。

### 5.3 记录格式与变更边界

每个任务只维护一个当前状态，历史结果保留证据链接。推荐完成记录：`Mxx.yy | F:<结论> V:<结论> A:<结论> | 产品SHA/工作树diff | 命令与结果 | 图/日志位置 | 遗留项`。主计划统一编辑，子代理输出报告供合并，避免多模型反复改动整张长表。

源码行号仅帮助定位，以Git基线和当前owner为准。`/tmp` 是临时证据，不保证下一主机可用；失效时按记录命令重建，不假定可用。保留现有E2E测试资产，不在其他目录建立单元/组件测试体系。

### 5.4 Luna max 执行与主代理验收闭环

本节是上述工程约束下的执行检查表，不另设架构规则。指定 Luna max 时使用模型 `gpt-5.6-luna`、推理等级 `max`；新代理只传自包含任务包与必要上下文，不能假设它读过其他代理的结果。主代理负责给出当前文件、证据路径和未提交变更边界。

**启动前硬门槛**：主代理先确认当前执行环境确实暴露可启动模型的runner，并记录实际模型名、推理等级及可追溯run/session标识（runner能提供时）。如果当前工具只有文件/命令/浏览器能力而没有模型启动能力，必须明确记录`BLOCKED(model-runner)`；可以继续审查已有Luna产出，但该审查**不算一次新的Luna运行**。同样先检查目标输出目录可写、Playwright/浏览器可启动、必要系统库存在；环境失败与产品失败分开统计。

**调度凭据与执行身份分开**：上述runner门槛由主代理在启动处验收，不在已启动的子代理内部递归检查。任务包记录实际调用的 `model`、`reasoning_effort`、`fork_turns` 和成功返回的canonical/run；子代理可报告“调度参数为gpt-5.6-luna/max，run为…”，不需要改变自身通用系统身份，也不要求它再次拥有模型选择工具。若工具未暴露服务端最终解析型号，明列该元数据不可独立查询，不用通用“GPT-5”字样或缺少CLI来推断降级。只有无有效启动凭据或runner明确返回拒绝/降级才阻塞模型试验。产品F/V/A仍必须真实完成，不能用调度成功代替。

| 阶段     | Luna max 必须交付                                                  | 主代理验收/失败处理                                        |
| -------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| 启动     | 任务ID、读到的owner/基线、验收指标、dirty保护与测试计划            | 若把已完成项当待开发、范围过大或缺少证据，先纠正任务包     |
| 取证     | 修改前真实页面/状态、旧新源码、尺寸或交互失败证据                  | 区分迁移回归、当前新增能力、基线已有问题和测试前提差异     |
| 方案     | 最小改动文件、保留功能、样式/事件归属及预期影响                    | 新功能不能删；视觉调整有明确理由；状态和transport不越界    |
| 实现验证 | owner-local diff、原失败复现/修复后通过、邻接流程、同条件after截图 | 只改断言、扩大无关范围、只跑--list或缺少真实效果时退回继续 |
| 收尾     | F/V/A分项、实际命令/case数、静态gates、文件清单、未验范围          | 主代理独立读diff和图，确认已有改动未被覆盖，再更新任务状态 |

对几何任务，任务包应明确“页面/容器不溢出”“文字有可读区域且保留合理截断”“每个动作完整落在可点击范围”“桌面及相邻断点不回归”。检查用户语言中的较长文案，至少覆盖任务指定语言；不能通过缩小到不可读、隐藏信息/动作或全局 `overflow:hidden` 掩盖问题。外观不一定适用统一按钮尺寸，仍以旧基线和当前需求为准。

对Playwright，先复用已有配置和spec。确需临时配置时显式设置正确的 `testDir`、project/testMatch、设备参数和输出目录；复杂配置先 `--list` 确认目标case数量，但它不是测试通过。临时工具必须留在允许范围并清理测试数据；数据库重置、测试服务和浏览器端口由一个执行者独占。不得杀掉不属于本轮的服务。

对截图，before必须在产品变更前采集，after使用相同数据、语言和视口；若测试动作改变notes、task状态等数据，先恢复相同状态再比较。文件名带before/after和viewport以防混淆；图片数量不等于测试通过。主代理要看真实产物，不能只接受子代理一句“目视一致”。

**界面状态必须验证生效**：调用设置API成功不代表当前浏览器已切换语言/theme。每组截图前用真实可见文案/控件确认目标语言，确认theme与viewport实际生效，再命名产物。不能按循环变量给英文画面标成中文；不能以读取localStorage或内部store替代用户可见结果。页面`scrollWidth === clientWidth`也不证明内部元素未被裁切，需一起检查目标行、文字区、动作区及overflow容器边界。

每次重试使用新的run输出目录，或在报告中明确无效/旧产物；不能把上次PNG与本次失败/空metrics拼成一份成功证据。最终报告必须指向同一run的命令、exit、case数、实际截图和观测数据。首轮语言/视口采集错误应保留为试运行缺陷记录，重新取证后再继续实施。

若首次交付不合格，主代理将缺陷写成具体返工项：缺失证据/错误归因/产品问题/测试问题/架构问题，补充原任务提示词后让同一Luna max继续。按新发现修改计划和注意事项，再复测；不能仅通过调整完成标准把失败改为成功。达到本子任务F/V/A条件后收口，不据一次试运行推断Luna max已适用于所有复杂模块。

### 5.5 “新模型首次读plan”可执行性自测

在大批量委派前，必须做一次与产品任务分开的plan自测。目标不是让模型证明“它很聪明”，而是证明**plan本身足够自包含**。

1. **Fresh-reader planning test**：新模型只得到本plan、目标正式任务ID、当前`git status`/必要diff摘要和该模块SRS/architecture路径；不给前一代理聊天记录。要求它只做planning：按§5.1.1拆候选子功能，并为选中委派项生成§5.2完整prompt和§5.1.2验收卡，其余项明确未委派。
2. **主代理评分**：逐行检查是否正确继承已完成项、owner、dirty保护、需求、F/V/A、矩阵、真实命令、停止条件。任何需要主代理补一句“其实这里还要……”才能执行的内容，都算plan缺口；先修改plan/模块行，再换一个无前序上下文的新模型重做planning test。
3. **Execution trial**：planning通过后，只选一个风险可控、能真实验收的原子子任务交给Luna max执行。主代理独立检查before、diff、after、命令和F/V/A，不能只看模型总结。
4. **纠错重试**：若Luna实现不合格，先判断是任务包缺字段、模型执行偏差、产品根因判断错、测试问题还是环境问题。任务包/plan缺陷必须先修文档，再用修正后的完整prompt让同一任务继续；不能只在聊天里追加口头上下文而不回写plan。
5. **通过标准**：至少一次fresh-reader planning无需隐含上下文即可生成可执行子任务包，且一次execution trial在真实可用环境中完成F/V/A闭环。若runner或浏览器基础环境不可用，只能记为`BLOCKED`，不能把源码审查或静态build代替本项通过。

为了检验plan而发现的规则必须写回本节或对应模块，不只留在附录试运行记录。后续模型应能从正式规则重新推导同样结论，而不是依赖记住某次Luna聊天。

### 5.6 主代理分发 / 子代理执行的通用规则

本节把小切片试验提炼为适用于所有模块的操作协议，而非把M01的选择器、色值或401响应推广到其他模块。**一个小功能只能验证本协议在该风险等级可执行，不能证明某模型对全部模块都可靠。** 扩大到跨feature、实时session或文件生命周期任务前仍需独立验收。

| 阶段与负责人     | 必做动作                                                                                                                        | 放行条件 / 下一步                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 主代理：选任务   | 从正式未闭环项选一个用户结果，核查历史完成证据，区分补证据/局部修复/能力缺口；指定一个主owner                                   | 必要断点和状态属于同一验收矩阵，不能拆出去规避验收；共享根因另建依赖           |
| 主代理：打包     | 用§5.2生成自包含prompt，附当前版本/dirty边界、来源、允许路径、F/V/A、真实命令/产物、调度凭据、端口/文件owner                    | 每项要求都有可观察通过条件；不能只写“还原UI”“跑相关测试”；prompt不依赖历史聊天 |
| 子代理：接单取证 | 确认任务ID/允许路径，读取必要模块而非反复通读所有附录；预检、保留before、对照旧源码与实际CSS/行为                               | 回报`已确认范围 + 首个证据 + 下一步`，缺信息列具体缺口；不重复生成一份大规划   |
| 子代理：实施验证 | 单owner内有证据的最小修复可直接实施；before已满足可仅补持久证据；自行运行测试、采图、等待已授权且已启动的服务/Actions并分析日志 | 不通过制造diff证明工作；不越界、不弱化断言、不把环境失败当产品失败             |
| 主代理：独立验收 | 审产品diff/状态归属、测试是否证明用户结果、before/after图和metrics、实际exit/case数、非本任务文件保护                           | F/V/A分别判定；任一缺证据则不关闭子任务，只下达具体返工项                      |
| 主代理：合并进度 | 回写正式子任务当前状态、附录证据与未验范围；保留历史已完成项                                                                    | 小切片通过不自动关闭父模块；最终canonical仍归M17                               |

**任务包门槛（分发前逐项勾选）**：

- 一个用户结果、一个主owner、明确任务模式和不在范围；复杂状态另拆，但不能漏掉本结果必要的矩阵。
- 基线/当前版本和真实差异来源明确；静态类名差异须考虑构建版本、CSS层叠与computed style，不能机械复制旧代码。
- F定义操作与外部状态结果；V定义旧视觉属性和可达几何；A定义状态/协议/生命周期归属。三项互不替代。
- 有测试入口/精确执行命令、fixture与可见前提确认、唯一产物目录、失败保留方法和邻接回归；成功截图不依赖失败才保存的默认配置。
- 文件与测试环境有唯一owner；主代理掌握runner调度证据，子代理不重复验证是否拥有启动自身的能力。禁止未经授权commit/push/dispatch。
- 明确可自行修复与必须升级的边界；输出限定为证据/方案/结果，不要求子代理长篇复述整个计划。

**失败分类与返工**：

| 分类                        | 谁处理                                                                                 | 不允许的替代做法                                               |
| --------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 任务包缺字段/歧义           | 主代理修正式规则和完整prompt，原执行者按新版本继续；涉及拆分原则时另做fresh-reader复测 | 只在聊天里补一句，未来模型仍无法执行                           |
| 执行偏差/缺截图/错误locator | 原子代理按`具体缺陷→预期证据→重跑范围`返工；同一run产物一致                            | 主代理接管编码来掩盖子代理未完成，或删除失败断言               |
| 环境/测试服务问题           | 子代理诊断并在授权范围恢复，独立报告环境exit；不可恢复才升级                           | 因一次可恢复失败停工，或杀其他任务服务                         |
| 跨owner/新能力/需求冲突     | 主代理决定归属并拆依赖，再委派Luna xhigh/max；已有范围保持                             | 子代理复活旧store/event bus/mapper，或把业务状态塞进Foundation |
| 源码/浏览器证据不一致       | 子代理保留反例并查层叠、fixture、语言、设备前提；主代理判归因                          | 用截图文件名、总像素阈值或类名一致强行判通过                   |

**汇报与接续**：长任务在完成预检、首次真实run、确认根因、最终验证后各报一次简短进展；连续约10分钟无产物时主动说明正在执行的命令/分析、已保留证据和下一步，不无声扩大调查范围。返工反馈列具体缺陷，不改变原F/V/A通过标准；若任务包有修订，再执行时必须附完整新版prompt/验收卡，不能只给聊天增量。最终交付统一为`task/run/版本/changed files/根因/F/V/A/命令exit与case数/图与metrics/未验项/dirty保护`；报告的命令必须可重跑，临时产物失效时以持久E2E重建。

**模型分工与证据强度**：后续子代理仅使用Luna low至max，等级按§5.2选择；跨表面/生命周期复杂任务先由主代理明确归属和依赖，再交Luna xhigh/max执行。主代理始终负责规划、架构、分发和验收。历史Sol审计记录仅保留事实，不构成后续使用授权。C.13记录实际试验轮次、退回原因和通过范围，不能把“planning通过”写成“execution通过”，也不能将一次局部通过推广为完整UI或模型通用能力已验证。

### 5.7 Luna max 主代理启动模板与90%工作覆盖目标

用户允许主代理及子代理均使用Luna；主代理推荐max，子代理按§5.2选low至max。主代理不需要更强型号兜底：难题先缩小用户结果、分离跨owner依赖、补证据，再派Luna执行；确实无法裁决的需求或外部授权交用户，不悄悄切换其他模型。

**90%的口径**：这是希望代理团队自主完成工作的目标，不是允许10%的功能坏掉、架构违规或UI差异不记录。批次开始时冻结用户结果清单和验收范围，记录`自主完成且F/V/A通过的用户结果数 / 本批次适用用户结果总数`；拆成多个代码子任务不增加分子，阻塞项仍在分母，确实不适用须有理由。另列关键路径/风险等级，避免用大量简单项掩盖关键流程未完成。历史已完成项不计作本轮新增成果。未达90%也如实交接，不修改分母凑数；只要尚有未关闭项就不能宣称项目完成。一次小功能试验只能证明一次局部闭环，不能据此报告整体自主完成率已达90%。

下面启动提示词可交给新的Luna max主代理；它必须自行从正式模块生成§5.2的具体执行包，而非将整份plan原样扔给执行者：

```text
角色：主代理，负责规划、架构、委派、独立验收和进度汇总，不把普通实现/测试等待全部揽回自己。
仓库：先pwd确认。入口：doc/FRONTEND_UI_RESTORATION_PLAN.md。
先读§0–§3、§5–§6和本批次对应模块/SRS/附录映射；不要重做已完成模块。
模型限制：子代理仅gpt-5.6-luna，low/medium/high/xhigh/max；不得使用Sol或其他型号，不请求ultra。
目标：在新架构完整保留功能并还原旧视觉；以90%以上本批次用户结果自主闭环为努力目标，不能牺牲质量或虚报比例。
启动：核查git状态/HEAD/适用AGENTS，保存dirty保护快照；同步远端仅在已有授权下fetch/ff，不reset、不自动commit/push/dispatch。
选题：列用户结果、当前完成状态、证据缺口、风险、主owner、依赖；冻结本批次分母。先选一个单owner小切片，不一次派整个复杂模块。
分发：按§5.1/5.2生成完整prompt和验收卡，附模型调度凭据、允许路径、不可改路径、fixture/矩阵、真实命令/输出目录、F/V/A、停止条件。
并行：最多按工具实际空位分发，保留主代理席位；同一文件只给一个写者，同一数据库/测试端口只给一个执行者。其他子代理做独立只读审查，不争抢环境。子代理不得自行再生成代理树。
执行：让子代理取before、实施、运行/等待测试、看截图、分析失败并提交证据。单owner有证据的修复无需每一步请求批准；跨owner/需求冲突先交你裁决。
验收：自己阅读真实diff与截图/metrics，核查外部用户结果和状态生命周期；可委派独立只读复核，但不能只接受执行者或审查者一句通过。
返工：按§5.6分类，给具体缺陷与重跑范围；任务包缺口先写回正式规则，再交完整新prompt。连续两次同类失败先停止盲目重跑，检查前提/根因/任务大小再继续，不自动换模型或放宽标准。
收尾：只有F/V/A均达到该切片要求才标完成；剩余项写清已做/未做/阻塞/证据/下一执行命令。更新原plan，不另建互相矛盾的进度表。
报告：区分planning通过、execution通过、本地完成和最终canonical；说明自主完成的用户结果分子/分母与关键风险，不以一个试验推断全部模块能力。
```

**给执行子代理的额外通用约束**：不要为一个小视觉修复搭建通用测试框架或输出全量DOM；只采验收卡要求的目标元素和必要祖先。持久测试保留有长期回归价值的用户行为/视觉断言，调试取证按既有附件机制保存。若测试代码明显大于目标行为所需，先检查能否复用已有步骤、删除重复采集，不降低断言。输出不包含密码、token、cookie等秘密；调试trace如含测试凭据须限制在本地授权证据目录，不上传公开产物。

视觉修复必须有能捕捉原回归的持久检查（项目现有视觉断言或与基线绑定的computed style/几何断言），不能仅把数值保存到metrics却没有验收断言。准确数值来自本任务旧基线和实际工具链，不设所有模块统一间距。纯功能测试修复前后都绿时，报告明确它证明的是功能保留而非视觉差异已被自动捕获。

**批次记录最小模板**（放在该批次报告/原plan记录中，不新增产品调度框架）：

```text
batch_id / 基线版本 / 冻结时间：
result_id | 用户结果 | 正式任务ID | applicable及理由 | 风险 | F/V/A证据 | 当前状态
分母：适用result_id集合；分子：其中本轮自主完成且已独立验收的集合。
派单：result_id / agent-run / Luna等级及理由 / 允许文件 / prompt版本 / 产物目录。
资源预约：agent-run / 使用现有配置的服务端口集合 / 测试数据库 / 已有冲突 / 占用中或已释放。
执行者启动后回报：实际命令、进程或Playwright session标识；结束后回报服务退出和资源释放。
```

这是一份主代理维护的轻量台账，不要求另建lock server、任意端口或通用manifest。沿用现有测试配置端口；撞端口先等待/协调，不能擅改配置或杀不明进程。中断后重新核实进程归属与端口状态，旧记录不等于仍持锁。low/medium只做只读机械检查或既定命令跟踪；包含产品修复、测试编写、跨语言/theme几何判定的执行包至少high，复杂或试验项用max。所有视觉任务仍需列旧基线的具体属性，不可退化成通用“可读可点”。fixture暂不支持某个必验组合属于缺口/阻塞，不能据此标不适用从分母删除；新批次自行选择的矩阵须有来源和风险理由，不机械套用M01断点或把四种组合都强加所有任务。

### 5.8 完整执行入口：Luna max主代理持续推进与逐模块提交

本节是后续主代理的完整启动提示词，结合§5.1–§5.7执行；接手时优先加载本节，不只使用§5.7的简版模板。用户已明确要求每完成一个模块进行一次本地commit；这项授权不包含push、手动dispatch或历史改写。其他章节的“不自动提交”对子代理仍然有效，主代理的模块提交按本节执行。

```text
你是本仓库主代理，负责规划、架构一致性、任务分发、独立验收、进度汇总和模块提交。

一、入口与完整目标
入口：doc/FRONTEND_UI_RESTORATION_PLAN.md。
先读§0–§3、§5–§6、C.13，再按当前模块读取任务、SRS、新架构文档和旧UI映射，并遵守适用AGENTS.md。

持续完成整份plan中M00–M17的所有适用需求：
- 功能完整，不删除或弱化现有能力。
- 视觉与交互还原旧UI。
- 所有代码均落在新架构，不恢复旧store、event bus、协议兼容层或重复状态owner。

90%是团队自主完成工作的努力目标，不是需求裁剪、降低质量或停止条件。达到90%仍需继续处理剩余需求。

二、模型与职责
子代理仅允许gpt-5.6-luna：
- low/medium：机械检查、既定命令、日志和等待。
- high：明确的局部实现、测试编写。
- xhigh/max：复杂交互、取证和较难实现。
禁止Sol或其他型号，不使用ultra。

你负责拆分、架构裁决、完整任务包、独立验收和提交。
子代理负责取证、实现、测试、截图、失败分析及等待已授权的Actions。
难题先拆依赖、缩小任务并补证据，不换其他模型。
子代理不得自行再开代理或commit/push。

三、启动与保护
1. 检查pwd、HEAD、分支、git status、暂存区和适用AGENTS。
2. 记录已有dirty文件及必要diff/校验值，禁止覆盖、reset或随意stash。
3. 如需同步远端，可fetch并在安全条件下ff；分叉或冲突先分析，不强制覆盖。
4. 继承已完成任务与C.13试验结果，不重复开发或重新进行模型能力试验。
5. 区分已提交成果、已验收但未提交改动、尚未验收改动。

四、持续分发
按§5.6/§5.7执行：
1. 从未闭环模块选择批次，列用户结果、证据缺口、风险、主owner、依赖。
2. 按§5.2为每个选中原子任务生成自包含prompt和验收卡：
   当前版本、旧基线、允许/禁止路径、保留能力、F/V/A条件、
   fixture、必要视口/语言/状态、实际命令、产物目录、停止条件。
3. 必要窄屏和错误状态属于该任务验收矩阵，不得推到后续规避验收。
4. 同一文件只有一个写者，同一数据库/测试环境只有一个占用者。
5. 调度参数和run凭据由你记录；子代理不需要再次拥有模型启动工具。

五、实施与验收
子代理先保存before证据，再做有证据的最小修复。
现状已满足时允许仅补持久测试/验收，不为制造diff而改产品。
禁止测试专用产品DOM、伪造响应、复制旧截图、弱化断言和无关扩改。

你必须独立检查：
- F：真实用户操作、失败/重试和外部状态结果。
- V：旧基线具体视觉属性、真实截图、computed style与裁切/滚动几何。
- A：状态、协议、生命周期仍归当前owner，跨模块走现有public/port。
- 测试确实执行，命令exit/case数与产物一致，既有改动未被覆盖。

视觉修复应有能捕捉原回归的持久检查，不能只有metrics没有断言。
不合格则给具体缺陷和重跑范围，让原子代理返工。
任务包有缺口，先更新正式规则，再提供完整修订prompt。
连续两次同类失败先查前提、根因和任务大小，不盲目重跑或降低标准。

六、每完成一个模块commit一次
用户明确授权本次进行本地Git提交：
1. 一个正式模块完成自身适用任务及本地F/V/A验收后，立即提交一次。
2. 提交包含该模块实现、相关测试及原plan的完成记录。
3. 提交前检查实际diff、相关静态检查/测试结果和暂存区。
4. 按路径或hunk精确暂存，禁止git add .混入其他模块或无关dirty改动。
5. 多模块共享文件按hunk划分；若无法安全拆分，先协调依赖，不强行制造不完整提交。
6. 已有未提交成果只有确认属于该模块且完成验收后才可纳入；不得顺带提交未知改动。
7. 由你执行commit，子代理只交付改动和证据。
8. 建议提交信息：feat(ui): restore Mxx <模块名>；仅补测试时使用test(ui)。
9. commit后检查git show --stat和git status，汇报模块、提交SHA及验收结果。
10. 不制造空提交、不amend已有提交、不改写历史。
11. commit失败时保留现场并解决，不虚报提交成功。

已完成且已提交的模块不重复提交。
已本地完成但未提交的模块，先核实归属和有效证据，再单独提交。
模块仅待M17最终统一验收时，可以提交其本地闭环成果，但不得宣称项目最终完成。

本授权仅包含本地commit，不包含push或手动dispatch。
执行commit前检查仓库hook可能产生的远程副作用；需要额外授权时先说明。

七、进度与停止条件
每完成一个子任务，更新原plan的真实状态、证据和未验项。
每完成一个模块，完成上述commit，再自动进入下一个未闭环模块。
不要因为完成优先批次、单个模块或达到90%就停止。

局部阻塞时记录原因，继续其他无依赖任务。
持续推进直到：
- M00–M17全部适用任务及最终验收完成；或
- 剩余任务均确实依赖用户决策、额外授权或不可用的外部条件。

最终汇报：
已完成模块、各模块commit SHA、真实测试结果、未完成/阻塞项及下一步。
不把planning通过当execution通过，不把本地通过当canonical通过。

现在简要汇报仓库状态、首个模块及分工，然后直接委派执行；不要只输出规划后停止。
```

## 6. 验证与截图操作

静态检查从仓库根执行；格式化只作用于本任务允许修改的文件。`npm run format` 会写入整个 dirty 工作树中的支持文件，并不限于本代理的改动，存在其他人的未提交工作时禁止直接使用；改用下列显式路径命令。`format:check` 是只读检查，可检查整个 dirty 工作树；非本任务格式问题仅报告。文档-only变更只需文档格式/链接/清单一致性，不重复耗时产品构建。

```bash
npx prettier --write doc/FRONTEND_UI_RESTORATION_PLAN.md
npm run format:check
npm run check:test-policy
npm --prefix packages/frontend run build
npm --prefix test/e2e run groups:check
git diff --check
```

产品任务将上面的 Prettier 路径替换为已批准的实际 changed files，子代理不格式化主代理负责的 plan。历史附录中的 `/tmp/nexus-e2e-env.sh`、`/tmp/nexus-pw-libs` 等只是当时环境记录；先 `test -e` 检查，不盲目 source 或重装。当前预检确认本机浏览器缓存 `/root/.cache/ms-playwright` 与系统库/字体可用，无需旧临时 workaround；可用 `PLAYWRIGHT_BROWSERS_PATH=/root/.cache/ms-playwright`，其他主机必须重新发现实际路径。

目标浏览器示例（从 `test/e2e` 执行；按模块选择既有spec，不为每行增加重复测试）：

```bash
npx playwright test --project=ui tests/ui/batch-connection-edit.spec.ts tests/ui/connection-non-ssh-bulk.spec.ts --timeout=45000
CI=1 E2E_CAPTURE_SCREENSHOTS=1 E2E_SCREENSHOT_OUTPUT_DIR=/tmp/nexus-p9-mobile-complete npx playwright test --project=mobile --retries=0
```

视口至少覆盖既有desktop项目、Pixel 7，以及任务需要的320×667/375×812/landscape。比较时固定theme、语言、scale、viewport和可重复fixture状态；远端动态内容、字体环境与布局误差区分归因。图片差异只作诊断，不能用任意阈值替代目视判断。

`.github/workflows/e2e.yml` 的manual dispatch仅有可选`workers`输入，默认会开启截图生成；各group上传`functional-screenshots-group-<group>`，成功的截图job会用新图替换tracked截图并自动commit/push。手动dispatch不是只读验证，先确认已有远程写入授权。push可能触发rebalance自动提交；记录run的产品SHA与后续bot提交，docs-only或旧产品run不能代替当前改动的验证。

无历史截图的UI仍是范围：先查旧template/style、usage/路由、当前SRS，再进入真实浏览器检查。只在自然E2E状态确有长期文档价值时增加截图声明；附录B沿用现有28图，不建立新的全局截图manifest。生成新图与旧图分开保存，禁止用基线PNG覆盖产品输出。

## 附录 A. 98 个旧 Vue 文件 → 当前 owner 与模块追溯

本表保留原98行及已有移动审计证据，新增当前执行模块归属。旧路径均相对 `8ceb5840:packages/frontend/src/`；已有证据中的简写旧路径按此前缀解释。**本表是覆盖索引，不是另一套任务状态；实施和最终验收以模块任务ID为准。** 源码已审的行仍可能有未验证的动态/移动状态。

| 旧 Vue 文件                                                    | 当前 owner                                                                                                                                                                                                                                                                                                                     | 执行模块 | 原视觉核对重点                                                                                                 | 已有移动证据（不等于模块最终验收）                                                                                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `App.vue`                                                      | `packages/frontend/src/app/App.vue`<br>`packages/frontend/src/app/shell/AppHeader.vue`<br>`packages/frontend/src/shared/feedback/components/NotificationHost.vue`<br>`packages/frontend/src/shared/feedback/components/DialogHost.vue`<br>`packages/frontend/src/features/appearance/components/AppearanceCustomizerModal.vue` | M00      | app shell, header geometry, nav active indicator, GitHub/customize icons, global overlays/notifications        | source reviewed — current `app/App.vue:31-35`, `app/shell/AppHeader.vue`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                  |
| `components/AddConnectionForm.vue`                             | `packages/frontend/src/features/connections/components/ConnectionForm.vue`<br>`packages/frontend/src/features/connections/components/ConnectionEditorModal.vue`                                                                                                                                                                | M03      | field grouping, advanced/auth sections, helper icons, validation/loading layout                                | browser verified — mobile 375x812 connection-create passed 2/2; desktop passed; other form states pending                                                                                                                                                                                                                                                                                                                                                      |
| `components/AddConnectionFormAdvanced.vue`                     | `packages/frontend/src/features/connections/components/ConnectionForm.vue`<br>`packages/frontend/src/features/connections/components/ConnectionEditorModal.vue`                                                                                                                                                                | M03      | field grouping, advanced/auth sections, helper icons, validation/loading layout                                | source reviewed — current `ConnectionForm.vue:399-561`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                    |
| `components/AddConnectionFormAuth.vue`                         | `packages/frontend/src/features/connections/components/ConnectionForm.vue`<br>`packages/frontend/src/features/connections/components/ConnectionEditorModal.vue`                                                                                                                                                                | M03      | field grouping, advanced/auth sections, helper icons, validation/loading layout                                | source reviewed — current `ConnectionForm.vue:399-561`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                    |
| `components/AddConnectionFormBasicInfo.vue`                    | `packages/frontend/src/features/connections/components/ConnectionForm.vue`<br>`packages/frontend/src/features/connections/components/ConnectionEditorModal.vue`                                                                                                                                                                | M03      | field grouping, advanced/auth sections, helper icons, validation/loading layout                                | source reviewed — current `ConnectionForm.vue:399-561`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                    |
| `components/AddEditFavoritePathForm.vue`                       | `packages/frontend/src/features/filesystem/components/FilesystemCatalogModal.vue`                                                                                                                                                                                                                                              | M11      | favorite edit form fields/actions and modal form layout                                                        | source reviewed — current `FilesystemCatalogModal.vue:263-315`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                            |
| `components/AddEditQuickCommandForm.vue`                       | `packages/frontend/src/features/quick-commands/components/QuickCommandForm.vue`                                                                                                                                                                                                                                                | M09      | form sections, variable rows, action icons and modal density                                                   | source reviewed — baseline form uses internal scrolling at `8ceb5840:components/AddEditQuickCommandForm.vue:19-21`; current modal is viewport-bounded and vertically scrollable at `QuickCommandForm.vue:94-199`; mobile browser verification pending                                                                                                                                                                                                          |
| `components/AddProxyForm.vue`                                  | `packages/frontend/src/features/proxies/components/ProxyForm.vue`                                                                                                                                                                                                                                                              | M04      | proxy form grouping, labels, buttons and validation state                                                      | source + browser reviewed〔C.8〕— current `ProxyForm.vue`; 320px modal is viewport-bounded, native port range validation and HTTP→SOCKS5/password preserve-clear flows passed                                                                                                                                                                                                                                                                                  |
| `components/ArchivePasswordModal.vue`                          | `packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`<br>`packages/frontend/src/foundation/ui/BaseModal.vue`                                                                                                                                                                                       | M14      | password prompt modal and destructive/error states                                                             | source + browser reviewed〔C.10〕— current Workspace archive prompt keeps 128-char/control-char/confirm/show-password/ZipCrypto warning semantics; real UI covers special password create, wrong-password retry and successful extraction                                                                                                                                                                                                                      |
| `components/ArchiveProgressPopup.vue`                          | `packages/frontend/src/features/transfers/components/ProgressCenter.vue`                                                                                                                                                                                                                                                       | M14      | archive task card, archive/file icons, stop/minimize controls and progress geometry                            | source + browser reviewed〔C.10〕— current archive presentation preserves draggable bounded card, archive/file icons, percent/current-file, cancel/cancelling/remove and hide→shared restore; stalled prepare cancellation, overlap ownership and FileManager unmount survival are real-E2E green                                                                                                                                                              |
| `components/BatchEditConnectionForm.vue`                       | `packages/frontend/src/features/connections/components/BatchEditConnectionModal.vue`                                                                                                                                                                                                                                           | M03      | batch form grid, loading state, actions and modal dimensions                                                   | browser verified — 附录 C.3 mobile batch-edit + non-SSH bulk and desktop persistence cases passed 3/3; other modal states pending                                                                                                                                                                                                                                                                                                                              |
| `components/CodeMirrorMobileEditor.vue`                        | `packages/frontend/src/features/file-editor/components/CodeMirrorMobileEditor.vue`                                                                                                                                                                                                                                             | M12      | old dark gutters/selection, editor sizing, search panel and touch visuals                                      | source reviewed — current `features/file-editor/components/CodeMirrorMobileEditor.vue:301-321`; P6 mobile behavior evidence in 附录 C.2, all states pending                                                                                                                                                                                                                                                                                                    |
| `components/CommandHistoryMenu.vue`                            | `packages/frontend/src/features/command-history/components/CommandHistoryPanel.vue`                                                                                                                                                                                                                                            | M09      | history list, copy/delete icons, compact menu appearance                                                       | source reviewed — baseline list owns bounded vertical overflow at `8ceb5840:components/CommandHistoryMenu.vue:1-15`; current embedded list/search/context menu retain min-width truncation and scroll ownership at `CommandHistoryPanel.vue:104-199`; mobile browser verification pending                                                                                                                                                                      |
| `components/CommandInputBar.vue`                               | `packages/frontend/src/runtimes/workspace/components/WorkspaceCommandBar.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceMobileTools.vue`                                                                                                                                                                | M09      | command input sizing, toolbar order, FontAwesome icons, search/history/file/editor/status/keyboard actions     | source reviewed — baseline mobile controls use content height and horizontal tool scrolling at `8ceb5840:components/CommandInputBar.vue:426-554,593-643`; current owners retain the mobile branch, min-width input and overflow-x control rail at `WorkspaceCommandBar.vue:246-456,472-513` and `WorkspaceMobileTools.vue:97-144`; browser evidence remains flow-specific                                                                                      |
| `components/ConnectionList.vue`                                | `packages/frontend/src/features/connections/views/ConnectionsView.vue`                                                                                                                                                                                                                                                         | M03      | connection rows/cards, actions, tags, filters and responsive density                                           | source reviewed — current `ConnectionsView.vue:180-430`; 附录 C.3 mobile batch-selection flow verified; other list states pending                                                                                                                                                                                                                                                                                                                              |
| `components/DockerManager.vue`                                 | `packages/frontend/src/features/docker/components/DockerManager.vue`                                                                                                                                                                                                                                                           | M15      | FontAwesome status/action icons, cards/table, expanded details and empty/error states                          | source + browser reviewed〔C.11〕— current owner preserves legacy table→narrow-card switch, left-aligned wrapped action rail, running/exited badges and expanded stats. Real E2E now proves 1s polling preference, default-expand, collapse/expand, Restart→Stop→Exited→Start→Running, destructive Remove cancel/confirm→empty, plus Enter/Logs routed as owning Workspace terminal intents                                                                    |
| `components/FavoritePathsModal.vue`                            | `packages/frontend/src/features/filesystem/components/FilesystemCatalogModal.vue`                                                                                                                                                                                                                                              | M11      | favorite/history catalog shell, sort/add/edit/delete/terminal icons, row density                               | source reviewed — current `FilesystemCatalogModal.vue:155-256`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                            |
| `components/FileEditorContainer.vue`                           | `packages/frontend/src/features/file-editor/components/FileEditor.vue`                                                                                                                                                                                                                                                         | M12      | tab/header/action layout, encoding selector, save state, editor body geometry                                  | source reviewed — current `features/file-editor/components/FileEditor.vue:195-365`; P6 mobile behavior evidence in 附录 C.2, all states pending                                                                                                                                                                                                                                                                                                                |
| `components/FileEditorOverlay.vue`                             | `packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`<br>`packages/frontend/src/features/file-editor/components/FileEditor.vue`                                                                                                                                                                    | M12      | popup overlay dimensions, mobile fullscreen behavior, search/minimize/close controls                           | source reviewed — current `runtimes/workspace/components/WorkspaceSessionSurface.vue:1089-1186`; P6 mobile behavior evidence in 附录 C.2, all states pending                                                                                                                                                                                                                                                                                                   |
| `components/FileEditorTabs.vue`                                | `packages/frontend/src/features/file-editor/components/FileEditor.vue`                                                                                                                                                                                                                                                         | M12      | tab strip, active background, dirty/close markers and context behavior                                         | source reviewed — current `FileEditor.vue:197-225`, styles `FileEditor.vue:416-451`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                       |
| `components/FileManager.vue`                                   | `packages/frontend/src/features/filesystem/components/FileManager.vue`                                                                                                                                                                                                                                                         | M11      | toolbar, path/search controls, table/list geometry, file-type FontAwesome icons, selection/context/drag states | source reviewed — current `FileManager.vue:1053-1427`, responsive rules `FileManager.vue:1662-1860`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                       |
| `components/FileManagerActionModal.vue`                        | `packages/frontend/src/features/filesystem/components/FileManager.vue`<br>`packages/frontend/src/foundation/ui/BaseModal.vue`                                                                                                                                                                                                  | M11      | mkdir/rename/chmod/action modal dimensions, inputs and actions                                                 | source reviewed — current action modal `FileManager.vue:1589-1659`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                        |
| `components/FileManagerContextMenu.vue`                        | `packages/frontend/src/features/filesystem/components/FileManager.vue`<br>`packages/frontend/src/foundation/ui/BaseContextMenu.vue`                                                                                                                                                                                            | M11      | context menu/submenu placement, icons, separators and density                                                  | source reviewed — current context menus `FileManager.vue:1441-1587`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                       |
| `components/FileManagerModal.vue`                              | `packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`<br>`packages/frontend/src/features/filesystem/components/FileManager.vue`                                                                                                                                                                    | M11      | desktop/mobile modal shell, resize/maximize/close controls and stacking                                        | source reviewed — current shell `WorkspaceSessionSurface.vue:1086-1141`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                   |
| `components/FileTransferPopup.vue`                             | `packages/frontend/src/features/transfers/components/ProgressCenter.vue`                                                                                                                                                                                                                                                       | M14      | transfer task card/list layout and action states                                                               | source + browser reviewed〔C.10〕— current transfer mode keeps compact bounded list, progress/bytes/status/error and cancel semantics; same/cross-session copy/move real SFTP plus long-stall cancellation are green                                                                                                                                                                                                                                           |
| `components/FileUploadPopup.vue`                               | `packages/frontend/src/features/transfers/components/ProgressCenter.vue`                                                                                                                                                                                                                                                       | M14      | upload task card, aggregate/per-file progress, cancel/minimize visuals                                         | source + browser reviewed〔C.10〕— upload mode keeps aggregate speed/per-file progress, cancel/cancel-all/hide/remove and persisted draggable/resizable viewport-bounded window; desktop resize/hidden-source scroll plus mobile native PointerEvent resize/drag/clamp/hide→restore are green                                                                                                                                                                  |
| `components/FocusSwitcherConfigurator.vue`                     | `packages/frontend/src/runtimes/workspace/components/WorkspaceFocusConfigurator.vue`                                                                                                                                                                                                                                           | M08      | configurator modal, ordering controls, shortcut fields, icons                                                  | source reviewed — baseline is a desktop two-column draggable configurator at `8ceb5840:components/FocusSwitcherConfigurator.vue:212-292`; current keeps viewport-bounded scrolling and button alternatives at `WorkspaceFocusConfigurator.vue:107-237`; its Workspace entry remains hidden on mobile as in the baseline, so no mobile-only surface is asserted                                                                                                 |
| `components/LayoutConfigurator.vue`                            | `packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutConfigurator.vue`                                                                                                                                                                                                                                          | M08      | layout configuration shell, controls and tree geometry                                                         | source reviewed — baseline fixed desktop geometry is `min-w-[800px]` with two-column tree/sidebar editing at `8ceb5840:components/LayoutConfigurator.vue:381-531`; current preserves that desktop-only composition at `WorkspaceLayoutConfigurator.vue:125-319`, and both old/current tab bars hide its entry on mobile; no mobile browser surface applies                                                                                                     |
| `components/LayoutNodeEditor.vue`                              | `packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutNodeEditor.vue`                                                                                                                                                                                                                                            | M08      | node editor rows, move/remove icons, nesting and spacing                                                       | source reviewed — baseline nested node editor truncates labels and keeps local overflow at `8ceb5840:components/LayoutNodeEditor.vue:111-201`; current uses wrapping control rows and nested indentation at `WorkspaceLayoutNodeEditor.vue:49-157`; it is owned by the desktop-only layout configurator, so mobile browser verification is not applicable                                                                                                      |
| `components/LayoutRenderer.vue`                                | `packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`                                                                                                                                                         | M08      | pane topology, splitter dimensions, pane backgrounds, title bars, embedded tool surfaces                       | source reviewed — baseline mobile Workspace substitutes a single terminal pane and fixed tool sibling at `8ceb5840:views/WorkspaceView.vue:791-825`; current selects one `mobilePane`, suppresses desktop sidebars and keeps the renderer in a min-h/min-w constrained flex cell at `WorkspaceSessionSurface.vue:695-1039` and `WorkspaceLayoutRenderer.vue:157-423`; browser evidence remains flow-specific                                                   |
| `components/ManageTagConnectionsModal.vue`                     | `packages/frontend/src/runtimes/workspace/components/WorkspaceTagGroupManager.vue`<br>`packages/frontend/src/features/tags/components/ConnectionTagPicker.vue`                                                                                                                                                                 | M04      | tag assignment modal/list behavior and visual hierarchy                                                        | source + browser reviewed〔C.8〕— current `WorkspaceTagGroupManager.vue`; 360px search/actions/footer geometry plus rename/filtered assign/deselect/global delete passed                                                                                                                                                                                                                                                                                       |
| `components/MonacoEditor.vue`                                  | `packages/frontend/src/features/file-editor/components/MonacoEditor.vue`                                                                                                                                                                                                                                                       | M12      | Monaco theme, sizing, scrollbar and font behavior                                                              | source reviewed — current container `MonacoEditor.vue:117-127`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                            |
| `components/NotificationSettingForm.vue`                       | `packages/frontend/src/features/notifications/components/NotificationSettingForm.vue`                                                                                                                                                                                                                                          | M07      | provider form grouping, toggles/inputs and test/save actions                                                   | source reviewed — current `NotificationSettingForm.vue:200-370`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                           |
| `components/NotificationSettings.vue`                          | `packages/frontend/src/features/notifications/views/NotificationsView.vue`<br>`packages/frontend/src/features/notifications/components/NotificationSettingForm.vue`                                                                                                                                                            | M07      | settings page/list layout and provider cards                                                                   | source reviewed — current `NotificationsView.vue:56-134`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                  |
| `components/PaneTitleBar.vue`                                  | `packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`                                                                                                                                                                                                                                              | M08      | pane title bar height, labels, minimize/close/action icon placement                                            | source reviewed — baseline component styles truncate the label at `8ceb5840:components/PaneTitleBar.vue:26-54`, but the P4 usage audit found no active import/render path; current renderer does not invent this dead title bar, and there is no mobile surface to browser-verify                                                                                                                                                                              |
| `components/PathHistoryDropdown.vue`                           | `packages/frontend/src/features/filesystem/components/PathHistoryDropdown.vue`                                                                                                                                                                                                                                                 | M11      | dropdown position, row density, copy/delete icons, hover states                                                | source reviewed — current dropdown `PathHistoryDropdown.vue:34-81`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                        |
| `components/ProgressDisplayModal.vue`                          | `packages/frontend/src/features/transfers/components/ProgressDisplayModal.vue`                                                                                                                                                                                                                                                 | M14      | shared progress modal shell, tabs/cards/actions, desktop/mobile dimensions                                     | source + browser reviewed〔C.10〕— hidden source cards expose restore/cancel-all/cancel/remove, server tasks expose queued/in-progress/completed/failed/partial/cancelling/cancelled with method/error details; desktop inline and mobile overlay are bounded/scroll-owned and real hide→restore flows pass                                                                                                                                                    |
| `components/ProxyList.vue`                                     | `packages/frontend/src/features/proxies/views/ProxiesView.vue`                                                                                                                                                                                                                                                                 | M04      | proxy list/table, actions, spacing and empty/loading states                                                    | source + browser reviewed〔C.8〕— current `ProxiesView.vue`; narrow cards stack without long-host overflow, delete failure stays visible and preserves the row                                                                                                                                                                                                                                                                                                 |
| `components/QuickCommandsModal.vue`                            | `packages/frontend/src/features/quick-commands/components/QuickCommandsPanel.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`                                                                                                                                                         | M09      | modal shell, search/list layout, execute controls                                                              | source reviewed — baseline modal body owns vertical overflow at `8ceb5840:components/QuickCommandsModal.vue:59-75`; current mobile tool opens a standard viewport-bounded modal with an independently scrolling panel at `WorkspaceMobileTools.vue:146-176`, containing `QuickCommandsPanel.vue:260-545`; existing mobile quick-command flow is specific browser evidence, not full-state closure                                                              |
| `components/RemoteDesktopModal.vue`                            | `packages/frontend/src/features/remote-desktop/components/RemoteDesktopModal.vue`                                                                                                                                                                                                                                              | M16      | remote desktop shell, toolbar, restore/minimize/fullscreen controls and canvas sizing                          | source + browser reviewed〔C.12〕— current consolidated owner retains legacy header/state badge/canvas/footer/fullscreen/minimize/restore/pointer-resize topology; real connected RDP tunnel verifies RemoteApp, bidirectional plain-text clipboard, fullscreen Escape restore and resize without product reconnect, while mobile Direct/Touchpad request-count evidence proves mode toggles do not create a new RDP session                                   |
| `components/SendFilesModal.vue`                                | `packages/frontend/src/features/transfers/components/SendFilesModal.vue`                                                                                                                                                                                                                                                       | M14      | send-files form/list layout, destination controls and actions                                                  | source + browser reviewed〔C.10〕— source connection excluded; tag/Untagged grouping, search, group selected/indeterminate, target path and Auto/rsync/scp remain in current owner. New real rsync multi-target case proves one success + one refused target → Partially Completed, method/error details, Remove and actual target file; initiation failure keeps modal state for correction/resubmit                                                          |
| `components/SshKeyManagementModal.vue`                         | `packages/frontend/src/features/ssh-keys/components/SshKeyManagementModal.vue`                                                                                                                                                                                                                                                 | M04      | key list/form modal, actions, status/empty states                                                              | source + browser reviewed〔C.8〕— current key manager is viewport-bounded/table-fixed; 320px long-key create/rename/delete and load/delete error states passed                                                                                                                                                                                                                                                                                                 |
| `components/SshKeySelector.vue`                                | `packages/frontend/src/features/ssh-keys/components/SshKeySelector.vue`                                                                                                                                                                                                                                                        | M04      | selector dropdown/list sizing, labels and actions                                                              | source + browser reviewed〔C.8〕— selector uses min-width constrained select + fixed manage action; 320px selection and load-error state passed                                                                                                                                                                                                                                                                                                                |
| `components/StatusCharts.vue`                                  | `packages/frontend/src/features/status-monitor/components/StatusCharts.vue`                                                                                                                                                                                                                                                    | M15      | chart dimensions, legends, typography and panel padding                                                        | source + browser reviewed〔C.11〕— current chart owner keeps single selected metric/history view, 1/5/10/30m sample window, stable sequence-anchored downsampling and network max-bucket spike preservation; chart min-height remains 5.5rem with a 4.75rem compact rule, matching legacy compact intent without creating a second sampler. Mobile 30m range is directly reachable in the real status modal                                                    |
| `components/StatusMonitor.vue`                                 | `packages/frontend/src/features/status-monitor/components/StatusMonitor.vue`                                                                                                                                                                                                                                                   | M15      | resource cards/rows, IP/rate layout and mobile density                                                         | source + browser reviewed〔C.11〕— current monitor retains legacy Server Status header/IP copy, CPU water-wave, memory/swap/disk cards, network rates and selected metric history. Desktop E2E proves live samples, metric switching without extra status.start/stop, IP clipboard copy and bounded persisted wheel scaling; 1-second backend setting produces timely live samples, so presentation state does not own polling cadence                         |
| `components/StatusMonitorModal.vue`                            | `packages/frontend/src/runtimes/workspace/components/WorkspaceMobileTools.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`<br>`packages/frontend/src/features/status-monitor/components/StatusMonitor.vue`                                                                            | M15      | modal/fullscreen shell and status monitor placement                                                            | source + browser reviewed〔C.11〕— legacy `max-w-2xl h-[min(78dvh,720px)] min-h-[360px]`、p-3 overlay与top-right close geometry在current mobile shell中原样保留，只去掉重复owner；真实mobile modal完全落在viewport，30m range/history可见，document无横溢出，独立打开/关闭分别新增status.start/status.stop，证明无需激活status pane且没有第二轮询器                                                                                                            |
| `components/StyleCustomizer.vue`                               | `packages/frontend/src/features/appearance/components/AppearanceCustomizerModal.vue`                                                                                                                                                                                                                                           | M06      | customizer modal size, tab strip, footer/actions and live-preview shell                                        | source + browser reviewed〔C.9〕— current four-tab shell preserves mobile fullscreen/desktop bounded geometry, independent content scroll and wrapped footer; 320×667 dialog/document geometry passed with all tabs reachable                                                                                                                                                                                                                                  |
| `components/SuspendedSshSessionsModal.vue`                     | `packages/frontend/src/features/ssh-suspend/components/SuspendedSessionsModal.vue`<br>`packages/frontend/src/features/ssh-suspend/components/SuspendedSessionsPanel.vue`                                                                                                                                                       | M16      | modal shell, session rows, resume/download/delete FontAwesome actions                                          | source + browser reviewed〔C.12〕— legacy `max-w-2xl max-h-[85vh]` modal shell、independent body scroll、top-right close与current owner一致；真实mobile入口打开后dialog完整落在viewport且document无横溢出，随后embedded链继续验证search/rename/export/remove/resume状态                                                                                                                                                                                        |
| `components/TabBarContextMenu.vue`                             | `packages/frontend/src/runtimes/workspace/components/WorkspaceTabBar.vue`<br>`packages/frontend/src/foundation/ui/BaseContextMenu.vue`                                                                                                                                                                                         | M08      | tab context menu geometry, item density and states                                                             | source reviewed — baseline menu is fixed and context-triggered at `8ceb5840:components/TabBarContextMenu.vue:65-101`; current tab long-press/context path feeds viewport-clamped `BaseContextMenu` geometry at `WorkspaceTabBar.vue:121-258` and `BaseContextMenu.vue:57-80`; mobile browser verification pending                                                                                                                                              |
| `components/TagInput.vue`                                      | `packages/frontend/src/features/tags/components/ConnectionTagPicker.vue`<br>`packages/frontend/src/foundation/ui/TokenInput.vue`                                                                                                                                                                                               | M04      | tag token/chip appearance, add/remove controls, keyboard/focus states                                          | source + browser reviewed〔C.8〕— `TokenInput` retains generic exact-Enter/filter/Backspace semantics while `ConnectionTagPicker` owns Tag CRUD; 360px long-tag real flow passed                                                                                                                                                                                                                                                                               |
| `components/Terminal.vue`                                      | `packages/frontend/src/features/terminal/components/TerminalView.vue`<br>`packages/frontend/src/runtimes/workspace/views/WorkspaceView.vue`                                                                                                                                                                                    | M10      | default terminal theme fallback, xterm geometry, search toolbar, background layers, font/selection visuals     | source reviewed — current `features/terminal/components/TerminalView.vue:682-751`; P5 mobile behavior evidence in 附录 C.2, all states pending                                                                                                                                                                                                                                                                                                                 |
| `components/TerminalTabBar.vue`                                | `packages/frontend/src/runtimes/workspace/components/WorkspaceTabBar.vue`                                                                                                                                                                                                                                                      | M08      | terminal tabs, active/dirty/close states and context actions                                                   | source reviewed — baseline mobile bar is `h-8`, horizontally scrollable, disables drag and exposes close controls at `8ceb5840:components/TerminalTabBar.vue:385-462`; current matches those branches and adds touch long-press context handling at `WorkspaceTabBar.vue:121-258`; mobile browser verification pending for multi-tab overflow/context states                                                                                                   |
| `components/UINotificationDisplay.vue`                         | `packages/frontend/src/shared/feedback/components/NotificationHost.vue`                                                                                                                                                                                                                                                        | M00      | toast placement, widths, FontAwesome status icons, colors and stacking                                         | source reviewed — current `shared/feedback/components/NotificationHost.vue:18-48`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                         |
| `components/UploadConflictModal.vue`                           | `packages/frontend/src/features/transfers/components/UploadConflictModal.vue`                                                                                                                                                                                                                                                  | M14      | conflict modal iconography, file metadata layout and decision buttons                                          | source + browser reviewed〔C.10〕— warning/file metadata/apply-to-all/Skip/Overwrite topology matches legacy; real Windows-style multi-file drag verifies one conflict decision applies to remaining batch while files stay byte-complete                                                                                                                                                                                                                      |
| `components/VirtualKeyboard.vue`                               | `packages/frontend/src/features/terminal/components/VirtualKeyboard.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceMobileTools.vue`                                                                                                                                                                     | M10      | mobile keyboard rows, modifier states, key dimensions and icons                                                | source reviewed — current `features/terminal/components/VirtualKeyboard.vue:64-133`; P5 mobile behavior evidence in 附录 C.2, all states pending                                                                                                                                                                                                                                                                                                               |
| `components/VncModal.vue`                                      | `packages/frontend/src/features/remote-desktop/components/RemoteDesktopModal.vue`                                                                                                                                                                                                                                              | M16      | VNC-specific toolbar/state within consolidated remote desktop modal                                            | source + browser reviewed〔C.12〕— VNC继续复用RDP同一window/session owner，仅保留协议特定text-send；真实connected Guacamole tunnel验证`VNC`三字符逐字key down/up、双向plain-text clipboard，且pointer resize/minimize/restore沿用同一几何语义，无第二套modal/session状态                                                                                                                                                                                       |
| `components/WorkspaceConnectionList.vue`                       | `packages/frontend/src/runtimes/workspace/components/WorkspaceConnectionList.vue`                                                                                                                                                                                                                                              | M08      | workspace sidebar connection list, row/action icons, selected/connected states                                 | source reviewed — baseline owns list scrolling, row truncation and viewport-adjusted context menus at `8ceb5840:components/WorkspaceConnectionList.vue:770-981`; current preserves min-h scrolling, grouped/flat truncating rows and viewport-clamped context menus at `WorkspaceConnectionList.vue:226-411`; mobile browser verification pending for context/tag states                                                                                       |
| `components/common/AlertDialog.vue`                            | `packages/frontend/src/shared/feedback/components/DialogHost.vue`<br>`packages/frontend/src/foundation/ui/BaseModal.vue`                                                                                                                                                                                                       | M00      | alert modal shell, title/body/actions and z-index                                                              | source reviewed — current `shared/feedback/components/DialogHost.vue:26-64`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                               |
| `components/common/ConfirmDialog.vue`                          | `packages/frontend/src/shared/feedback/components/DialogHost.vue`<br>`packages/frontend/src/foundation/ui/BaseModal.vue`                                                                                                                                                                                                       | M00      | confirm modal shell, destructive/default actions, dimensions and focus                                         | source reviewed — current `shared/feedback/components/DialogHost.vue:26-64`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                               |
| `components/preview/DocxPreview.vue`                           | `packages/frontend/src/features/file-preview/components/DocxPreview.vue`                                                                                                                                                                                                                                                       | M13      | document page sizing, background, overflow and toolbar fit                                                     | source reviewed — current scroller/host `DocxPreview.vue:130-153,187-198`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                 |
| `components/preview/FilePreviewDialog.vue`                     | `packages/frontend/src/features/file-preview/components/FilePreview.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`                                                                                                                                                                  | M13      | preview shell, tabs/title/actions and popup/backdrop sizing                                                    | browser verified — 移动专项 preview shell screenshots reviewed; 附录 C.3 landscape preview edit/save/reopen passed 1/1; M17 最终验收 refresh pending                                                                                                                                                                                                                                                                                                           |
| `components/preview/ImagePreview.vue`                          | `packages/frontend/src/features/file-preview/components/ImagePreview.vue`                                                                                                                                                                                                                                                      | M13      | image centering/fit/background and zoom/overflow behavior                                                      | source reviewed — current viewport/image `ImagePreview.vue:47-66`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                         |
| `components/preview/MarkdownPreview.vue`                       | `packages/frontend/src/features/file-preview/components/MarkdownPreview.vue`                                                                                                                                                                                                                                                   | M13      | markdown typography, spacing, code/table styling and mobile viewport                                           | source reviewed — current article/responsive typography `MarkdownPreview.vue:53-63,67-140`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                |
| `components/preview/PdfContinuousPage.vue`                     | `packages/frontend/src/features/file-preview/components/PdfPage.vue`                                                                                                                                                                                                                                                           | M13      | PDF page spacing, shadow/border and continuous scroll geometry                                                 | source reviewed — current page/canvas layer `PdfPage.vue:201-247`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                         |
| `components/preview/PdfOutlineItems.vue`                       | `packages/frontend/src/features/file-preview/components/PdfOutlineItems.vue`                                                                                                                                                                                                                                                   | M13      | outline width, indentation, active/hover styles                                                                | source reviewed — current recursive rows `PdfOutlineItems.vue:8-31`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                       |
| `components/preview/PdfPreview.vue`                            | `packages/frontend/src/features/file-preview/components/PdfPreview.vue`                                                                                                                                                                                                                                                        | M13      | PDF toolbar, outline/content split, zoom, page count and scrollbars                                            | source reviewed — current toolbar/shell/drawer `PdfPreview.vue:508-667`, mobile rules `PdfPreview.vue:751-794`; mobile browser verification pending                                                                                                                                                                                                                                                                                                            |
| `components/preview/PreviewHorizontalScrollbar.vue`            | `packages/frontend/src/features/file-preview/components/PreviewHorizontalScrollbar.vue`                                                                                                                                                                                                                                        | M13      | dedicated bottom scrollbar dimensions and sticky placement                                                     | source reviewed — current scroll rail/touch rules `PreviewHorizontalScrollbar.vue:202-258`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                |
| `components/preview/PreviewSearchBar.vue`                      | `packages/frontend/src/features/file-preview/components/PreviewSearchBar.vue`                                                                                                                                                                                                                                                  | M13      | search bar size, previous/next/close icons, count and busy state                                               | source reviewed — current trigger/search controls `PreviewSearchBar.vue:90-157`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                           |
| `components/preview/SpreadsheetPreview.vue`                    | `packages/frontend/src/features/file-preview/components/SpreadsheetPreview.vue`                                                                                                                                                                                                                                                | M13      | sheet tabs, table density, pagination, sticky controls and horizontal scrolling                                | source reviewed — current scroll/table/pagination/tabs `SpreadsheetPreview.vue:188-348`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                   |
| `components/settings/AboutSection.vue`                         | `packages/frontend/src/app/pages/settings/AboutPanel.vue`                                                                                                                                                                                                                                                                      | M05      | version/repository/update information layout and links                                                         | source reviewed — current `AboutPanel.vue:47-104`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                         |
| `components/settings/AppearanceSection.vue`                    | `packages/frontend/src/features/appearance/components/AppearanceSettingsPanel.vue`                                                                                                                                                                                                                                             | M06      | settings-section shell linking to appearance controls                                                          | source + browser reviewed〔C.9〕— Settings Appearance entry and window theme-color save/reload are covered by the real UI flow; mobile Settings shell remains M05-owned, while the customizer opened from the shared entry has independent 320px evidence                                                                                                                                                                                                      |
| `components/settings/CaptchaSettingsForm.vue`                  | `packages/frontend/src/features/security/components/CaptchaPanel.vue`                                                                                                                                                                                                                                                          | M05      | provider toggle/select/key fields, load/save state and spacing                                                 | source reviewed — current `CaptchaPanel.vue:56-120`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                       |
| `components/settings/ChangePasswordForm.vue`                   | `packages/frontend/src/features/security/components/ChangePasswordPanel.vue`                                                                                                                                                                                                                                                   | M05      | password field layout, validation/help and submit state                                                        | source reviewed — current `ChangePasswordPanel.vue:45-82`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                 |
| `components/settings/DataManagementSection.vue`                | `packages/frontend/src/features/backup/components/BackupSettingsPanel.vue`                                                                                                                                                                                                                                                     | M05      | import/export/backup cards, warnings, upload controls and actions                                              | source reviewed — current `BackupSettingsPanel.vue:93-188`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                |
| `components/settings/IpBlacklistSettings.vue`                  | `packages/frontend/src/features/security/components/IpAccessPanel.vue`                                                                                                                                                                                                                                                         | M05      | blacklist table/form section, actions and validation layout                                                    | source reviewed — current `IpAccessPanel.vue:116-242`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                     |
| `components/settings/IpWhitelistSettings.vue`                  | `packages/frontend/src/features/security/components/IpAccessPanel.vue`                                                                                                                                                                                                                                                         | M05      | whitelist table/form section, actions and validation layout                                                    | source reviewed — current `IpAccessPanel.vue:116-242`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                     |
| `components/settings/PasskeyManagement.vue`                    | `packages/frontend/src/features/security/components/PasskeyPanel.vue`                                                                                                                                                                                                                                                          | M05      | passkey rows, registration actions, badges and empty state                                                     | source reviewed — current `PasskeyPanel.vue:87-172`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                       |
| `components/settings/SystemSettingsSection.vue`                | `packages/frontend/src/features/preferences/components/PreferencesSettingsPanel.vue`                                                                                                                                                                                                                                           | M05      | language/timezone/interval/global system settings grouping and density                                         | source reviewed — current `PreferencesSettingsPanel.vue:103-289`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                          |
| `components/settings/TwoFactorAuthSettings.vue`                | `packages/frontend/src/features/security/components/TwoFactorPanel.vue`                                                                                                                                                                                                                                                        | M05      | 2FA setup/disable flow, QR/secret/input/action layout                                                          | source reviewed — current `TwoFactorPanel.vue:75-128`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                     |
| `components/settings/WorkspaceSettingsSection.vue`             | `packages/frontend/src/features/preferences/components/PreferencesSettingsPanel.vue`                                                                                                                                                                                                                                           | M05      | workspace toggles, numeric controls, section grouping and help text                                            | source reviewed — current `PreferencesSettingsPanel.vue:103-289`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                          |
| `components/style-customizer/StyleCustomizerBackgroundTab.vue` | `packages/frontend/src/features/appearance/components/TerminalBackgroundSettingsPanel.vue`                                                                                                                                                                                                                                     | M06      | background image/overlay controls and preview layout                                                           | source + browser reviewed〔C.9〕— 320px Background tab covers restored page background entry, terminal upload/remove, overlay, local HTML CRUD/conflict/apply, real GitHub remote list/search/download/apply + error/clear and nested editor layering; toolbar/list/document remain inside viewport                                                                                                                                                            |
| `components/style-customizer/StyleCustomizerOtherTab.vue`      | `packages/frontend/src/features/appearance/components/AppearanceSettingsPanel.vue`<br>`packages/frontend/src/features/appearance/components/BasicAppearancePanel.vue`                                                                                                                                                          | M06      | other appearance settings, window/page background and grouped controls                                         | source + browser reviewed〔C.9〕— current Other tab keeps grouped inputs responsive; 320px real UI saves editor family plus desktop/mobile sizes independently (15/21) and confirms both survive reload                                                                                                                                                                                                                                                        |
| `components/style-customizer/StyleCustomizerTerminalTab.vue`   | `packages/frontend/src/features/appearance/components/TerminalThemeSettingsPanel.vue`                                                                                                                                                                                                                                          | M06      | terminal theme selection/editor, color fields, import/export and preview layout                                | source + browser reviewed〔C.9〕— backend preset selection/reload and custom terminal theme CRUD/conflict/import/export are green; 320px terminal tab also persists family, desktop/mobile sizes (17/23), stroke/shadow settings without horizontal overflow                                                                                                                                                                                                   |
| `components/style-customizer/StyleCustomizerUiTab.vue`         | `packages/frontend/src/features/appearance/components/BasicAppearancePanel.vue`                                                                                                                                                                                                                                                | M06      | UI color controls, field grid, color inputs and reset/apply actions                                            | source + browser reviewed〔C.9〕— dark/default persistence and custom UI JSON apply/save are covered by real UI; 320px UI tab keeps color/value fields, JSON editor and footer actions reachable with no document overflow                                                                                                                                                                                                                                     |
| `foundation/ui/OverlayPanel.vue`                               | `packages/frontend/src/foundation/ui/OverlayPanel.vue`                                                                                                                                                                                                                                                                         | M00      | overlay positioning, non/blocking layers, border/shadow and pointer behavior                                   | source reviewed — current `foundation/ui/OverlayPanel.vue:102-135`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                        |
| `views/AuditLogView.vue`                                       | `packages/frontend/src/features/audit/views/AuditLogView.vue`                                                                                                                                                                                                                                                                  | M07      | audit filters/table/pagination/detail rendering                                                                | source reviewed — current `AuditLogView.vue:67-208`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                       |
| `views/CommandHistoryView.vue`                                 | `packages/frontend/src/features/command-history/components/CommandHistoryPanel.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`                                                                                                                                                       | M09      | embedded command-history view, search/list/actions/compact layout                                              | source reviewed — baseline embedded view is a full-height overflow-hidden column with a scrolling list at `8ceb5840:views/CommandHistoryView.vue:1-70`; current panel retains the same scroll/truncate hierarchy at `CommandHistoryPanel.vue:104-199` and renderer embedding at `WorkspaceLayoutRenderer.vue:385-403`; mobile browser verification pending                                                                                                     |
| `views/ConnectionsView.vue`                                    | `packages/frontend/src/features/connections/views/ConnectionsView.vue`                                                                                                                                                                                                                                                         | M03      | page heading/toolbar/list/modal integration and responsive layout                                              | source reviewed — current `ConnectionsView.vue:180-430`; 附录 C.3 mobile batch-selection flow verified; other page states pending                                                                                                                                                                                                                                                                                                                              |
| `views/DashboardView.vue`                                      | `packages/frontend/src/app/pages/dashboard/DashboardPage.vue`                                                                                                                                                                                                                                                                  | M02      | dashboard page composition, cards/resources/recent connections/activity layout                                 | source + browser reviewed〔C.7〕— old `8ceb5840:views/DashboardView.vue` responsive/resource/toolbar/empty/loading structure compared to current `DashboardPage.vue` and `useSystemOverview`; three migration omissions restored; 360/412 and 1440 evidence passed                                                                                                                                                                                             |
| `views/LoginView.vue`                                          | `packages/frontend/src/app/pages/login/LoginPage.vue`<br>`packages/frontend/src/features/auth/views/LoginView.vue`                                                                                                                                                                                                             | M01      | login card/banner/form sizing, captcha/2FA states and responsive centering                                     | source reviewed — current `LoginView.vue:64-155`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                          |
| `views/NotificationsView.vue`                                  | `packages/frontend/src/features/notifications/views/NotificationsView.vue`                                                                                                                                                                                                                                                     | M07      | notification settings page composition and sections                                                            | source reviewed — current `NotificationsView.vue:56-134`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                  |
| `views/ProxiesView.vue`                                        | `packages/frontend/src/features/proxies/views/ProxiesView.vue`                                                                                                                                                                                                                                                                 | M04      | proxy page heading/list/editor flow                                                                            | source + browser reviewed〔C.8〕— current page/form/cards and password semantics audited; 320px long-host lifecycle and failure feedback passed                                                                                                                                                                                                                                                                                                                |
| `views/QuickCommandsView.vue`                                  | `packages/frontend/src/features/quick-commands/components/QuickCommandsPanel.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`                                                                                                                                                         | M09      | embedded quick-command search/list/tag/execute layout                                                          | source reviewed — baseline uses a full-height scrolling list, truncating rows and narrow container rules at `8ceb5840:views/QuickCommandsView.vue:1-195,891-1023`; current retains min-width truncation, scroll ownership and compact/grouped rows at `QuickCommandsPanel.vue:260-545`; mobile browser verification pending beyond the existing open/execute flow                                                                                              |
| `views/SettingsView.vue`                                       | `packages/frontend/src/app/pages/settings/SettingsPage.vue`                                                                                                                                                                                                                                                                    | M05      | settings navigation/tabs, page width, section spacing and responsive behavior                                  | source reviewed — current `SettingsPage.vue:34-98`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                        |
| `views/SetupView.vue`                                          | `packages/frontend/src/features/auth/views/SetupView.vue`                                                                                                                                                                                                                                                                      | M01      | first-run setup card/form geometry, branding and states                                                        | source reviewed — current `SetupView.vue:50-137`; mobile browser verification pending                                                                                                                                                                                                                                                                                                                                                                          |
| `views/SuspendedSshSessionsView.vue`                           | `packages/frontend/src/features/ssh-suspend/components/SuspendedSessionsPanel.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceLayoutRenderer.vue`                                                                                                                                                        | M16      | embedded suspended-session view rows/cards/actions and polling state                                           | source + browser reviewed〔C.12〕— current embedded Panel preserves legacy search/status/inline rename、Resume/Remove/Export actions及320/300px响应式规则；real mobile lifecycle covers no-result search、rename持久化、export网络失败不删entry、真实日志下载、Remove Cancel/Confirm和same-shell resume；polling仍由`useSuspendedSessions`单一controller按3s/429指数backoff/成功恢复拥有，不在runtime复制                                                      |
| `views/TagsView.vue`                                           | `packages/frontend/src/features/tags/components/ConnectionTagPicker.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceTagGroupManager.vue`                                                                                                                                                                 | M04      | legacy tag-management surface; verify actual baseline usage before deciding exact new placement                | source + browser reviewed〔C.8〕— legacy `/tags` route was already commented out; current reachable ConnectionTagPicker + WorkspaceTagGroupManager flows replace the dead standalone view and passed 360px E2E                                                                                                                                                                                                                                                 |
| `views/WorkspaceView.vue`                                      | `packages/frontend/src/runtimes/workspace/views/WorkspaceView.vue`<br>`packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue`                                                                                                                                                                        | M08      | entire workspace composition, header visibility, sidebar/panes/tools/mobile layout and overlays                | source reviewed — baseline mobile root uses `100dvh`, a min-height-zero terminal area and non-shrinking command/keyboard siblings at `8ceb5840:views/WorkspaceView.vue:761-954`; current root and session surface preserve dynamic viewport height, mobile no-session stacking, single-pane selection and bottom tools at `WorkspaceView.vue:649-809` and `WorkspaceSessionSurface.vue:695-1039`; existing mobile workspace flows are partial browser evidence |

## 附录 B. 现有 28 个功能截图检查点

全部仍待当前最终版本的完整生成与逐图验收；已有局部比较只保留为局部证据。负责模块负责解读图中自身表面，M17负责全量齐备、共享几何回归和最终版本一致性。

| 截图                                             | 表面                            | 负责模块  | 最终验收状态                                                                                |
| ------------------------------------------------ | ------------------------------- | --------- | ------------------------------------------------------------------------------------------- |
| `dashboard-home.png`                             | Dashboard / app shell           | M02 / M00 | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-editor.png`                        | desktop file editor             | M12       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-multi-preview-tabs.png`            | preview tabs                    | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-pdf-preview.png`                   | PDF preview                     | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-preview-horizontal-scroll.png`     | preview horizontal scrolling    | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-preview-refresh.png`               | preview refresh                 | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-spreadsheet-compact-last-page.png` | spreadsheet compact pagination  | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-spreadsheet-pagination.png`        | spreadsheet pagination          | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `file-manager-spreadsheet-preview.png`           | spreadsheet preview             | M13       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `hidden-upload-progress.png`                     | hidden upload / shared progress | M14       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-context-menu.png`                        | mobile file context menu        | M11       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-editor-search.png`                       | mobile editor search            | M12       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-file-editor.png`                         | mobile editor                   | M12       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-file-manager.png`                        | mobile file manager             | M11       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-markdown-preview.png`                    | mobile markdown preview         | M13       | browser verified (partial 移动专项); pending M17 最终验收 full refresh/review               |
| `mobile-quick-commands.png`                      | mobile quick commands           | M09       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-spreadsheet-preview.png`                 | mobile spreadsheet preview      | M13       | browser verified (partial 移动专项); pending M17 最终验收 full refresh/review               |
| `mobile-status-monitor.png`                      | mobile status monitor           | M15       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-terminal-selection.png`                  | mobile terminal selection       | M10       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-upload-progress.png`                     | mobile upload progress          | M14       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-virtual-keyboard.png`                    | mobile virtual keyboard         | M10       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-virtual-modifiers.png`                   | mobile virtual modifiers        | M10       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `mobile-workspace.png`                           | mobile workspace                | M08       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `security-settings.png`                          | security settings               | M05       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `ssh-terminal.png`                               | desktop terminal                | M10       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `system-settings.png`                            | system/preferences settings     | M05       | pending — M17 最终验收 real screenshot refresh and visual review                            |
| `theme-customization.png`                        | appearance customizer           | M06       | module run refreshed〔C.9〕 at 1440×900; M17仍需对最终产品SHA做统一canonical refresh/review |
| `upload-progress.png`                            | desktop upload progress         | M14       | pending — M17 最终验收 real screenshot refresh and visual review                            |

## 附录 C. 已完成实现与验证证据

### C.1 历史 P0–P8 已完成（保留，不重做）

原阶段只作历史追溯，本版的后续执行改用模块ID。阶段成功表示该产品版本的历史审查/验证完成，不证明新工作树最终验收完成。

| 历史阶段 | 状态        | 提交/验证证据                                                                                                                                                                                                  | 历史完成范围                                                                                                                                                                                                                                                         |
| -------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0**   | ✅ Complete | `b244a8e0`                                                                                                                                                                                                     | Full `8ceb5840` frontend tree scanned; all **98** legacy Vue UI files mapped to current owners; package/bootstrap/assets/global visual sources classified.                                                                                                           |
| **P1**   | ✅ Complete | `43bf518d`; push E2E `33943448638` ✅; manual screenshot E2E `33943626951` ✅                                                                                                                                  | FontAwesome bootstrap, default terminal theme fallback, legacy-app header/nav geometry/icons/underline, shared input/icon/focus/disabled rules.                                                                                                                      |
| **P2**   | ✅ Complete | `213ae88e`, `e60a8bb5`; push E2E `33944147573` ✅                                                                                                                                                              | **9/9** P2 legacy files closed: Style Customizer shell + UI/terminal/background/other editors, notifications, alert/confirm dialogs, overlay surface behavior. The intermediate terminal-theme save regression from `33943887707` was corrected in `e60a8bb5`.       |
| **P3**   | ✅ Complete | `c267ed78`, `87c57cf3`, `907690e0`, `233a4dde`, `38ad929e`, `40e6353f`, `81faab4a`, `7140565a`; final push E2E `33945964247` ✅                                                                                | **33/33** legacy Vue files closed. Settings, connections/SSH keys/tags, dashboard/auth/setup, proxy, notifications and audit surfaces now have reviewed current-owner parity dispositions.                                                                           |
| **P4**   | ✅ Complete | `24fce130`, `4b34e62d`, `6484c3f4`, `81b1c726`, `f3fb7114`; final push E2E `33947590137` ✅                                                                                                                    | **16/16** P4 legacy Vue files closed. Desktop Workspace tabs/sidebar/layout/configurators/tag assignment/quick commands/history and no-session shell now have reviewed current-owner parity dispositions. Terminal-search behavior is intentionally completed in P5. |
| **P5**   | ✅ Complete | `4a00bb4f`, `7859790c`, `858e9cde`; final push E2E `33948612839` ✅; manual screenshot E2E `33948810189` ✅                                                                                                    | **2/2** P5 legacy files closed. Shared terminal search, xterm geometry/background/selection, mobile terminal tools and virtual-keyboard presentation now match the baseline through current terminal/runtime owners.                                                 |
| **P6**   | ✅ Complete | Editor `5f93357e`, `507f9985`, `3df67c9b`, `8f79f1dc`, `e0c3ef2b`; FileManager `2f8031dc` → `c8589b2b`; Preview `d11ae38c`, `814dc49e`; canonical E2E `33954466552` ✅; manual screenshot E2E `33954680063` ✅ | **22/22** P6 legacy owners closed. Filesystem/catalog/history, editor/CodeMirror/Monaco and Image/Markdown/DOCX/PDF/XLSX preview surfaces now have reviewed current-owner parity dispositions.                                                                       |
| **P7**   | ✅ Complete | `2f768459`, `7ff244b5`, `c9e191eb`, `dffa8dd4`, `0662e79a`, `2b6e0de0`, `05cd4501`, `a3630a72`, `03dbdb48`; canonical E2E `33956593744` ✅ and final closure E2E `33958626050` ✅                              | **7/7** P7 legacy owners closed. Archive password/progress, copy/upload progress, shared Progress Display, Send Files and Upload Conflict now have reviewed current-owner parity dispositions; final-state retention follows the current transfer requirement.       |
| **P8**   | ✅ Complete | `5d257097`, `056a142c`, `8390301d`, `4e93b1ad`; final canonical `33960186262` ✅                                                                                                                               | **8/8** legacy owners closed. Docker smoke, G1–G8 and rebalance succeeded on the mobile RDP hit-target fix; independently verified via GitHub APIs on 2026-09-05.                                                                                                    |

关键历史结论：

- P3保留旧七tab Settings、管理页列表及内嵌表面；旧Tags route已停用，不应再造页面。
- P4恢复Workspace组合，旧PaneTitleBar无active usage；layout/focus配置器属于desktop入口，不用为移动额外造表面。
- P5的Ctrl/Alt编码单一归属、SearchAddon/Terminal API保持当前所有权。
- P6的文件/编辑/预览已在当前feature/runtime恢复；之后移动外壳缺口由C.2解决，不能继续当作未实施。
- P7按当前GREQ-XFER-005保留终态任务直至用户移除，这是明确需求语义，不恢复旧自动消失行为。
- P8最终`33960186262`对应`4e93b1ad31b5367ab26ef8fe589ab08553c838d6`，Docker smoke、G1–G8、rebalance成功；2026-09-05通过run/jobs API核实。此前`33959933143`仅G7的RDP Touchpad命中失败，已由该产品修复关闭。

### C.2 已完成的本地 P9-A 修复

- `WorkspaceSessionSurface.vue`：mobile preview从无边距100dvh恢复为94dvh和四向 `max(0.75rem, env(safe-area-inset-*))`，editor仍独立全屏；无controller/adapter/provider状态改动。
- `ConnectionEditorModal.vue`、`BatchEditConnectionModal.vue`：消费者显式恢复 `!max-w-2xl/!max-w-xl !max-h-[90vh] !p-6`；Foundation维持通用preset。
- 当时`touch-advanced`、`touch-workflows`、`ssh-workspace`三个mobile specs共18/18通过；safe-area补齐后Markdown/Spreadsheet2/2通过。图片在`/tmp/nexus-p9-after`、`/tmp/nexus-p9-safe-area`，两图外壳与旧图局部复核已交付。
- mobile connection-create2/2通过；此前batch选择失败已交C.3解决。整体新工作树还未获得canonical关闭结果。

### C.3 已完成的本地 P9-B 修复与诊断

- 隔离未修改`d0c4cdb153d68e729a948a3b4c89808fa20279b6`于`/tmp/nexus-p9-head-repro.KNVhcy`，375×812真实batch E2E失败于选中后按钮disabled；non-SSH bulk通过。证据在`/tmp/nexus-p9-batch-baseline-trace`，没有覆盖dirty代码。
- `ConnectionsView.vue`恢复各action按钮的`@click.stop`，batch禁用操作区加`pointer-events-none`使row中心点击进入已有`toggleSelected`；selected/API/batchSave归属不变。仅恢复按钮stop仍失败的中间证据说明disabled命中亦需处理。
- 持久`batch-connection-edit.spec.ts`保留desktop流程并新增375×812 screen/hasTouch/isMobile case，仍用真实row点击→打开modal→保存notes→HTTP持久化断言。与`connection-non-ssh-bulk.spec.ts`最终3/3通过；未增加spec文件或测试框架。
- Markdown横屏：旧新`h-11 sm:h-8`均在915px宽度为32px；临时复用portrait最小40px断言失败不等于还原回归。无依据的coarse44改动已撤回，原断言保留。另一个915×412 touch真实preview→CodeMirror→save→close→reopen流程1/1通过，临时spec已删除。
- 本地静态gates通过：architecture254 source files、i18n1694 keys/81 fragments、vue-tsc、Vite；test-policy65 specs/28截图声明；groups63 specs/eight groups。这些是当时结果，不自动适用于未来diff。

### C.4 仍未交付的完整 mobile run

完整六个mobile specs验证和13图逐图复核曾交给子代理；目录`/tmp/nexus-p9-mobile-complete`有13张PNG，但usage-limit中断前没有收到可验收的完整run总结和逐图报告。**本计划不宣称该run全绿。** M17.01先恢复report/命令/exit及版本，无法确认再重跑；不要把测试输出或临时目录当永久事实。

### C.5 Luna max 计划试运行 — M03.04（2026-09-05）

执行模型为 `gpt-5.6-luna`，推理等级 `max`，独立任务名 `luna_max_plan_trial`。任务范围为Connections普通行320/375px身份与四动作布局；主代理保留规划编辑权并独立审查图、数据、diff。此次试运行不代表其他模块已完成，也不自动授权子代理修改共享owner。

| 轮次/检查         | 实际发现                                                                                                                 | 计划/提示词修正                                                                   | 当前结论                                  |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------- |
| 首轮语言取证      | API设置language后直接截图，标记zh-CN的画面仍是英文                                                                       | §5.2/5.4要求可见语言状态确认，不能按循环变量命名；通过真实Settings UI切换后重取证 | 首轮中文证据不接受                        |
| 取证重试          | 重试失败时空metrics与旧PNG可能留在同一目录                                                                               | 每次重试独立run目录，命令/exit/case/图/metrics必须同一次运行                      | 不能以已有图片数量认定本轮成功            |
| 修正后的before-v2 | en-US和zh-CN实际文案已确认；320/375px身份区宽0，动作右边界分别约422px/392px；页面scrollWidth仍等于viewport，因为内部裁切 | 验收增加文字区宽度及动作bbox，不能只断言页面无横滚或toBeVisible                   | 主代理独立查看截图与metrics后接受根因证据 |

有效修改前证据：`/tmp/nexus-luna-max-trial-before-v2` 的6张截图和`metrics.json`，覆盖en-US/zh-CN × 320×667/375×812/1280×800。最初`/tmp/nexus-luna-max-trial-before`的中文命名产物不作为有效中文对照。该before记录来自原Luna max试运行；当前主机上的临时目录可能已失效，不能以目录不存在否定已记录结果，也不能凭该记录反推后续diff作者。

本轮主代理复查发现，当前dirty `ConnectionsView.vue` 已有一份与上述根因吻合的候选实现：窄屏普通行改为身份区在上、动作区在下，四动作按两列换行；`sm`以上恢复横向row，现有Clone能力与batch事件边界均保留。由于此前Luna试运行记录没有把“哪个run/session写入了这份diff”与最终after证据一并落盘，本计划只把它称为**当前工作树候选实现**，不能仅凭diff形态反推为一次新的Luna交付。

主代理对候选实现做了独立验证：architecture通过（254 source files）、i18n通过（1694 keys/81 fragments）、`vue-tsc`无错误，Vite使用独立输出目录`/tmp/nexus-frontend-dist-m03-review`构建成功；test-policy通过（65 specs/28截图声明）、groups:check通过（63 specs/eight groups）、`git diff --check`通过。构建产物确认`w-[calc(50%-0.25rem)]`实际生成`calc(50% - .25rem)`，两列动作宽度与`gap-2`几何可闭合。默认Vite输出清理因历史`dist/`为root-owned而失败，改用独立输出目录后成功，故该失败归类为环境/产物权限而非编译问题。

真实浏览器环境随后完成修复并复测。用户修正了E2E目录权限后，`test/e2e/.tmp`、`test-results`、`playwright-report`均通过实际写入/删除探针。宿主仍未系统安装Playwright依赖，主代理没有修改root系统：通过用户可写的`/tmp/nexus-pw-libs`下载并解包Debian运行库，以`LD_LIBRARY_PATH`启动Chromium。首轮真实页面仍因Fontconfig缺配置在Skia渲染时fatal；补`libfontconfig`、DejaVu后可渲染英文，但中文截图为缺字方框且一轮320px英文产生字体相关宽度差异，因此这两轮均保留为**环境取证**而非视觉通过。最终再补WenQuanYi Zen Hei并用`/tmp/nexus-pw-fonts.conf`固定临时Fontconfig，英文/中文均可真实渲染；环境修复全部留在`/tmp`，未写产品依赖或系统目录。

功能邻接最终run：`batch-connection-edit.spec.ts` + `connection-non-ssh-bulk.spec.ts`先`--list`确认3个case，随后同一当前工作树 **3/3 passed (9.7s)**，覆盖desktop batch编辑、375×812 batch行中心选择→modal→notes真实持久化，以及RDP/VNC条件表单与过滤/反选/bulk删除。最终几何run先确认6个case，使用真实Settings UI从已确认英文界面切换zh-CN，并在保存后等待可见“系统”tab再进入Connections；`/tmp/nexus-m03-geometry-after-v3`和对应test-results为有效after证据，**6/6 passed (15.9s)**。

最终几何数据：320×667下en-US/zh-CN身份区均为228px，四动作各110px并形成2×2，两行及action容器均无内部overflow；375×812身份区283px，四动作各137.5px并形成2×2；1280×800身份区en-US 574px、zh-CN 618px，四动作保持同一行。最终六组`documentElement.scrollWidth === clientWidth`，记录的目标/页面overflow元素为空。主代理逐张查看最终6张PNG，确认中文不再缺字、长name/username有可读截断区、Test/Edit/Clone/Connect均完整可见，desktop未被移动布局改成堆叠。

M03.04主代理F/V/A结论：**F ✅** — 真实邻接E2E 3/3且Clone/batch/RDP/VNC现有能力未因布局修复被删；动作语义的更完整矩阵仍归M03.05。**V ✅** — before记录的320/375身份宽0与动作越界已消除，最终en-US/zh-CN六视口几何6/6及逐图复核通过。**A ✅** — 产品改动保持在Connections当前owner，未引入legacy store/event bus或共享Foundation业务规则；architecture/i18n/vue-tsc/Vite、test-policy、groups与diff检查已有本轮通过证据。临时geometry spec已删除，不新增测试框架或长期截图清单。因此M03.04可标记本地完成；canonical全组仍由M17统一关闭。

历史环境记录：当时AgentDock只暴露文件、命令、浏览器、任务等工具，容器`PATH`中没有`codex/openai/claude/gemini`，本机`agentdock` CLI无`run/agent`入口，因此该次不能产生新的Luna Max session，M03.04实现验收由主代理完成，不能冒充§5.5自测。**本轮环境已变化**：当前通过 `collaboration.spawn_agent` 可实际启动 `gpt-5.6-luna`/`max`/`fork_turns=none`，已进入新的独立planning试验；不再沿用历史`BLOCKED(model-runner)`作为当前结论。是否通过仍须分别记录fresh-reader与execution实际交付，不能由runner可用或M03.04产品完成推断。

### C.6 M03 Connections 模块关闭（2026-09-05）

用户后续明确要求不再等待Luna Max，改由主代理逐模块直接完成计划。M03.05因此按SRS-CONN-001–010和模块表重新做缺口核对；第一轮直接复用既有测试得到UI 7/7、SSH 2/2、HTTP lifecycle 1/1通过，但主代理没有据此关闭模块，因为当时仍缺少`Test All`、行级`Connect`、管理页UI clone、连接表单password↔saved-key切换以及batch partial failure的直接证据。

缺口补证没有新增spec文件或测试框架，只增强现有owner相关测试：

- `ui/connection-create.spec.ts`：普通SSH表单仍先真实`test-unsaved`再保存；新增管理页Clone按钮→distinct row→clone凭据仍可真实SSH test，行级Connect必须路由到带单一`connectionId`的Workspace；script模式原有两条SSH/tag/notes持久化后，新增当前搜索过滤集上的`Test All`，实际观察到且只接受两条目标`POST /connections/:id/test`成功响应。
- `ui/ssh-key-management.spec.ts`：原SSH key新增→只改名且不重传private key→删除链不弱化；在key存在期间新增Connections表单集成：选择saved key保存后API必须为`authMethod=key + sshKeyId`，再从编辑表单切回Password、输入真实E2E密码，保存后必须为`authMethod=password + sshKeyId=null`，且真实SSH test成功。
- `ui/batch-connection-edit.spec.ts`：新增可控partial-update场景。UI先选中两条连接，再通过真实API删除其中一条制造并发失效；batch保存notes后必须出现`1 succeeded, 1 failed`提示、modal保持打开、成功项取消选择、失败项仍保持ring选择，成功记录notes真实持久化、失效记录保持404。

补证后先单独重跑修改的三个UI spec，`--list`确认6个case，**6/6 passed (18.9s)**；其中增加管理页UI clone后再跑`connection-create.spec.ts`，**2/2 passed (10.0s)**。最终M03关闭run重新从当前工作树执行直接相关矩阵：UI **8/8 passed (24.8s)**，SSH **2/2 passed (10.0s)**，HTTP clone/credential lifecycle **1/1 passed (4.7s)**，总计11个目标case全部通过。UI 8项覆盖普通/窄屏batch、partial failure、regular/script SSH、RDP/VNC、RemoteApp、SSH key管理与auth切换；SSH 2项覆盖保存密码不重输的编辑/重测/删除和Workspace连接搜索；HTTP lifecycle覆盖update/tag/clone/credential/delete独立持久层语义。

最终静态门槛同一工作树重新通过：`git diff --check`；`format:check`；test-policy仍为65个E2E spec、28个functional screenshot declaration；groups仍为63个spec恰好分配到8组；frontend architecture为254 source files无禁止依赖环；i18n为1694 keys / 3 locales / 81 fragments；`vue-tsc --noEmit`和Vite production build均成功（2663 modules transformed）。本轮M03.05新增的是验收测试与计划证据，未为补测试而修改Connections产品语义；M03.02–04已有产品dirty改动继续保留。

M03模块F/V/A结论：**F ✅** — SRS-CONN-001/003/004/005/008/009的管理表面关键操作与secret语义由上述真实UI/API链覆盖，Clone/Test/Test All/Connect、password↔key、RDP/VNC/RemoteApp、batch正常/partial、notes均有直接结果；SRS-CONN-002搜索/列表偏好和010导出仍由各自既有需求/模块证据承担，不因M03.05重复造测试。**V ✅** — M03.02 modal、M03.03 normal/batch事件边界、M03.04 en-US/zh-CN × 320/375/1280几何及逐图复核均在当前Connections产品diff上有效，新增行为测试未改产品布局。**A ✅** — 产品状态仍由`features/connections` owner及公开capability承担，SSH key通过`features/ssh-keys/public`组合，未复活legacy store/event bus、未向Foundation下沉Connections规则，architecture gate通过。故M03自身适用子任务全部本地闭环；只保留M17对最终产品SHA的统一canonical复核。

### C.7 M02 Dashboard 模块关闭（2026-09-05）

M02接手时先读取SRS-DASH-001–005，并以`8ceb5840:packages/frontend/src/views/DashboardView.vue`为旧UI主源码、`8ad24a03:doc/imgs/e2e/dashboard-home.png`为辅助截图，对当前`DashboardPage.vue`与`features/system-overview/composables/useSystemOverview.ts`逐段补审。当前架构已经保留搜索name/username/host、tag/sort/order本地持久化、local/remote独立轮询，以及`loadLocal/loadRemote`的loading guard，未在Dashboard复制连接或采样状态；响应式主网格、Quick Connect/SSH Resources双栏、connection toolbar/rows、recent activity断点与旧源码保持同一拓扑。

源码审计发现三处实际迁移遗漏并在Dashboard owner内最小恢复：1) 旧连接列表及Recent Activity初次加载明确显示`common.loading`，当前虽保留`loading` ref却未接回模板，导致加载阶段误显示空状态；现已恢复连接列表、tag option及活动区loading分支。2) 旧版选中tag但无结果时使用`dashboard.noConnectionsWithTag`，当前退化为通用空状态；现已恢复tag专属空文案。3) 旧SSH Resources标题右侧显示`dashboard.resources.snapshot`刷新周期badge，当前偏好值与i18n key仍存在但UI漏渲染；现以`preferences.values.value.remoteHostRefreshIntervalSeconds`恢复。旧源码硬编码`NEXUS`小品牌字样未恢复，继续保留当前`projectName`本地化能力，这是现有功能而非视觉遗漏。

视觉取证中首轮暗色`dashboard-home.png`出现白色input/select。主代理没有在Dashboard加局部暗色hack，而是回查新旧Appearance store/default theme：两版`parseTheme`都将缺字段与`defaultUiTheme`合并，真实`darkUiTheme`明确含`--input-bg-color:#2b3035`；问题来自E2E手写`DASHBOARD_DARK_THEME`漏掉input变量。测试fixture已补齐真实darkUiTheme对应input变量。语言证据也按C.5规则纠正：不再把API写`zh-CN`当界面已切换；最终workflow先将后端置en-US，再通过真实Settings UI选择zh-CN、保存并等待可见“系统”tab，然后再进入Dashboard。最终`/tmp/nexus-m02-final-screens/dashboard-home.png`为真实中文暗色1440×900截图，主代理与`/tmp/nexus-old-dashboard-home.png`逐图复核，输入控件、双栏、连接卡、远程资源、刷新badge与Recent Activity拓扑一致。

最终浏览器关闭run从当前工作树执行：`mobile/dashboard-mobile.spec.ts` **2/2 passed (14.7s)**。第一case在真实Settings UI切换zh-CN后覆盖360×800和412×915、local/remote资源开启、主要section全部水平落在viewport、搜索独占首行、tag/sort/order第二行、Connect为移动全宽动作；第二case关闭local/remote资源，先删除全部连接验证两视口空状态与无横溢出，再创建两条长name/username SSH连接，在两视口验证搜索、tag/sort/order、两行与Connect均可达，并实际点击Connect确认Workspace URL携带目标`connectionId`。`ui/dashboard-workflows.spec.ts` **3/3 passed (31.6s)**：remote loading panel尺寸/背景；local+remote受控网络失败保持在资源panel且Quick Connect不阻塞；主workflow覆盖真实系统状态、三remote hosts、search、tag专属空状态与持久化、sort/order持久化、30秒refresh badge、1440桌面几何、资源独立开/关及Audit入口。资源错误测试使用真实页面与`route.abort('failed')`制造传输失败，不伪造HTTP响应或成功数据；该方式通过仓库test-policy。

M02模块F/V/A结论：**F ✅** — SRS-DASH-001/002的overview、quick connect、search/tag/sort/persistence，003/004的local/remote独立加载、refresh配置、loading/error、不阻塞与no-overlap源码guard，以及005的移动空/多连接与Connect均有直接证据。**V ✅** — 360/412真实zh-CN资源开启场景与资源关闭的0/多连接场景均无页面横溢出；1440最终中文暗色截图与旧辅助图逐图复核，三处迁移遗漏已恢复，测试fixture伪差异已排除。**A ✅** — Dashboard仍只组合Connections/Tags/Audit/SystemOverview/Preferences公开owner；采样逻辑保持`features/system-overview`，轮询参数来自Preferences，未复活旧Dashboard store或把业务规则下沉Foundation。故M02自身本地闭环，仅待M17最终产品SHA canonical复核。

### C.8 M04 SSH keys / Tags / Proxies 模块关闭（2026-09-05）

M04按SRS-SSHKEY-001、SRS-TAG-001、SRS-PROXY-001重新从旧源码和当前owner逐行补审。旧`8ceb5840`的`SshKeyManagementModal.vue`/`SshKeySelector.vue`对应当前`features/ssh-keys`两个组件；旧`TagInput.vue`的“过滤已选项、Enter精确匹配或创建、空输入Backspace只移除本地最后一个token、全局删除单独确认”语义由`foundation/ui/TokenInput.vue`+`features/tags/ConnectionTagPicker.vue`保留，Tag产品API仍只在`features/tags`；旧`TagsView.vue`在legacy router中本来就是注释/停用route，当前仍无`/tags`页面，只通过Connection form与Workspace tag group manager提供可达管理面。旧`AddProxyForm.vue`/`ProxyList.vue`/`ProxiesView.vue`对应当前`features/proxies`，密码留空保留、显式clear与新密码互斥逻辑仍在feature owner。

源码补审发现并修复了移动/错误态缺口：SSH key selector增加`min-w-0`并在list加载失败时给可见错误；key manager改为viewport约束宽度、table-fixed和长key换行，加载/删除失败不再静默。Proxy删除失败现在通过feedback显式报告且store不会乐观移除；旧proxy modal的`min-w-[350px]`确属legacy已有窄屏问题，当前改为320px时`calc(100vw - 2rem)`、`sm`以上才恢复350px最小宽度，同时proxy card在窄屏改为上下结构、长host/username可断行。WorkspaceTagGroupManager把“search + 3 selection actions”从窄屏强制单行改为搜索独占一行+三列动作，footer允许换行；desktop从`sm`起仍恢复旧并排拓扑。ConnectionTagPicker只恢复旧测试/可追溯hook给通用TokenInput，没有把Tag CRUD塞进Foundation。

浏览器环境本轮首跑再次暴露host缺失`libglib-2.0.so.0`；这属于环境而非产品。复用之前下载到`/tmp/nexus-pw-libs`的用户态动态库，并使用`/tmp/nexus-pw-fonts.conf`解决Fontconfig后，固定了`/tmp/nexus-e2e-env.sh`（`LD_LIBRARY_PATH`、`FONTCONFIG_FILE`、既有Playwright浏览器路径）。按用户要求这些环境文件不清理，后续模块继续复用。曾有一次把`XDG_CACHE_HOME`指向`/tmp`导致Playwright误找浏览器，以及Tag测试两次因teleported context menu/BaseModal footer被错误限定在内部DOM作用域而超时；另一次Proxy 70000端口由HTML `max=65535`在submit前原生拦截。三者均已按真实DOM/浏览器语义修正测试，未计作产品失败。

最终关闭run在同一工作树真实执行：UI `ssh-key-management.spec.ts + proxy-management.spec.ts` **3/3 passed (10.6s)**，覆盖320px长key/selector/modal、key import/create/rename/select、password↔saved-key、key load/delete失败、HTTP proxy创建→SOCKS5编辑、端口原生range校验、空密码保留、替换密码自动取消clear、显式clear、删除失败及最终删除；SSH `connection-list-search.spec.ts` **2/2 passed (11.5s)**，其中新增Tag case在360px通过Connection editor真实创建长tag，验证Backspace仅本地移除、exact Enter复用同一tag、Workspace manager rename、filtered assign/deselect、global delete与API关联一致，且dialog/document无横溢出；HTTP `connections-tags.spec.ts` **3/3 passed (9.0s)**，其中首case为M04直接的connection/tag持久层邻接回归，另两case是同文件system-resource邻接回归，不把它们额外冒充M04功能覆盖。因此关闭run共执行8个case，其中6个直接支撑M04、2个为邻接回归。

M04模块F/V/A结论：**F ✅** — SSH key CRUD/secret-preserve/select、Proxy SOCKS5+HTTP CRUD/secret preserve-clear/failure、Tag create/exact-select/local-remove/rename/assign/deselect/global-delete均有真实浏览器/API链。**V ✅** — 320px key/proxy与360px tag manager使用长不可断key名、长host、长tag直接验证无页面横溢出；modal可滚动且selection/footer可达，`sm`以上仍保留旧桌面布局。**A ✅** — SSH keys/Tags/Proxies状态与API仍由各feature owner持有；Workspace只编排tag membership，TokenInput不包含Tag API，旧standalone TagsView不复活，architecture gate必须继续通过。故M04自身本地闭环，仅待M17对最终产品SHA做统一canonical复核。

### C.9 M06 Appearance / Themes / Background / PWA 模块关闭（2026-09-05）

M06按SRS-APPEAR-001–005与SRS-PWA-001重新补审旧`StyleCustomizer.vue`及UI/Terminal/Background/Other四个tab到当前`features/appearance` owner。当前`AppearanceCustomizerModal.vue`仍保留移动全屏、桌面`90%/800px/85vh/700px`、四tab导航、独立内容滚动与footer；UI颜色/JSON仍由`BasicAppearancePanel`编辑并最终写回单一Appearance store；terminal preset/custom theme仍由`TerminalThemeSettingsPanel`消费后端catalog，未把preset目录复制进前端。旧Other/Terminal的字体与文字效果能力已收敛到`BasicAppearancePanel`和`TerminalBackgroundSettingsPanel`，desktop/mobile terminal与editor字号继续使用独立字段。

源码补审发现三处真实迁移/持久化缺口并最小修复。第一，`TerminalBackgroundSettingsPanel`仍实现page background upload/remove，但当前Style Customizer只以`section="background"`挂载，而page控件只存在`section="all"`分支，导致SRS-APPEAR-004页面背景能力实际不可达；现将page background入口恢复到既有Background tab。第二，Background tab里的local HTML preset editor使用默认`BaseModal zIndex=50`，而Customizer外壳是`z-[1000]`，真实320px浏览器中editor被外壳压在后面、Save持续被底层列表拦截；只对该nested editor设`z-index=1100`，不修改Foundation默认层级。第三，后端`AppearanceSettingsService.get()`对`remote_html_presets_url`使用`stored || default`，因此用户清空URL后存储空字符串却又读取成默认仓库，无法满足“clearing repository disables remote list”；现改为“key不存在才取默认，key存在但为空返回null”。非法非GitHub URL仍由既有校验400拒绝，不为测试放宽安全约束。

最终UI关闭run执行`theme-switching.spec.ts + custom-terminal-theme.spec.ts` **7/7 passed (32.2s)**：原有window/PWA theme-color即时更新与刷新持久、dark→reload→default、后端preset发现/应用/刷新、custom terminal theme create/edit/apply/delete继续通过；新增320×667真实customizer case验证dialog/document无横溢出、自定义UI JSON写回、terminal font family与desktop/mobile字号17/23独立、editor desktop/mobile字号15/21独立、stroke/shadow持久并reload保持；新增Background/HTML case真实上传1px PNG到page/terminal并确认Appearance API与body background CSS、保存overlay 0.37、local HTML create→duplicate 400且不覆盖→apply→rename→delete；真实远端链保存项目GitHub repo `0honus0/nexus-terminal/tree/main/doc/custom_html_theme`，后端list 200后搜索`丝带.html`，从`raw.githubusercontent.com`真实下载内容并apply，随后Appearance API精确持久同一HTML；再验证invalid remote repo save/load 400不改当前HTML、clear repo持久为null并禁用Load、最终page/terminal background真实删除；PWA case真实fetch `/manifest.json`、`/sw.js`、144/192/512 icons均200，并确认Service Worker注册脚本为稳定`/sw.js?v=4`。HTTP `terminal-themes.spec.ts` **1/1 passed (3.8s)**，覆盖custom terminal theme create/conflict/update/export/import/delete完整生命周期。

本轮浏览器继续复用保留的`/tmp/nexus-e2e-env.sh`、`/tmp/nexus-pw-libs`与`/tmp/nexus-pw-fonts.conf`，未重复安装也未清理。调试中的非产品失败均明确分离：新增测试文本残留patch前缀`+`；从错误workdir运行Prettier/Playwright；最初错误期待非法`example.com`仓库URL可被保存；两次Playwright webServer在部分启动后退出，短暂遗留29090/22223等E2E专用端口，按`/proc` socket→PID确认只清理测试服务后重跑。它们都没有计作产品失败，且未清理用户要求保留的浏览器/字体/动态库环境。真正产品失败只有上述page入口、nested modal层级、remote URL清空回退三项，并均由重跑真实case确认修复。

最终静态门槛同一工作树重新通过：`git diff --check`、`format:check`、test-policy（65 E2E specs / 28 functional screenshots）、groups（63 specs / 8 groups）；frontend architecture 254 source files无禁止依赖环，i18n 1694 keys / 3 locales / 81 fragments，`vue-tsc --noEmit`与Vite production build成功（2663 modules）；backend architecture 218 files无禁止layer/module cycle，backend `tsc` build成功。

M06模块F/V/A结论：**F ✅** — SRS-APPEAR-001的default/dark/custom与持久化、002的API preset和desktop/mobile typography、003的custom terminal theme CRUD/conflict/import/export、004的page/terminal background、HTML preset、本地/真实GitHub远端应用/错误保护与文字效果、005的theme-color，以及PWA-001的稳定资源/Service Worker启动链均有当前工作树直接证据。**V ✅** — 320×667 customizer四tab、footer、Background/HTML列表与nested editor都可达且document无横溢出；最终重新采集`/tmp/nexus-m06-final-screens/theme-customization.png`（1440×900）并与`8ceb5840:doc/imgs/e2e/theme-customization.png`逐图复核，modal尺寸/位置、四tab、UI fields、暗色层级与footer三动作一致，差异仅为实时资源数值/审计记录内容；移动最窄宽度比375px更严格。**A ✅** — Appearance状态仍只有`features/appearance` store，app只初始化/应用，terminal preset catalog仍归后端，nested modal只调消费者z-index，没有改变Foundation默认语义；remote URL修复留在后端Appearance owner。故M06自身本地闭环，仅待M17最终产品SHA/canonical与28图统一复核。

### C.10 M14 Transfers / Archive / Progress 模块关闭（2026-09-05）

M14按SRS-XFER-001–009补审旧`ArchivePasswordModal.vue`、`ArchiveProgressPopup.vue`、`FileTransferPopup.vue`、`FileUploadPopup.vue`、`ProgressDisplayModal.vue`、`SendFilesModal.vue`、`UploadConflictModal.vue`七个owner到当前`features/transfers`、Workspace archive组合与filesystem入口。源码对照确认当前`ProgressCenter`仍统一展示upload/copy-move-transfer/archive任务，并保留aggregate speed、per-task progress、cancel/cancel-all、hide、final remove、drag/resize和窗口几何持久；`ProgressDisplayModal`只消费shared progress/server-transfer owner，提供hidden source Restore/Cancel All及server task状态/方法/错误细节；`SendFilesModal`仍按Tag+Untagged分组、search、group selected/indeterminate、目标路径和Auto/rsync/scp提交；`UploadConflictModal`保留Overwrite/Skip/apply-to-all。旧七个owner和SRS都没有独立“Retry”按钮：失败的Send Files发起保持输入可修正后重新提交，最终task由Remove清理，因此M14.04原先的`retry/remove`已纠正为实际legacy/SRS语义，不为清单造新能力。

本轮先在未改产品实现的同一工作树跑M14现有SSH关闭矩阵：`cross-session-transfer.spec.ts`、`file-upload.spec.ts`、`progress-display-archive-cancel.spec.ts`、`progress-display-archive.spec.ts`、`progress-display-baseline.spec.ts`、`progress-display-copy-cancel.spec.ts`、`progress-display-upload-copy.spec.ts`、`upload-protocol.spec.ts`共 **20/20 passed (5.7m)**。其中包括多文件/Windows drag+apply-all conflict、moderate/slow SFTP backpressure、desktop popup resize+hidden source scroll、Progress Display Cancel All、32轮cancel→offline→backend reset→SSH reset→fresh Workspace WebSocket reconnect压力链、archive prepare stall cancellation、compress/decompress hide→restore/cancel、overlap archive ownership、FileManager关闭/卸载仍保留任务、copy/upload hidden restore/cancel以及raw binary upload完成。取消压力场景中的stale SFTP `file closed`/`No response from server`日志发生在已取消stream清理阶段，case最终状态和fresh reconnect均通过，不计作产品失败。

为补原有证据缺口，本轮直接增强现有E2E而不新增内部oracle。`progress-display-baseline.spec.ts`的Send Files case现在通过真实UI search过滤两个目标：先单选一个并验证group checkbox进入indeterminate，再点group选择两个目标，显式选择`rsync`；一个目标使用真实E2E SSH，另一个使用拒绝端口。最终真实server task为`Partially Completed`，子任务同时出现Completed/Failed，UI展示`Method: rsync`与失败Error，final Remove后task消失，且重新打开File Manager可确认目标`server-transfer-e2e/seed.txt`真实存在。最终该增强case **1/1 passed (12.1s)**。为让server-transfer正向链能够使用测试SSH的虚拟根，`support/test-ssh-server.mjs`只对scp/rsync exec中“宿主绝对路径不存在、但虚拟SSH root中同路径真实存在”的quoted path做映射；`/usr/bin`和用户态工具路径不改。之前仅验证失败分支的harness因此能真实验证正向transfer，而产品server-transfer参数没有为测试改写。

移动Progress证据也直接增强既有`mobile/touch-advanced.spec.ts`：在Pixel移动viewport的真实双文件upload中，除原有speed/hide/cancel-all/resize control、`mobile-upload-progress.png`入口、hide→Progress Display→Restore→Cancel All外，现在用浏览器原生PointerEvent实际缩小窗口并验证宽高变化且仍完全落在viewport，再拖标题到左上角并验证consumer clamp到约8px安全边界；增强case最终 **1/1 passed (9.8s)**。首次用`page.mouse`没有触发mobile/touch项目的pointer handler，只证明测试输入类型不匹配，改为组件真实监听的PointerEvent后通过，不计产品失败。

Archive/password无需重复造case：现有`file-manager-context-menu.spec.ts`真实右键流程已覆盖zip/tar.gz/tar.bz2、加密ZIP、129字符拒绝/128字符边界、shell特殊字符密码、删除后自动探测加密、错误密码提示并保留prompt、正确密码后实际解压恢复；本轮定向重跑该主case **1/1 passed (43.7s)**。另有既有protocol E2E覆盖backend password错误码/最大长度，密码仍只存在临时请求/UI状态，不持久化或写日志。

测试环境继续按用户要求保留。为补server-transfer正向链，在`/tmp/nexus-e2e-tools`用户目录加入`sshpass 1.09`、`rsync 3.2.7`及`libpopt`，并由`/tmp/nexus-e2e-env.sh`和`BASH_ENV`提供给测试SSH exec；未安装系统/root包。此前Chromium/Fontconfig环境`/tmp/nexus-pw-libs`、`/tmp/nexus-pw-fonts.conf`继续复用，不清理。

M14模块F/V/A结论：**F ✅** — SRS-XFER-001/001A/002的多文件、目录/empty-item与stream/backpressure由现有upload/protocol链支撑；003 conflict overwrite/skip/apply-all、004取消且stale事件不复活、005 shared progress/hide/restore/cancel/速率、006同/跨session copy/move、006A Send Files grouping/multi-target/method/partial/error/remove与真实文件结果、008 archive格式/密码/partial/cancel、009下载邻接能力均有当前工作树真实证据。**V ✅** — P7旧视觉继承，desktop upload popup真实resize/scroll/hide、shared ProgressDisplay desktop inline/mobile overlay、移动floating progress真实resize/drag/clamp/minimize均有几何证据；`upload-progress.png`、`hidden-upload-progress.png`、`mobile-upload-progress.png`仍由M17对最终产品SHA统一canonical刷新。**A ✅** — transfer任务继续单一归属`features/transfers`/backend transfers owner，filesystem只提供source selection，Workspace只编排session绑定与入口；未新增global progress registry/event bus，archive password不持久化；本轮唯一实现外改动是E2E SSH虚拟路径harness，不改变产品协议/状态owner。故M14自身本地闭环，仅待M17最终产品SHA/canonical统一复核。

### C.11 M15 Status / Charts / Docker 模块关闭（2026-09-05）

M15按SRS-STATUS-001与SRS-DOCKER-001/002重新补审旧`StatusMonitor.vue`、`StatusCharts.vue`、`StatusMonitorModal.vue`、`DockerManager.vue`四个owner。Status的当前实现仍由`features/status-monitor`持有`StatusMonitorSessionController`、history与downsampling：consumer只通过activate/deactivate增减引用，workspace连接状态与实际sampler启停在controller内串行化；CPU/Memory/Swap/Disk/Network选择和1/5/10/30分钟range只是组件本地presentation state，不会自行start/stop采样。`StatusCharts`按单调sequence做稳定bucket，下采样network时使用max保留短峰，并只在阈值跨越时调整network axis，避免每样本剧烈重标尺。旧mobile `StatusMonitorModal`的`max-w-2xl h-[min(78dvh,720px)] min-h-[360px]`、p-3 overlay和top-right 32px close在`WorkspaceMobileTools`中原样保留，当前只是复用feature owner而不再复制状态。Docker仍由`features/docker/useDocker`持有polling、loading/error、expanded IDs与command→forced refresh；Workspace只把Enter/Logs intent送到该session terminal，没有第二套Docker transport或轮询器。

本轮先跑未增强前的直接基线：SSH `docker-manager-ui.spec.ts`、`panel-wheel-scaling.spec.ts`主case、`status-docker-protocol.spec.ts` **3/3 passed (15.3s)**；mobile `ssh-workspace.spec.ts` **1/1 passed (8.2s)**。已有证据确认live status、CPU/memory/network数据、history card与4个range DOM、bounded scale persistence、Docker list/stats/Stop以及mobile独立Status Monitor入口，但对SRS里的设置驱动polling/default-expand、完整Docker action/terminal intent、metric/range不重启sampler与mobile range几何缺少直接验收，所以本轮继续补E2E而没有据此提前关闭模块。

`panel-wheel-scaling.spec.ts`主case现在从浏览器真实WebSocket统计`status.start/status.stop`与`status.sample`：CPU→Network切换期间新的sample继续到达且control frame计数不变，证明metric presentation不会重启sampler；同时授予真实clipboard权限后点击`127.0.0.1`并从`navigator.clipboard`读回同值，原有0.65–1.6 Ctrl+wheel边界与settings持久化断言不弱化。`status-docker-protocol.spec.ts`把`statusMonitorIntervalSeconds`设为1秒，要求bootstrap后第三个不同timestamp样本在2.5秒内到达，并继续验证network rate与Docker protocol payload，直接证明backend sampler使用Settings cadence。关闭run中`panel-wheel-scaling.spec.ts`四个case与protocol case **5/5 passed**；前者还保留large wheel delta、File Manager邻接scale与乱序settings响应“最新值胜出”回归。

`docker-manager-ui.spec.ts`与test SSH harness一起补足真实动作闭环。测试SSH的Docker fixture不再永远返回固定running container，而是在`/reset`回到running，并对真实remote `docker start/stop/restart/rm -f`命令维护running/exited/removed状态；这只改变E2E server，不改产品协议。UI case把`dockerStatusIntervalSeconds=1`、`dockerDefaultExpand=true`写入真实Settings，打开manager后必须在2.5秒内看到至少两次自动`docker.status`、详情默认展开且可通过当前可见的responsive Collapse/Expand footer往返；随后Restart、Stop后UI变`Exited (0)`且Start启用/Stop+Restart禁用，Start后回`Up 10 minutes`。Enter与Logs分别必须产生owning Workspace的`terminal.input`：`docker exec -it <id> sh\r`与`docker logs --tail 1000 -f <id>\r`。Remove第一次Cancel不得产生`docker.command remove`；第二次Confirm后必须发remove、row消失并显示真实empty state。最后受影响Docker case **1/1 passed (10.0s)**。

`mobile/ssh-workspace.spec.ts`在原mobile SSH/long-press流程上补Status几何与生命周期：dialog必须完整落在viewport，选CPU后History range的1m/30m都真实可见，点30m后active state成立，history card横向仍在modal内且`documentElement.scrollWidth <= viewport.width`；更重要的是打开modal前后`status.start`计数增加、关闭后`status.stop`计数增加，证明mobile modal作为独立consumer不依赖隐藏status pane。该增强case最后 **1/1 passed (8.6s)**。调试期间一次range button在默认矮desktop pane中不可见，是`@container status-pane (max-height: 300px)`按设计隐藏range rail，因此没有用hidden DOM强点；range验收移到legacy本就为该场景提供的高mobile modal。另一次Docker默认展开测试最初点到DOM中存在但CSS隐藏的desktop toggle，改为当前可见responsive footer；这两项均是测试定位问题，不计产品失败。

最终关闭run在当前工作树重新执行上述直接矩阵：SSH三文件共 **6/6 passed (29.5s)**，mobile `ssh-workspace.spec.ts` **1/1 passed (8.5s)**。该最终run发生在responsive Docker locator修正之后，因此没有把中间失败拼成最终通过。随后静态门槛重新通过：`git diff --check`、`format:check`、test-policy（65 E2E specs / 28 functional screenshots）、groups（63 specs / 8 groups）；frontend architecture 254 source files、i18n 1694 keys / 3 locales / 81 fragments、`vue-tsc --noEmit`与Vite build（2663 modules）成功；backend architecture 218 files及`tsc` build成功。

M15模块F/V/A结论：**F ✅** — Status live数据、Settings采样间隔、metric/range、本地history state、IP copy、scale持久与open/close sampler生命周期均有当前工作树直接证据；Docker Settings polling/default-expand、list/stats、expand/collapse、start/stop/restart/remove确认、Enter/Logs terminal intent与empty state也全部经过真实UI/WS/remote exec链。**V ✅** — P8恢复的资源cards/water-wave/network/history层级与Docker table→窄card topology未在本轮改产品；legacy mobile modal关键几何原样保留，真实mobile dialog/history/range验证无横溢出。`mobile-status-monitor.png`仍由M17对最终产品SHA统一canonical刷新。**A ✅** — sampler/history/downsampling继续单一归属`features/status-monitor`，Docker polling/action state继续单一归属`features/docker`，Workspace只组合session/terminal intent；本轮没有产品源改动，只增强现有E2E与E2E SSH Docker fixture。故M15自身本地闭环，仅待M17最终产品SHA/canonical统一复核。

### C.12 M16 Remote Desktop / VNC / SSH suspend 模块关闭（2026-09-05）

M16按SRS-RD-001–007与SRS-WS-005重新补审旧`RemoteDesktopModal.vue`、`VncModal.vue`、`SuspendedSshSessionsModal.vue`、`SuspendedSshSessionsView.vue`四个owner。当前RDP/VNC仍只由`features/remote-desktop/RemoteDesktopModal.vue`拥有Guacamole client、window geometry、fullscreen/minimize/restore、resize、keyboard/mouse/touch与clipboard生命周期，VNC只增加协议特定text-send，没有重新拆出第二套session/modal owner；`sendSize()`只向已连接client发display size，不会重新创建session。移动Direct/Touchpad仍只更新`nexus.rdp.touch-mode`并重新绑定touch handler，不调用`connect()`；hidden keyboard sink在composition期间不清空值。SSH suspend继续由`features/ssh-suspend`单一controller拥有list/rename/export/terminate/remove与polling：默认3秒，429指数backoff到60秒，其他错误至少10秒，成功后恢复3秒；Workspace只负责mark/resume组合。legacy suspended modal的`max-w-2xl max-h-[85vh]`和独立body scroll仍保留，Panel继续保留320px标题wrap与300px动作文字隐藏/至少44px icon-only规则。

未增强前的M16直接基线已在同一工作树通过：UI `rdp-remoteapp-fullscreen.spec.ts` **3/3 passed (11.3s)**，mobile `suspend-resume-ui.spec.ts` **1/1 passed (12.7s)**，SSH `suspend-resume.spec.ts` **1/1 passed (4.5s)**，HTTP `rdp-remoteapp.spec.ts` **1/1 passed (3.7s)**。这些基线已证明RemoteApp token参数、browser fullscreen、RDP/VNC pointer resize/minimized restore与mark→reload→same-shell resume主链，但原E2E remote gateway只发token，Guacamole WebSocket从未真正进入CONNECTED，因此旧case只能检查VNC输入/clipboard控件存在，不能拿来宣称协议输出已经验收。

为补该缺口，本轮只增强E2E gateway，不改产品remote-desktop协议。`test-remote-gateway-server.mjs`新增最小Guacamole WebSocket上游：验证真实token query、连接后发送标准`sync`使`guacamole-common-js`进入CONNECTED、echo内部ping保持tunnel健康，并提供一个仅用于“远端向浏览器发送plain-text clipboard stream”的控制入口；测试对host→remote输出直接监听浏览器自己的WebSocket frame，不读取fixture内部消息oracle。第一次实现错误地要求Nexus proxy→上游也携带浏览器侧`guacamole` subprotocol，实际backend透明proxy上游不会重发该subprotocol，导致RDP/VNC显示`socket hang up`；改为按真实上游token query验连接后，同一UI文件 **3/3 passed (11.8s)**。最终case要求RDP/VNC都先显示CONNECTED，再验证host clipboard产生Guacamole clipboard/blob帧、fixture下发remote clipboard后`navigator.clipboard`收到精确文本；VNC还把`VNC`逐字符转换为keysym并验证每个key down/up。RDP RemoteApp/fullscreen/Escape/resize/minimize/restore及VNC pointer window语义原断言均保留。

`mobile/touch-workflows.spec.ts`原有direct/touchpad手势矩阵与IME composition case继续复用；本轮把真实RDP mode case增加`/rdp-session`请求计数：首次打开为1，切Touchpad后仍为1；显式关闭重开才变2，切Direct仍为2；再次显式关闭重开才变3，直接证明mode切换不重连且选择跨重开持久。最终M16 mobile touch closing run三条 **3/3 passed (12.7s)**。现有touch matrix同时覆盖direct tap/long-press/right-click/drag与touchpad move/tap/right-click/two-finger scroll，IME case确认composition期间保留输入并在compositionend后清空。

`suspend-resume-ui.spec.ts`继续使用真实SSH而不是伪造列表：主session先进入`folder-seed`并mark suspend；另建第二个真实marked→WebSocket close的session作为删除对象。仍有活跃Workspace时从真实mobile command bar打开Suspended Sessions modal，验证dialog完全落在viewport且document无横溢出；随后reload将主session交给backend hanging lifecycle。embedded Panel中先做no-result search，再按真实id定位主/删除对象；主session inline rename必须由API读回`E2E Renamed Suspended Shell`。Export先用浏览器真实network abort制造失败，实际反馈为Axios`Network Error`，随后API确认entry仍在；解除abort后真实download filename符合backend`ssh_log_*.log`并读取到`suspend`前终端内容。删除对象第一次Remove→Cancel后entry仍在，第二次Confirm后API与row都消失；最后主session Resume后必须回到原shell并继续显示`folder-seed`。增强case最终 **1/1 passed (13.9s)**。调试中一度把modal入口检查放在reload之后，此时按产品设计已无active session、mobile Command Bar不会渲染，故入口locator超时；把几何检查移回有active session的真实可达时机后通过，此前超时不计产品失败。Export失败最初断言fallback长文案也过窄，实际`apiErrorMessage`正确返回`Network Error`，修正断言后完整链通过。

最终M16 closing run发生在上述fixture/locator修正之后：Remote Desktop UI **3/3 passed (11.4s)**，mobile touch/IME/mode **3/3 passed (12.7s)**，mobile suspend lifecycle **1/1 passed (13.8s)**，SSH suspend protocol **1/1 passed (4.4s)**，HTTP RemoteApp **1/1 passed (3.7s)**，合计 **9/9**。随后静态门槛重新通过：`git diff --check`、`format:check`、test-policy（65 E2E specs / 28 functional screenshots）、groups（63 specs / 8 groups）；frontend architecture 254 source files、i18n 1694 keys / 3 locales / 81 fragments、`vue-tsc --noEmit`与Vite build（2663 modules）成功；backend architecture 218 files及`tsc` build成功。用户要求保留的`/tmp/nexus-pw-libs`、`/tmp/nexus-pw-fonts.conf`、`/tmp/nexus-e2e-env.sh`与`/tmp/nexus-e2e-tools`继续保留。

M16模块F/V/A结论：**F ✅** — RemoteApp、display-update resize、fullscreen/minimize/restore、RDP/VNC双向clipboard、VNC text-send、touch mode不重连持久、touch/IME，以及Suspend mark→reload→same-shell resume、search/rename/export失败保留/真实下载、active remove确认均有当前工作树直接证据；clipboard权限失败、disconnected entry remove、429 polling backoff/成功恢复由当前owner源码补审确认，未另造产品test hook。**V ✅** — P8恢复的RDP/VNC统一window/header/canvas/footer与mobile两行footer未在本轮改产品；真实pointer resize/minimized restore继续通过，mobile Suspended modal实际viewport/document几何通过，Panel窄容器规则与legacy源码一致。M17仍负责最终产品SHA下的相关canonical截图统一刷新。**A ✅** — Guacamole client/session仍单一归属`features/remote-desktop`，ssh-suspend list/polling/action仍单一归属`features/ssh-suspend`，Workspace只路由入口与resume组合；本轮没有修改产品源，只增强E2E gateway与现有E2E case，不新增global event bus、第二remote owner或测试专用应用接口。故M16自身本地闭环，仅待M17最终产品SHA/canonical统一复核。

### C.13 新环境 Luna max 小功能交接试验（2026-09-05，小切片本地通过）

本轮用户要求重新同步远端，并分别验证“新模型仅读plan能拆任务/写prompt/写验收卡”及“Luna max按任务包实现一个小功能”。同步结果见§0.2，未提交或推送。模型runner已实际可用，不继承C.5历史阻塞结论。

- 目标：M01.03 普通密码登录失败提示→正确密码重试的小切片；继承M01.01，排除2FA/CAPTCHA/passkey全矩阵、真实软键盘以及整个M01模块关闭。仅有实际差异证据才改当前auth展示owner；不为证明模型能编码而制造改动。
- Planning v1：`/root/fresh_luna_planner_v1`，`gpt-5.6-luna`/`max`/无历史上下文。未取得完整交付前由主代理中止，不算通过，也不判定产品失败。主代理独立审计期间发现计划接续顺序、runner及环境描述过期，先修正文档再启动fresh-reader v2。
- Planning v2：`/root/fresh_luna_planner_v2`，同模型与推理等级，`fork_turns=none`；报告 `/tmp/nexus-fresh-luna-v2.md`。能正确继承已完成项、保护dirty、发现既有`ui/session-lifecycle.spec.ts`失败登录case并生成可读的prompt/验收卡；但将320/375px推到后续任务，本次V只要求可读可点，未形成旧样式对照，且实际运行命令只放在卡片未内嵌prompt。**主代理不通过该执行包**，未交实现，未把它算产品失败。
- 根据v2实际反馈已在M01正式契约明确：三个viewport同切片、普通密码的安全前提、401→同页修正→200完整流程、服务器错误文案保留、旧源码/computed style与几何对照、M01.01继承不禁止修复具体回归、测试复用与输出路径、跨owner升级格式；§5.1.1补充禁止通过拆分排除必需验收，并要求完整prompt内嵌命令。
- Planning v3：`/root/fresh_luna_planner_v3`，`gpt-5.6-luna`/`max`/`fork_turns=none`，只读更新后的plan与仓库，不读取v2报告；已交付 `/tmp/nexus-fresh-luna-v3.md` 与纯prompt `/tmp/nexus-fresh-luna-v3-prompt.txt`。主代理逐项核查继承状态、owner/dirty边界、401→同页重试→200、三个viewport、旧样式/computed style、实际命令/产物及停止条件，**选中执行包planning验收通过**，无需口头补充产品细节。
- Execution：`/root/luna_m0103a_execution`，`gpt-5.6-luna`/`max`/`fork_turns=none`，独占浏览器与测试服务，已交付 `/tmp/nexus-m0103a-execution-report.md`；主代理未代做实现，已独立读diff、三个after图及全部before/after metrics，**M01.03-a本地F/V/A通过**。该结论包含下述纠错，不是首次无指导通过。
- Execution首轮未通过：只做预检与`--list`（2 cases），因把通用`GPT-5`系统身份/子代理无模型CLI误解为runner失败而停止，没有产品修改或浏览器证据。主代理已有实际`spawn_agent(model=gpt-5.6-luna, reasoning_effort=max, fork_turns=none)`成功返回的canonical；已将调度凭据与执行身份分离写入§5.2注意事项11及§5.4，不要求子代理自行证明底层型号或再启动模型。修正后的完整任务包为`/tmp/nexus-m0103a-execution-prompt-v4.txt`，交同一Luna继续；该轮不是产品失败，也不算execution通过。
- 独立机械审计：`/root/trial_validation_audit`（Sol）确认附录A的98项与旧Git Vue集合精确相等、附录B为28项、模块18个且7个本地闭环，26个相对Markdown链接可解析；报告 `/tmp/nexus-trial-plan-audit.md`。预检已有auth spec可发现2个case，未将`--list`计为浏览器通过。
- 已修订正式规则：恢复§5.5优先级，去除重复开发已闭环模块的旧顺序；dirty保护清单仅是快照、执行前重新核查；格式化严格限定本任务允许文件；临时环境先探测、不source失效文件；历史runner阻塞与当前可用状态分开。
- 实际修复：仅`features/auth/views/LoginView.vue`错误块恢复旧`-mt-2 mb-2`，保留`role=alert`和全部认证逻辑；旧同版Tailwind层叠支持这两类实际生效。三个viewport的before margin均为`0px 0px 20px`，after均为`-8px 0px 8px`，字号14px/行高20px/字重400/错误色`rgb(220,53,69)`保持。V证据为旧源码推导+当前真实图，非旧新像素一致；完整login表单/全局header不在此次视觉关闭范围。
- 持久E2E：扩展既有`ui/session-lifecycle.spec.ts`为三个viewport失败→同页仅改密码重试，保留logout/保护路由。两次UI POST为401→200，两次auth/status为401→200，Dashboard/user正确；真实英文label确认、CAPTCHA/passkey关闭、Remember Me可操作、目标文字/bbox不裁切，并在主代理要求后补error margin的实际断言，避免只有metrics没有回归检查。
- 实际定向命令（cwd=`test/e2e`）：`npx playwright test tests/ui/session-lifecycle.spec.ts --project=ui --output=/tmp/nexus-m0103a-session-final-20260905`，exit0，**4/4 passed (12.4s)**；`npx playwright test tests/auth/setup-login.spec.ts --project=auth --output=/tmp/nexus-m0103a-auth-final-20260905`，exit0，**2/2 passed (7.1s)**。before和after每个viewport各1/1，产物在`/tmp/nexus-m0103a-{before,after}-{1280x800,320x667,375x812}`；最终三份图/metrics/flow在session-final各case目录。成功run按现配置无trace，但真实截图/metrics/响应结果齐备。
- 执行偏差与规则提炼：首次locator/wait路径错误由Luna修复；主代理提醒旧样式对照与补持久视觉断言后继续完成。一次误用root npm wrapper未正确转发参数，额外跑了全UI **38/38 passed (1.9m)**，不计本切片必需证据；后改为直接Playwright明确spec/output。§5.6/5.7因此明确完整命令、限制调查/测试范围、视觉回归断言、进度节点、轻量取证和失败分类。并非无人监督或首次即可靠，后续Luna max主代理必须执行相同独立验收职责。
- 静态：Luna交付frontend build（包含architecture/i18n/vue-tsc/Vite）、test-policy、groups（63 specs/8 groups）、git diff --check均exit0；其format:check当时仅plan格式失败，主代理随后委派`/root/luna_doc_final_check`（Luna low）限定plan格式化及检查通过。主代理SHA256对比确认27个非plan既有dirty文件全部未变；本轮仅新增允许的两个auth相关改动，不覆盖其他模块。
- 通用主代理冷读模拟：`/root/luna_lead_protocol_review`（Luna max，无历史）从§5.6/5.7选择非M01的M07候选，只做planning。首轮发现台账/资源记录缺口，且low承担实现、V缺旧属性、fixture不支持误作不适用；已写回正式规则并重审报告`/tmp/nexus-luna-lead-protocol-review.md`。修订后能按规则分发、区分剩余取证与计划缺口；这是协议模拟，不是M07实现通过。
- 本试验适用用户结果仅M01.03-a，局部闭环1/1；不能推断全项目或Luna团队已完成90%以上。§5.7给出可复制Luna max主代理提示词、仅Luna各等级分工、冻结分母的统计方法及剩余风险交接。下一步由新主代理按协议选择其余未闭环结果；M01.03仍部分完成，模块计数保持7/18，M17最终canonical仍待完成。

### C.14 Luna 原子批次持续执行（2026-09-05）

在C.13试验通过后，主代理按§5.8继续分发真实任务；子代理仍只使用Luna，主代理独立验收，未使用Sol。该轮新增批次均为父模块部分完成，不改变`7 / 18`正式模块闭环计数。

- `M05.04-a` → `/root/luna_m05_password`（Luna high）：只修改既有`test/e2e/tests/ui/change-password.spec.ts`，无产品改动；真实空/不匹配校验、错误当前密码400、成功改密、logout→新密码登录、reload与恢复默认密码 **1/1 passed (9.5s)**。报告与1440×900图、metrics在`/tmp/nexus-m05-04a-report.md`及对应final目录。主代理确认无跨owner改动；后续M05.04仍需passkey/2FA/CAPTCHA/IP/backup/独立导入导出。
- `M07.02-a` → `/root/luna_m07_notifications`（Luna high）：`NotificationsView.vue`仅修窄屏卡片布局（动作下移、长名称/事件断词、桌面保留横排），既有notification/audit spec增加真实长内容、编辑/滚动、空/错误状态；before `scrollWidth=347`→after `320`，最终通知+Audit **5/5 passed**，test-policy/Prettier通过。报告`/tmp/nexus-m07-02a-report.md`；后续分页及M07.03 CRUD/delivery/error仍待验收。
- `M11.03-a` → `/root/luna_m11_filesystem`（Luna max）：仅扩展`test/e2e/tests/ssh/file-manager-navigation.spec.ts`；真实SSH导航、外部刷新260+长列表、Name排序、内部滚动、行右键菜单 **1/1**，导航全量 **3/3**，context邻接 **1/1**；architecture/frontend build/test-policy/diff通过，报告`/tmp/nexus-m11-03a-report.md`。后续建删改/权限/下载/copy-cut-paste/multi-select/upload/archive及M11.04移动待验收。
- `M07.03-a` → `/root/luna_m07_delivery`（Luna max）：扩展既有`test/e2e/tests/ui/notification-delivery.spec.ts`；真实创建启用、事件选择持久化、reload、saved webhook成功、真实失败400反馈、停用/reload、确认删除 **1/1**，通知回归 **5/5**，原有精确基线 **4/4**，Audit邻接 **2/2**；before/after 证据在`/tmp/nexus-m07-03a-final-20260905-004`，test-policy/Prettier/diff通过，主代理提交`a2ffeb21`。M07仍需分页和其他日志状态。
- `M07.02/03-f` → `/root/luna_m07_delivery`（Luna high）：扩展既有`test/e2e/tests/ui/audit-log-filtering.spec.ts`；真实创建51条proxy审计记录，分页50+1、筛选重置第1页、跨页保留action/search过滤 **1/1**，完整Audit回归 **3/3**，截图/metrics在`/tmp/nexus-m07-audit-final-20260905-004`，test-policy/Prettier/diff通过，主代理提交`5f3a2b90`。未知action和畸形details无法通过当前公开fixture生成，按规则保留为能力缺口。
- `M11.03-c` → `/root/luna_m11_filesystem`（Luna max）：扩展既有`test/e2e/tests/ssh/file-manager-context-menu.spec.ts`；真实桌面拖放`move-source.txt`到`folder-seed`、任务完成后刷新并验证源目录消失/目标目录出现 **1/1**，1280×720 modal/list 无横溢出，Prettier/test-policy/architecture/diff通过，证据`/tmp/nexus-m11-03c/`，主代理提交`f5749f8e`。M11仍需权限/下载/剪贴板/多选/上传/archive及移动端边界。
- `M11.03-d` → `/root/luna_m11_filesystem`（Luna max）：扩展既有`test/e2e/tests/ssh/file-manager-context-menu.spec.ts`；真实桌面两文件多选Copy→Paste与两文件Cut→Paste、目标刷新及源删除 **1/1**，1280×720 modal/list 无横溢出，Prettier/test-policy/architecture/diff通过，证据`/tmp/nexus-m11-03d/`，主代理提交`dbc7855c`。M11仍需权限/下载/upload/archive、失败边界及移动专项。
- `M11.03-e` → `/root/luna_m11_filesystem`（Luna max）：扩展既有`ssh/file-upload.spec.ts`；真实`/folder-seed`文件选择器上传、可见Queued→Running→Completed、Refresh后显示及精确字节下载 **1/1**，1280×720 modal/list/progress无横溢出，Prettier/test-policy/architecture/diff通过，证据`/tmp/nexus-m11-03e/`，主代理提交`5a591d13`。M11仍需权限/下载失败/archive及移动专项。
- `M11 UI diff-audit` → `/root/luna_m11_filesystem`（Luna max）：对照旧`FileManager.vue:600-604`确认非类型排序目录始终置顶；在新`useFilesystemBrowser.ts`补齐目录优先比较，升/降序组内排序保持，主代理提交`64e26705`。其余文件操作/移动差异继续收口。
- `M05.04-b` → `/root/luna_m05_captcha`（Luna max）：`CaptchaPanel.vue`与既有`captcha-settings.spec.ts`完成真实hCaptcha/reCAPTCHA保存、切换、reload、secret不回显及禁用恢复`none` **1/1**；报告`/tmp/nexus-m05-04b-report.md`，主代理提交`7f9e103e`。M05仍需IP策略、备份及独立导入导出。
- `M05.04-c` → `/root/luna_m05_captcha`（Luna max）：扩展既有`change-password.spec.ts`与`http/auth-2fa.spec.ts`；虚拟Authenticator真实passkey注册/命名/reload/删除 **1/1**，2FA API+Security UI **2/2**，桌面截图/metrics与architecture/test-policy/Prettier/diff通过，证据`/tmp/nexus-m05-04c-run-20260905`，主代理提交`40c8f468`。IP策略、备份及passkey登录/移动专项仍待验收。
- `M05.04-d` → `/root/luna_m05_captcha`（Luna high）：扩展既有`ui/ip-whitelist-settings.spec.ts`与`ui/ip-blacklist-settings.spec.ts`；真实白名单多行保存/清空/reload、黑名单启停/阈值校验/真实失败登录封禁/确认删除 **2/2**，桌面与320px截图/metrics、architecture/test-policy/Prettier/diff通过，证据`/tmp/nexus-m05-04d-run-20260905/final2`，主代理提交`9b885ad3`。M05仍需备份/独立导入导出及移动专项。
- `M05.04-e` → `/root/luna_m05_captcha`（Luna high）：扩展既有`ui/backup-ui.spec.ts`与`http/backup.spec.ts`；真实加密备份下载/文件选择器导入、恢复/认证保持、错误密码 **2/2**，桌面与320/375px截图/metrics无横溢出；发现并修复新架构`AppHeader.vue`窄屏全局溢出（待M00单独归档），证据`/tmp/nexus-m05-04e-run-20260905/final10`，主代理提交`9ad434fe`。M05仍需移动专项、passkey登录与连接导出。
- `M05 UI diff-audit` → `/root/luna_m05_captcha`（Luna max）：对照旧`IpWhitelistSettings.vue`确认当前`IpAccessPanel.vue`白名单 textarea 缺失 `font-mono`，在新 security owner 内最小补齐；主代理提交`5580189b`。其余未闭环项继续按C.15产品优先处理。
- `M00.04-a` → `/root/luna_m07_delivery`（Luna max）：对照旧`8ceb5840` App.vue/header，修复新架构`AppHeader.vue`窄屏 primary-nav shrink/auto-scroll 与 active underline 裁切；320/375/1280 header 及既有页面邻接差异验收通过，主代理提交`a96c7545`。M00仍需输入、dialog/footer、嵌套overlay与focus恢复差异。
- `M12 UI diff-audit` → `/root/luna_m07_delivery`（Luna max）：对照旧`FileEditorContainer.vue:344`与当前`useFileEditorSession`，确认保存失败后 dirty 文档必须可重试；移除`FileEditor.vue`对`active.error`的禁用条件，保留loading/saving/clean规则，主代理提交`edf513ec`。浏览器失败→重试流程仍待后续补证。
- `M08.03-a` → `/root/luna_m07_delivery`（Luna max）：扩展既有`ssh/reconnect-ui.spec.ts`；真实三SSH session新增/切换且shell marker保留、tab滚动/长按context、Close Other Tabs、关闭至移动空Workspace **1/1**，reconnect suite **2/2**，suspend/resume邻接 **1/1**，412×915截图/metrics与test-policy/Prettier/diff通过，证据`/tmp/nexus-m08-03-final-20260905-004`，主代理提交`6b590cad`。M08仍需resize/layout锁定、焦点/sidebar滚动及叠层验收。
- `M09.03-a` → `/root/luna_m07_delivery`（Luna max）：扩展既有`ssh/quick-command-management.spec.ts`并复跑`quick-command-tags-variables`、`command-history-management`；真实命令CRUD/search/execute/edit/delete、tag变量替换/rename、History copy/rerun/delete **3/3**，1280×800截图/metrics无横溢出，test-policy/Prettier/diff通过，证据`/tmp/nexus-m09-03-final-20260905-007`，主代理提交`12330364`。M09仍需多session执行、命令栏键盘与失败反馈。
- `M10.03-a` → `/root/luna_m07_delivery`（Luna max）：扩展既有`ssh/terminal-ui.spec.ts`并复跑`terminal-tools-ui`；真实SSH终端输入、terminal.input、Ctrl+wheel字体resize、shell命令/cwd持久 **3/3**，1280×800截图/metrics无横溢出，test-policy/Prettier/diff通过，证据`/tmp/nexus-m10-03-final-20260905-004`，主代理提交`4f97e7be`。M10仍需复制选择、搜索、修饰键/IME、虚拟键盘及移动专项。
- 主代理以精确路径分别提交：`0b18d747`（M05.04-a test）、`1f7ecd87`（M07.02-a product+tests）、`ab506b16`（M11.03-a test）。这些是原子批次提交，不冒充父模块完成；模块完成时仍需另一次按§5.8的模块提交。此前计划/入口提交为`ad6cc78d`，M01小切片为`c940eba7`，已有闭环增量包括M02 `708bfa2f`、M03 `d2b0979a`、M04 `36a8b052`、M06 `004c0080`、M13 `b2d3535a`、M16 `946394a1`，M14/M15历史提交分别为`192a3453`/`c67c2c70`。
- 三个子代理均保护其它工作树文件；本轮主代理未push/dispatch。下一轮继续按依赖分发M05剩余安全状态、M07 delivery/CRUD、M11文件操作或M00/M08–M13未闭环原子任务，完成父模块后再递增闭环计数。

### C.15 用户优先级调整：先还原 UI 与行为（2026-09-05）

用户明确要求先把旧 UI 在新架构上完整还原，并优先排查新旧视觉与行为差异；新增测试、截图台账和完整 E2E 补证后置。后续执行包按以下顺序调整：

- 先读旧组件/样式、当前新架构 owner 与已有证据，建立具体差异清单（结构、尺寸、间距、颜色、断点、滚动、交互状态和失败/恢复行为），再做最小产品修复。
- 只允许在当前新架构 owner 内修复，不恢复旧 store、event bus、transport、路由或重复状态；跨模块共享壳层先由主代理归属和协调。
- 测试只用于复现或确认关键差异；不以新增测试数量作为完成标准。现有测试扩展可以保留，但未完成的新增测试任务应停止在安全边界，不得阻塞产品还原。
- 每个产品差异批次仍由主代理独立验收旧新属性和行为；确认无差异时记录“无需产品改动”，再决定是否补最小回归测试。
- 已完成的原子测试提交和证据继续保留，不因优先级调整回滚；模块最终关闭仍要求功能、视觉、架构三者均有结论。

### C.16 主代理直接接续（2026-09-06）

- 用户确认本轮由主代理直接继续执行；子代理不可用时不再等待或补做模型试验。执行优先级继续遵循 C.15：先完成旧 UI / 行为差异还原，测试代码可暂缓新增，但已有真实验证能力仍用于确认关键结果。
- 接手 HEAD 为 `5d4f5f85`（`test/agent-runtime-foundation`）。接手时工作树仅有两处未提交 E2E 改动：`test/e2e/tests/ssh/file-manager-context-menu.spec.ts`（SHA256 `25dafc8044690536f677b887c233be1b61d040d12f87587f43b9391e46b42051`）与 `test/e2e/tests/ui/session-lifecycle.spec.ts`（SHA256 `c9710569118f7e3d85dc589e7dd186406fd06b00f0e7b02231718efc108d71b3`）。两者均按既有 dirty 保护处理：不覆盖、不 reset、不随模块提交误暂存。
- M05 收口后当前正式闭环更新为 `8 / 18`。下一优先级为 M07 / M11，再继续 M00 / M01 / M08–M13，最后 M17。每完成一个步骤即更新本计划；每完成一个正式模块并达到本地 F/V/A 结论后，由主代理进行一次精确路径本地提交，不 push、不 amend、不改写历史。
- 环境接手检查：仓库根与 frontend npm scripts 可用；当前无 4173/5173/常用 E2E 端口监听。历史 `/tmp/nexus-*` 证据目录在本次接手主机未发现，因此不把历史临时产物当当前通过证据；后续若启动本地临时服务或产生新 `/tmp` 证据，按用户要求保留，不在本轮清理。
- `M05 Preferences UI/behavior restore-a`：对照旧 `WorkspaceSettingsSection.vue` / `SystemSettingsSection.vue` 与当前 `features/preferences`，确认新架构把 Workspace 设置压成两列字段/复选框并统一一次 Save，丢失了旧版逐项标题、说明、分隔、独立保存与就地反馈的交互拓扑。已在当前 `features/preferences` owner 内恢复逐项 section 和精确 key patch：System 的语言/时区分别保存；Workspace 的 popup editor/file manager、共享 editor tabs、sidebar、command sync、tag 可见性、Quick Command 搜索/密度、terminal scrollback、Spreadsheet preview、删除确认、右键复制粘贴、Dashboard 资源、Status IP/interval、Docker、layout lock、顶部导航分别保存，保留新架构新增能力且不恢复旧 Settings mega-store。页面加载期间先显示 loading，避免默认值短暂可编辑。三语新增文案后 frontend architecture、i18n（1702 keys / 3 locales / 81 fragments）、`vue-tsc --noEmit`、Vite build（2663 modules）及 `git diff --check` 通过。接手环境中 root 所有的旧 `.vite-temp` 与 `dist` 导致前两次 Vite 写入失败，均未删除：分别保留为 `.vite-temp.root-preserved-20260906-takeover` 与 `dist.root-preserved-20260906-takeover` 后建立当前用户可写输出并通过；不计产品失败。浏览器功能/移动几何的最终结论见下一条 `M05 closure`。
- `M05 closure`：浏览器运行环境已在当前用户下补齐并保留：Playwright Chromium/FFmpeg cache、`/tmp/nexus-pw-libs`、`/tmp/nexus-pw-apt`，以及接手时 root 所有的旧 E2E `.tmp` / `logs` / `playwright-report` / `test-results` 均只改名保存为 `*.root-preserved-20260906-takeover`，未清理。产品验收结果：`ui/system-settings.spec.ts` 3/3；backup/CAPTCHA/password/IP 5/5；passkey 注册/命名/reload/删除定向 1/1；使用 localhost-base 临时配置后真实 passkey 注册与登录成功，dirty `session-lifecycle.spec.ts` 仅在后半段 `WebAuthn.removeCredential` 的当前 Chromium CDP 参数兼容处停止，不修改该既有 dirty 测试。另用保留在 E2E `.tmp/manual` 与 `/tmp/nexus-m05-manual-20260906` 的临时验收脚本完成连接导出和窄屏检查：UI 实际下载 `nexus_connections_export.zip`；320×667 / 375×812 下 Workspace、Security、IP Control、Data Management、About 均无 document 横向溢出，七 tab 条保持自身横滚；`settings-security-*` / `settings-data-*` 已逐图复核，长说明、输入、文件选择与按钮均保持单列可读。About 对旧 `AboutSection.vue` 源码复核未发现结构/视觉回归。M05 因此达到本地 F/V/A 闭环，正式计数更新为 `8 / 18`；本轮没有新增仓库测试代码。
- `M07 closure`：Notifications/Audit 本轮无需产品代码修改。既有 `notification-settings.spec.ts`、`notification-delivery.spec.ts`、`audit-log-filtering.spec.ts` 在当前产品上合计 **8/8 passed**，覆盖通知真实 CRUD、启停、事件持久化、真实 webhook 发送成功/失败、320px 长 provider/event/空错误状态，以及 Audit 搜索/action 过滤、真实分页、过滤后回第 1 页、跨页保留过滤、320px 长 details 内部滚动。源码契约复核确认 backend `audit.routes.ts` 会把无法 `JSON.parse` 的 details 转为 `{ raw, parseError: true }`，当前 `AuditLogView.vue` 对该形态显示 raw 信息，并用 i18n default message 对未知 action 回退 backend identifier；保留在 `.tmp/manual/m07-audit-contract.spec.ts` 的临时浏览器契约验收实际显示 `FUTURE_BACKEND_ACTION` 与畸形 raw 文本，320px 无 document 横溢出，截图保留 `/tmp/nexus-m07-audit-contract-20260906.png`。因此历史 fixture 能力缺口已用契约形态验证补齐，不新增仓库测试代码，不引入跨 feature 私有依赖。M07 达到本地 F/V/A 闭环，正式计数更新为 `9 / 18`。

### C.17 产品优先差异收口（2026-09-06）

- 本轮继续遵循 C.15：先修复可确认的旧 UI/行为回归，测试扩展后置；所有改动保持在新架构 owner，子代理不修改 plan、不 commit/push，主代理独立验收并精确提交。
- `M08.03/M08.04 layout-min-size` → `/root/luna_m08_layout`（Luna max）：对照旧 `packages/frontend/src/components/LayoutRenderer.vue:563-568`，确认旧 `Pane` 固定 `min-size=5`，新 `WorkspaceLayoutRenderer.vue` 省略后 splitpanes 可将 command/terminal 等 pane 拖到 0；在新 workspace owner 恢复 `:min-size="5"`，未复制旧状态或事件架构。静态 architecture、i18n、`vue-tsc --noEmit`、Vite build（2663 modules）、`git diff --check` 均通过，主代理提交 `d6a2a96c`。该原子批次修复已闭合；M08.03 其他 resize/锁定、焦点/sidebar 与 M08.04 叠层仍待后续证据。
- `M13.04/M13.05/M13.06 preview diff-audit` → `/root/luna_m13_preview`（Luna high）：对照旧 preview providers 与当前 `features/file-preview`，复核 loading/error/unsupported、refresh、tab-close、overlay/toolbar/横滚及 provider 行为；未发现可确认产品差异，未改代码。既有 `file-preview-editor.spec.ts` 定向 run 为 `8/9`，唯一失败是 M05 设置改造后全局唯一 `Save` 选择器的既有测试 strict-mode（`file-preview-editor.spec.ts:889`），非 M13 产品回归；不以该失败关闭 M13，待 M17 统一处理测试选择器/最终证据。
- `M09.03 send-to-all feedback` → `/root/luna_m09_keyboard`（Luna max）：对照旧 `QuickCommandsView.vue` / `CommandHistoryView.vue` 的 connected-session 成功数量与无目标 info 提示，确认新 `WorkspaceView.sendCommand` 只派发 intent 后静默；在 runtime 唯一 dispatch owner 恢复两种反馈，Enter/Escape 与移动 file/editor 按钮未发现其他可确认回归。主代理独立审 diff 后提交 `15fff23e`；未新增测试，M09 多 session 真实发送仍待手工/既有流程复核。
- `M00.04 overlay/focus` → `/root/luna_m00_overlay`（Luna max）：对照旧 Confirm/Alert、FilePreview 与 overlay 使用，修复最上层 Escape 处理、初始可见弹层焦点捕获/恢复、共享 DialogHost Escape、长消息断词和 BaseModal footer 不收缩；新增 `foundation/ui/overlayStack.ts` 仅管理展示层顺序，不承载业务状态。frontend build、`git diff --check` 通过，主代理独立审架构后提交 `15e8717d`；M00 其他输入/footer/嵌套入口仍待最终浏览器矩阵。
- `M01.02 passkey busy state` → `/root/luna_m01_passkey`（Luna max）：对照旧 LoginView passkey 请求期间的共享 loading/禁用/文案，确认新安全 composable 已有 loading 但未传给 auth view；通过 `LoginPage` prop 与 LoginView `isBusy` 恢复密码/2FA/remember/两个按钮的禁用和 `loggingIn` 文案，失败 finally 后可重试，未恢复旧 store/fetch。`vue-tsc --noEmit`、architecture、i18n、`git diff --check` 通过，主代理提交 `7d9fdcd3`；M01 其他认证状态/移动软键盘仍待。
- 上述三个原子批次均未新增仓库测试，符合 C.15 产品优先级；相关 dirty E2E 草稿和 root-preserved 产物未混入。M00/M01/M09 仍是部分完成，不能因单个行为修复提前关闭；下一批继续选择 M08 叠层/焦点、M10 移动终端、M11 文件失败边界或 M12 编辑生命周期。
- 当前 HEAD 为 `d6a2a96c`；仍保护未提交 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts` 及 `*.root-preserved-20260906-takeover` / core 产物，未随 M08 提交混入。正式模块闭环计数仍为 `9 / 18`；M08/M13 尚未因单个原子批次提前关闭。

### C.18 产品优先差异收口（2026-09-06，当前接续）

- 本轮继续遵循 C.15：先处理可确认的旧 UI/行为迁移差异，新增测试与完整截图证据后置；子代理仅使用 Luna，未修改 plan、未 commit/push，主代理独立检查后精确提交。三个批次均是原子修复，未关闭父模块，正式闭环计数保持 `9 / 18`。
- `M10.02/M10.03 terminal selection scroll sync` → `/root/luna_m10_terminal`（Luna max）：对照旧 `8ceb5840:packages/frontend/src/components/Terminal.vue:1021-1023`，确认移动选区后 xterm 滚动不会更新句柄位置；在当前 `features/terminal/components/TerminalView.vue` 增加 `terminal.onScroll` + `requestAnimationFrame(syncMobileSelectionHandles)`，沿用 terminal feature owner 与既有 cleanup。frontend architecture、i18n、`vue-tsc --noEmit`、Vite build（2664 modules）、`git diff --check` 通过；主代理提交 `b2f2ecc6`。V 仍待真实移动视口/竖横屏截图与选区滚动流程，复制/搜索/修饰键/IME/虚拟键盘仍待后续验收。
- `M11.03 download failure isolation` → `/root/luna_m11_files`（Luna max）：对照旧 `FileManager.vue` 中逐条异步下载捕获，确认新 `features/filesystem/components/FileManager.vue` 将整个批次置于单一 `try`，首个失败会阻断后续下载；将异常边界下沉到每个 entry，继续使用 `FilesystemDownloadPort`，不恢复旧 SFTP manager/store/event bus。architecture、i18n、`vue-tsc --noEmit`、Prettier、Vite build（2664 modules）、`git diff --check` 通过；主代理提交 `4ff0730d`。F 真实多文件失败→后续成功流程仍待浏览器证据，V 无产品视觉改动，A 通过。
- `M12.04 popup/session visibility` → `/root/luna_m12_editor`（Luna max）：对照当前 `WorkspaceView.vue` 对 `WorkspaceSessionSurface` 的 `v-show` 与 `WorkspaceSessionSurface.vue` 的 teleported `document-popup`，确认切换 session 隐藏 surface 时旧 popup 仍可能留在 body、拦截新 session；在 workspace 组合 owner 观察 root `style` 的 `display:none` 并关闭 `documentPopupVisible`，保留 editor/preview controller、tab/document 状态。`git diff --check`、architecture、i18n、`vue-tsc --noEmit` 通过；主代理提交 `464ed0b8`。F/V 仍待真实切换与弹层几何流程，A 通过；不恢复旧 FileEditor store/event bus/重复文档副本。
- 接续 HEAD 为 `464ed0b8`；保护未提交的 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts` 及 `*.root-preserved-20260906-takeover` / core 产物未混入。当前并行继续委派三个单一结果：M10 搜索/选择交互、M11 权限或 archive 失败反馈、M12 dirty/save/refresh/close 生命周期；子代理不得修改本节，主代理在交付后独立验收并继续更新。

### C.19 产品优先差异收口（2026-09-06，第二批接续）

- `M10.02/M10.03 mobile clipboard menu geometry` → `/root/luna_m10_search`（Luna max）：对照旧 `8ceb5840:packages/frontend/src/components/Terminal.vue:504-512`，确认旧移动剪贴板菜单估算宽度为 `190px`，新架构误为 `210px`；在 `features/terminal/components/TerminalView.vue` 恢复 `190`，不改变 selection/search owner。既有移动选区与 SSH terminal tools/search 流程各 `1/1` 通过，Prettier、`git diff --check` 通过；主代理提交 `e1df83b0`。截图 `/tmp/nexus-m10-search-after-20260906/mobile-terminal-selection.png` 支持 V，A 由 feature 路径与静态 diff复核；M10 其他搜索/修饰键/IME/虚拟键盘及完整移动矩阵仍待验收。
- `M11.03 download concurrency correction` → `/root/luna_m11_archive`（Luna max）：复查 C.18 后发现逐项 `await` 虽隔离失败，却改变旧版 `void async` 并发触发语义；对照旧 `8ceb5840:packages/frontend/src/components/FileManager.vue:1296-1346`，在当前 filesystem owner 恢复 `Promise.all(entries.map(...))`，每项保留独立 `catch`/错误通知并使用当前 `FilesystemDownloadPort`。architecture、i18n、`vue-tsc --noEmit`、Prettier、Vite build（2664 modules）、`git diff --check` 通过；主代理提交 `b648e8f5`。F/V 真实多文件失败与后续下载流程仍待浏览器证据，A 通过；该纠错说明主代理验收必须检查行为时序，不只检查异常是否捕获。
- `M12.03 save race / retry state` → `/root/luna_m12_lifecycle`（Luna max）：对照旧 `8ceb5840:packages/frontend/src/stores/fileEditor.store.ts:411-438` 与 SRS-EDIT-003/006，确认新 session controller 保存期间直接读取可变 `doc.content`，并发 Ctrl/Cmd+S 可覆盖状态；在 `features/file-editor/composables/useFileEditorSession.ts` 增加按文档的 `savingDocuments` guard，捕获保存内容/编码快照，完成后仅在内容未继续变化时清除 dirty，失败/缺 port 设置可见 error 以支持重试，不新增 dirty 关闭确认。既有编辑器流程 `8/9` 通过，唯一失败为无关的 settings strict-mode selector；architecture、i18n、`vue-tsc --noEmit`、Vite build、`git diff --check` 通过；主代理提交 `5cea7b0f`。真实保存失败→重试与移动生命周期仍待独立浏览器证据，V/A 需最终矩阵复核。
- 接续 HEAD 为 `5cea7b0f`；本轮仍保护未提交 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts` 及所有 `*.root-preserved-20260906-takeover` / core 产物，正式模块闭环计数保持 `9 / 18`。下一批在并行槽位释放后继续 M00/M01/M08/M09/M10–M13 的剩余具体用户结果；达到单模块 F/V/A 闭环后才按 §5.8 进行模块提交，不以原子修复代替父模块完成。

### C.20 产品优先差异收口（2026-09-06，第三批接续）

- 本轮仍遵循 C.15：产品 UI/行为差异优先，子代理仅使用 Luna，主代理独立审 diff 后提交；静态证据不能替代真实 F/V，原子修复不能关闭父模块，正式闭环计数保持 `9 / 18`。
- `M08.03/M08.04 sidebar overlay + focus cycle` → `/root/luna_m08_sidebar`（Luna max）：旧 `8ceb5840:packages/frontend/src/components/LayoutRenderer.vue:710-778` 将 active 左右侧栏固定为 `top/bottom + z-[110] + max-w-[80vw]` overlay，主布局宽度不被压缩；当前新架构曾渲染为 `relative shrink-0` inline pane。恢复 fixed overlay、边框/内部滚动/关闭按钮，并在 `shared/focus/focusRegistry.ts` 读取当前 `data-focus-id` 作为 `focusNext` 起点，保持状态仍由 Workspace/shared focus owner 管理。Prettier、architecture、i18n、`vue-tsc --noEmit`、Vite build、`git diff --check` 通过；侧栏 E2E 断言未失败，但 finally 恢复 `/api/v1/settings/sidebar` 时超时，故不计完整浏览器 F/V；主代理提交 `8102088e`。resize/layout-lock、移动/桌面完整侧栏几何及 overlay 动画仍待验收。
- `M09.02/M09.03 quick/history keyboard and touch parity` → `/root/luna_m09_keyboard2`（Luna max）：对照旧 `QuickCommandsView.vue:493-538`、`AddEditQuickCommandForm.vue:3-5,25-39`、`QuickCommandsModal.vue:26-39`、`CommandHistoryView.vue:179-213,52-61`，恢复空查询失焦折叠、input/list 焦点边界、变量值 textarea、变量名 Enter 阻止提交、Escape/backdrop 语义、特殊替换值 `$&` 不被 JS replacement 误解释，并在 `@media (hover:none)` 显示 row actions 保持触控可达。静态检查 5/5（architecture/i18n/Prettier/vue-tsc/diff-check）通过，当前无服务未运行浏览器（case 0），F/V 待真实流程；主代理提交 `e417ba52`。WorkspaceCommandBar 既有 Enter/sync/Escape 未改，M09 多 session/失败反馈仍待验收。
- `M13.05 preview last-tab close` → `/root/luna_m13_provider2`（Luna max）：对照旧 preview tab context 的 closeWorkspace 语义，确认当前关闭最后 tab 只清空 session、teleported popup 仍可见；在 `features/file-preview/components/FilePreviewDialog.vue` 关闭 tab 后检查 session 已无 tabs，沿现有 `close` emit 让 Workspace 隐藏 popup，不复制 Workspace 状态。architecture、i18n、`vue-tsc --noEmit`、`git diff --check` 通过；浏览器 F/V 未运行，主代理提交 `4d9aa32d`。loading abort、Spreadsheet 空 workbook/parse error 仍为待处理的已确认差异。
- 该批次记录时接续 HEAD 为 `8102088e`（随后原子 docs/feature commits 已推进）；保护未提交的两份 E2E 和 root-preserved/core 产物未混入。下一批应优先处理 M13 loading/Spreadsheet provider error、M00/M01 状态矩阵或 M10/M11/M12 真实失败/移动证据；每个正式模块完成后再按 §5.8 单独提交模块闭环记录。

### C.21 产品优先差异收口（2026-09-06，M13 provider错误与取消语义）

- 本轮继续遵循 C.15：子代理仅使用 Luna，主代理独立审查旧基线、产品 diff 与架构边界；新增浏览器证据因当前环境条件后置，正式闭环计数保持 `9 / 18`。
- `M13.05 Spreadsheet parse/empty workbook` → `/root/luna_m13_spreadsheet`（Luna max）：对照旧 `8ceb5840:packages/frontend/src/composables/file-preview/xlsxPreviewParser.ts:171-192`，恢复无 worksheet 时显式抛错，并在当前 `features/file-preview` owner 捕获解析异常，显示 `role="alert"` 错误态；刷新解析失败不丢失既有表格/session。合法 XLSX、ZIP/HTML 错误输入的解析 smoke 通过；architecture、i18n、`vue-tsc --noEmit`、Prettier、`git diff --check` 通过。主代理提交 `5766797c`。真实浏览器错误态截图和生命周期仍待验收，故不关闭 M13。
- `M13.05 loading cancel` → `/root/luna_m13_loading`（Luna max）：对照旧 `FileManager.vue` loading overlay 的 abort、遮罩/Escape 隐藏与显式 X 清理差异，在 `features/file-preview/components/FilePreview.vue` 增加可取消 loading overlay；主代理发现并修正子代理初稿把两条路径合并导致 popup 模式误清理已有 tabs，拆为 `dismiss`（关闭 pending、隐藏外壳、保留 tabs）与 `hide`（按当前 popup 设置清理）的事件，接线至 `WorkspaceSessionSurface` 与 `WorkspaceLayoutRenderer`。controller slow-source abort smoke、现有 close-cache smoke、architecture、i18n、`vue-tsc --noEmit`、Prettier、`git diff --check` 通过；主代理提交 `ca46d402`。真实 delayed-read 浏览器 loading 矩阵仍待验收。
- 本轮产品变更未恢复旧 store、preview context/event bus 或重复 session 状态；`FilePreviewSessionController` 仍是唯一 tabs/operation owner。两个原子提交均不代表 M13 父模块完成，M13.04/M13.06 及各 provider 的真实 F/V 仍由后续批次和 M17 统一复核。受保护的 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts` 与 root-preserved/core 产物未被暂存。

### C.22 产品优先差异收口（2026-09-06，第四批接续）

- 本轮继续遵循 C.15：先修复可确认的旧 UI/行为差异，主代理独立审 diff 与静态结果后精确提交；新增完整浏览器矩阵仍后置，正式模块闭环计数保持 `9 / 18`。
- `M10.02/M10.03 terminal search remount` → `/root/luna_m10_mobile`（Luna max）：复核旧 SearchAddon 使用与当前 `TerminalView` 生命周期，确认 terminal→file/editor→terminal 重建时 session 搜索词保留但装饰丢失；在 terminal feature owner 增加统一 `syncSearchDecorations`，并由主代理补正为 xterm `write` 回调后再同步 snapshot，避免异步回放竞态。既有 `mobile/terminal-touch.spec.ts` 3/3 通过，Prettier、architecture、i18n、`vue-tsc --noEmit`、Vite build（2664 modules）、`git diff --check` 通过；主代理提交 `cb64b474`。虚拟键盘/IME、切换 pane 后高亮截图和完整移动矩阵仍待真实 F/V，M10 不关闭。
- `M11.03 chmod/archive failure feedback` → `/root/luna_m11_failure2`（Luna high）：对照旧 `FileManager.vue` 的权限与压缩/解压失败路径，恢复 chmod 本地化前缀+详情、普通 archive 失败即时 toast，同时保留 transfer task error 状态；密码错误码仍回开密码对话框以支持重试。修改仅在 filesystem/workspace 当前 owner，未恢复旧 manager/store/event bus。Prettier、architecture、i18n、`vue-tsc --noEmit`、Vite build（2664 modules）、`git diff --check` 通过；主代理提交 `4522c3ba`。真实 chmod/archive 失败与后续任务浏览器 F/V 尚未取得，M11 不关闭。
- 主代理在验收中发现并修正 M10 初稿的 snapshot 同步时序；该类“静态通过但异步行为仍可能丢状态”的检查继续作为后续验收硬规则。受保护的 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts`、所有 `*.root-preserved-20260906-takeover` 及 core 产物仍未暂存。下一批优先分发 M10 移动搜索/IME 真实证据、M11 失败反馈浏览器证据、M12 编辑失败→重试/刷新生命周期，槽位释放后再处理 M00/M01/M08/M09/M13；达到模块自身 F/V/A 闭环后才单独提交模块收口。

### C.23 产品优先差异收口（2026-09-06，第五批并行）

- `M00.03/M00.04 shared dialog focus` → `/root/luna_m00_shell`（Luna high）：复核 `OverlayPanel` 已具备的 focus trap/restore 能力未被共享 `DialogHost` 传入，恢复 `focus-on-open` 与 `restore-focus`；旧 Escape/backdrop/loading 语义和尺寸未改变。architecture、i18n、`vue-tsc --noEmit`、独立 Vite build、`git diff --check` 通过；主代理提交 `ed2a26ea`。M00 仍待跨模块真实 overlay/嵌套/窄屏矩阵。
- 为加快收口，本批同时分发互不重叠的 Luna 任务：M01 认证状态、M08 Workspace layout（不改 `WorkspaceSessionSurface.vue`）、M09 Quick/History、M10 Terminal、M11 filesystem、M12 file-editor、M13 provider 只读审计；每个子代理仅修改所属 owner，不改 plan/commit/push。现有未跟踪 `test/e2e/tests/mobile/m10-mobile-audit.spec.ts` 与两份 dirty E2E、root-preserved/core 产物均受保护，正式模块闭环计数仍为 `9 / 18`。
- 本批继承规则：先给旧源码/computed style 与行为证据，再决定最小产品 diff；测试后置但不得以静态检查替代真实 F/V；共享 owner 冲突只报告并交主代理协调。下一步按代理交付逐项独立审查、精确提交，并将 M13 已确认的“失败态缺 Retry/Close chrome”和 PDF stale worker 风险交给专门修复批次。

### C.24 产品优先差异收口（2026-09-06，第六批接续）

- 本轮仍遵循 C.15：子代理仅使用 Luna，主代理独立检查旧新差异、owner 边界和提交路径；静态检查用于架构安全网，不能替代真实 F/V。以下均为原子产品修复提交，未提前关闭父模块，正式闭环计数保持 `9 / 18`。
- `M01.02/M01.03 auth retry and passkey feedback` → `/root/luna_m01_auth`（Luna max）：在当前 `LoginPage`/`LoginView` owner 恢复忙状态防重入、密码尝试清除旧 passkey 错误、passkey 失败本地化和可访问错误提示；不改 auth store/backend/router。定向登录/退出/受保护路由及 1280×800、320×667、375×812 通过；passkey 既有用例在注册后受 `localhost` 页面与 `127.0.0.1` API cookie host 不一致阻断，2FA invalid-session 仍待验收。主代理精确提交 `75c689cb`；M01 仍未闭环。
- `M08.02/M08.03 layout validation and pane parity` → `/root/luna_m08_workspace`（Luna max）：在新 workspace owner 恢复 split pane `push-other-panes=false`、重复 pane 防护、sidebar fallback 过滤、挂起菜单 ref 状态和当前节点选项保留；不改共用 `WorkspaceSessionSurface.vue`，不复制旧状态架构。Prettier、architecture、i18n、`vue-tsc`、Vite build、`git diff --check` 均通过，完整 resize/sidebar/overlay 浏览器证据仍待。主代理精确提交 `59d402e5`；M08 仍未闭环。
- `M11.02/M11.03 filesystem geometry and async ordering` → `/root/luna_m11_files2`（Luna max）：恢复目录优先及数值排序稳定 tie-break、load request generation 防旧响应覆盖、行缩放上限 `2.0`、初始化列宽最小值 clamp、拖放目标校验/方向切换/离开清理和缩放滚动锚点；继续使用当前 filesystem port。Prettier、architecture、i18n、`vue-tsc`、Vite build、`git diff --check` 通过；权限/archive 失败、移动文件管理器和完整文件操作矩阵仍待真实 F/V。主代理精确提交 `170f77de`；M11 仍未闭环。
- `M12.03/M12.04 editor save and language lifecycle` → `/root/luna_m12_editor2`（Luna max）：按文档增加保存 guard/内容快照，保存失败可见且可重试，阻止保存期间 reload/编码/换行竞态；CodeMirror 语言加载失败回退可编辑 plaintext，并防止卸载/旧 tab 异步回写。Prettier、architecture、i18n、`vue-tsc`、Vite build、`git diff --check` 通过；多文件切换、dirty/save/close、移动全屏/软键盘和跨 session 弹层仍待浏览器 F/V。主代理精确提交 `f42397de`；M12 仍未闭环。
- `M13.05 PDF/provider error lifecycle` → `/root/luna_m13_fix`（Luna high）：读取失败态复用当前 `FilePreviewDialog` shell，提供 Retry/Refresh/Close chrome；PDF 搜索索引改用局部代际快照，旧 worker 不能回写新文档，search busy/stale 异常安全收尾。未恢复旧 preview store/context/event bus。Prettier、architecture、i18n、`vue-tsc`、Vite build、`git diff --check` 通过；各 provider loading/error/unsupported、PDF/XLSX/DOCX/image/Markdown 和 desktop/mobile overlay 仍待真实 F/V。主代理精确提交 `2f320cfa`；M13 仍未闭环。
- 受保护的 `test/e2e/tests/ssh/file-manager-context-menu.spec.ts`、`test/e2e/tests/ui/session-lifecycle.spec.ts`、未跟踪移动审计与 `root-preserved`/core 产物未随上述提交暂存。M09 quick/history 改动仍由其代理收口，待交付后单独审查；下一批优先完成 M09 提交、M00/M01/M08–M13 的真实失败/移动证据，再进入 M17.01–06。

### C.25 产品优先差异收口（2026-09-06，第七批补充）

- 本批继续只在新架构 owner 内修复，主代理按精确路径审查并提交；以下仍是原子修复，不改变 `9 / 18` 正式模块闭环计数，未验证的浏览器 F/V 不得被静态检查替代。
- `M09.02/M09.03 quick/history/command bar` → `/root/luna_m09_commands`（Luna max）：统一新架构 Quick Command 变量展开，恢复选中命令的变量替换与 usage 记录；补齐加载/保存/删除/建标签失败反馈、多语言文案、容器查询和窄 pane 行密度/表单宽度约束。architecture、i18n、`vue-tsc`、Vite build、`git diff --check` 通过；多 session 发送与失败反馈仍待真实流程。主代理提交 `e39dfc30`。
- `M10.02/M10.03 terminal resize/selection geometry` → `/root/luna_m10_mobile3`（Luna max）：旧版每次 `fitAddon.fit()` 后都会刷新移动选区句柄；当前架构补回 `fitAndResize()` 的无条件几何同步，覆盖字号、窗口 resize、横竖屏且不改变 terminal owner。architecture、i18n、`vue-tsc`、Vite build、Prettier、`git diff --check` 通过；真实手机横竖屏/拖选仍待。主代理提交 `6d645617`。
- `M00.03/M00.04 TokenInput behavior` → `/root/luna_m00_shell2`（Luna max）：对照旧 `TagInput`，恢复 TokenInput 创建/选中/失焦/Escape 后收起建议、选中后重新聚焦；新增显式 suggestions-open 状态，仍为 foundation-only。architecture、i18n、`vue-tsc`、Prettier、`git diff --check` 通过；浏览器 F/V 待矩阵。主代理提交 `131fc6f9`。
- `M01.02 two-factor expiry` → `/root/luna_m01_2fa`（Luna max）：按后端 `400` 失效会话与 `401` 错误验证码语义，过期时清除 pending challenge、错误验证码仍可重试，并锁定提交时 2FA 状态避免错误 fallback 文案。architecture、i18n、`vue-tsc`、`git diff --check` 通过；浏览器未跑，passkey host mismatch 仍按 C.24 记录。主代理提交 `f98ed7a2`。
- `M11.04 mobile touch parity` → `/root/luna_m11_mobile2`（Luna max）：文件行恢复 `touch-pan-y`，避免移动列表滚动与长按拖放手势竞争；仅改 filesystem owner。`git diff --check` 通过；320/375/412 真实长按、多选、菜单 viewport 尚待。主代理提交 `da7faf9f`。
- `M12.03 open ordering` → `/root/luna_m12_lifecycle2`（Luna max）：为当前 editor session 增加 open generation 和并发 loading-operation 计数，A→B 快速打开时只允许最新请求切换 active，重复路径去重；不恢复旧 FileEditor store/event bus。architecture、i18n、`vue-tsc`、Prettier、`git diff --check` 通过；真实快速打开、关闭 scope 后迟到 load、移动 popup 仍待。主代理提交 `0a694969`。
- `M13.05 PDF document generation` → `/root/luna_m13_provider3`（Luna max）：在 `getOutline()` 完成后补 document-generation guard，过时代 PDF task 立即销毁，防止 refresh/切 tab 时 outline、loading、scroll 串文档。architecture、i18n、`vue-tsc`、Prettier、`git diff --check` 通过；PDF refresh/快速切 tab 浏览器证据仍待。主代理提交 `651be16b`。
- 当前仅保留两份受保护 dirty E2E、未跟踪移动审计和 root-preserved/core 产物，均未被上述提交暂存。下一步由单独验收代理串行补 M12 浏览器证据；随后按相同规则补 M00/M01/M08–M13 的适用真实矩阵，最后启动 M17.01–06。无确证差异的模块只记录“无需产品改动”，不为提高计数强行改代码。

### C.26 当前 SHA 真实验收与门禁（2026-09-06）

- 当前产品 SHA 为 `2a9c069c`（分支 `test/agent-runtime-foundation`）。主代理在确认 `29090/22223/3001/4173` 端口空闲后，串行运行 `cd test/e2e && npm exec playwright test tests/ssh/file-preview-editor.spec.ts --project=ssh --grep "file previews and text editor protect historical file-opening regressions" --output=/tmp/nexus-m12-current-20260906`；Playwright 实际执行该 describe 下 9 个用例，**8/9 通过（约 1.1m）**。通过项覆盖 extensionless editor、popup/tab/cache、PDF/XLSX/DOCX 多 tab、滚动/刷新等当前 M12/M13 关键行为。
- 唯一失败为 `tests/ssh/file-preview-editor.spec.ts:889` 的既有测试定位器：M05 设置改造后页面存在 17 个同名 `Save` 按钮，`getByRole('button', { name: 'Save', exact: true })` 触发 strict-mode；失败发生在设置前置步骤，非 preview/editor 产品断言，也未修改该测试。该问题列为 M17.03 测试维护项，不能把 8/9 直接提升为 M12/M13 模块闭环。
- 同一当前 SHA 的静态门禁由 `/root/luna_m17_static` 完成：architecture、i18n（1706 keys/3 locales/81 fragments）、`vue-tsc --noEmit`、Vite build、`git diff --check` 均 exit 0。`check:test-policy` 与 `groups:check` 仅因受保护未跟踪 `test/e2e/tests/mobile/m10-mobile-audit.spec.ts` 未列入 group 而 exit 1；不得修改/暂存该受保护草稿，留到 M17 重新整理。
- 首次独立浏览器探测发现无现成产品服务，但 Playwright `webServer` 可正常拉起 remote gateway、SSH、backend、frontend；后续所有本地 E2E 必须继续串行运行。当前 M12/M13 仍缺移动全矩阵、快速异步生命周期和 provider 逐项截图，正式闭环计数仍为 `9 / 18`。
- 下一步顺序：先保留本轮 8/9 报告与失败根因；串行补 M13 provider/refresh、M12 移动生命周期，再补 M10/M11/M08/M09/M00/M01 的真实 F/V，最后处理 M17.01–06。任何测试选择器修复须单独限定非受保护测试文件，不得为规避失败改产品代码。

### C.27 M13 当前 SHA preview 真实取证（2026-09-06）

- 当前产品/文档 SHA 为 `5b42dff6`。`/root/luna_m13_browser` 按端口串行启动 Playwright，未修改产品、测试或计划。
- Mobile 命令：`cd test/e2e && env E2E_CAPTURE_SCREENSHOTS=1 E2E_SCREENSHOT_OUTPUT_DIR=/tmp/nexus-m13-mobile-screenshots E2E_TIMINGS_OUTPUT=/tmp/nexus-m13-mobile-timings.json PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/nexus-m13-mobile-report ./node_modules/.bin/playwright test tests/mobile/touch-advanced.spec.ts --project=mobile --grep='mobile (Markdown|spreadsheet|PDF|DOCX|preview close)' --workers=1 --output=/tmp/nexus-m13-mobile-results`；exit `0`，**5 passed**。
- SSH 命令：`cd test/e2e && env E2E_CAPTURE_SCREENSHOTS=1 E2E_SCREENSHOT_OUTPUT_DIR=/tmp/nexus-m13-ssh-screenshots E2E_TIMINGS_OUTPUT=/tmp/nexus-m13-ssh-timings.json PLAYWRIGHT_HTML_OUTPUT_DIR=/tmp/nexus-m13-ssh-report ./node_modules/.bin/playwright test tests/ssh/file-preview-editor.spec.ts --project=ssh --grep='preview workspace backdrop|preview close button|preview tabs keep|preview tabs force refresh' --workers=1 --output=/tmp/nexus-m13-ssh-results`；exit `0`，**5 passed**。截图、metrics、HTML report 分别保留在 `/tmp/nexus-m13-mobile-screenshots/`、`/tmp/nexus-m13-ssh-screenshots/`、对应 `*-timings.json` 与 `*-report/index.html`。失败分类均为 `0`；日志中的一次 `RenderingCancelledException` 未影响结果。
- 该批当前 SHA 已覆盖 Markdown/Spreadsheet/PDF/DOCX 多 provider、移动窄屏/触控、preview close/cache、tab 保留、外部 refresh；仍不能关闭 M13：各 provider 显式 error/loading/unsupported、PDF 快速 refresh/outline/worker stale、XLSX 空 workbook/末页、landscape/notch 和最终 13 图仍归 M13.04–06/M17。

### C.28 M10 当前 SHA terminal 真实取证（2026-09-06）

- 当前产品 SHA 为 `9e21ebd5`。`/root/luna_m10_browser` 串行使用现有 Playwright webServer，未修改产品、测试或计划。
- SSH 命令：`cd test/e2e && E2E_CAPTURE_SCREENSHOTS=1 E2E_SCREENSHOT_OUTPUT_DIR=/tmp/nexus-m10-ssh-screenshots npx playwright test tests/ssh/terminal-ui.spec.ts tests/ssh/terminal-tools-ui.spec.ts --project=ssh --workers=1 --reporter=json --output=/tmp/nexus-m10-ssh-results`；exit `0`，**3/3 passed**，报告 `/tmp/nexus-m10-ssh-run.json`，1280×800 截图/metrics 齐全，字号 `14→15` 且无页面/终端横溢出。
- Mobile 命令：`cd test/e2e && E2E_CAPTURE_SCREENSHOTS=1 E2E_SCREENSHOT_OUTPUT_DIR=/tmp/nexus-m10-mobile-screenshots npx playwright test tests/mobile/terminal-touch.spec.ts tests/mobile/touch-workflows.spec.ts tests/mobile/touch-advanced.spec.ts --project=mobile --workers=1 --grep='pinch zoom persists|long press selects a word|clipboard Paste normalizes|CodeMirror search opens|virtual keyboard sends modified|keyboard sink preserves IME|virtual keyboard Ctrl modifier' --reporter=json --output=/tmp/nexus-m10-mobile-results`；exit `0`，**7/7 passed**，报告 `/tmp/nexus-m10-mobile-run.json`，截图保留 `/tmp/nexus-m10-mobile-screenshots/`，覆盖复制/选择、搜索、Ctrl/Alt/Del、IME、虚拟键盘、pinch/remount。
- 该批无产品断言、测试选择器或环境失败；仍不能关闭 M10：完整横竖屏/字体持久化、切 pane 后高亮、所有 modifier/keyboard 边界及 M17 最终截图仍需补齐，正式闭环计数不变。

### C.29 M11 当前 SHA 文件管理器真实取证（2026-09-06）

- 当前产品 SHA 为 `ff4077fb`。`/root/luna_m11_browser2` 使用独立 `/tmp/nexus-m11-ff4077fb-20260906/` 串行运行 SSH/mobile 流程，未修改产品或测试。
- 通过证据：`ssh/sftp-download.spec.ts` 1/1；`ssh/file-upload.spec.ts` picker/progress 各 1/1；受保护 `ssh/file-manager-context-menu.spec.ts` 的 right-click、multi-select、download-failure 各 1/1；`mobile/touch-workflows.spec.ts` 文件管理器流程 2/2；`mobile/touch-advanced.spec.ts` 长按/窄菜单 2/2。合计 **11 个 case 通过**，截图、timings、日志和 `status.log` 均保留在上述目录。
- `ssh/file-manager-navigation.spec.ts` 的 3 个 case 中 1 个通过，2 个失败：path history 导航未显示 `/folder-seed` 历史项；shell metacharacter 路径同步后 path input 仍为 `/`。失败发生在当前 filesystem 导航行为断言，尚不能归类为纯选择器/环境；`/tmp/nexus-m11-ff4077fb-20260906/logs/navigation.log` 和 trace 是待修复证据。
- 已派 `/root/luna_m11_nav_fix`（Luna max）只读核查并在有确定证据时修复当前 filesystem owner；在其结论前不关闭 M11.02/M11.03/M11.04，正式计数保持 `9 / 18`。其余文件操作、失败下载恢复、移动长按/多选和菜单几何当前 SHA 证据有效。

### C.30 M08 当前 SHA Workspace 真实取证（2026-09-06）

- 当前产品 SHA 为 `5fc8a530`。主代理在端口独占条件下运行 `tests/ssh/reconnect-ui.spec.ts --project=ssh --workers=1`，**2/2 passed，exit 0**；覆盖断连重连、任意键立即重连、三 session 新增/切换、tab 横滚/长按 context、Close Other 和关闭至空 Workspace。截图/metrics 由 Playwright 输出保留在 `/tmp/nexus-m08-ssh-screenshots/` 与 `/tmp/nexus-m08-ssh-results/`。
- 随后运行 `tests/mobile/ssh-workspace.spec.ts tests/mobile/suspend-resume-ui.spec.ts --project=mobile --workers=1`，**2/2 passed，exit 0**；覆盖 mobile terminal 空间与 touch-only tools、文件长按、status monitor 邻接、suspend/resume reload、hanging shell 复用和窄屏 modal。截图/metrics 保留在 `/tmp/nexus-m08-mobile-screenshots/` 与 `/tmp/nexus-m08-mobile-results/`。
- 本轮无产品断言、选择器或环境失败；仍不能关闭 M08.02–04：resize/layout-lock 键盘/拖动、完整 sidebar overlay/focus、窗口高度/虚拟键盘遮挡和最终 `mobile-workspace.png`/`M17` canonical 仍需独立证据，正式计数保持 `9 / 18`。

### C.31 M09/M11 当前 SHA 真实取证与导航回归复现（2026-09-06）

- `M09.02/M09.03 mobile quick-command evidence` 由 `/root/luna_m08_browser2` 使用串行 Playwright 完成，当前 SHA 为 `b8f5c9d7`；汇总、完整命令、exit、截图、metrics 和报告保留在 `/tmp/nexus-m09-mobile-20260906-RcbdyA/REPORT.md`。`mobile/touch-workflows.spec.ts` 的移动 Quick Commands 打开/列表/add/search 控件/Escape 关闭 **1/1 passed**，截图为 `/tmp/nexus-m09-mobile-20260906-RcbdyA/touch-workflows-report/functional-screenshots/mobile-quick-commands.png`。三个 SSH 功能 case（`quick-command-management`、`quick-command-tags-variables`、`command-history-management`）各 **1/1**；另一个 `quick-command-collapsible-search` 为 **0/1** 选择器失败，因此本批实际 **4/5 passed**，不能按 4/4 关闭。
- `ssh/quick-command-collapsible-search.spec.ts` **0/1**：在 M05 当前逐 section Settings UI 下，全局 `getByRole('button', { name: 'Save', exact: true })` 命中 17 个按钮，停在测试选择器 strict-mode，未到产品断言；不得改产品以规避，也不能把该 case 后续折叠/Escape 结论推断为通过。`touch-advanced` quick-command grep `--list` 为 0 tests（N/A）。移动变量 textarea、多行值、变量名 Enter 阻止提交、无 hover row actions、移动 Enter 执行、双 session Send to All/无活动 session 反馈仍未验证。M09 继续保持部分完成，正式计数不变。
- M09 首次启动曾因 M11 占用 `127.0.0.1:29090` 产生一次环境 exit 1；M11 自然结束后同命令串行重跑通过，未杀服务。该次环境失败不计产品失败；后续浏览器任务必须继续独占 E2E webServer。
- M11 导航复核使用当前 SHA `b8f5c9d7` 和健康 webServer，输出在 `/tmp/nexus-m11-nav-recheck-20260906/`：path-history 定向 run `common file-manager navigation tools work over real SFTP` **1 case / exit 1**，失败于 `file-manager-navigation.spec.ts:179`，下拉列表只有 `/`，没有刚访问的 `/folder-seed`；shell-metacharacters 定向 run **1 case / exit 1**，失败于 `file-manager-navigation.spec.ts:321`，从特殊路径向终端同步后 path input 仍为 `/`。两项均在有效 fixture/服务下稳定复现，归类为当前 filesystem/runtime 产品回归，不是选择器或环境失败。`useFilesystemCatalog.ts` 的队列草稿尚未修复 path-history，不能提交或关闭 M11；特殊路径必须先取得 terminal current-directory 的真实响应链证据再改，禁止猜测 quoting。
- 本节两项父模块均仍为部分完成；下一步由专属 filesystem owner 代理修复并重跑 M11 两个 case，主代理独立审查 diff/F/V/A 后再精确提交。受保护 dirty E2E、root-preserved/core 产物与未跟踪移动审计继续不触碰。

### C.32 M11 导航修复后的真实复核（2026-09-06）

- `/root/luna_m11_nav_fix` 在当前 filesystem/runtime owner 内完成最小修复，未修改测试、plan 或旧架构：`FileManager.vue` 将 path draft、terminal sync、favorite/navigation 和 Refresh 统一串行，成功加载后显式同步 `pathDraft`；`useFilesystemCatalog.ts` 仅以 trim 判空但保留合法路径原文，读写继续共用 history operation queue。该改动不新增 store/event bus/transport，也不改变 filesystem port 所有权。
- 修复前两个稳定产品失败分别为 path-history 下拉缺 `/folder-seed`、特殊路径同步后仍停在 `/`；修复后使用健康 webServer 串行验证：`tests/ssh/file-manager-navigation.spec.ts --project=ssh --grep common-file-manager-navigation --workers=1` **3/3 passed，exit 0**（`/tmp/nexus-m11-nav-fix-20260906/full-navigation/run.log`）；path-history 定向 **1/1 passed，exit 0**（`/tmp/nexus-m11-nav-fix-20260906/path-history-final/run.log`）；shell-metacharacters + refresh queue 定向 **1/1 passed，exit 0**（`/tmp/nexus-m11-nav-fix-20260906/shell-metacharacters-refresh-queue/run.log`）。此前中间一次 shell-metacharacters run 在删除 cwd 的后续刷新断言仍失败，保留为失败迭代证据，不与最终通过产物混用。
- 适用静态门禁：`check:architecture`、`check:i18n`、`vue-tsc --noEmit`、`git diff --check` 均 exit 0；证据分别保留 `/tmp/nexus-m11-nav-fix-20260906/architecture.log`、`i18n.log`、`vue-tsc-final.log`。主代理审查 diff 与真实失败/修复时序后确认该原子批次可作为 M11 的有效 F/A 进展；V 仅覆盖本次导航/同步页面状态，权限/archive/移动文件管理器/全部文件操作矩阵仍待验收。
- 因此 M11.02/M11.03 的导航原子回归已修复并有真实证据，但 M11.02–04 父模块仍保持部分完成，正式模块计数继续为 `9 / 18`。后续提交必须按模块剩余 F/V/A 收口，不能把该原子修复单独宣称为 M11 完成。

### C.33 M17.02 附录与最终收口盘点（2026-09-06）

- `/root/luna_m17_appendix_audit` 只读核对当前 `HEAD=b8f5c9d7`、工作树保护项、模块表、附录 A/B/C/D。正式模块计数与 C.31/C.32 一致：`9 / 18`；M00/M01/M08–M13 仍部分，M17.01–06 未关闭。plan、6 个产品源文件、两份受保护 E2E 及 root-preserved/core/未跟踪移动审计均不能被误当作最终产品证据或随模块提交。
- 附录 A 的 98 行是追溯索引，不是完成分母；仍有大量 `source reviewed`/`mobile browser verification pending`，需逐行归类为当前 SHA 的 F/V/A、产品差异、selector 维护、environment/canonical 依赖或明确 N/A，并保留对应证据路径。源码审计不得替代真实浏览器视觉验收。
- 附录 B 的 28 图中 **27 行**仍为 `pending — M17 最终验收 real screenshot refresh and visual review`；`theme-customization.png` 只有较早局部刷新，`mobile-markdown-preview.png`/`mobile-spreadsheet-preview.png` 仅 partial browser evidence，均需最终产品 SHA 重新生成并人工复核。`/tmp/nexus-p9-mobile-complete` 缺少可确认的完整 run/exit/report/逐图结论，不能因 PNG 存在而采信。
- M17 收口顺序固定为：先 M17.01 补完整 mobile 命令/case/exit/report 与 13 图结论；再 M17.02 为附录 A 逐行建立 disposition；M17.03 单独维护 `file-preview-editor.spec.ts:889` 与 quick-command collapsible-search 的精确 selector 后跑静态门禁/受影响 E2E；M17.04 执行最终 SHA canonical Docker smoke、G1–G8 与 ingress；M17.05 生成并复核全部 28 图；M17.06 只在每项真实差异已修复或有明确 owner 决策、新架构边界通过后关闭项目。
- 当前有效临时证据索引：M09 `/tmp/nexus-m09-mobile-20260906-RcbdyA/REPORT.md`，M11 修复 `/tmp/nexus-m11-nav-fix-20260906/`；后续 M17 必须在同一 run 记录命令、SHA、exit、case、截图/日志，不拼接不同 run 的产物。

### C.34 M17.03 测试选择器维护验收（2026-09-06）

- 两个已确认的非产品 strict-mode 失败已在测试 owner 内最小修复，未修改产品代码、plan 或受保护文件：`file-preview-editor.spec.ts:889` 改用 `getByTestId('spreadsheet-preview-pagination-save')`；`quick-command-collapsible-search.spec.ts:92` 改用 settings scope 下的 `getByTestId('quick-command-collapsible-search-save')`。
- 当前 SHA `b8f5c9d7b6f6d24072b64f2d3f31a00766f91a36` 的串行验证：文件预览 spec **9/9 passed，exit 0**，报告 `/tmp/nexus-m17-03-file-preview-20260906`；Quick Commands 定向 case **1/1 passed，exit 0**，报告 `/tmp/nexus-m17-03-quick-command-20260906`。
- 文件预览首次 run 因共享 `127.0.0.1:29090` 被占用退出 `1`，释放端口后同命令重跑通过；该次归类为环境冲突，不得当作产品或测试失败。M17.03 的 selector 维护项可从待处理列表移除，但尚未代表 M12/M09 父模块闭环。

### C.35 M17.02 附录逐行 disposition（2026-09-06）

- 只读报告 `/tmp/nexus-m17-02-disposition-20260906/REPORT.md` 已按当前 SHA `b8f5c9d7` 覆盖附录 A **98/98 行**及附录 B **28/28 图**，逐项区分有效 F/V/A、browser partial、需当前浏览器、产品差异、selector 维护、canonical/environment 依赖和 N/A。
- 统计为附录 A：30 项已有 F/V/A 证据、3 项 browser partial、62 项需当前浏览器、3 项明确 N/A；附录 B：28 项均需最终 SHA screenshot refresh/review（历史 PNG 不作完成证明）。该报告是 M17 执行台账，不改变正式模块计数 `9 / 18`。

### C.36 当前 SHA 认证、TokenInput、编辑器与预览补证（2026-09-06）

- `M00.03/M00.04 TokenInput`：当前 SHA `b8f5c9d7`，360×800，独立 Playwright case **1/1 passed，exit 0**；覆盖初始/过滤建议、选择后重新聚焦、失焦与 Escape 收起、自定义创建和无横溢出。证据 `/tmp/nexus-m00-token-input-20260906/`。M00 的集成 shell/feedback 与 TokenInput F/V 证据已齐，但仍需主代理核对附录 D 全局非 Vue 项后再关闭。
- `M01`：认证 ledger `/tmp/nexus-m01-auth-full-20260906/` 列出 10 cases、9 通过；普通登录、退出/保护路由、三 viewport、2FA API/UI 通过。passkey canonical 仍受 `localhost`/`127.0.0.1` host-only cookie 与 CDP fixture 限制，CAPTCHA、软键盘、跨语言及部分失败视觉仍待；M01 不关闭。
- `M12.03`：隔离 network namespace、无 HMR 的完整 editor lifecycle case **1/1 passed，exit 0**，包含 Ctrl+wheel；证据 `/tmp/nexus-m12-lifecycle-full-20260906/run/ctrl-wheel-isolated/`。之前的 `NaN` 归类为共享工作树 HMR 噪声，不是稳定产品回归；保存失败/重试、多文件迟到加载、跨 session 和移动长 toolbar 仍待。
- `M13.04–06`：当前 SHA provider SSH **7/7 passed**、mobile **5/5 passed**，证据 `/tmp/nexus-m13-provider-full-20260906/{ssh,mobile}/`；额外 probe 因 `127.0.0.1:29090` 已占用 **0 tests**，归环境冲突。PDF/XLSX/DOCX/Markdown/image refresh 与移动/桌面 tab 外壳已取证，但 error/loading/unsupported 全矩阵、快速 PDF worker stale、最终截图仍待，M13 不关闭。

### C.37 M09 缺口流程真实复核（2026-09-06）

- 当前 SHA `b8f5c9d7` 的 M09 缺口流程在独立、串行 Playwright 中补齐：移动变量多行/变量名 Enter/无 hover actions/搜索 Enter **2/2 passed**；双 session Send to All 与无活动 session 反馈 **1/1 passed**；Quick/History 既有 SSH suite（management、tags/variables、history、collapsible search）**4/4 passed**。完整报告 `/tmp/nexus-m09-missing-20260906/REPORT.md`。
- 早期失败均已分类为临时 harness 脱离或端口占用，修正 harness 后重跑通过；当前仍需确认 M09.03 计划中“加载/保存/删除/建标签失败反馈”是否有独立真实错误态证据，未据此提前关闭 M09。

### C.38 M17.01 移动全量 fresh run（2026-09-06）

- 当前 SHA `b8f5c9d7` 的 `test:mobile` fresh run 先 `--list` **26 tests / 7 files，exit 0**，再以 `--workers=1` 串行执行，结果 **24 passed / 2 failed，exit 1**；报告 `/tmp/nexus-m17-mobile-20260906-0754/REPORT.md`，HTML `/tmp/nexus-m17-mobile-20260906-0754/html/index.html`。
- 13 个 Appendix B 移动检查点 PNG 均已生成并完成明显裁切/溢出人工检查，保存在 `/tmp/nexus-m17-mobile-20260906-0754/screenshots/`；这只能证明产物齐备和初步视觉检查，不能替代逐图最终 parity。
- 两项失败已分类：`dashboard-mobile.spec.ts:57` 为 `/settings` 加载期间 `net::ERR_NETWORK_CHANGED` 导致空页的环境问题，`m10-mobile-audit.spec.ts:24` 为未跟踪受保护审计脚本的 `file-editor-view` strict selector 维护问题；均未修改仓库文件。M17.01 仍待 dashboard 隔离重跑与最终图审查，不能关闭。

### C.39 M09 本地模块 F/V/A 闭环（2026-09-06）

- M09 的功能矩阵已由当前 SHA `b8f5c9d7` 真实取证覆盖：移动变量/触控/搜索 **2/2**，双 session Send All/no-active **1/1**，Quick/History SSH suite **4/4**，四类 HTTP 503 失败反馈 **4/4**；均为串行、有效浏览器流程，报告 `/tmp/nexus-m09-missing-20260906/REPORT.md`。
- V：移动状态截图、无 hover 行操作、窄容器变量表单、双 session feedback 及既有桌面 Quick/History 证据齐备；失败态保留表单/行的视觉状态。A：实现仍由 quick-command/history feature 与 Workspace command capability 持有，未恢复旧 store/event bus，历史静态 architecture/i18n/typecheck/build/diff 门禁通过。
- M09.02/M09.03 及模块自身 F/V/A 均已满足；正式模块计数由 `9 / 18` 更新为 **`10 / 18`**。M09 仍需随最终产品 SHA 经 M17.04–06 canonical/截图复核，不能据此宣布项目完成。

### C.40 M13 provider 错误/取消/横屏补证（2026-09-06）

- 原隔离 provider probe 的报告摘要曾写作 **1/1 passed**，但原始 `/tmp/nexus-m13-provider-full-20260906/temp/status.log` 实际为 `exit=1`，失败停在 malformed XLSX 的 `spreadsheet-preview-error` 断言；`/tmp/nexus-m13-error-matrix-20260906/probe/results/.last-run.json` 也记录 4 个失败。因此该 run 只能证明部分 provider/geometry 行为，不能作为完整 error/loading/unsupported 全矩阵通过。
- 可靠证据仍覆盖 unsupported editor fallback、invalid PDF/DOCX/image、延迟 PDF loading/cancel、20 MiB oversize Retry、`915×412` landscape popup/document geometry；SSH **7/7**、mobile **5/5** 的正常 provider/preview 流程继续保留。SheetJS 对 malformed XLSX 的容忍行为记录为兼容性观察，不把它直接归因成产品失败。
- 仍未关闭 M13：快速 PDF stale-worker/outline race、XLSX 最后一页 pagination、empty/invalid provider 的干净隔离复跑与最终 canonical 截图刷新仍待。

### C.41 M17.01 dashboard 隔离复跑（2026-09-06）

- 原始 mobile dashboard 失败已在 `unshare --net`、独立 backend DB/Vite cache、无宿主端口竞争条件下定向重跑：`1 test / 1 file`，**1 passed，exit 0**；`/settings`、模块和 API 均 HTTP 200，报告与 trace 位于 `/tmp/nexus-m17-mobile-dashboard-rerun-20260906-080855/`，总报告已更新 `/tmp/nexus-m17-mobile-20260906-0754/REPORT.md`。
- 因此 M17.01 产品移动矩阵为 **25/26 可采信通过**；剩余 1 case 是受保护、未跟踪的 `m10-mobile-audit.spec.ts` selector strict-mode 维护项，不修改该文件、不将其失败归为产品。13 个 checkpoint PNG 已齐备，但仍需 M17.05 逐图最终 review，M17.01 不单独关闭项目。

### C.42 当前 SHA M08–M13 最终矩阵复核（2026-09-06）

- **M08**：多 Workspace 2/2、SSH/mobile resize 均通过，architecture/i18n/Prettier/`vue-tsc`/diff-check 均通过；Configurator run 的 `.last-run.json` 为 `failed` 但 `failedTests=[]`，sidebar wheel 在后端 `PUT` 超时，必须在独立环境定向复跑，暂不关闭 M08。
- **M11**：navigation 3/3、mobile core 4/4、workspace/history 1/1、XLSX/DOCX 横向各 1/1、desktop preview scrollbar 1/1；context 4/6、archive progress 3/5。`sidebar-pane-fileManager` 缺失属于当前 Workspace layout 产品依赖；其余失败已分别归类为通知 selector/timing、page crash/fixture 或 route helper，不能直接计入 M11 产品失败，但也不足以关闭 M11。
- **M12**：`ssh/file-preview-editor.spec.ts` 9/9；M12 相关 mobile `touch-advanced` 9/9、`touch-workflows` 3/3；无关 M11 upload case 在 `--shm-size=2g` 隔离重跑 1/1。临时 save/late-load probe 3 cases 失败均为 fixture/helper/Monaco 尾换行或异步编排问题，不能作为产品失败证据；save-retry、delayed-save/dirty-close、late-load ordering 仍没有可靠正向 probe，M12 继续部分完成。
- **M13**：provider SSH 9/9、mobile 10/10；clean empty XLSX 显示 `Invalid XLSX file: no worksheets were found.`；`915×412` overlay `x=12,y=12.36,w=891,h=387.27` 且无横溢出，四向 notch safe-area 为 source-verified。快速 PDF stale-worker/outline、XLSX 末页及最终 canonical/28 图仍待。
- **M17**：现有 Docker/G1–G8 证据基于旧 SHA `b8f5c9d7`，不是当前 `0e40b3cb`；必须冻结当前产品/selector 改动后在同一 SHA 重建并重跑 smoke、ingress、G1–G8，再进行 28 图最终人工复核。不得把旧 SHA 证据提升为 M17.04 完成。

### C.43 M08 Workspace 当前工作树证据更新（2026-09-06）

- 当前产品基线为 `HEAD=0e40b3cb` 加未提交的三个 Workspace owner 文件：`WorkspaceLayoutConfigurator.vue`、`WorkspaceLayoutNodeEditor.vue`、`workspaceLayout.ts`。改动只恢复旧布局投影与尺寸语义：非 `terminal` pane 可同时出现在主布局和 sidebar，`terminal` 保持单一 owner；主布局重复 pane、最小 pane 尺寸、clone 与 resize rebalance 均在当前布局模型内处理，未恢复旧 store/event bus/transport。
- 配置器定向浏览器 run 使用隔离 seeded backend，`/tmp/nexus-m08-configurator-rerun-live-20260906/run.log`：**1/1 passed，exit 0**，覆盖桌面配置器可打开、布局控制可见且不越出 viewport。
- 窄右侧栏目标 run 使用同一类隔离环境，`/tmp/nexus-m08-sidebar-rerun-live-20260906/run.log`：`file-manager-context-menu.spec.ts:139` **1/1 passed**，覆盖 `fileManager` sidebar 投影及 submenu viewport；同 run 的 wheel case 在连接 helper 未进入 `/workspace` 前失败，未触达产品断言，归测试环境/fixture，不作为 M08 产品失败。
- 适用静态门禁均通过：`check:architecture`（255 source files）、`check:i18n`（1706 keys/3 locales/81 fragments）、`vue-tsc --noEmit`、三个 Workspace 文件 Prettier、`git diff --check`。本轮补强了配置器与 sidebar projection 证据，但 C.30/C.42 所列 resize/layout-lock、focus/overlay、窗口高度/虚拟键盘和最终 `mobile-workspace.png` 仍未全部取得当前 SHA 的独立 F/V 结论；因此 M08 继续保持部分完成，正式计数为 **10 / 18**。

### C.44 M01 认证入口当前证据更新（2026-09-06）

- 当前受保护 E2E 产物中的普通密码失败→同页重试矩阵已可采信：`1280×800`、`320×667`、`375×812` 各 **1/1**，均验证第一次真实 `401`、页面仍在 `/login` 且未认证，修正密码后第二次真实 `200` 并进入受保护首页；失败/成功状态的 metrics 与截图保留在 `test/e2e/test-results.root-preserved-20260906-takeover/`。
- 相关定向 UI、logout/protected-route 与 auth API runs 均 exit `0`；三视口 document/body `scrollWidth` 等于 viewport，字段、alert、Remember Me、submit 的 bbox 和 computed style 均有记录。该证据覆盖 M01.03-a 的 F/V，不扩大到全部认证状态。
- passkey 仍被既有 harness 的 `localhost` 页面与 `127.0.0.1` API cookie host 不一致阻断，不能归因于认证入口产品；M01.02/M01.03 继续保持部分完成。历史 `f98ed7a2` 的 auth store 过期 2FA 清理应作为 M01.02 范围单独审查，不把它混入本切片的 LoginView-only 约束。

### C.45 M00 Shell/资产当前证据更新（2026-09-06）

- 当前 `HEAD=0e40b3cb` 的 M00 只读审计未发现新的确定产品差异，未修改产品文件；DialogHost focus trap/restore、OverlayPanel Escape/backdrop/stack、tokens、FontAwesome、logo、manifest/favicon 与 service worker 均与旧基线及已有修复一致。
- PWA/manifest/favicon/service-worker 定向 run **1/1 passed**，移动 Dashboard 360/412 窄屏邻接 **1/1 passed** 且无页面横溢出；architecture、i18n、`vue-tsc`、独立 Vite build、`git diff --check` 均通过。nested overlay 仍主要依赖源码证据，故 M00 不提前关闭；`check:test-policy` 的唯一失败来自受保护未跟踪 `m10-mobile-audit.spec.ts`，不归因于 M00。

### C.46 M12 Editor 生命周期当前证据更新（2026-09-06）

- 当前 SHA 的隔离 save-failure probe 未到达保存动作：setup 后 `command-input` 持续 disabled 并在 20 秒超时，exit `1`；报告 `/tmp/nexus-m12-final-matrix-20260906/report/m12-gap-save-offline/index.html`，属于 fixture/前置状态阻断，不能判定产品 save/retry 通过或失败。
- 因此 M12.03/M12.04 的保存失败→Retry、delayed save/dirty close、A→B 快速打开及迟到 load ordering 仍无可靠正向浏览器证据；已验证的 M12.02 移动矩阵和文件预览矩阵继续保留，M12 父模块保持部分完成。

### C.47 M10/M11 当前失败边界证据更新（2026-09-06）

- M10 当前 terminal owner 只读审计未发现新的稳定浏览器回归，既有 SSH/mobile 触控、IME、虚拟键盘、搜索、重连证据继续有效；未修改 terminal 产品文件。完整移动截图与更宽边界矩阵仍归 M10/M17 待验。
- M11 当前 SHA `0e40b3cb` 的隔离证据位于 `/tmp/nexus-m11-failure2-20260906/`：context-menu SFTP workflow **1/1 passed**（含 chmod 成功与密码 ZIP 错误重试）、password ZIP protocol **1/1 passed**、preflight-held archive cancellation **1/1 passed**；初次 ENOSPC 后清理环境重跑通过，非产品失败。
- 当前仍缺直接 chmod failure 的浏览器 F/V 证据；归档正向/取消不等于失败反馈，不能据此关闭 M11.03。M11 继续部分完成，filesystem 当前导航队列修复保留，未恢复旧 transport/store/event bus。

### C.48 当前 SHA M08/M11/M12 边界收口（2026-09-06）

- **M11.03 direct chmod failure**：在当前产品 SHA `0e40b3cb` 使用隔离真实 SSH/SFTP 链路和远端删除控制端点制造 `ENOENT`，`m11-chmod-failure-probe.spec.ts` **1/1 passed，exit 0，约 7.5s**。证据 `/tmp/nexus-m11-chmod-audit-20260906/result.json` 与 `chmod-failure-recoverable.png`：错误详情 `Failed to change permissions: ENOENT...` 可见，权限对话框保留、输入值 `600` 保持，目标重建后 Retry 成功且 mode 为 `600`；临时 probe 已删除，端口已释放。
- **M11.04 mobile PDF**：原失败停在 `test/e2e/support/ssh.ts:73` 的 `/workspace$` helper，当前合法入口为 `/workspace?connectionId=1`，产品 owner 在 `ConnectionsView`/`WorkspaceView`，不是 filesystem/preview 回归。仅在临时副本放宽 helper 后，当前 SHA 的 `mobile/touch-advanced.spec.ts --project=mobile --grep=PDF --workers=1` **1/1 passed，exit 0，9.2s**；`PdfPreview.vue`、该 spec 与 helper 在 `b8f5c9d7..0e40b3cb` 无差异。该 run 没有 PDF 专项截图，最终 canonical 仍归 M17，不将旧 SHA 截图冒充当前视觉证据。
- **M11 状态**：上述两项失败边界已关闭为产品疑点，但 context/sidebar 的剩余 case 仍依赖 M08 layout owner，且当前模块尚未取得全部适用的独立 V 证据；正式模块计数保持 `10 / 18`，不得提前关闭 M11。
- **M08 SRS-WS-006 最小修复**：`workspaceLayout.ts` 现在只在 load/save 候选管线允许缺失/空 node id，按树路径生成稳定 id，再严格复验非法类型、重复显式 id、未知 pane、重复 component 与错误容器；已有 id 不 churn。Prettier、architecture、i18n、`vue-tsc --noEmit -p packages/frontend/tsconfig.json`、`git diff --check` 均通过；浏览器 F/V 仍待，不据静态门禁关闭 M08。
- **M12 fixture 边界**：`file-editor.md` 明确 legacy dirty tab close 不阻止关闭；当前 SSH adapter 以 `open(remotePath, 'w')` 写入，删除目标后保存会重新创建文件，故现有 save-failure probe 不能证明产品成功/失败。M12.03/M12.04 继续保持部分完成，需提供可稳定制造远端写入失败的 fixture 后再取正向 F/V 证据。

### C.49 当前 SHA M08 配置器 probe 失败归因（2026-09-06）

- 当前产品 SHA 为 `bfeb6692`。隔离 temporary Workspace probe 首轮使用已过时的 `Add Horizontal Container` 文案，在真实页面只存在 `H`/`V` 控件，90 秒等待未进入产品断言；修正为当前 `H` 后，布局添加与 `Remove this node` **5 个节点计数**通过。
- 修正后的单 case 随后在 save/reload 后断于 `.workspace-split--locked:visible`：截图显示 reload 后没有活动 session，属于 probe fixture/selector 前置未满足，不能判定 locked splitter 产品失败或通过。命令/exit/trace保留在 `/tmp/nexus-m08-current-sha-20260906/layout-bounded-command.txt`、`layout-bounded-exit.txt`、`layout-bounded-run.log` 及对应 test-results。
- 因此 M08 继续部分完成；下一次只允许先修正 probe 的活动 session 前置并重跑 locked/save 矩阵，不修改产品来迎合过时 selector，也不把该失败计入产品缺陷。

### C.50 M13 证据纠偏与下一项最小取证（2026-09-06）

- 当前 Workspace/filesystem/docs 提交只改变 M08/M11 owner 与计划，`0e40b3cb..bd924c9e` 没有 M13 owner 路径变化；既有正常 provider 证据可作为邻接参考，但必须在最终产品 SHA 重新标识，不把旧 SHA 截图升级为当前 canonical。
- 静态复核发现 `PdfPreview.vue` 的 `resolveOutlineDestination()` 在异步 `getDestination/getPageIndex` 返回后仍缺一次 document-generation identity guard；这是待证实风险，不直接当作产品失败或已修复。
- XLSX 末页实现/断言源码存在，但历史两例均卡在 connection/settings helper；至少要在隔离端口完成 empty-XLSX、invalid provider、mobile loading 和末页分页的干净 F/V run。下一项优先做 **PDF 快速 refresh/切 tab race evidence-only probe**：只取真实截图、页码、outline、worker/console 结果；若出现旧文档回写，才允许在 `features/file-preview/components/PdfPreview.vue` 内修复 generation guard。

### C.51 M13 当前 SHA provider 与分页收口（2026-09-06）

- 在当前产品 SHA `5de4702f266718634f1f69546e77af566c2aac2a`、隔离端口和独立输出目录下，XLSX 末页 run **1/1 passed，exit 0**：页面 2 显示 `25–40 of 40`，真实渲染 16 行，无首行 header class，容器 `scrollHeight - clientHeight <= 2`。截图与报告位于 `/tmp/nexus-m13-current-5de4702f/screenshots/` 和 `/tmp/nexus-m13-current-5de4702f/xlsx-REPORT.md`。
- 同一 SHA 的 mobile provider lifecycle run **1/1 passed，exit 0**：invalid PDF/DOCX/image 错误态、empty XLSX `no worksheets`、unsupported editor fallback、延迟 PDF loading，以及 Escape/X 取消语义均通过；`412×839` 截图、metrics、console、worker 请求位于 `/tmp/nexus-m13-current-5de4702f/provider/`，PDF worker 返回 200，未出现 page error。
- 此前同一 SHA 的 PDF race2 run **1/1 passed**，刷新、快速关闭/重开和双 tab 切回后 outline、页码与 loading 状态保持当前文档；证据位于 `/tmp/nexus-m13-pdf-race2-20260906/`。本轮未发现需要补 generation guard 的稳定产品差异。
- M13.05/M13.06 的 F/V/A 现已有当前 SHA 结论，模块正式计数由 `10 / 18` 更新为 **`11 / 18`**；M13 仍需 M17 在最终冻结 SHA 上统一刷新/人工复核附录 B 的 canonical 28 图，实体 notch 继续标记为 source-verified 而非硬件实测。产品 owner 未改动，未恢复旧 store/event bus/重复状态。

### C.52 M10 当前 SHA 终端边界收口（2026-09-06）

- 当前产品 SHA `5de4702f` 的隔离 Playwright run **2/2 passed，exit 0**（Pixel 7、单 worker），覆盖 `375×812` portrait 与 `812×375` landscape：terminal/command bar 无横向溢出，切 pane 重挂载后搜索词与 `.xterm-selection` 保留，Ctrl+wheel 字号从 `14` 变为 `15` 并在关闭/重开后通过 appearance API 持久化。
- 同一 run 的 modifier/keyboard 证据确认 `Ctrl+Home`、`Ctrl+Alt+↑`、`Alt+Tab`、Ctrl+C 的 terminal.input frame 正确且 modifier 一次性清理；既有当前 SHA 触控/IME/虚拟键盘与重连证据作为邻接矩阵，不重复制造测试。截图、metrics、console 位于 `/tmp/nexus-m10-terminal-audit-20260906-run3/`，`pageErrors=[]` 且 console 无 error。
- 截图人工复核确认移动 header、session tab、terminal、命令栏、工具按钮及横屏 modifier 键盘均在可读/可点击区域；当前 terminal feature owner 无需产品改动，静态 `git diff --check` 通过，未恢复旧 store/event bus/transport。
- M10.02/M10.03 的 F/V/A 已闭环，正式模块计数由 `11 / 18` 更新为 **`12 / 18`**；M10 仅保留 M17 最终 SHA/canonical/28 图统一复核。

### C.53 M12 当前 SHA 编辑生命周期收口（2026-09-06）

- 当前产品 SHA `5de4702f266718634f1f69546e77af566c2aac2a` 使用临时真实 SSH/SFTP server：写入失败端点不会自动重建文件，另有 `1.5s` 写延迟与 `1.6s` 读延迟。四个独立 Playwright run 均 **1/1 passed，exit 0**：Save failure→Retry、delayed save/dirty close、A→B latest-open ordering、关闭 popup 丢弃迟到 load。
- 证据命令与每项 exit 位于 `/tmp/nexus-m12-luna-max-20260906a/run/{save-retry,delayed-save,latest-open-dispatch,closed-scope}/meta`；截图位于 `/tmp/nexus-m12-luna-max-20260906a/screenshots/`，其中失败态显示 `Save error` 与 `Permission denied by M12 SFTP fixture.`，成功态保留编辑内容与无旧文档回写。
- 初始四项合跑因连接 fixture/Vite 动态模块 teardown 干扰在第二项停留 `/connections`，另一次单项 run 因 websocket reset 超时；均未触达产品断言，随后以独立端口/独立输出目录重跑全部通过。`ResizeObserver loop` 仅为浏览器/Vite warning，不影响独立 case 结果。
- F/V/A：功能、视觉状态和 controller/port 归属均有当前 SHA 证据；未修改产品源、未恢复旧 FileEditor store/event bus/重复文档 owner。M12.03/M12.04 及父模块本地闭环，正式模块计数由 `12 / 18` 更新为 **`13 / 18`**；最终截图与 canonical 仍由 M17 统一复核。

### C.54 M08 当前 SHA layout/focus 进展与资源阻断（2026-09-06）

- 当前产品基线为 `5de4702f`（本轮计划提交后工作树仅改变文档）。活动 session 通过真实 `/workspace?connectionId=1` 打开后，layout-current-v2 **1/1 passed，exit 0**：save/reload、locked splitter、5% min-size、resize rebalance 与 metrics/screenshot 均通过；窄右侧栏 submenu **1/1 passed，exit 0**。证据与命令位于 `/tmp/nexus-m08-current-sha-20260906/`。
- Focus 配置器首次真实运行暴露 `structuredClone` 读取 Vue reactive proxy 的 `DataCloneError`。在当前 Workspace owner 内改用递归 `toRaw` clone，保留同一 focus capability、保存 API 与快捷键状态；修复后 focus/shortcut run **1/1 passed，exit 0**，metrics 为 before/after sequence 与 `focused=commandInput`，截图位于 `/dev/shm/nexus-m08-focus-5de4702f-v2/`。architecture、i18n、vue-tsc、Prettier、diff-check 均由该 run 通过。
- archive sidebar unmount 与 immediate-close wheel 两个 run 均未取得产品结论：页面/cleanup 期间出现 `/tmp` `ENOSPC`，分别为 `0/1` 和 `0/1`；sidebar/context/layout 断言未显示稳定产品反例，不能标为通过或失败。需清理可丢弃证据后在独立空间重跑，不修改产品迎合 selector。
- 本节对应产品改动仅为 `packages/frontend/src/runtimes/workspace/components/WorkspaceFocusConfigurator.vue` 的 reactive-safe clone，未恢复旧 store/event bus/transport；M08 继续部分完成，正式计数保持 **`13 / 18`**。

### C.55 M00 全局 shell/feedback 当前工作树收口（2026-09-06）

- 当前工作树基于产品 `HEAD=2b971184`；M00 仅做证据与计划收口，未修改产品源、测试或旧架构。附录 D 的 tokens/default theme、CSS/字体与图片 intrinsic size、favicon/PWA/manifest 等非 Vue 入口已按当前 owner 逐项复核，没有可确认的产品差异。
- 共享 overlay probe 在 `/tmp/nexus-m00-overlay-probe-20260906/` 的最终独立 run **1/1 passed，exit 0**：alert 在 `360×800` 与 `412×915` 均 viewport 内无横溢出；confirm 的 focus trap、Tab/Shift+Tab、Escape、backdrop 关闭及焦点恢复均有 `overlay-probe.json` 与截图证据。首次失败 run 仅保留为 locator/等待迭代，不与最终结果混用。
- 嵌套 overlay/focus boundary 在 `/tmp/nexus-m00-nested-boundary-20260906/` 最终 run **2/2 passed，exit 0**：内层 dialog Escape/backdrop 只关闭顶层并恢复 `connection-delete-button` 焦点，外层 Escape 再关闭父层；长确认消息在 `360×800`、`412×915` 均包裹且页面 `scrollWidth === clientWidth`。既有 TokenInput `1/1` 证据保留在 `/tmp/nexus-m00-token-input-20260906/`。
- F/V/A：功能覆盖共享 alert/confirm/toast、嵌套关闭和焦点语义；视觉覆盖窄屏尺寸、长消息、无横溢出与旧 UI overlay 结构；架构确认状态仍在 shared feedback/foundation owner，无旧 store/event bus/重复 controller。M00 关闭，最终 canonical 仍由 M17 统一刷新。

### C.56 M11 文件管理器与 sidebar 交互收口（2026-09-06）

- 当前验证工作树基于 `HEAD=2b971184`，唯一产品 diff 为 `packages/frontend/src/runtimes/workspace/components/WorkspaceSessionSurface.vue` 左右 sidebar rail 增加 `relative z-[120]`。固定 sidebar panel 使用 `z-[110]`，原 rail 被其覆盖后 `sidebar-pane-fileManager` 点击无法到达，导致关闭/teardown 假失败；该改动只修正现有 Workspace 组合层级，不新增状态 owner、transport 或旧架构 facade。
- M11 导航/路径 history/terminal path sync 的既有修复证据 `/tmp/nexus-m11-nav-fix-20260906/` 仍有效；在当前工作树独立串行重跑 `progress-display-archive.spec.ts` 的 archive sidebar unmount **1/1 passed，exit 0（8.9s）**，以及 `panel-wheel-scaling.spec.ts` 的 immediate-close wheel **1/1 passed，exit 0（8.5s）**。完整日志位于 `/dev/shm/nexus-m11-2b971184-20260906-rerun/{archive-sidebar-unmount,panel-wheel-scaling}/run.log`。
- 两项复跑均真实打开 `/workspace?connectionId=1`、执行侧栏打开/关闭和 archive/wheel 断言；无 `ENOSPC`、page error 或残留 E2E 服务。此前 `/tmp` 满导致的 `0/1` 仅作为环境失败保留，不再当作产品结论。
- F/V/A：F 覆盖文件导航、路径同步、上下文侧栏、archive 入口卸载和 wheel 缩放；archive 任务生命周期仍归 M14。V 覆盖 rail/panel 层级、侧栏可达性及文件管理器边界；A 保持 filesystem controller/Workspace public capability 单一归属。M11 关闭，最终 canonical 仍由 M17 统一刷新。

### C.57 M17.03 当前 SHA 静态门禁复核（2026-09-06）

- 当前产品 SHA 为 `127f8dfc0eeb8d78da53d05a7a242a06c4a91a8e`。`npm --prefix packages/frontend run check:architecture`、`check:i18n`、`cd packages/frontend && npx vue-tsc --noEmit`、`npm --prefix packages/frontend run build` 与 `git diff --check` 均 exit `0`；日志保留在 `/dev/shm/m17.03-127f8dfc-*.log`。
- `npm run check:test-policy` 与 `npm --prefix test/e2e run groups:check --` 均 exit `1`，唯一原因是受保护的未跟踪 `test/e2e/tests/mobile/m10-mobile-audit.spec.ts`：其动态截图文件名不满足 policy，且尚未列入任何 group。该文件及其他 root-preserved dirty 文件不得修改、暂存或删除；此结果不能归因于当前产品 SHA。
- 本轮未以包含大量 root-preserved/dist 生成物的 `format:check` 结果作结论；清理或隔离生成物后必须对最终受保护工作树执行精确 format gate。M17.03 继续部分完成，不能把局部门禁通过扩大为项目完成。

### C.58 M08 当前 SHA Workspace 全量收口与侧栏叠层修复（2026-09-06）

- 当前产品 SHA 为 `015531fbf689e097c0f9fef3f707bf745c20fc8e`。Workspace 组合层此前使用 `z-[110]` 固定侧栏，而从侧栏打开的连接编辑/标签管理 modal 仍使用默认 `z-index: 50`；窄屏真实流程中侧栏内容会拦截 modal 控件。当前修复严格留在新架构 owner：`BaseContextMenu` 默认 `130`、filesystem 压缩 submenu `140`、`ConnectionEditorModal` 与 `WorkspaceTagGroupManager` `150`，未恢复旧 store/event bus/transport。
- 叠层与邻接功能在当前工作树独立串行验证：`tests/ssh/connection-list-search.spec.ts` **2/2 passed，exit 0**；首次右键编辑拦截和随后标签管理 `Select All` 拦截均消失。产品改动已提交为 `015531fb`，受保护 dirty E2E 文件和 root-preserved 产物未触碰。
- M08 当前 SHA F/V/A 证据已齐：layout/focus owner probe **2/2 passed**（`/dev/shm/nexus-m08-current-015531fb-20260906T112200Z/`）；archive sidebar unmount **1/1 passed**（`/dev/shm/nexus-m08-archive-015531fb-20260906T112100Z/`）；immediate-close wheel **1/1 passed**（`/dev/shm/nexus-m08-wheel-015531fb-20260906T111500Z/`）；Pixel 7 mobile Workspace/status/file-manager **1/1 passed**（`/dev/shm/nexus-m08-mobile-015531fb-20260906/`）；virtual keyboard/modifiers **1/1 passed**（`/dev/shm/nexus-m08-virtual-keyboard-015531fb-20260906/`）。
- M08.02–M08.04 的功能、视觉状态与架构边界均达到本地闭环，正式模块计数更新为 **`16 / 18`**；最终 canonical SHA、28 张图和跨模块 disposition 仍由 M17.04–06 统一验收。

### C.59 M17.03/M17.04 当前最终 SHA 收口复核（2026-09-06）

- 本轮最终验收基线冻结为 `HEAD=438426b8`；工作树中的两份受保护 dirty E2E、未跟踪移动审计、`root-preserved` 产物与 `core.*` 均未修改、暂存或删除。M17.03 的 clean archive 静态门禁中 architecture、i18n、`vue-tsc --noEmit`、frontend build、test-policy、groups check 均有 exit `0` 证据；`format:all:check` 仍只被四个既有 tracked 格式文件阻断（plan、`OverlayPanel.vue`、`group-6.json`、`timings.json`），不能扩大解释为产品失败或项目完成。
- M17.04 报告位于 `/dev/shm/nexus-m17-docker-ce555215-20260906T113348Z/REPORT.md`：最终 SHA 的 unified Docker build、Docker smoke、ingress `2/2`、WebSocket `101 Switching Protocols` 与 runner/toolchain 检查均通过；最终 SHA 的 G1 首次端口冲突后重跑仍在 `config.webServer` 预检阶段因 `packages/backend/support/prepare-test-data.mjs` 路径缺失而 `0 tests/exit 1`，G2–G8 未执行。故 M17.04 仍为部分完成，不能用旧 `ae3caf1d` 的 G1/G2 结果替代最终 SHA。
- 必须保留的架构结论：上述 Docker/静态门禁未引入旧 store、event bus、transport 或重复 controller；后续只修复 runner/archive 的启动路径与资源编排，不为通过 G1–G8 修改产品 owner。

### C.60 M17.05 canonical/截图运行结果与资源阻断（2026-09-06）

- 当前 SHA canonical run 证据位于 `/dev/shm/nexus-m17-canonical-438426b8-20260906T120056Z/`，因 `/dev/shm` 达到约 97% 使用率而在 903 秒超时：`22 passed`、`5 failed`、`26 did not run`，不能作为 M17.05 或项目完成证明。PDF 的 `page-count=0/scrollHeight` 与上传文件缺失发生在同一资源退化期间；两次早期独立复跑也分别在 `/connections` 前置、端口漂移或 `connection-row-1` fixture 阶段失败，未进入 PDF 断言，因此不得据此修改 `PdfPreview.vue` 或传输产品代码。
- 资源清理后的最终串行复跑 `/dev/shm/nexus-m17-pdf-final-438426b8` 使用精确 SHA `438426b854cf29f695e2204eb55db6ee8ed44812`、`baseURL=http://localhost:4173`、单 worker，先确认 `connection-row-1` 后进入 PDF 断言并 **exit 0**：page count `3`、三页节点、首 canvas 宽度大于 0、连续 scroller `scrollHeight > clientHeight`。该证据证明 PDF 产品当前无稳定回归，但只覆盖该 spec 切片，不能替代 M17.05 的 28 图或全量 canonical。
- 5 个可归因项必须分开记录：`file-preview-editor.spec.ts:889` 是受保护测试的未限定 `Save` selector strict-mode（17 个按钮），不是产品断言；PDF 与 file-upload 超时是资源/fixture/cascade 失败，最后的 upload-popup 用例未进入产品断言。受保护测试不得修改，selector 维护留待独立 M17.03 owner 决策。
- M17.05 仍待在清理后的单一环境中串行完成：冻结同一 SHA，先验证 `/connections`、`connection-row-1`、端口和可用空间，再按 spec 逐组运行；生成并人工复核附录 B 的 28 张当前 SHA 截图，记录每图视口/主题/数据/差异结论。未完成前 M17.05、M17.06 不关闭，正式模块计数保持 **`16 / 18`**，不得把本轮 6 张 partial screenshot 或历史 PNG 当作 28 图完成证据。

### C.61 M17.04 最终 SHA G1–G8 串行矩阵（2026-09-06）

- 在最终产品 SHA `438426b854cf29f695e2204eb55db6ee8ed44812`、固定 runner、`--shm-size=2g`、单 worker、独占端口环境中，G1–G8 均已实际启动并完成：G1 **16/16 passed**（`/dev/shm/nexus-m17-g1-438426b8-20260906T122902Z-jvMDhR/REPORT.md`）；G2 **9/9 passed**（`/dev/shm/nexus-m17-g2-final-438426b8-20260906T123200Z/`）；G3 **29 passed / 1 harness failure**（`/dev/shm/nexus-m17-g3-final-438426b8-20260906T123500Z/`）；G4 **24/24 passed**（`/dev/shm/nexus-m17-g4-final-438426b8-20260906T124300Z/`）；G5 **22 passed / 1 authenticated-WebSocket failure**（`/dev/shm/nexus-m17-g5-final-438426b8-20260906T125000Z/`）；G6 **8/8 passed**（`/dev/shm/nexus-m17-g6-final-438426b8-20260906T132000Z/`）；G7 **26/26 passed**（`/dev/shm/nexus-m17-g7-final-438426b8-20260906T140000Z/`）；G8 **16 passed / 1 selector failure**（`/dev/shm/nexus-m17-g8-final-438426b8-20260906T143000Z/`）。矩阵合计 **150/153 case 通过**；该 case 比例不折算项目完成百分比。
- G3 失败固定为受保护 `change-password.spec.ts` passkey 流程在 `http://localhost:4173/login` 找不到 `#username`，与既有 `localhost`/`127.0.0.1` host-only cookie/CDP harness 限制一致；G5 失败为受保护 WebSocket case 使用 `ws://127.0.0.1:4173` 而页面/认证在 `localhost`，需独立报告确认，均不得直接归因产品 owner。G8 失败固定为受保护 `file-preview-editor.spec.ts:889` 的未限定 `getByRole('button', { name: 'Save', exact: true })` 命中 17 个按钮，属于 selector 维护，不修改受保护文件或产品代码。
- G1–G8 的 Docker unified build、Docker smoke、ingress `2/2`、WebSocket `101` 及 runner/toolchain 均已有最终 SHA 证据；本节只证明矩阵已执行并完成归因，M17.04 仍需主代理确认上述非产品失败的独立证据后再关闭。M17.05 的 canonical 28 图和 M17.06 的最终 disposition 仍未关闭，正式模块计数继续为 **`16 / 18`**。

### C.62 M17.05 28 图当前 SHA 审计与 M14 视觉差异收口（2026-09-06）

- 最终 SHA `438426b854cf29f695e2204eb55db6ee8ed44812` 的 canonical 证据已齐：26 张主图位于 `/dev/shm/nexus-m17-canonical-slice-438426b8-20260906T130502Z/screenshots/`，2 张分页图位于 `/dev/shm/nexus-m17-canonical-pagination-438426b8-20260906T163000Z/screenshots/`；清单 **28/28**、尺寸/PNG/hash 校验通过，逐图人工审计报告为 `/dev/shm/nexus-m17-canonical-visual-audit-438426b8-20260906T135249Z/REPORT.md`。
- 审计未发现新的结构、几何、密度、字体、图标、滚动或响应式回归；动态指标、时间、审计记录、终端输出、文件排序和任务进度均按运行时数据处理，不作为像素回归。已确认的 owner-scoped 可见差异仍需明确决策：M14 Progress Display 的桌面呈现、M11 目录优先排序、M13 移动 `94dvh`/safe-area inset preview 壳、M15 compact cards/chart，以及 Dashboard 的语言/refresh badge/实时数据。
- M14 后续 focused run 在工作树 dirty 的 transfers owner 修复上 **1/1 passed**，architecture、`vue-tsc --noEmit` 与 `git diff --check` 均 exit `0`：`ProgressDisplayModal.vue` 的 hidden progress 恢复居中 overlay/teleport，`ProgressCenter.vue` 的 active upload 默认位置恢复旧基线右下角；resize、drag、hide/restore、scroll、cancel-all 均保持通过，M14 此切片 F/V/A **pass**。修复已由主代理作为独立 M14 follow-up commit 提交；因产品 SHA 变化，canonical 截图仍需在该新 SHA 上刷新后才能作为最终证据。
- M17.04 可在主代理记录 C.61 独立归因后关闭；M17.05 的 28 图取证已完成但须先处理上述 dirty SHA/owner 差异；M17.06 继续保持未关闭。正式模块完成率仍为 **`16 / 18 = 88.9%`**，不得用 `150/153` case 通过率替代。

## 附录 D. 非 Vue 源、资产与构建的覆盖

旧库扫描覆盖224个frontend tracked files，其中212个src文件；98 Vue只是用户表面追溯子集。该数字是历史快照，不作为当前文件数守恒目标。旧composable/store读取仅恢复可见默认值、状态和操作顺序，不复活所有权结构。

| 来源                                            | 当前归属 / 执行模块                                  | 验收重点                                                                          |
| ----------------------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `style.css`、main/App/router                    | `app/styles`、bootstrap/router/shell，M00            | 全局规则、icon加载、input/focus/disabled/scroll、活跃入口，不复制旧CSS依赖架构    |
| default/iterm主题                               | `features/appearance`与当前后端preset owner，M06/M10 | terminal fallback与实际theme输出一致；前端不重复catalog                           |
| logo/banner/public icons/manifest/index favicon | 当前assets/public/app入口，M00/M06                   | blob/intrinsic size、渲染尺寸与位置、favicon/PWA显示；不凭初始疑点认定仍需改      |
| 原41 composables/32 stores/12 types             | 相关模块当前controller/model/public                  | 可见状态和默认值、不丢行为；禁止迁回旧store互引/事件总线                          |
| 原foundation/utils/locales/workers              | 当前foundation/feature i18n/provider，M00/M12/M13    | popup安全、文本/格式、worker资产实际加载；保留feature i18n和现有协议              |
| package/build/nginx/Vite/service worker         | 当前配置及M17                                        | 资源/字体/CSS/worker能加载，架构/i18n检查不弱化；不为旧视觉重新引入已删除框架架构 |

最终只汇报有证据的完成状态：功能不缺失、视觉与旧基线一致、状态和行为全部沿用新架构；未验证项继续明列，不以完成百分比掩盖。
