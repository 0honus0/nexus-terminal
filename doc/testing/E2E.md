# 验证与测试记录

本文记录验证入口、实际执行证据和未验范围；产品操作见 [USAGE](../USAGE.md)，owner 与依赖见 [架构](../architecture/BACKEND.md)，当前任务与测试授权见 [PLAN](../PLAN.md)。历史记录只对其日期、SHA、工作区及执行场景有效，静态检查、局部验证与全量 E2E 分别记录。

## 当前验收基线

最新完整远程 [41865585558](https://github.com/0honus0/nexus-terminal/actions/runs/41865585558) 验证 `main/1a31cfa54228391ab4237db87c5ea76c70cf26d1`：559个场景全部一次通过，质量检查、双端生产构建、Docker smoke及8个测试分片的完整原始日志均通过，零失败、重试或跳过。Backend129项，Browser1–7分别49/63/57/54/73/57/77项（包含隔离场景）。同期GitHub Actions官方故障使workflow/job API尚未同步完成状态，本次通过结论依据完整job日志，不将API结论记为success。CI后继e71cf820仅更新耗时估算，产品源码一致；最终文档收口不改变被测源码。

官方插件[v1.0.3](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.3)已发布，main/tag均为d5dd455，发布CI成功。本体最新[amd dev发布41867087587](https://github.com/0honus0/nexus-terminal/actions/runs/41867087587)完整日志确认推送完成，GHCR已核验dev/固定标签、linux/amd64平台、digest和e71cf820源码revision；workflow API同样受上述故障影响，未记为官方success。此前指定实例数据库维护与7262e8ac镜像部署仍保持原范围，本轮没有更新生产容器或数据库。真实运营商切网、手机软键盘、外部供应商及未列故障边界仍按[待验与外部依赖](../PLAN.md#待验与外部依赖)保留；受控回归不替代真实模型效果或吞吐实测。更早测试与镜像结果只保留为各自历史证据。

## Agent 聊天悬浮区与输入工具栏修正（2026-11-04）

本批基于main/b6bd3b25。用户反馈手机Token/上下条状态行下半部分仍遮挡消息，同时要求权限/添加文件具备SSH目标同款边框、手机隐藏目标数量；授权提交推送、处理远程E2E与发布main dev，沿用linux/amd64，不更新生产。本批按D17执行源码/静态与正式远程测试，不启动本地业务环境。产物保留于`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104/toolbar-followup`。

源码定位前轮遗漏：agent-composer-status本身绝对定位且透明，但section的12px gap与footer的桌面8px/窄屏6px或5px顶部padding使状态行下半区落在正文滚动范围外；只去底色不能透出该处不存在的正文。本轮移除滚动区/footer间距和各尺寸顶部padding，保留olderHidden提示原有下间距、输入框底部定位、状态行位置/按钮背景、正文末尾54px留白及点击穿透。无用量的静态发送提示去除胶囊底色。权限触发器显式soft，ArtifactPicker仅compact入口从ghost改soft，沿既有UiButton边框/背景；不改全局UI或其它弹层。SSH目标数量在原620px紧凑档隐藏，最窄300px档隐藏整个摘要，选择面板内数量、勾选与真实connectionIds不变。

复审覆盖AgentAppSurface模板/CSS、AgentConfigPopover、UiPopover/UiButton、ArtifactPicker及唯一NativeInputArtifacts消费者，含桌面、各容器档、短窗口、olderHidden、无用量提示、有附件及busy/disabled/选中状态。没有新增测量、计时/监听、请求、状态、类型或Shared/后端/数据库变化。旧CDP与559项结果保持原SHA范围，不作本轮视觉验收；最终根`pnpm run check`、`pnpm run build:frontend`及`pnpm run format:all:check`均退出0（check.log、build-frontend.log、format-check.log），最后文档另做Prettier与diff检查。提交推送后的完整远程E2E及amd dev发布结果继续回填；真实手机软键盘及新布局的像素/触摸专项未验。

## 终端工具栏响应优化（2026-11-04，浏览器及远程回归通过）

基线main/fff92dfa，用户要求优化终端“隐藏、进度显示、配置布局”点击卡顿。源码确认导航显示原来等待队列与HTTP回执，两个弹窗首次点击才导入，进度窗nextTick读取几何可能强制同步布局。PreferencesStore增加导航预览/revision，values仍为已确认快照；AppHeader和WorkspacePage显示、高度、按钮及下次切换消费同一有效值，原串行CAS、冲突/unknown围栏不变。旧finally不清新预览，permission撤销立即收尾，Presentation重置隔离旧身份。

TabBar在pointerenter/focus/pointerdown通过Page调用原公开loader，仅预加载代码、不挂载或读取业务数据；实际打开继续defineAsyncComponent及原草稿/取消流程。进度窗通过测量前断开的单次ResizeObserver布局后定位，保留拖动/位置缓存/手机规则，卸载清observer和resize监听。未改CSS、正常UI、终端fit/字体/尺寸算法、任务容量或Backend/Shared/数据库。

初期按D17完成两轮源码审核及静态检查，check.log的3处函数空行已按原ESLint修正；check-final.log、build-frontend.log、format-all.log与docs-format.log通过。用户随后明确“实测 提交推送发布amd main dev”，本轮据此执行限定CDP与真实本机SSH回归；在提交推送及完整远程E2E通过后发布main的dev/linux/amd64，不更新生产容器或用户数据库。产物集中`/home/honus/nexus-task-artifacts/workspace-toolbar-performance-20261104`，保留至用户通知。

环境Node22.23.1、pnpm11.28.10、Playwright1.64.1及Chromium156，经CDP127.0.0.1:29222访问真实https://api.honus.top；Vite9998/Backend3001、临时SSH41011、随机账号、数据库和浏览器profile均为本轮独立runtime。真实Store/Controller/API与SQLite、SSH正常执行；拦截只延迟或丢弃已取得的真实回执，以及一次具名503读取故障，不伪造保存成功、不重放写入。

最终runtime/acceptance.mjs整组15项PASS，acceptance-final-2.log与browser-acceptance.json记录零pageerror：预加载无挂载/业务请求；进度首次打开/位置初始化/Escape；键盘布局打开/改草稿/取消确认/放弃关闭；800ms延迟回执前导航即时反馈；三次点击串行且两份旧回执不回退；真实409回退与阻断/重读；已成功保存但丢回执为unknown、无重放、只读恢复；离页撤销排队写；进度拖动/重开位置及缩小视口约束、快速开关；真实SSH输入与两次导航后尺寸保持；320/390px触屏真实SSH、延迟回执导航及进度布局/关闭；正常列表取消不误报而真实503仍有刷新入口；真实退出登录撤销旧预览/排队写，重新登录恢复已确认配置。截图已目视核对，toolbar-trace-*.zip、请求及回执记录保留。

扩展实测发现启动时单条配置刷新会取消旧列表读取，WorkspaceConnectionList仍将具名cancelled转成失败Toast。现仅过滤该只读取消通知，Store快照、刷新时序与其它失败不变；initial-error-diagnostic.log记录修复前调用源，initial-error-fixed.log记录修复后零通知，整组15项再次通过。源码复审覆盖8个改动源码的消费者、预览/确认隔离、撤销/重置/旧finally、module事件链和RO收尾、具名取消与真实失败。脚本初期的Vue节点归属、整页刷新重建终端、250条资源时序缓冲、确认弹层定位/真实文案及登出的link角色已按真实入口修正，所有失败产物保留，没有为测试修改UI或强制点击。

本轮点击时序以click捕获时间至首个确认目标DOM的requestAnimationFrame回调计，不等于完整屏幕呈现或终端吞吐。最终15项回归中，800ms真实回执持有期间隐藏为8.8ms，已预加载进度窗44.1ms、布局窗32ms；无/有位置及两类弹窗均保留正常流程。另尝试Vite插件切换旧源码做对照，但全图失效/页面重载后旧模块未成功建立SSH基线，comparison*.log仅保留诊断；没有可用旧版对照结果，不宣称端到端倍数提升。候选代码已恢复并补拍layout-desktop.png。

最后补丁后根`pnpm run check`（check-acceptance.log）、`pnpm run build:frontend`（build-acceptance.log）、`pnpm run format:all:check`（format-acceptance.log）全部退出0，文档另做Prettier/diff复核。同步origin/main仅新增501ee855的CI耗时估计，未改本轮被测产品源码。测试结束已停止自有浏览器/前后端及SSH夹具，9998/3001/29222/41011无监听，目录与全部产物保留。

修复提交`1a31cfa54228391ab4237db87c5ea76c70cf26d1`已推送main，正式远程[E2E 41865585558](https://github.com/0honus0/nexus-terminal/actions/runs/41865585558)的质量检查（含双端生产构建）、Docker smoke及8个分片完整原始日志均通过。按正式Reporter格式核对559条唯一passed记录，无失败、重试或跳过；Backend129项，Browser1–7分别49/63/57/54/73/57/77项，包含分片内独立运行的隔离场景。GitHub同期[Actions官方故障](https://stspg.io/pjgptg3cfc6n)导致workflow/job API尚未同步完成状态，不能把该API状态记为success；通过依据为各job完整日志、测试结束汇总及上传产物。证据为e2e-backend-1.log、e2e-browser-1至7.log、e2e-quality.log、e2e-smoke.log、e2e-verification.json与官方故障记录。

CI后继`e71cf8204b0d5de9349ce4ac6be8b9b19154cbbd`仅更新scripts/e2e/duration-estimates.json，已核对diff后快进；产品源码与被测修复一致，不将后继SHA称为直接执行过E2E。随后由main触发[amd dev发布41867087587](https://github.com/0honus0/nexus-terminal/actions/runs/41867087587)，生产依赖审计通过；完整publish-prepare.log/publish-image.log确认构建、双标签推送及收尾完成，无job error。实际匿名Registry核验`ghcr.io/0honus0/nexus-terminal:dev`与`sha-e71cf8204b0d`的index digest均为`sha256:c0ae6315d414165d199b41096f871a0bc8b1b2c01c19e06d7aa9862dfc4f0ed2`，排除证明manifest后只有linux/amd64；平台manifest为`sha256:68fe70829d13a21ea4e1af383abdaecf6a7946536d682292dc562195dfb50066`。manifest/config的SHA256、OCI revision及version全部与发布源和固定标签一致，见runtime/verify-image.mjs及image-verification.json，token只在内存。发布workflow API尚未同步完成状态，此处只声明原始日志及实际产物核验完成。本轮源码、验收与镜像交付完成，最终仅提交PLAN/testing收口；生产容器和数据库未更新，自有测试进程已停止，产物按用户要求保留。

未验范围：真实手机软键盘、生产网络/多设备、多标签及大量真实传输任务压力、完整主线程长任务profile、预加载下载失败后的恢复；不把本轮rAF/DOM时序或软件渲染模拟扩为所有设备耗时保证。

## 工作区尺寸自动保存冲突（2026-11-04，限定浏览器回归通过）

只读排查指定远程实例：生产revision为7262e8ac，14:26:26.894及14:26:51.367 UTC的PUT /api/v1/settings/layout返回409（auditId1504/1506），此前及间隔内preferences写入成功。SQLite只读核对presentation记录仍存在、version136；共有4个有效登录会话，但日志未含请求expectedVersion/浏览器身份，不能据此认定具体页面或设备。未改远程数据、设置或容器。原始日志与脱敏审计元数据保留于`/home/honus/nexus-task-artifacts/personal-data-conflict-20261104`。

用户要求修复后，尺寸自动保存沿原队列按本地确认基线做容器整组比例三方合并，只对明确409在原任务中重读后最多再保存一次；相同目标不重复写入。结构/同组比例冲突、二次409及unknown停止；恢复读取失败保留原拒绝与读取失败cause，不误报为布局提交未知。Controller的revision隔离重读后的旧任务，失活后的已确认回执仍可推进同一布局的本地基线，保存回执不回填预览。WorkspacePage沿原Toast/刷新入口使用中英日布局文案，未改正常UI。接口消费者只涉及原Repository、Controller与Adapter，无Shared/后端/数据库变更。

用户随后明确授权“浏览器回归 审核提交推送”，作为D17限定例外。基线main/9111e440，Node22.23.1、pnpm11.28.10、Playwright1.64.1，经CDP 127.0.0.1:29222访问真实https://api.honus.top；Vite9998和Backend3001使用本阶段runtime独立数据库与本机SSH44807夹具，不读取用户生产库或修改生产实例。页面A运行正式Workspace/Controller/Adapter/Store/API，页面B使用独立Pinia及真实API推进同一测试账号版本；故障拦截只控制回执及读取时机，不替换保存实现。一项真实鼠标拖分隔条，其余以正式Controller尺寸事件触发完整合批链。截图已核对桌面及320px中文Toast/原刷新按钮。

最终runtime/acceptance.mjs整组17项PASS，browser-acceptance-closeout.log与browser-acceptance.json记录全部断言及零pageerror：真实拖动只保存一次、外部偏好更新后409→重读→一次成功、不同容器合并及后续保留未调整远端比例、同组尺寸/结构冲突不覆盖、同目标不重复PUT、第二次409停止；第一次及恢复写入真实成功但丢回执均unknown且不重放，恢复读取503保留已拒绝结果和两个cause；读取中离页/显式刷新/注销不重派、刷新废弃旧合批；连续拖动串行且旧回执不回写新预览，失活后确认仍推进本地基线；320px提示无横溢且实际点击刷新解除围栏并加载远端布局，注销不发新的连接列表读取且无失败Toast。登录后重新建立真实SSH并重复完整回归，未跳过故障场景。

扩展回归发现并修复两处真实竞态：冲突恢复读取期间显式刷新仍可能发第二次PUT，现由Controller独立resizeScope撤销旧意图；注销清理终端时短暂挂载的WorkspaceConnectionList仍读数据并提示会话失效，现于读取及通知前核验认证。race-retest-final.log与logout-retest.log分别定向通过，随后最终17项整组复验。浏览器脚本初期的对象字段顺序比较、重复运行基线、热更新后终端已关闭等夹具假设已修正，失败产物/trace保留，不作为产品失败或最终PASS依据。

源码审核覆盖唯一Repository/Adapter消费者、容器完整向量与结构、冻结基线、队列内恢复不自等待、两次写入的未知边界、revision/permission/resizeScope撤销与晚回执、注销挂载及三语文案；无Shared/后端/存储契约或正常UI变化。初期根check、前端build与全仓格式已通过；最终补丁的根check、前端生产build、全仓ESLint/Prettier及diff均通过，命令退出0，见check-closeout.log、build-frontend-closeout.log及format-closeout.log；最终文档格式另经docs-check-closeout.log核对。本轮没有运行完整本地或远程E2E，既有559项仅保持原SHA范围；三语真实呈现、真实多设备网络和高频交错拖动仍未覆盖。不发布镜像或部署，专用浏览器/前后端/SSH夹具完成后关闭，目录、隔离数据、截图与layout-browser-trace-*.zip保留至用户通知。

## 连接编辑清除凭据布局（2026-11-04，静态检查）

基于main/fac0f2ee，ConnectionForm将清除凭据勾选项移到密码输入框右侧，SSH密钥模式放在选择框右侧。源码核对原输入ID、凭据可见条件、清除后禁用、密码留空保留及保存/取消调用链；复用原UiInput/UiCheckbox，输入可收缩，清除项不换行，无新请求或状态owner。USAGE及PLAN同步。用户随后要求审查代码并提交推送；第二轮复核表单→提交→原版本更新及现有E2E定位，未发现本批新增逻辑问题，未新增源码修改。按D17未运行浏览器或行为测试；320px手机、三语呈现及真实保存回归仍待验。根`pnpm run check`、前端生产build、全仓ESLint/Prettier及`git diff --check`均通过；日志集中于`/home/honus/nexus-task-artifacts/connection-credential-layout-20261104`。

## 插件市场更新确认弹窗（2026-11-04，限定浏览器验收通过）

工作区基于main/d81823bb，将PluginManagementSettings顶部候选包确认区移入共用UiModal；安装及两步升级继续使用原契约。用户明确授权“本地两个修改都用浏览器验证下 没问题提交推送”，作为D17的限定例外。证据保留于`/home/honus/nexus-task-artifacts/plugin-market-modal-20261104`。Node v22.23.1、pnpm 11.28.10、Playwright 1.64.1、Chromium 156，经本机CDP连接实际`https://api.honus.top`；前端当前源码9998，后端3001使用独立空数据库，自建29192仓库提供真实签名1.0.0/2.0.0包，不读取用户数据库或操作生产。

两轮源码审核覆盖prepare→stage→candidate→弹窗→原install/prepare-upgrade/upgrade→确认及load；保留签名、能力、技术详情、CAS和unknown围栏。候选包关闭只清展示，不撤销draining。原UiModal负责Portal、焦点进入和短屏正文滚动，组件在校验请求禁用原按钮前记录触发元素，弹窗关闭且原视图可写后恢复焦点；失活丢弃引用。首轮真实浏览器发现取消后焦点丢失，已在调用方修复并整轮复验，未更改共享基础组件。

`runtime/acceptance.mjs`与`browser-acceptance.json`记录15项PASS：桌面取消/Escape/遮罩及焦点归还、busy安装禁止三种关闭、确认安装自动关闭；中英日各390×844/320×720/320×480共9组尺寸与按钮完整性；短屏展开技术详情后正文滚动且footer可达；准备升级409后弹窗内重读；真实prepare成功但仅丢弃浏览器回执后保留unknown围栏，重读核实draining、不自动finish，显式确认新意图后完成升级并保留原App身份。请求记录核对最终upgrade只发送一次，无pageerror。截图、几何和`browser-acceptance-trace.zip`同目录。

验收脚本修正了隐藏同名元素定位、按真实翻译定位及“短内容必须溢出”的不当假设，保留各次失败产物；产品未为这些测试假设改动。焦点修复后重新执行根`pnpm run check`和前端生产build均通过（final-check.log、final-frontend-build.log）；全仓格式及diff按最终收口日志记录。未运行本地全套E2E，既有559项只保持原SHA覆盖；离开页签/登出晚回执、并发升级/卸载及真实手机软键盘仍未覆盖。本批只提交推送，不发布或部署。

## Agent 聊天工具状态与悬浮控件（2026-11-04，限定浏览器验收通过）

工作区基于main/c202c152，本轮仅修改前端聊天展示及对应文档；用户随后明确授权提交推送，未发布或部署。证据保留于`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104`。Node v22.23.1，独立tools目录的pnpm 11.28.10（与根packageManager一致），仓库ESLint 10.14.0、Prettier 3.9.10、Vue 3.5.44；未修改依赖或锁文件。

两轮源码审核：AgentAppSurface两处工具列表消费同一toolCallId审批索引；NativeToolActivityList核对App/Run、当前hash和操作版本，分别显示审批与执行状态，保留申请/处理时间及旧操作详情。删除独立审批组件及三语无消费者文案；原待审批侧栏、最小化快速批准、CAS/未知写入、当前Run审批读取和工具分页未改。既有native-surface.spec.ts的data-tool-name/data-approval-status断言现由真实工具article提供，不增加测试专用入口。控件状态行绝对定位在输入区上方，只有按钮恢复指针命中并保留自身底色；空白不占正文布局，正文底部留白覆盖28px按钮、6px间距及原20px留白。附件、Portal弹层、自动跟随和消息导航继续原生命周期，无新增请求、监听或计时器。

本轮命令均退出0：`pnpm run check`（Backend/Shared及Frontend类型、双端ESLint，check.log）、`pnpm run build:frontend`（vue-tsc+生产Vite，frontend-build.log）、`pnpm run format:all:check`（全仓ESLint/Prettier，format-check.log）、`git diff --check`。源码差异审核记录source-review.diff；文档收口后另核对格式及diff。

用户本轮明确授权后，在与上节相同的真实站点/CDP和隔离空库中补验，产物位于`/home/honus/nexus-task-artifacts/plugin-market-modal-20261104`。使用真实签名Native App、正式隔离插件进程与真实审批账本；29193只提供受控模型SSE与签名包，不调用付费模型、不连接SSH。`runtime/chat-acceptance.mjs`与`chat-browser-acceptance.json`记录8项PASS：批准按钮发送原审批hash/version，单一工具article同时显示approved/completed与申请/决定时间；拒绝显示denied及后端实际failed，不伪报成功；独立Approval history不存在。桌面Token弹层、上一条/下一条/最新真实滚动通过，空白区域实际命中下方正文P元素，点击与滚轮事件穿透；历史阅读位置在普通窗口尺寸变化后保留。390/320px触屏context分别覆盖Token/导航、空白触摸点击穿透及滚轮、合并状态与按钮无横向溢出，末条正文位于控件上方。截图及trace已保存并目视核对，pageerror为0。

浏览器脚本按实际文案、任务侧栏遮罩和已存在线程调整定位；拒绝后的工具状态按真实账本failed核对，空白命中点限定在正文与控件真实重叠区域。期间根check重建Shared触发Vite热重载的一轮已作废，构建结束后重新完整通过；各次失败产物保留，不把脚本假设修正称为产品修复。本轮未修改聊天源码。手机触摸滚动的完整手势/真实软键盘、运行中上翻新消息、附件、批准后执行失败、过期/取代和历史分页扩大组合仍待专项，559项历史基线不覆盖本次新差异。

## 远程数据库维护与镜像更新（2026-11-04，已完成）

用户在镜像发布后明确授权维护远程数据库及更新镜像。目标仍为指定主机的`/home/honus/product/nexus_terminal`，原双容器健康、源码4a3074da，数据库为旧plugin-apps签名；4个Agent Run均completed，29份上下文缺systemPrompt，压缩/检查点/子任务记录均0。先下载并核对已测7262e8ac的固定amd镜像digest，再用新版真实initializeSchema生成独立参考库，逐对象对照全部DDL。发现唯一结构差异为agent_run_children.max_requests仍有400的旧CHECK；保留了首轮演练拒绝证据，没有绕过结构检查或直接修改签名启动。

一次性维护脚本和验证脚本集中远程`maintenance/20261104-agent-flow-dev`，不增加产品兼容分支。副本演练将旧空子任务表按新版原始DDL及索引重建为当前Shared安全整数范围；29份历史快照补systemPrompt空串，原消息/sources的原始JSON后缀完整保留并重算content_hash。旧版模型适配器没有单独system消息或Responses instructions，因此不把当前指引伪写为历史指引，也不更改历史付费request_hash、任务状态或用户配置。所有表逐行哈希只排除已授权快照字段及版本签名，维护前后相等；完整性/外键检查通过，结构签名最后在同事务更新。

副本经新版镜像真实readContextSnapshot全部29份解码通过后，停止本应用前后端，归档完整data、.env及Compose；逐个常规文件校验归档内容与原文件哈希一致，完整备份pre-upgrade-data.tar.gz的SHA256为`7e6388f5a8464747ae10cee278d3a5b2245a6f7661361a6c1711ba1e459db720`。随后同脚本事务维护线上，验证副本再次由新版解码；99张表行数和其它字段全部保留，最终所有DDL精确匹配新版参考库，integrity=ok、foreign_key_check=0。保留4任务/1线程/2App/2插件安装及29份上下文，不执行模型任务或重放旧请求。

前后端已更新到已测7262e8ac的`ghcr.io/0honus0/nexus-terminal:dev`，digest为`sha256:b4f1c34743e3428a167b651e5aacddbc99e83b8942d04766b19e65387006b3e5`；两容器running/healthy、OCI源码一致。公开`https://ssh.honus.top/`及`/api/v1/status`均HTTP200，状态正文为{status:"ok",service:"nexus-backend"}；自本次启动起两容器日志无warn/error/fatal。完成时间2026-11-04 12:48 UTC，未使用回滚；原镜像额外保留本地rollback-agent-flow-20261104标签，未推送该标签。未升级或重装用户现有插件。

远程目录权限700，完整备份含实例密钥及用户数据，维护完成时仅留远程受保护目录；用户随后明确要求清除备份，已删除pre-upgrade-data.tar.gz及rehearsal/live-verification/reference三份数据库副本（共10,698,199 bytes），同时移除本次旧回滚镜像，未清理其它镜像或当前数据。脚本、启动日志及核验记录继续保留；清理后双容器仍healthy，公开status为HTTP200，清理清单为backup-cleanup.json。非敏感核验报告及脚本另存本地`/home/honus/nexus-task-artifacts/agent-flow-deploy-20261104`（deployment-result.json、post-deployment-verification.json、live-maintenance.json、backup-verification.json）；本轮是部署/数据维护验证，不扩大为真实模型、手机、SSH或RDP全业务实机验收，也未重新发布产品源码。

## Agent 执行补充回归与 amd dev 交付（2026-11-04，已完成）

用户最新授权补充E2E、提交推送plugin与本体，并在完整远程测试通过后发布main的amd dev。宿主从f789446f工作区接续，保留最小化提醒及全部六项执行优化；官方插件d5dd455/v1.0.3已发布，复核main与tag、公开Release一致且插件工作区干净。本轮不更新远程部署、用户数据库或运行本地行为测试。实施产物原集中`/tmp/nexus-agent-flow-e2e-release-20261104`；用户通知E2E完成后续接时原目录不在当前环境，最终远程日志/清单/统计重新保存至`/home/honus/nexus-task-artifacts/agent-flow-release-20261104`，继续保留至用户通知。

新增正式入口`agent/execution-flow.spec.ts`纳入backend分片，运行真实应用HTTP/SQLite/OpenSSH/签名包与隔离子进程回归；模型HTTP只控制供应商输出。23项模型/上下文场景覆盖双协议宿主指引与Skill元数据、实际快照内容/hash、精确Skill正文读取、明确4xx拒绝、429最多三次总尝试及成功恢复、408/409/5xx和连接无响应不重放、Unicode流前缀/工具边界、半流断开和取消后运输关闭。四项插件场景覆盖role/工具子集、逐步hook、独立进程与文件访问隔离、单次批准/原operationId、错误hash派发前拒绝、撤权未消费，以及畸形结果保留原未知与实例退役后新意图。三项调度场景使用真实ToolService及工具分类，控制I/O屏障核对并行预算、完成原序、exclusive前后隔离、失败/取消停止补位与已启动任务收敛；它们是调度隔离回归，不冒充真实SSH吞吐实测。

`agent/task-notices.spec.ts`新增1280/390/320px正式浏览器场景：最小化本身不弹、新审批变化才弹、后台焦点保持、卡片边界、快速批准的原回执、完成预览/8秒收起、再次最小化不补弹旧完成。测试复用原UI入口及严格Workspace回执，未改产品布局。模型脚本及签名包夹具支持本批场景；既有消费者参数和正常断言保留。

提交前静态：Node22.23.1、pnpm11.28.10；根check、双端build、Shared check及新E2E严格TypeScript检查退出0，日志check.log/build.log/shared-check.log/e2e-types.log。首次手工tsc触发新版TS显式文件与tsconfig冲突，按工具要求加`--ignoreConfig`后通过，未放宽strict或改依赖。最终全仓ESLint/Prettier与diff通过，format.log保留；最终新增wrapper的显式TAP reporter修改再做定向格式/lint及类型核对。此时尚无本轮远程行为PASS或新镜像，不使用旧553项证明当前工作区。

首轮完整远程 [41825149177](https://github.com/0honus0/nexus-terminal/actions/runs/41825149177) 对应 a85f5f41：质量、Docker smoke和browser1–6通过；backend新增两项整链wrapper未启动成功，runner仅安装OpenSSH客户端，现补齐openssh-server并附加子进程stdout/stderr诊断；调度wrapper通过。browser7的1280px通知场景因任务栏与Transcript均呈现同一命令而严格定位失败，现将审批详情与命令断言限定在Tasks区域；保留全部行为断言和产品UI。其余两种通知视口通过。上述修复静态检查后重新提交，等待完整远程验证；本轮尚未发布本体镜像。

第二轮完整远程 [41826647057](https://github.com/0honus0/nexus-terminal/actions/runs/41826647057) 对应64367aa7：质量、Docker smoke及7个browser分片全部通过，包含1280/390/320px通知场景；backend原有场景和调度通过，模型23子场景中22项通过。剩余Responses夹具漏发assistant role、完成status和完整output快照；插件夹具backendEntry使用了被正式契约拒绝的根目录路径。按真实协议补齐SSE，插件入口改为backend/index.mjs，不修改应用校验、不放宽断言或超时；继续完整远程复验。失败stdout/stderr已保存在backend-round2产物。

第三轮完整远程[41828020189](https://github.com/0honus0/nexus-terminal/actions/runs/41828020189)验证7262e8ac，559项全部一次通过；新增模型整链11秒、签名插件隔离/审批4.5秒、调度456毫秒通过，三种视口通知分别14/13/13秒。上述两轮失败均已复验解决，未修改产品UI、放宽断言、跳过场景或增加超时。质量含根check/全仓格式和正式双端生产构建，Docker smoke同轮通过。本次手动完整任务不自动提交耗时文件，发布冻结在同一被测SHA；最终远程完整日志、job清单和统计为e2e-run.log/e2e-run.json/e2e-summary.json。未将受控模型HTTP和调度gate回归当作实际吞吐或模型质量实测。

发布[41830244197](https://github.com/0honus0/nexus-terminal/actions/runs/41830244197)全部成功，生产依赖审计通过；`ghcr.io/0honus0/nexus-terminal:dev`及`sha-7262e8ac31e4`的index digest均为 `sha256:b4f1c34743e3428a167b651e5aacddbc99e83b8942d04766b19e65387006b3e5`，唯一真实平台linux/amd64，平台manifest为 `sha256:d5c0bb6d0335849ac2cbdcf7424a228883a188b09d4d204d83a808331e206819`。匿名GHCR下载校验manifest/config的SHA256、两标签digest、平台和OCI revision，源码精确为7262e8ac31e414d4de8b8f99102cee681e376961；脚本/输出为verify-image.py及image-verification.json，token只驻内存。插件main/tag及v1.0.3 Release再次只读复核一致，发布CI41821088972成功。本体全部源码/测试已提交推送，最终仅PLAN/testing收口，未更新远程部署或用户数据库。

## Agent 执行与插件扩展（2026-11-04，源码静态及插件发布）

宿主基线main/f789446f及前序未提交最小化提醒；Node v22.23.1、pnpm 11.28.10。本轮按用户“全部修改”、工具接口可破坏性更新、插件更新后发布及同后端格式的授权实施。产物集中 `/tmp/nexus-agent-flow-plugin-implementation-20261104`，全部原目录保留；无本轮本地行为/浏览器/CDP/E2E、真实模型请求或用户数据库维护。宿主未提交推送、未发镜像、未部署。

前置只读参考固定为DeepSeek Harness `8bd073392eef6f54e921a093b95076248eb08cbb`（core/tools的batch/pipeline、core/agent-loop、skill/tool-skill、architecture文档）、pi-mono `0efe50cb6dde31b19fb5931c96db0e7562b788e2`（agent-loop）及官方插件 `790ccdec91c4c88632d9f90f0378e41d0f9cc4d2`。参考源码保留 `/tmp/nexus-agent-flow-plugin-audit-20261104`；没有安装/执行外部项目，不将其性能结论套到本项目。

| 功能            | 最终调用链与审核覆盖                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 指引及Skill目录 | Run→prepareStep→Plugins签名目录→Context快照/预算/hash→Chat system / Responses instructions；同Run缓存首次验签目录、每轮和派发前复核安装revision。Skill仅注入元数据，正文精确读取；usage锚点、自动压缩及存储展开保留当前systemPrompt。                                                                                                                                     |
| 工具调度        | Run→executeBatch→逐项准入/审批/账本；显式parallel读取经p-limit有界重叠，exclusive为屏障，结果原序；失败/取消停止排队补位，已启动项allSettled排空，原工具名/失败码诊断保留；未派发排队取消不伪造独立失败，多项确定拒绝不因聚合被误分类为存储/资源未知。没有照搬DSH固定并发10。                                                                                             |
| 文本合批        | RunModelStream→Platform modelTextBatches→原appendText事务→事件；复用16ms节奏及128KiB帧预算，最多一个预读。控制/完成/已知断流先交付前缀；取消先停止真实producer，再等待预读/return；仅已分类取消免于二次报错，独立晚失败及cleanup_failed保留。                                                                                                                             |
| 审批唤醒        | Governance.subscribe/RunChanges→watch→普通Tool/ACP内部许可；先订阅再读取，dirty避免丢唤醒；通知不代替事务授权，仍保留1秒跨进程/到期复核，finally退订/清timer。                                                                                                                                                                                                            |
| 模型拒绝        | Platform响应阶段→ModelNetworkFailure→ProviderRequestFailure→Run failed与Shared步骤码；仅开流前明确4xx拒绝可确定失败，先排空辅助/Job/Child。429沿SDK原退避，所有其它HTTP状态禁止重试，连接无响应停止SDK重试；5xx/超时/半流/清理未确认保留unknown，不被后一次拒绝抹除。                                                                                                     |
| 插件贡献        | agent.json严格解码→Model应用投影→签名目录→受审批plugin_tool_call→绑定实例agent RPC；role/toolNames/beforeStep/tools，context.read与plugin.invoke各自复核，实例内串行、期限含启动/排队、pending/停机/晚结果归原owner；Run调用不复用管理队列32项门槛，活跃实例不重复构造/整包验签。工具效果未知但实例已确认关闭时保留Run效果围栏；只有资源/存储未确认才保留实例并阻断模块。 |

两轮审核覆盖全部新增/修改的Context/Tools/Governance/Plugins/Run、Shared SDK/能力/失败取值、Platform模型/隔离协议，以及前端能力选择/三语消费者。Model和Adapter白名单转换独立；SQL仍只在Adapter。新systemPrompt为快照必填，v1结构签名变为 `backend-next-v1-initial-20261104-agent-instructions`，未兼容、迁移或删除旧开发库。历史角色与运行中输入规则未改变；前序最小化提醒保留。

静态执行：首轮ToolModel联合遗漏、格式、合批reader类型推导以及最后一轮错误导入均已修正。`check-6.log`、`check-final-2.log`根check退出0；`build-final-2.log`双端生产构建及`shared-check.log`类型退出0；`format-final.log`全仓ESLint/Prettier退出0。最后诊断/HTTP重试/取消与实例准入修补后，`closeout-check.log`根check及`closeout-build.log`双端生产构建退出0，`closeout-shared-check.log`Shared类型退出0；最终后端`final-backend-check.log`/`final-backend-build.log`退出0，最后相关文件ESLint通过。`final-format.log`全仓ESLint/Prettier及`final-diff.log`退出0；收口文档另做定向Prettier/diff。中途一次E2E文档格式未整理的失败已由最终格式通过覆盖。没有新增/运行本轮行为测试，静态结果不替代运行验收。

独立插件源码在专用目录plugins worktree，提交 `d5dd455e209fffb86433cedb7044c507a0d848b3` 已推送main。Nexus Agent 1.0.3贡献简短角色与原两份Skill；Full-stack 1.0.3贡献上下文钩子及backend_status只读App KV示例。复制后端Prettier配置及函数空行规则，统一Tab/单引号/分号/120列/控制语句括号、JSON/YAML两空格；仓库增加format/lint/check脚本，Validate/Release均执行冻结锁安装及格式/lint/包校验。`plugin-check-release.log`退出0，远程[41820776547](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41820776547)验证精确源码，draft签名构建[41820876070](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41820876070)成功。

发布[v1.0.3](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.3)已公开为latest，发布事件的[41821088972](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41821088972)再次构建成功。draft下载先核对Ed25519官方pin/签名、全部文件hash/大小、catalog URL/版本与逐文件提交源码，再公开；latest目录及两包匿名HTTP200，public复核同样签名及源码。产物/元数据/脚本与核验日志在release-1.0.3。两包均要求Host>=1.0.3，现有安装必须显式升级，不存在旧协议转换。

| 公开包                    | 大小        | SHA-256                                                          |
| ------------------------- | ----------- | ---------------------------------------------------------------- |
| nexus.agent-1.0.3.tar     | 20480 bytes | 904a2238a05ccfd393c2faa61d53e22bc41044dbd67e8809d2061c53e456f6de |
| nexus.fullstack-1.0.3.tar | 20480 bytes | 633775837fe37b675a21e4c65b8d15bed2c3d2f6205a93f8cfc07e826409ace6 |

待正式验收：中文任务Skill选择及正文按需读取；目录更新/撤权、上下文容量/压缩/快照；读取并发与exclusive排序、取消/混合失败/排空；普通与ACP批准/拒绝/期限/CAS/跨进程；429退避、明确拒绝与5xx/断流不重放；上下文/工具RPC及畸形输出、超时、升级/卸载/发布者撤权；实际首字、事务次数、吞吐和取消延迟。签名包核验不证明运行行为或性能，不沿用历史553项或旧插件安装证据代验。

## Agent 最小化任务提醒（2026-11-04，源码/静态）

基线main/f789446f，本批未提交工作区。用户授权最小化时的小型任务更新/快速审批卡片，并明确仅变化时短暂弹出，不常驻。仅新原生任务提醒UI及Host/runtime观察，原完整窗口、后端与Shared不变；按PLAN D17不新增/运行行为、浏览器/CDP或本地/远程E2E，不发布部署或操作数据库。553项正式通过只属于ac314e58，不能用于担保本批提醒。日志集中 `/tmp/nexus-agent-task-notices-20261104`，保留全部现有产物。

实现：复用当前Surface/useNativeRuns的原任务订阅，最小化继续、标签隐藏/关闭/卸载/身份撤销停止；Host实例登记带注销保护的任务投影，只按Run身份/状态、审批身份/版本和语义失败变化触发，正文/用量/语言/审批排序不会反复弹。初始历史终态只作基线；同任务合并、多任务排队，新审批优先但不替换悬停/键盘操作中的卡片。8秒收起，悬停/键盘操作或标签隐藏暂停；触摸点击不会因悬停/焦点永久暂停。待审批标记保留，按最近expiresAt单个本地timer更新过期标记/按钮，不增加服务端轮询。

快速动作复查当前Run/Thread、审批版本/hash/期限和blocked，调用原mutate意图、CAS和operationId，不开放最小化创建/续发/取消或未知重试。过期、冲突、未知时进入完整会话核对。卡片只呈现安全摘要/目标/风险与有限结果预览，用量未到不补0；正文保持纯文本，不执行模型HTML。定位使用已安装Floating UI 2.0.1，Frontend新增直接依赖，lock仅新增该importer引用，无包版本升级；原Popover因全局FocusScope/DismissableLayer不适用于自动提醒，最终没有引入其焦点/键盘/背景副作用。保持328px最大卡片，实际宽高由定位库/视口收缩；手机按钮整枚换行，不在按钮内拆字。

两轮源码复核：第一轮沿minimized→runtime available/canReadUpdates→原订阅→投影→Host变化/合并→通知→原审批mutate；第二轮核对空Run在途、首个历史快照、完成/unknown与剩余正文、多个App/版本、App卸载/登出、语义失败与语言变化、过期/CAS/双击/未知、队列切换/触摸焦点和计时清理，以及定位监听释放/无自动聚焦/卡片内Esc/贴边标记。初次类型命令错误地从根调用vue-tsc，已改为Frontend包入口；首个实现的时钟API不匹配安装版本，最终删除额外时钟，统一使用Host的过期时点。首轮根check发现定位中apply声明间距，已按原规则修正。最终 `pnpm run check` 与 `pnpm run build:frontend` 均退出0（check-final.log/build-final.log）；全量 `pnpm run format:all:check` 和 `git diff --check` 通过，最终文档定向格式复核通过。未提交/推送，本批产物保留。

待正式回归：只有真实任务变化短暂弹、8秒后隐藏且流式输出不复活、最小化本身不弹/旧历史不补弹、多App合并/审批优先/关闭单条、浏览器隐藏/恢复与终态续读、批准/拒绝/多审批及过期/冲突/未知写、登出与旧卸载不影响新实例、终端持续输入/其它弹窗焦点不受影响、桌面贴边/拖动和320/390px手机三语布局/真实软键盘。无本批浏览器截图或行为PASS，不以源码/构建替代实机验收。

## 累积变更审核与正式远程 E2E（2026-11-04，已完成）

用户最新要求审核当前全部变更、修复残余并推送解决正式远程E2E。本批从main/ce7c135e及累积50个文件工作区继续，不回退前序修改；保留已有RDP提交，覆盖SSH连接、注销反馈、维护清理、终端响应和Agent可编辑硬限制。仅授权正式远程Actions，本地仍不新增行为/CDP/全量E2E、不操作用户数据库或发布镜像。证据集中 `/tmp/nexus-change-review-e2e-20261104`，保留所有前序产物。

两轮源码审核按PLAN当前四表完成：Shared范围、完整codec、存储/冻结/治理覆盖、实际预算准入和配置消费者；大数减法、时间表示、Child批量预览与单次容量；真实Job/MCP/Browser/Remote任务归属、排队/取消/晚返回/故障排空；认证撤销通知、保存回调原signal、重新激活；无预测输出快路径、预测/reset屏障、字号同帧合并及远端resize去重；ssh2默认认证与公钥签名算法回退；两个GHCR包归属、保护标签与递归manifest、删除前复核。未发现需要恢复旧固定产品上界的底层依据。清理架构里残余Remote8任务和有效预览8KiB的相反说明；既有16任务准入测试已同步，保留关闭排空和同key顺序断言。

新增两项正式回归：coverage-gaps公共API核对全部15项高于旧上界的硬限制、普通预算和App覆盖持久化，并拒绝超硬限制、非安全整数及超Node计时器输入；performance-settings核对真实界面硬限制800→普通预算800→重载读回，两次保存之间默认预算不改变。没有运行实际800次模型调用，不把配置验收等同请求压力验证。更新既有恢复硬限制注释，不再把默认值称作协议上界；原功能断言保持。

本地根check与双端生产build退出0（check.log/build.log）；新E2E消费者严格TypeScript检查退出0（e2e-types.log，显式使用Backend Node类型目录；首次未配置Node类型的调用失败已修正命令）。全量格式检查首轮发现新增测试两处函数空行，已按原规则修正；最终全量格式/diff通过。64bca706已提交并推送main（首次GitHub commit_refs_rules服务失败，重试成功）；推送未自动触发任务，手动启动正式41811345271，源码SHA一致，8个分片且不更新截图。第一轮完整结果见下，旧551场景不担保当前工作区。

第一轮41811345271已结束：质量、Docker smoke、Backend与browser1/3/4/6通过，browser2/5/7共4项失败：functional-memory的两项非法期限委派、subagent-lifecycle和native-run均在首次/重试出现首个模型步骤model_response_invalid。三分片日志和完整trace/截图分别下载到本批目录browser-{2,5,7}-1；MODEL_STREAM_SETTLED定位Platform model-request.parameters，源码确认数组工具声明maxItems仍固定拒绝>128。协作dependencies/join/cancel已扩大声明范围，导致包含这些工具的整个模型请求在网络派发前失败。移除这个无底层依据的声明门槛，保留正安全整数、范围关系、完整请求编码容量和工具实际参数校验；原native-run完整Skill/批量/文件/Shell/取消断言保留，不改UI或扩大超时。USAGE/架构同步，Backend check/build、单文件ESLint及定向格式均退出0，日志为fix-backend-check.log、fix-backend-build.log、fix-eslint.log及fix-format-check.log；最终单文件ESLint、定向格式和diff通过后以ac314e58提交推送。

最终源码ac314e58的根check与全量格式复核退出0（final-check.log/final-format.log），修复后Backend build已通过。推送的自动任务41812350189延迟出现；手动41812361893按同一main并发策略替代并取消前者，保留后一完整任务，没有把取消算作功能失败。完整任务结果见当前基线：全部553项一次通过，首轮4项失败与新增2项配置回归均通过，未修改UI、正常断言或超时。完整日志run-41812361893.log、job清单run-41812361893.json和统计final-e2e-summary.json均在本批目录；额外核对passed场景唯一性553/553，无重复/失败/flaky/跳过。维护脚本22项隔离回归沿既有证据，未执行线上清理。最终仅PLAN/testing收口提交，不发布或部署，测试环境与所有产物保留至用户通知。

## 终端连接等待优化（2026-11-04，源码及静态）

基线 `main/848f9c14`，本轮工作区修改；Node v22.23.1、pnpm 11.28.10，pnpm 路径沿用 `/tmp/nexus-integration-toolbar-20261104/tools/node_modules/.bin`。新产物集中 `/tmp/nexus-terminal-connect-performance-20261104`，保留至用户通知。仅调整 Platform SSH 认证顺序和 WorkspacePage 初始化并行，不修改 UI、协议、期限、主机信任或远端部署。

源码依据：当前 ssh2/lib/client.js 默认以 none 开始认证，项目已有明确密码/私钥；createConnectConfig 改为已配置方法优先、none 后备，保留库内公钥算法回退。正常凭据成功路径每跳少一次认证往返属于协议链推断，尚无真实耗时测量。WorkspacePage 初次与缓存激活的查询动作与布局读取并行；终端仍由 layout.loaded 挂载，已有 channel 缓冲和消费窗口持有挂载前输出。Files 原已后台初始化，prompt/setup 原已合并为一次 PTY 提交，保持其开放输入前完成的顺序。

两轮源码复核覆盖密码/私钥/none、主机信任及各跳配置、失败/取消/关闭、慢布局与读取失败、失活/注销晚返回、连接中前台恢复和普通/挂起恢复；未新增资源/轮询/自动重试。根 `pnpm run check`、`pnpm run build`（Backend → Frontend）、`pnpm run format:all:check` 全部退出0，分别留 check.log/build.log/format.log；最终文档单独格式和 `git diff --check` 通过。按 D17 未新增/运行本地行为、CDP、E2E 或真实 SSH 性能验证；慢布局下首屏及完整输出、各种认证服务器、多跳与端到端耗时仍待正式回归/实测，历史551场景不覆盖本轮修改。

## RDP/VNC 绘制性能验证（2026-11-04）

本轮先做源码/依赖/参考项目核对，随后按用户新增授权运行定向浏览器/CDP验证并修改RDP presenter，基线仍为 `main/848f9c14` 加前序未提交 SSH 连接优化；仅修改RDP presenter的超量区域合并；VNC实现、依赖、UI和远端保持。源码和元数据集中 `/tmp/nexus-rdp-render-performance-20261104`，按用户要求保留；来源均为公开 GitHub，只读获取，不含连接凭据。

核对安装的 noVNC 1.7.0 的 core/rfb.js、display.js、H.264 decoder，固定 IronRDP `62246b364a0282bab85087f658a81fe4207b6b31` 的 canvas/image/session 及官方 Web 接入，并以已安装 JS 的三参数 putImageData binding 交叉确认。参考 Devolutions Gateway `0e65dc2637f29d8e84dbfd326ce887960f5ca2a0` 的 RDP/VNC 接入及 Cockpit Machines `c03f14ae4abb8175c3a9b53d75db53905b55d3c0` 的 VncConsole。Gateway VNC 使用 Iron VNC，不当作 noVNC 相同库证据；本项目 noVNC 使用者对照为 Cockpit。

两轮源码复核：第一轮沿项目 controller/Adapter/presenter/透明桥及 SDK 追踪输出顺序，第二轮核对实际 RDP build_config、公开 SDK 扩展、上游 Canvas 和 noVNC FBU/异步队列/编码能力。架构 softbuffer 旧描述已更正。实现复核覆盖超过32区域后的像素覆盖、合并扫描上界、WASM内存复用、清空/尺寸变化/关闭、分配失败和不支持输入回退；没有新增限制或额外像素底图。

### 浏览器性能及像素证据

Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47，独立环回HTTP服务、CDP和浏览器profile均在上述目录；浏览器实际为SwiftShader/软件Canvas，无硬件GPU。基线是改前真实presenter快照，最终候选由 `benchmark-final.mjs` 直接编译工作区真实模块；源码快照 `final-source.ts` 保留。主脚本退出0、日志无PAGE ERROR；原始数据 `final-benchmark-results.json`、环境 `final-benchmark-environment.json`、汇总 `final-summary.{json,txt}`。

先比较原生Canvas backbuffer、零复制行视图、只合并新区域与全区域最小面积配对。Canvas方案像素正确，但4K条带CPU中位数7.2→15.9ms，未采用；行视图无稳定收益，只合并新区域无法稳定保留4K分散更新的收益，均未进入产品。最终保留原像素底图，只在超量时合并新增重绘面积最小的一对，扫描最多33个区域的528对，恢复至原32区域预算。

最终108轮：3种分辨率×6场景×3轮×基线/候选交错顺序。每轮54帧，前9帧暖机，统计45帧；每格为3轮每帧CPU耗时中位数的中位数（ms，改前→改后）。CPU口径为同步像素入队/复制加rAF内原生Canvas提交，不包含等待下一帧、RDP解码/传输或完整浏览器合成。

| 更新场景             | 1920×1080 | 2560×1440 | 3840×2160 |
| -------------------- | --------- | --------- | --------- |
| 分散小块，64×48×96   | 4.0→4.1   | 6.5→6.1   | 12.8→6.4  |
| 窗口块，320×180×12   | 3.2→2.9   | 4.0→4.0   | 4.6→4.5   |
| 全宽条带，64行×12    | 3.2→3.1   | 4.7→4.8   | 7.7→7.8   |
| 文字，64×20×1        | 0.1→0.1   | 0.1→0.1   | 0.1→0.1   |
| 640×480内局部小块×96 | 1.7→1.9   | 1.8→2.0   | 2.0→2.0   |
| 高密度小块×384       | 9.0→9.0   | 10.9→11.3 | 19.0→18.4 |

4K分散更新每帧平均提交面积8,081,311→1,396,117像素（减少82.7%），调用1→32次但均在同一rAF完成，CPU中位数减少50%。其它场景改善有限；局部更新与部分密集场景有0.1–0.4ms的耗时上浮，未把这些变化报告为普遍提速。4K高密度更新仍超过16.7ms帧预算；未测真实服务器、网络、解码、硬件GPU或端到端帧率，不能宣称真实RDP速度翻倍或消除逐块刷新。

13项像素/生命周期验证通过：分别对改前和最终模块与原生putImageData逐字节比对部分/重叠/透明/负裁剪、输入立即清零模拟WASM复用、超过32个分散区域及未更新间隙、尺寸重建和同尺寸width/height清空、小数输入原生回退、待绘时关闭及实例方法/属性恢复、RangeError与超过32MiB后的同步直接绘制。另运行已安装noVNC 1.7.0真实Display，确认dirty在backbuffer且flip前不可见、flip后呈现；该项不等同VNC网络或编码性能验证。

根 `pnpm run check`、`pnpm run build:frontend`、`pnpm run format:all:check` 均退出0，日志为本目录check.log/build.log/format.log；最终文档目标Prettier与 `git diff --check` 通过。真实模块与测量快照SHA256均为 `bec03c828988b3c459b48ea1f19007aa60744f65a52a0be2a67dd548c3184153`。本轮未运行全量E2E或远端部署，全部自建浏览器/环回服务由脚本关闭，测试目录与产物保留至用户通知。

## 主动退出的错误提示隔离（2026-11-04，源码与静态）

用户反馈正常退出弹“操作失败／个人数据请求失败，请重新读取”。源码确认：useAuthenticatedViewScope的available/activated原先能在认证已撤销后重新建立scope；个人历史/快捷指令的error观察未核对view，通知的重读动作也未绑定原意图；LatestValueSaver失败回调只有error，工作区自动保存及字体回调未核对原permission；App尺寸保存原先允许null身份开始并与null比较。这些都是退出窗口的错误发布入口，当前没有用户浏览器抓包，不将任一单独路径当作已实机证实的唯一触发。

修复：无会话视图保持撤销，attach才可恢复新scope；上述观察与重读绑定原view；通用保存器回传原T，Workspace及layout按原permission过滤晚回调，列宽/侧栏/显隐等在派发前检查；App尺寸保存要求已认证用户。保留全局feedback、AppHeader真实退出失败和状态核对，未将取消伪装为成功或自动重试未知写入。原样保留SSH/RDP变更；本批检查覆盖合并后的工作区，RDP单独提交按用户新增授权收口。

已完成两轮源码复核：第一轮沿auth.beginAuthentication→App同步生命周期→stores/view撤销→错误观察/保存回调，第二轮核对首次匿名挂载、attach、logout失败恢复、重复激活、切用户、旧signal和刷新动作、layout与全部7个LatestValueSaver消费者、远程桌面null身份及真实错误出口。按PLAN D17未新增/运行本地行为、CDP或E2E；前序RDP108轮与13项像素证据只覆盖绘制，不能当作退出回归。根 `pnpm run check`、`pnpm run build:frontend` 和 `pnpm run format:all:check` 均退出0（check.log/build.log/format.log），最终文档格式与 `git diff --check` 通过；本批产物集中 `/tmp/nexus-logout-feedback-20261104`，环境和前序产物保留至用户通知。

## 两包镜像清理保留规则（2026-11-04）

基线 main/ce7c135e 加前序 SSH 与退出提示隔离未提交变更；本批只修改既有手动清理 workflow、维护脚本及对应文档。两个固定 GHCR 包各自保留现有 main/dev/latest 及平台/证明 manifest 闭包，校验 repository.id；允许部分保护标签未发布，有版本但无保护根时拒绝。原当前/活跃/重启 Actions 保护、关联成功证据、精确404统计及失败传播保持。两轮源码复核覆盖固定包范围、User/Org 路径、包归属、包缺失/空包、独立 digest 集合、渠道变化及无条件删除的并发窗口；核对当前 runner 发布脚本只推送 latest。

沿既有 workflow 的前置维护夹具执行 `node --test scripts/maintenance/cleanup-history.test.mjs`，22项全部通过；真实调用维护脚本，外部 GitHub/GHCR 全部 mock，不访问网络或删除远端资源。覆盖两包三渠道和闭包、跨包同 digest、部分/仅 main 标签、同 digest 多标签、两包分别归属错误/无保护根、Org、缺 runner、渠道移动和新增、重复标签、保留 manifest 读取失败，以及既有404/403/500、活跃/重启运行和不可核验产物。两脚本 node --check、根 `pnpm run check`、`pnpm run format:all:check` 及 `git diff --check` 均退出0，对应 tests.log/check.log/format.log；最终文档单独格式与 diff 通过。本批未启动产品、CDP 或全量 E2E，未重复运行产品构建。

环境 Node v22.23.1、pnpm 11.28.10，日志集中 `/tmp/nexus-cleanup-retention-20261104`，保留至用户通知。本机只读 GitHub 包查询返回403（缺 read:packages），未提权、未运行清理、未提交推送或触发 workflow；真实包权限及线上删除尚未验证，不以本地夹具冒充线上清理结果。

## 终端翻页与缩放响应（2026-11-04，源码与静态）

基线 main/ce7c135e 加前序 SSH、退出提示和清理工作流未提交变更；本批只修改 TerminalView、TypeAhead vendor host 及对应文档。源码核对当前 xterm 6 WriteBuffer 在12ms片段内连续解析，原 host 却逐块在前后插入解析屏障，即使没有预测也串行等待；FitAddon.proposeDimensions 读取布局和计算样式，原字体手势每事件修改字号后立即 fit，主题更新同样重新测量。本批不是实测性能复现，不报告 FPS 或毫秒收益。

实现：TypeAhead队列头为输出且无预测时保留原beforeServerInput/回调，直接提交xterm；输入、reset和有预测的输出保持双解析屏障，之后排队的无预测输出可继续直接提交。缩放继续同步更新本地目标字号和保存意图，只在几何帧应用最新字号；预测撤销在途不重复测量，完成后核对原PTY/可见性并读取最新字号。主题观察与字体族/scrollback观察拆开。没有改滚轮累积/方向/步进、100ms容器resize合并、无清屏fit、同尺寸PTY去重、本地字号预览和串行保存；用户强调的缩放抖动作为关键待验项保留。

两轮源码复核沿输出→预测→xterm解析→原始ACK，输入/批量DEL→预测、reset/barrier→快照/PTY替换/历史，以及滚轮/捏合→本地字号→Workspace预览/LatestValueSaver→appearance保存→props反馈→几何复测；覆盖同步解析回调、预测清空后的排队输出、CSI分包、旧epoch、页面隐藏/失活/卸载、快照原始尺寸、缩放中途旧保存回执、最后一次字号和ResizeObserver回调。既有terminal-ui的连续缩放/旧回执/关闭前保存与mobile pinch场景已核对，未改变断言或测试配置。

按PLAN D17未新增/运行本地行为、CDP、性能脚本或E2E。根 `pnpm run check`、`pnpm run build:frontend`、`pnpm run format:all:check` 均退出0，日志分别为check.log/build.log/format.log；最终文档格式与 `git diff --check` 通过。日志集中 `/tmp/nexus-terminal-response-20261104`，Node v22.23.1、pnpm 11.28.10。未提交推送、未重启或部署；真实手机捏合、持续滚轮与窗口拖动无回退/抖动、全屏程序翻页、弱网预测及大历史的实际性能仍待正式回归或实机验证。

## 可编辑硬限制与固定门槛清理（2026-11-04，源码审核）

用户要求继续去除可编辑硬限制之外无底层依据的常量上界。沿前序模型请求数修复及当前未提交工作区实施，默认预算、默认硬限制和UI不变，未提交推送、部署或操作数据库。产物集中 `/tmp/nexus-editable-hard-limits-20261104`，保留至用户通知。

源码修改：全部15项设置范围以Shared为唯一owner，数量、Token及累计字节仅受正安全整数表示约束；活动时间和工具超时保留Node/SSH最大单次延时2147483647ms的明确技术边界；Artifact期限按Date TimeClip校验。不再额外固定工具4000、Child4、消息5000/8MiB、Recall20/32KiB、文件10GiB/30天。Governance、双端控件/codec及SQLite解码沿同一取值消费；冻结预算、真实占用、原CAS及未知围栏继续生效。Token、消息和文件容量以剩余额度减法比较，Artifact Range容纳16位安全整数，Job分页offset预留64项加法空间。

直接消费者同步：Recall输入及候选窗口支持请求条数，模型预览不再强制8KiB；Child依赖与join/cancel不再额外限4，批量预览超出原工具外壳时省略正文并保留续读；Child完整响应容量保持2064384bytes，移除从工具额度派生的历史条数与乘法。Remote/Job活跃8、MCP/Browser待处理及Browser会话16门槛移除，真实任务追踪、冲突、故障证据和停机排空保留。运行MCP/Browser调用使用原冻结工具signal，不再另套60秒总期限；SDK实际无条件创建timer，故MCP设置其最大可表示延时而由外部signal取消，Browser导航关闭独立计时器，连接/单次控制与清理期限保持。单次参数16KiB、捕获256KiB、分页/完整编码及私有管理/缓存容量保留，不承诺无界响应或任意并发。

两轮源码审核覆盖15项设置保存/确认/冻结/撤权与App缩窄、Root/Child族账本、大数比较和SQL表示、Recall与预览、Child批次副作用后交付、Job准备/取消/晚收尾、MCP/Browser排队/期限/关闭。核对既有HTTP/Storage/Frontend/E2E消费者：旧16任务准入断言已改为允许独立第17项进入，仍保留同key排队、关闭后拒绝、实际晚结果排空及共享close断言；小批Child正文断言和128个MCP连接/续接容量断言仍保持。此项仅修改既有消费者，不新增或运行行为测试。

Shared check、根check（Shared build、Backend check、双端ESLint及Frontend vue-tsc）、双端生产build、全量format:all:check全部退出0，日志分别为shared-check.log、repository-check.log、build.log、format-check.log。既有测试消费者修改后的定向语法/ESLint及最终文档格式/diff结果见final-review.log。按PLAN D17未运行行为、CDP、本地E2E或实际模型请求，大配置、超过8/16并发及60秒调用仍待正式回归。数据库沿前序v1签名变更，不兼容旧开发库；本批未再变更DDL，实际旧库维护仍未执行。

## 模型请求数硬限制可调整（2026-11-04，源码审核）

用户希望把硬限制模型请求数设为800，却提示最大400。基线 main/ce7c135e 加前序本地SSH、退出提示、维护与终端响应变更；本批未提交推送。源码确认Shared AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests=400被前端硬限制QuantityInput、HTTP codec、ExecutionService与存储行解码共同消费；另有AGENT_RUN_STEP_MAX_COUNT=400限制Run循环、Root Participant、步骤存储和工具详情解码，Governance有效覆盖也另写400。Git历史指向1f21e469的执行契约调整，未发现供应商或底层库规定请求数400的依据。

修复：Shared模型请求数只保留Number.MAX_SAFE_INTEGER表示边界；步骤常量改名AGENT_RUN_STEP_MAX_INDEX并从同一基础取值派生，全部消费者同步；执行循环取消独立步骤上限，Root依赖冻结族账本，Child仍继承实际预算。Governance范围映射Shared，App覆盖仍在事务核对已保存硬限制。前端控件、Shared编解码和SQLite解码沿原引用自动同步，默认普通预算80、默认硬限制400及其余字段额度不变。新库Child max_requests CHECK同源放宽；初始v1签名同步更新为backend-next-v1-initial-20261104-model-request-range；旧开发库因签名不匹配在启动时拒绝，原CHECK不会自动改写，部署前须明确维护表约束与签名或使用独立空目录；旧快照不兼容，不操作实际用户库。

两轮源码审核覆盖硬限制预览/确认→设置重读→普通预算保存→App覆盖→Root冻结→Child继承→步骤reserve/工具元数据/共享用量→上下文摘要与命名计费，含800、原400默认、低于预算拒绝、非法/非安全整数、CAS与未知结果围栏；旧步骤常量与模型请求数固定400的真实消费者已全仓复查，剩余400仅默认值。Shared check、根check、双端build及全量format:all:check均退出0，日志为shared-check.log/repository-check.log/build.log/format-check.log。初始v1签名同步后再次执行Backend check/build及该文件ESLint，均退出0，日志为final-backend-check.log/final-backend-build.log/final-eslint.log；最终文档格式和git diff检查通过。按D17未新增/执行行为、CDP、本地E2E或真实模型请求，不以源码审核声称已经实跑800次。

环境Node v22.23.1、pnpm11.28.10，日志集中 `/tmp/nexus-agent-model-request-limit-20261104`，保留至用户通知。待正式回归：800硬限制保存重读后设置有效预算；>400步骤后继续工具调用及HTTP详情解码；Root/Child/摘要共享额度按实际配置拒绝下一次；非法输入/并发配置变化/旧库CHECK维护。

## 阶段逻辑回归

先按 PLAN 决定项核对本批授权和真实受影响调用链，再选择验证；D17 的默认路径为源码审核、静态检查后按明确授权执行远程 GitHub Actions。下列命令是入口说明，不表示本批已经执行或获得额外测试授权。

| 检查              | 入口与范围                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态与构建        | 根目录 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check`、`git diff --check`；纯文档可只运行受影响 Markdown 格式、链接及 diff 检查。               |
| 完整 E2E          | `pnpm test:e2e` 构建应用与测试客户端后运行 Playwright；依赖和隔离服务以 `tests/e2e` 配置与夹具为准。                                                             |
| 后端 / 浏览器分组 | `pnpm test:e2e:backend` 只构建后端与 Shared；`pnpm test:e2e:browser` 构建并运行浏览器组。整轮判据包含两组、质量与 Docker smoke。                                 |
| 动态隔离端口入口  | `pnpm test:e2e:remote -- <Playwright参数>` 调用本地 `scripts/e2e/run-remote.mjs`，为服务分配独立环回端口后运行 Playwright；这个名称不表示会触发 GitHub Actions。 |
| 远程 Actions      | `.github/workflows/e2e.yml` 及其实际引用脚本；每轮记录 run URL、提交 SHA、分片结果、首次失败与重试，不跳过失败场景换绿。                                         |

回归覆盖正常流程、授权/身份变化、冲突、取消、未知提交/执行、晚返回及资源关闭；按真实 owner 判断结果，不能从本地等待结束推断远端停止。每项证据注明环境、命令、输出、覆盖和未验范围，实机/外部依赖不能用静态或协议夹具代替。专用环境与产物保留至用户通知清理，凭据不进入文档或日志。

## 专项记录

### 独立 Nexus Agent 1.0.2 提交发布（2026-11-04）

用户要求提交发布此前精简。独立仓库 main `790ccdec91c4c88632d9f90f0378e41d0f9cc4d2` 提交六文件：两份Skill、NexusAgent manifest1.0.2、根版本与README/目录说明；[v1.0.2](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.2) 已于07:40:08Z公开并设为latest，tag与源码SHA相同。operations/developer共4687→2601 UTF-8字节（减少44.5%），不是token、延迟或准确率实测。

本地 node scripts/check.mjs 通过；[validation 41793587965](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41793587965)、[草稿签名41793663714](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41793663714)、[正式发布41793872161](https://github.com/0honus0/nexus-agent-plugins/actions/runs/41793872161) 均成功。沿README流程先创建指向已验证main的draft，Actions使用原secret签名；下载草稿核对后公开，未取出私钥。通过匿名公网latest目录及两包均HTTP200，再核对官方publisher与Host pin、Ed25519签名、包大小/hash/URL、全文件hash及提交源码字节。Full-stack原1.0.1包hash与上一发布完全相同，未改写同版本内容。

- `nexus.agent-1.0.2.tar`：SHA256 `776956d7eb44a493a486fc294eb8a28ade3a630c314c19828928e1fd32e40a2b`，恰含两份Skill，frontend/backend入口均null。
- `nexus.fullstack-1.0.1.tar`：SHA256 `293c5b48ef67c42a5fa6ba32e4df47573fdcccb60aaff8a2ee71e608f740a36d`。

全部本轮记录与下载位于 `/tmp/nexus-agent-tools-audit-20261104/release-1.0.2`：check.log、validation.json、draft-release.log、draft-verify.log、published-verify.log及release信息。未执行宿主行为/E2E、真实插件安装升级、模型调用、远端部署或镜像重发；这些产物核对不代替新包安装后的Skill检索/哈希读取和真实角色效果验收。现存用户App没有自动升级，环境与产物按用户要求保留。

### 设置读取恢复与推荐安装默认授权（2026-11-04，远程回归完成）

用户继续授权只读排查指定 Nexus 主机；本轮 SSH 仅读取 backend 最近3小时/最多5000行 Compose 日志，未修改远端文件、配置、数据库或容器。实际日志66行，范围07:01:09.324Z–07:08:49.789Z，未找到对应设置 GET 失败，execution-settings PUT 为200且 responseFinished=true；其余为 SSH 资源取消与 suspended socket 关闭，不能据此认定设置请求根因，也不能从无日志证明请求全部成功。产物 `/tmp/nexus-agent-market-release-20261104/remote-{backend,ssh}.log`，SSH stderr 为空。

源码定位：KeepAlive 失活正常置 needsRefresh，却被 preferences-system/workspace 的 pending 当作失败；个人偏好和后端日志缺少重新激活读取，Agent 初始 refreshRequired 也可能临时误报。当前未在用户浏览器取得失败模块 ID，两个偏好面板与症状吻合，不声称远端精确证实。修复保留原只读恢复/未知写围栏与晚响应隔离，仅真实失败触发提示。

推荐新装的初始启用/全部声明授权经 Service 决策、Model 投影进入原安装事务，SSH 目标能力为全部 SSH 范围，Runtime 启动后才确认；普通安装、升级和已装复用不恢复权限。回归新增缓存页往返无写入，并由正式 Playwright 调用真实签名包/SQLite 的内部初始化夹具，核对启用、完整授权/目标范围、运行态、撤权后幂等复用和普通安装空授权。该夹具不冒充官方签名包或替换 pinned key；官方新包真实验收仍待 D16。

两轮源码审核完成；根 check、双端 build、全量格式检查均退出0，日志分别为本轮目录 check.log/build.log/format.log，diff 检查通过。正式远程 41792075453 对 07a69be8 完整通过551场景，新增缓存往返1.6秒、安装初始化2.6秒，原真实读失败保护1.1秒；日志 e2e.log/e2e-result.json/e2e-watch.log。不运行本地行为/CDP/E2E，不沿用上一轮通过担保新增行为。

以下记录按原执行范围保留；当时的“当前”“待验”“未提交/发布”等指该轮时点，最终产品行为以 USAGE 与当前源码为准。架构正文已移回对应架构文档，避免把设计误当测试证据。

### 本轮 dev 镜像发布（2026-11-04，完成）

[41792924820](https://github.com/0honus0/nexus-terminal/actions/runs/41792924820) 成功发布 main `4a3074da6f8ab7e515a017f949ce03b1d059dc88` 的 linux/amd64 镜像。生产依赖审计成功；构建日志确认 OCI revision 与上述 SHA 一致，平台 linux/amd64，两个标签 `ghcr.io/0honus0/nexus-terminal:dev`、`:sha-4a3074da6f8a` 推送同一 digest `sha256:7593bb061d77afae1aeedfec09c0f57f7ca13882ad04f1feb36bafc6b09c90bb`。测试 SHA 07a69be8 与发布 SHA 之间只有 CI 耗时估算变更，无产品源码差异。发布证据 publish.log/publish-result.json/publish-watch.log 留本轮目录。

遵守用户“不更新远程”：本轮仅早先 SSH 只读日志排查，没有远端拉取镜像、重启、部署或数据库维护；生产主机仍保持此前部署。未创建稳定版 tag/Release，未发布独立 Nexus Agent 新签名包。测试产物保留至用户通知。

### Agent 安装与插件仓库布局（2026-11-04，源码及静态）

基线 main/fa71d07e，本轮本地变更；Node v22.23.1、pnpm 11.28.10（沿用 `/tmp/nexus-integration-toolbar-20261104/tools/node_modules/.bin`）。用户授权安装弹窗和仓库排版，并补充手机安装/取消各一行、按钮内不换行。AgentOnboardingModal 分离提示和动作、缩减手机面板内边距；PluginRepositorySettings 分层标题/刷新、地址/添加、搜索，按实际容器宽度排列介绍和操作，窄面板使用有可访问名称的刷新图标及独立地址行。

两轮源码复核覆盖正常/加载/禁用、长名称/URL/简介、官方/第三方、保留数据及多个操作组合；所有原点击事件、安装与校验/信任/清除条件、未知围栏和取消保持原 owner。无 Shared、后端、基础按钮或持久化变更。USAGE/Frontend 同版同步。

日志集中 `/tmp/nexus-agent-market-layout-20261104`：根 `pnpm run check`（check.log）、最终 `pnpm run build:frontend`（build-final.log）、两个修改组件的 ESLint（eslint-final.log）、`pnpm run format:all:check`（format.log）均退出0；首次构建也通过，最终构建覆盖源码复核后的窄面板补充。文档收口后再做目标 Prettier/diff 核对。

按 D17 未新增/运行本地行为、CDP 或 E2E；Windows、320px手机、中英文及缩放下的真实几何、视觉和点击待验，不能沿用上一轮549项远程通过担保本轮布局。未提交、推送或发布；产物保留至用户通知。

### Artifact 总空间统一（2026-10-26）

范围：删除单文件设置及固定16MiB Artifact/图片、8MiB截图业务上限，取消10,000项累计文件准入，读取偏移跟随Shared协议容量；生成/截图/下载预检总剩余空间，最终begin事务保证总配额。文件库增量hash与Range分段下载复用现有入口，无额外UI变更。

D17：不新增/运行本地行为、浏览器/E2E或付费图片请求。现有plugin-artifact-streams夹具将内容大小固定为16MiB测试批次，不随新10GiB协议上限分配巨大内存；未改变原授权撤销/关闭/lease断言。

待验：超过16MiB生成/上传/预览/下载，超过8MiB截图；总空间接近耗尽、已有staging预留、并发生成最终begin拒绝、磁盘余量；多段下载逐段版本/范围/长度/hash/空文件/中途取消；大文件上传分片hash且无整体ArrayBuffer；文件数超过10,000后按空间准入；SDK Base64技术容量、非规范Base64及格式拒绝；旧设置文档不自动迁移。

两轮源码审核完成：第一轮核对全契约删除、HTTP流式/JSON容量区分、最终配额事务、已有预留和工具偏移；第二轮核对Base64规范编码/运行时预算、浏览器上传读取前技术能力、Range空文件/末段/版本变化、增量hash销毁及取消。检查证据：

- `pnpm run check`通过，`/tmp/nexus-artifact-capacity-check.log`。
- `pnpm --filter @nexus-terminal/shared build`、`pnpm run build`及最后技术能力补齐后的`pnpm run build:backend`通过，日志`/tmp/nexus-artifact-capacity-shared.log`、`/tmp/nexus-artifact-capacity-build.log`、`/tmp/nexus-artifact-capacity-backend-final-build.log`。
- `pnpm run format:all:check`通过，`/tmp/nexus-artifact-capacity-format.log`；后续修改均目标Prettier写入并再做完整格式检查，`git diff --check`及既有流式夹具`node --check`通过。

源码/静态结果不代表上述运行时场景已通过；未重启、未改已有数据库、未提交推送。删除执行配置字段按当前破坏性结构执行，旧持久设置及冻结Run文档不兼容。

### 文件管理器预读20ms（2026-10-26）

原useFilesystemBrowser的PREFETCH_DELAY_MS由50改为20；FileManager普通目录、“..”鼠标停留及键盘定位共用此入口，后继最新候选补调度也引用同一常量。两轮源码审核核对入口与两处定时器，以及缓存命中、单个预读、最新候选、点击复用、离开/失活/dispose取消和revision围栏，无其它代码改动。

静态检查日志：`/tmp/nexus-files-prefetch20-check.log`、`/tmp/nexus-files-prefetch20-build.log`、`/tmp/nexus-files-prefetch20-format.log`；根check、Frontend build、全量格式及git diff --check均通过。按D17不新增/运行行为或浏览器/E2E测试，真实普通目录/上级目录20ms预读与快速移出待远程验收。

## WebSocket 周期保活（2026-10-26，源码及静态）

范围：Platform HTTP listener 的既有 channel/raw WebSocket，每25秒以 ws 标准 Ping 保活，浏览器自动 Pong；无 UI、Shared 或业务消息变化。

两轮源码复核：沿 upgrade→activeSockets→channel/raw→维护 suspend/drain/resume→listener close 追踪所有权；复核 ws.ping(callback) 支持、OPEN/缓冲保护、同步/异步发送失败、一次性定时器unref与同步清除。保活不刷新业务授权/挂起租约，不以一次漏Pong强制断开；原前台恢复探测、业务心跳及SSH离线策略保留。原始路由即使调整事件监听，统一timer仍由HTTP owner掌管。

静态：Backend build通过，日志 `/tmp/nexus-ws-keepalive-build.log`；根check、全量format及git diff --check通过，日志 `/tmp/nexus-ws-keepalive-{check,format}.log`。初轮ESLint发现新增分支缺少花括号及声明空行，已按项目规范修正后重跑，不将初轮失败记为通过。

按PLAN D17未新增/运行行为、浏览器专项或E2E。待验：经真实反向代理空闲超过60秒及多轮Ping；SSH/Agent/raw RDP/VNC并存；手机后台恢复、休眠/断网；发送背压、维护暂停恢复及停机无残留timer。未部署、重启或提交推送。

## 全部本地变更审核与远程回归（2026-10-26，已完成）

用户授权审核、提交全部本地代码并修复远程E2E。两轮分组源码审核覆盖 Agent Run/Step/Tool/Child、预算和模型SDK重试、上下文摘要与标题、批准分页/策略、模型来源、Artifact空间与分块下载、前端流合并/乐观消息/目标记忆、终端生命周期/输入恢复、Workspace附件流控及WS保活；保留已有授权UI变更，本轮不增加UI设计修改。

审核修正：工具列表协议按数值时间戳与ID校验游标，避免字符串位数影响排序；后端目标黑名单用例删除误加的approvalMode字段；状态监控用例按当前方向箭头及可访问标签核对上下行，保留速率/窄窗/缩放/趋势全部断言。

已完成根check、Shared/双端build、全量格式/diff、变更E2E的独立tsc（临时配置 `/tmp/nexus-all-review-e2e-tsconfig.json`，包含原前端别名及严格类型）；日志 `/tmp/nexus-all-review-{check,build,format,e2e-types}.log`。首次直接tsc因缺少项目配置、继而别名未设置失败，改用临时显式配置后通过，不视为产品问题。游标最终修正后的根check、双端build、全量format/diff亦通过，日志 `/tmp/nexus-all-review-final-{check,build,format}.log`。另修复模型手动添加按钮因聊天/图片两组重名导致的严格定位冲突，按Chat models组定位；更新已恢复的Run批准策略断言为默认Ask when needed，仍核对不产生grant。未执行本地行为测试；远程使用正式E2E工作流。

旧失败基线40218989558：质量/Docker由Agent宿主引用尚未提交的composable/Shared字段导致编译失败；Agent窗口链大量失败与此一致；状态监控仍定位已删除rate-label。完整日志下载到 `/tmp/nexus-e2e-40218989558-logs/`，旧证据不代表当前修复已通过。当前待提交新版本并远程回归。

### 首轮远程构建反馈

提交1f21e469推送dev，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40259908812 。质量作业通过；Docker独立后端构建失败在model-sdk-request的内置fetch/Undici Dispatcher类型冲突（Node26的undici-types与显式Undici7不同），不是UI或测试断言问题。完整Docker日志/tmp/nexus-e2e-40259908812-docker.log。

修复后工作区Backend build通过（/tmp/nexus-undici-boundary-build.log）；复制backend/shared源码及固定锁文件至/tmp/nexus-backend-isolated-review，严格filtered安装后build亦通过（/tmp/nexus-undici-isolated-{install,build}.log）。此隔离构建不含Frontend DOM类型，未做本地行为测试。远程Docker实际构建/启动和8个功能分片待下一轮确认，不将编译通过记为运行通过。

### 首轮功能失败分类（40259908812）

通过分片4/5/7。产品：备份503（agent_runs approval_mode登记位置与PRAGMA顺序不符）、Custom SDK连接中（trace确认/sdk/common/version.js缺失CORS响应，静态白名单漏新SemVer依赖；改为esbuild单模块交付）、预览刷新点击被透明缩放padding截获（仅修命中，无外观调整）。

测试：模型发现入口移动及ID自动匹配禁用期输入竞态；审计自动加载后原手动刷新按钮已删除；ACP取消仍定位折叠详情旧按钮；首次SSH失败已按用户要求保留终端与按键重连；手机预览旧40px尺寸预设不适用于已授权新设计；外部Run取消使用重新进入正式会话恢复；委派非法参数当前为确定拒绝并反馈模型，夹具必须消费错误而非持续重发直到80次预算耗尽。保留拒绝无Child、唯一失败工具和模型完整回复断言。

完整失败作业日志在/tmp/nexus-e2e-40259908812-shard{3,8}.log及/tmp/nexus-e2e-job-121370361{720,744,763}.log；分片3的截图/trace下载/tmp/nexus-e2e-40259908812-artifacts3。未用本地浏览器或行为测试替代远程证据。

本批两轮源码复审完成；静态比较56张Agent表的建表列与备份注册顺序，修正后全部一致。根check、Shared/Backend/Frontend build、全量format、变更E2E严格tsc、JS与SDK产物语法检查、git diff --check通过，日志/tmp/nexus-e2e-round2-{check,build,format,types}.log。初轮静态发现SDK资产早返回缺花括号、工具列表decoder调用参数不完整，均修正重跑；不计作通过。SSH首次失败用例还验证3秒无自动重试、显式按键才发第二次连接且保持单个tab。待推送本批并远程全量复验。

### 第二轮远程反馈（40261572646）

3bb022fd对应 https://github.com/0honus0/nexus-terminal/actions/runs/40261572646 ：质量、Docker构建/启动冒烟及分片1/2/4/5/6/7通过；分片3/8各剩一个旧测试入口。前轮备份503、Custom SDK依赖交付、预览刷新遮挡均已通过真实远程回归；非法委派参数反馈、ACP审批取消、手机预览与SSH首次失败显式重试也通过。

剩余测试修正：发现按钮当前翻译为Update model list；审批不按原始JSON摘要查找，而在Tasks侧栏按工具名及实际Approve and run按钮定位。批准前展开Normalized operation核对ID/hash并打开审计；批准后核对原请求expectedVersion/operationHash及命令真实结果，并验证待审批卡片消失、历史为approved。避免对批准后已退出的待审批卡片继续点击。两轮源码审查保留原授权/哈希/版本/执行结果断言，不改产品UI或业务逻辑。完整日志/tmp/nexus-e2e-job-121375378{516,538}.log。第三轮全量远程待验。

本批仅两处既有E2E及文档变更；目标ESLint、全部已变更E2E严格tsc、目标格式及git diff --check通过，日志/tmp/nexus-e2e-round3-{lint,types,format}.log。未重跑本地行为测试或修改产品UI。第三轮将按新SHA执行完整正式工作流。

### 第三轮远程反馈（40262842979）

e2f66bdf对应 https://github.com/0honus0/nexus-terminal/actions/runs/40262842979 ：质量、Docker及分片1/2/4/5/6/7/8通过；分片3仅完整插件审批出现一次flaky，重试后命令、unknown与上传/下载完整流程均通过，failOnFlakyTests正确阻止假绿。

原trace已下载/tmp/nexus-e2e-40262842979-artifacts3，解压/tmp/nexus-e2e-round3-trace；日志/tmp/nexus-e2e-job-121378765711.log。证据：测试读取折叠状态后点击前，WS审批到达触发产品同步watch展开；测试toggle随后关闭，错误截图Tasks完全不存在而请求徽标已为1。修正为等待既有自动展开并核对Tasks可见，保留原卡片/版本/hash/审计/命令与附件断言，不改产品UI、不放宽flaky标准。两轮源码审核确认该用例是唯一waitNativeApproval后立即toggle面板入口。严格tsc、目标ESLint/格式及diff后按新SHA第四轮远程回归。

### 最终验收：第四轮全绿（40263876745）

代码提交fc5845fd97be449e11bb1b58b03ab2b9150af481，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40263876745 结论success。Checks/format/build、Docker deployment smoke、runner准备及8个Playwright分片全部success；463个用例通过，0失败、0 flaky。分片1–8分别72、42、69、36、55、49、66、74通过；分片2及3包含隔离运行的用例，计入各分片总数。审批卡片自动展开、原hash/版本与审计、命令执行、unknown、附件真实上传/验证下载全部通过。截图更新作业按未请求刷新而skipped，不是遗漏回归。

全部分片原始日志/tmp/nexus-e2e-job-121381919{843,879,881,884,905,923,973}.log及/tmp/nexus-e2e-job-121381920218.log；本轮目标ESLint、严格tsc、格式和diff通过（/tmp/nexus-e2e-round4-{lint,types,format}.log）。源码两轮复审完成；没有本地行为/E2E运行，没有更改UI设计。远程CI自动提交0f44d2b3只刷新duration-estimates，已快进同步。

本次代码审核、提交推送与远程E2E修复已完成。未部署、重启或发布应用镜像；初始v1数据库签名变化仍按H-12/D14使用新数据目录，不提供旧开发数据兼容。个人未跟踪截图不属于代码交付，保持原状。真实生产代理/Android后台等专项不因CI通过而扩大宣称已验。

## 前端无效CSS清理（2026-10-26，源码及静态）

范围：仅删除无实际消费者的样式，不修改UI效果、模板/脚本或交互。复用已安装的Vue compiler-sfc、PostCSS与selector parser做临时审查（/tmp/nexus-css-audit.cjs），扫描91个样式源、2663条规则并得到126个候选选择器。工具输出不是删除依据；人工逐一排除模板字符串、Vue Transition/Router和第三方DOM后，清理21个无引用类名对应的39个选择器，其中35条完整规则及2个由此空置的容器查询；混合选择器保留仍使用的分支及原声明。另删3个无消费者的局部变量。全局主题token、动态类及PDF.js内部变量保留。

涉及首页旧搜索/容器、Settings旧Workspace分组、Agent旧原生滑块/配置/历史控件、模型旧输入框、已取消的内联提示、快捷指令旧信息区和传输旧停止按钮等12个原样式owner。两轮源码复核核对实际消费者和全部diff；静态AST对照工具/tmp/nexus-css-review.cjs证实每个已改Vue文件的template/script/scriptSetup内容、style属性，以及全部保留选择器的声明值/顺序/at-rule条件与HEAD一致，仅排除明确批准清理项。结果/tmp/nexus-css-cleanup-review.log。

根check（含Backend包级类型检查）、Frontend生产build、全量format:all:check和git diff --check通过，日志/tmp/nexus-css-cleanup-{check,build,format}.log。临时扫描首两次因独立/tmp脚本无法解析pnpm间接依赖而失败，改用已安装依赖的实际解析路径后通过，未增加依赖或修改项目配置。按D17未运行本地行为/浏览器/E2E，不将静态AST对照冒充视觉回归；前轮463项PASS仍只对应其原提交。本次未提交、推送、部署或重启，未改个人未跟踪截图。

## CSS清理交付、dev amd64与原站点升级（2026-10-26，已完成）

代码0fc60b7b127e699efffe99c89987b39b3a78a9bf推送dev。正式E2E https://github.com/0honus0/nexus-terminal/actions/runs/40265599805 完整success：463通过、0失败/0 flaky，8分片、根质量/格式/build和Docker smoke成功；分片1–8分别58/49/52/51/57/56/67/73项，独立用例计入对应分片。各分片日志/tmp/nexus-css-final-e2e-job-121387248{795,802,808,811,833,842,858,861}.log。CI自动f5b6221f仅更新duration-estimates，已同步。

用户要求dev amd镜像，发布 https://github.com/0honus0/nexus-terminal/actions/runs/40265629589 成功，生产依赖high级审计通过。镜像ghcr.io/0honus0/nexus-terminal:dev及sha-0fc60b7b127e，仅linux/amd64；digest为sha256:29d0af1b3797a2a796a5aa7fcfb4e6f2b48f52960e60a423cb418011d763cf54，revision精确对应代码SHA。发布原始日志/tmp/nexus-css-dev-amd-publish.log。

### 原部署识别及用户明确的数据处理选择

容器Compose标签定位原部署/home/honus/product/nexus_terminal，原NEXUS_DATA_DIR为./data，公开Origin为https://ssh.honus.top。旧镜像cb693e4c、数据库signature为backend-next-v1-initial-20261023-remote-tool-installer；新镜像要求backend-next-v1-initial-20261025-agent-approvals，不能直接复用旧库。初步只拉镜像未替换服务；用户随后明确要求备份旧库、在原目录新建后导入UI/连接/快捷指令分组/Agent配置等，才执行一次性离线导入，产品没有新增兼容逻辑或修改旧库签名。

隔离容器network=none、无发布端口，用新镜像初始化schema，43张配置表逐列比对；原旧库已有执行覆盖为空、全局执行设置无记录，不需要猜测已删字段。试导入和正式最终备份导入均验证原配置逐行完全一致、foreign_key_check无结果、integrity_check=ok。保留ID、加密密文及原实例密钥；源库无Provider/聊天内容。旧模型库缓存schemaVersion=1不导入，按当前v2缓存重新建立；旧审计/通知派发及运行账本留备份，不混入新运行实例。数据目录appearance/artifacts/plugins按内容hash复制核对；原环境文件hash保持。

正式停止前后端后完整备份data/.env/Compose，再做独立SQLite备份；原data移动到维护目录previous-data，新库仍放原data路径。保留旧镜像rollback标签、原数据及失败自动回退流程；没有触发回退。正式前后端健康，image architecture/revision/digest与发布一致。

### 数据和入口验收

| 内容       | 核对结果                                                                                                                                                 |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 账号/会话  | 原账号1、原会话3，密码/因素字段及原摘要会话完整保留；短期维护验证会话finally清除。                                                                       |
| 连接       | 连接6、凭据6、主机密钥5、连接标签关联6；Proxy1/标签3保留。                                                                                               |
| 外观与命令 | 主题403、外观1、布局偏好1；快捷指令14、标签组2、关联14、原历史16保留。                                                                                   |
| Agent配置  | 内置App及政策各1、声明能力19、denylist元数据保留；Provider/聊天源记录为0。                                                                               |
| 认证读取   | 新版启动后26项实际GET覆盖设置/布局/外观/主题/连接/各凭据/命令与标签/Agent App/模型库/执行设置/政策/权限，全部200；只输出路径/状态/长度，不打印秘密正文。 |
| 公网       | 首页200且字节与容器新版index.html一致；/api/v1/status为200；无Cookie的auth/status为预期401，携维护会话认证读取为200。                                    |
| 数据与备份 | 正式库FK/integrity再次通过；完整备份tar目录可读、SHA-256匹配，原数据保留，.env未改。                                                                     |
| 日志       | 新后端启动及验证期间无error级日志；未据此宣称未覆盖的真实SSH/浏览器视觉行为已验。                                                                        |

远程备份目录/home/honus/product/nexus_terminal/upgrade-20261026T035324Z（0700）：data-env-compose-before-upgrade.tar.gz、nexus-terminal-before-upgrade.db及previous-data完整旧目录；包含实例密钥，保留root权限，不上传仓库。部署元数据deployment.json、final-import.json及final-verification.json保存在该目录；本地日志/tmp/nexus-upgrade-{prepare,trial-import,trial-http,cutover,final-http,final-check}.log。首次临时验证误用了settings/appearance及credentials复数路径，按真实路由纠正后26项全通过；最初公网检查将无Cookie的正常401误当失败，核对认证路由后按真实语义记录，不修改产品。没有输出或更换原密码、实例密钥或Provider密钥。未保留浏览器测试会话、未运行本地E2E；原个人截图保持不动。

### 挂起关闭恢复画面几何修复（2026-10-26）

截图显示恢复后的TUI底部重复提示及空白；源码核对确认快照尺寸缺失、重复PTY resize和checkpoint尺寸排队问题。既有SSH `resizing a suspended fullscreen terminal is ordered after its checkpoint`同步验证baseline尺寸先于快照、live尺寸在快照之后；保留原快照正文断言。D17下未执行本地行为或E2E。

待远程：普通缓冲区TUI/备用屏幕在同尺寸、宽窄及高低变化后挂起关闭恢复，底部提示/光标正常；恢复时切后台、重挂载及多SSH切换保留各自输出；连续resize的checkpoint按每次尺寸处理，相同尺寸不重复发送远端调整；ACK失败/被接管仍不开放输入。

静态证据：两轮源码审核覆盖快照/实时尺寸事件、预挂载缓冲、xterm解析队列及失效generation、同尺寸去重、checkpoint resize/reset尺寸捕获、ACK与背压保持；`pnpm run check`、`pnpm run build`（含Shared/Backend/Frontend）、`pnpm run format:all:check`和`git diff --check`通过。日志：`/tmp/nexus-suspend-geometry-{check,build,all-format}.log`；末次reset尺寸捕获后的Backend check/build分别见`/tmp/nexus-suspend-geometry-backend-{recheck,build}.log`。静态通过不代表截图实机/E2E已通过，本轮未重启、提交或推送；保留其它正在修改的UI/Agent文件及原截图。

### Codex挂起恢复：高延时与滚动区域定向验证（2026-10-26）

用户明确授权api.honus.top的Codex测试及高延时时序排查，本轮限定该链路。使用独立Chrome/CDP与自建测试SSH会话，未接管用户现有终端；初次共享浏览器的恢复定位存在歧义，其结果作废，后续按精确suspend ID隔离。普通静止、执行中排队、75×28窄窗口恢复，以及WS上行700ms/下行900ms（实际往返约1.9秒）均保留输入区背景，未直接稳定复现原截图。

真实Codex 0.164.0输出显示DECSTBM区域处于1–29行而屏幕共34行；SerializeAddon 0.14不保存此状态。126×34真实输出按15个块间边界快照/接续，旧路径在重绘区域未还原的切点有1287–1576个单元格差异；补齐边界后余下7项均为同色调色板16色/256色编码差异，规范化后无可见字符格差异。实际新Backend checkpoint factory及浏览器加载的新Frontend tracker分别重放15个切点，全部零差异；非手工拼接修复后缀代替实现验证。

持久回归：`tests/backend/remote/backend-next-terminal.integration.mjs`新增7个真实xterm快照接续场景（普通/备用屏、DECOM、非法区域忽略、软重置、RIS、resize），断言后续滚动后的完整屏幕字符/背景及底部输入区保留；连同原两项共9项通过。检查命令：`node --test tests/backend/remote/backend-next-terminal.integration.mjs`。既有SSH fullscreen E2E保留几何顺序断言，尚未运行本轮远程Actions。

证据：`/tmp/nexus-codex-region-tests.log`、`/tmp/nexus-codex-factory-replay.log`、`/tmp/nexus-codex-browser-replay-result.json`、`/tmp/nexus-codex-delayed-private-result.log`。原始流仅放/tmp，不提交对话内容或Cookie。源码复核两轮覆盖几何、解析屏障、scroll region与监听生命周期；末轮check/build/全量format/diff日志分别为`/tmp/nexus-codex-region-{check,build,format}.log`。实机原截图尚未稳定复现，旧Backend进程尚未加载本轮代码，不能宣称新版本端到端恢复通过；非活动缓冲区区域和任意未闭合ANSI解析状态不在本轮快照保证内。无UI设计变更；按用户后续授权提交本次修复，未推送或部署重启。

### 终端逐字符真实回显优化（2026-10-26）

源码沿前端onData→sendConnected→WS terminal.input→requireTerminal→Workspace.write→ssh2 channel及原输出链核对：前端发送/前台输出没有固定防抖；Workspace WS入口仅派发任务，不等待文件操作执行完成，不能把Platform串行消息接收误判为终端等待目录请求完成。确认SSH底层TCP未关闭Nagle，且input/resize/flow原先均重复完整授权。修正原SSH route的直连/跳板客户端与代理TCP的noDelay，并只去除上述控制操作外层重复授权；具体处理器仍完整检查身份、phase、精确attachment与挂起租约。

两轮源码复核覆盖：直连/跳板/HTTP及SOCKS代理的真实socket归属；ssh2公开setNoDelay对forward channel的无操作及外层策略；ready后设置失败的原catch销毁；输入/resize/flow在未连接、pending ACK、被接管、失效Cookie/租约过期时的授权与拒绝路径。无UI/Shared/存储变化，不添加本地预测字符，未改在途容量或输出流控。

本批沿PLAN D17不新增/运行本地行为、浏览器或E2E。待远程/明确授权专项：普通Shell与Codex、中文输入/退格/方向键在直连、跳板和HTTP/SOCKS代理及高RTT下的键入至远端回显分位延迟；大输出/文件传输并行时的交互；原身份失效、接管与pending ACK拒绝用例。已有SSH连接不会因源码修改改变TCP选项，需加载新版Backend后新建SSH再验证。静态证据：根check（含Backend包级check）及Backend/Shared build通过，本批文件ESLint/Prettier及diff通过；全量format失败项仅为并行工作区的AppIntegrationEditor.vue、SafetyNetworkSettings.vue、UiInlineNotice.vue、WorkspaceLayoutRenderer.vue，未代为格式化。日志`/tmp/nexus-terminal-echo-{check,build,format}.log`，本批文件检查见`/tmp/nexus-terminal-echo-scope-format.log`。未重启、提交推送或修改其它工作区UI/Agent文件。

### VS Code TypeAhead 移植定向验证（2026-10-26）

本轮沿用户对 api.honus.top 的终端/高延时专项授权，未运行全量本地 E2E、模型请求或修改真实 SSH 文件。复用 VS Code 固定提交 ae11932c6109d3977d78f2fe8937d861e246151d 的 MIT 核心，来源和适配差异见前端 vendor README。

定向算法回放 `/tmp/nexus-typeahead-verify.mjs` 使用实际新增模块及真实 headless xterm：11项通过，覆盖学习后本地回显、匹配不重复、不匹配回滚、首字符未确认的密码提示、退格/左右移动、snapshot撤销及晚到回显、Unicode/粘贴、备用屏/隐藏光标/滚动区内停用、分片SGR、超时、旧epoch及ACK唯一、首次RTT超过500ms可学习，以及Codex式滚动区下方输入。结果 `/tmp/nexus-typeahead-verify.log`。首次加空白格属性恢复时定向断言发现撤销遗留可序列化的空格，改为带原背景的ECH恢复，重跑通过；不把失败轮记为PASS。

复用此前真实Codex捕获流，通过实际TypeAhead模块逐块与无预测的xterm比较；先制造待确认字符，再输入真实重绘。16块、126×34屏幕逐块字符/宽度/前背景/粗体/反色均零差异，最终光标坐标及显隐一致，结果 `/tmp/nexus-typeahead-codex.log`。不把录制重放称为真实Codex交互全覆盖。

独立临时Chromium访问 https://api.honus.top，在登录页面挂载真实TerminalView隔离测试实例，无账号或SSH资源写入。抽取既有终端生命周期场景及新增3个TypeAhead场景，使用正式源模块及真实浏览器断言；13项通过：前后台重挂载与原始ACK、鼠标模式清理、UTF-8跨重挂载、PTY替换、历史snapshot排空/慢游标、后台顺序、无rAF同步TUI/尺寸、预测与不同远端结果校正、snapshot/重挂载不保留预测及密码/粘贴不预显。日志 `/tmp/nexus-typeahead-browser.log`；这是定向执行，不是正式远程Actions。新增回归位于 `tests/e2e/specs/ui/terminal-lifecycle.spec.ts`，传输观察者拒绝/退订断言同步至既有 `tests/frontend/workspace-terminal.integration.mjs`（后者仅静态检查，未运行其服务集成）。临时工具最初遇到esbuild虚拟模块external和已有Chromium版本路径问题，修正工具后执行，未修改项目测试配置。

两轮源码复核覆盖实际派发/手机修饰键、唯一发送、原始字节流控、首字符与异常序列、样本/超时、解析队列、后台/历史/断线/resize及PTY generation、挂起snapshot和订阅/定时器清理。正常UI template/style本批无变更，保留其它并行UI/Agent修改。根check（含Backend包级check）、Frontend生产build、新增E2E严格tsc、既有JS语法及本批ESLint/Prettier/diff检查通过，日志 `/tmp/nexus-typeahead-{check,build,e2e-types,scope-format}.log`；全量format仅受并行修改的UiInlineNotice.vue格式阻塞（`/tmp/nexus-typeahead-all-format.log`），未代为调整。未提交、推送、重启或部署；Android真机、任意全屏程序、所有超高RTT/代理与长时交互仍不在本次实机保证内。

### 文件管理器纵向拖动与固定命令栏（2026-10-26）

用户报告api.honus.top连接后文件管理器无法向上拖动。原因是同一纵向Splitpanes中terminal/commandBar/fileManager三项只调整相邻Pane，而commandBar只有38–42px可调整区间；仅打开pushOtherPanes又会遇到库的最大尺寸提前返回、after-pane漏算后续兄弟，以及前侧全部到最小值后重复扣减前序尺寸的问题。后两项会造成总尺寸超过100%或极限拖动丢失24%的高度，不能只改一个开关。

修复：仅含commandBar的纵向容器开启库原有推挤能力，按两侧可伸缩量传递到其它兄弟，命令栏原限制不变；pnpm patch同步Splitpanes 4.1.2源文件与实际消费的浏览器ESM产物。修正最大值判断/分配中的后序尺寸、最小值边界重复扣减。其它容器保持原相邻调整，分隔线/命中区/默认布局/UI样式不变。

在指定api.honus.top使用独立临时Chromium，先复现原开关两种状态（`/tmp/nexus-fileheight-repro.log`），再挂载真实WorkspaceLayoutRenderer、RuntimeSession和正式默认中心布局；会话保持本地idle，使用独立Pinia和本地布局ref接收真实layoutResize事件，不打开SSH/WS、不保存用户设置。600px容器内初始terminal/command/files高度354/38/207；下侧分隔条上拖后230/38/330，反向342/42/215，上侧分隔条上拖后247/42/309，锁定后完全不变。极限向上144/38/417，向下472/42/84；方向键两次后417/38/144。7个有效resize事件尺寸总和均100%，零pageerror；关闭实例并dispose本地RuntimeSession。证据 `/tmp/nexus-fileheight-actual.log`。最初隔离工具缺少active Pinia而未挂载，补上独立Pinia后执行；中途边界断言发现库漏算/重复扣减后继续修复，失败轮不作为PASS。

前端开发进程已按原工作目录、参数和环境重启并强制更新预构建依赖，后续只由Vite配置watch重新加载补丁；端口9998及api入口保持。没有重启后端。前端就绪日志 `/tmp/nexus-fileheight-vite.log`，不把开发服务重启写为生产部署。

既有正式SSH E2E `tests/e2e/specs/ssh/docker-manager-ui.spec.ts` 的Workspace布局场景新增上下拖动、命令栏高度、总百分比、终端最小尺寸及恢复断言；等待远程Actions，未运行全量本地E2E或真实SSH此新增场景。两轮源码复核核对库源/ESM一致、min/max/百分比守恒、容器选择、布局锁及原保存链。根check（含Backend包级）、Frontend生产build、变更E2E严格tsc、本批ESLint/Prettier和diff通过，日志 `/tmp/nexus-fileheight-{check,build,e2e-types,scope-format}.log`；全量format仅原有UiInlineNotice.vue格式失败，未代改（`/tmp/nexus-fileheight-all-format.log`）。本轮未按自身操作提交或推送，无用户连接/文件/布局写入。

## Agent 步骤与工具审计移除（2026-10-26）

删除正式 Host/审批卡片及 DEV 页的审计入口，撤销四个专用查询端点和 Shared 审计 DTO。保留步骤/工具状态及内部事件事务，供执行、审批、异常恢复和快照一致性校验。回归改用线程工具列表核对 ACP 和工具终态，继续验证审批 hash、命令预览、真实副作用和取消围栏；插件用例核对审计入口消失及 Run 用量仍可读取，后端 HTTP 用例核对已移除端点 404。

静态证据：根 `pnpm run check`、双端 build（含 Shared）、Agent 相关 E2E 严格 TypeScript 检查已通过；日志 `/tmp/audit-check-final.log`、`/tmp/audit-build5.log`、`/tmp/audit-e2e-types.log`。依 D17 未运行本地 Agent 行为测试，正式 HTTP/Agent E2E 和浏览器验收待 Actions，不将静态通过记为 E2E 通过。最终契约及用例收口后，根 check、双端 build、Agent E2E 严格类型、`pnpm run format:check` 和 `git diff --check` 均通过；记录见 `/tmp/audit-final-*`。

### 2026-10-26 自动图片与远程回归修正

- functional-regressions：本地受控 Provider 返回 PNG Base64，模型调用 image_models_list/image_generate，结果只允许文件事实，最终仅回答普通文字。验证审批前无预览、完成后图片实际解码/下载、刷新恢复。无需真实付费图片请求。
- panel-wheel-scaling 与 host：定位当前 IP 复制可访问名称与分开的聊天/图片模型筛选框。
- rdp-remoteapp-fullscreen：在转发唯一的创建请求回执前读取结果，避免导航后 CDP 响应体丢失，不重复变更请求。
- 传输取消：独立传输 lease 仅在获取阶段转发取消；流式 stage 等待已派发 WRITE 后用独立清理期限删除临时文件，保持真正网络故障的 unknown/清理错误。既有 Progress Display 取消与后续 baseline reset 回归验证。

本地静态检查与正式远程 Actions 证据在本次实施方案记录；未通过前不视为发布验收。

40296789507回归补正：图片受控场景显式授予context.read以读取图片模型列表；布局极限百分比换算为CSS像素误差≤1px（观察器与整数clientHeight取整），仍严格断言终端最小24%和指令栏37–43px。Progress Display用例继续真实点击拖动后的恢复按钮；仅修复按钮被分隔条遮挡的层级。已派发复制取消应显示Result unknown与核对源/目标提示，手动Remove后消失，不把受理取消等同于远端回滚；后续隔离reset必须成功。

### ZIP特殊节点与连续拖动补修（2026-10-26）

- 生产只读日志：ssh.honus.top / pve_debian两次压缩在inspectSources非常规文件预检以invalid_input失败；尚未发布本轮ZIP代码，未宣称生产实测通过。
- 原生Info-ZIP实测：普通文件、空目录、FIFO和Unix socket组成的目录，zip退出18，FIFO被忽略、socket报警且添加日志不等于实际入包；GNU tar忽略socket但收录FIFO。归档Service使用既有字面量排除参数统一跳过嵌套特殊节点，保留warning。
- 新正式回归：archive-cancel-recovery校验ZIP和tar.gz实际条目/内容与verified_warning；progress-display-archive验证真实来源删除后压缩失败Toast、两处进度无残留、恢复来源后仍能压缩；复制取消保留unknown Toast且不显示失败卡片。
- 40298917003失败复核：图片用例传错分页before游标，实际工具生成成功；分片6 trace显示第二次拖动发生在前次100ms延迟解绑前，旧timer中断新拖动。分别修复测试参数和Splitpanes真实事件生命周期，不弱化交互断言。
- 本轮本地：根check、完整build、全量format:all:check与受影响E2E严格tsc通过（日志/tmp/nexus-zip-{check,build,lint,types}.log）；正式Actions待当前提交完整回归，镜像待全绿发布。

33e1cb77 / [40302424259](https://github.com/0honus0/nexus-terminal/actions/runs/40302424259) 实际结果：质量与Docker通过，分片1/2/4/7/8通过。生成图片的预览/下载/刷新持久化通过；新Unix socket/FIFO目录ZIP与tar.gz内容校验通过；复制取消unknown Toast/隐藏失败任务通过。分片5仅新增用例没有先关闭驻留Toast导致后续点击被遮挡，修测试正常关闭流程；分片6首跑极限恢复在松手后97ms开始，100ms全页pointer-events保护吞掉mousedown，重试通过但整轮按flaky拒绝，补丁将保护缩至同步click结束后的下一任务；分片3原PDF横向滚动首跑失败、重试通过，trace记录scrollbar613px后最终缩放宽度才更新至1284px，晚到几何锚定重置left0，修复仅几何锚定保留当前横向滚动。既有产品UI模板/样式未变，原双向拖动与PDF横滚断言保留，待下一SHA完整回归。

最终产品源码 `7d66cacb397412b199ddd98cd246c4ec53336ef6` 的 [40304902706](https://github.com/0honus0/nexus-terminal/actions/runs/40304902706) 全绿：质量、Docker部署smoke、8个正式分片共469/469首次通过，零重试/零flaky。图片自动预览/下载/刷新、Unix socket/FIFO目录ZIP与tar.gz实际内容、压缩失败Toast及恢复后新任务、复制取消unknown Toast、连续双向/极限拖动、PDF横向滚动均通过。自动提交 `7f8ff3ff` 只更新 duration-estimates，无产品源码差异。linux/amd64 dev发布 [40306499771](https://github.com/0honus0/nexus-terminal/actions/runs/40306499771) 成功；`dev` 与 `sha-7f8ff3ff9e54` 已发布，OCI revision `7f8ff3ff9e54594a991e48451baafacb63991125`、实际平台 `linux/amd64` 核对通过，index digest `sha256:eeadf1ada289d8061b9fffb5dc6f80e70aa1fc9e745c5ec51acc6978e70b8196`。`unknown/unknown` 附属清单为BuildKit证明，并非ARM运行时。未部署生产。

### 原生压缩直接递归与限制移除（2026-10-26）

生产只读核对：后端已运行revision `7f8ff3ff9e54594a991e48451baafacb63991125`，最新压缩失败为 `limit_exceeded`，位置 `/dist/modules/remote/files/model/file-resource.js:436`，对应 `scanEntries` 的应用条目预算；不是旧镜像未更新。本轮直接移除压缩源树预扫描、20,000条目/64层预算和原生进度固定上限，不新增替代阈值。所选路径直接交给原生ZIP/TAR；进度为工具输出观察，成功由退出及产物核验决定。无UI源码变更。人工规则H-20及工程规则E-08.1同步，防止无实测依据新增限制。

正式回归新增：20,005个文件及70层子目录压缩，检查ZIP实际条目、末项/深层文件正文、完成后SFTP stat，并通过夹具OPENDIR观察断言压缩不遍历SFTP目录；既有socket/FIFO用例改为验证原生行为，ZIP跳过两者并核验warning，TAR保留FIFO元数据、跳过socket，普通文件正文保持。取消/后续压缩与目标位于源目录内的既有断言保留。

两轮源码复核覆盖Service→Model→Native完整参数迁移、无人消费类型删除、随机原生退出标记与进度隔离、非零ZIP独立zip -T、临时输出字面量排除、取消/未知与清理；未以进度数作为源树完整性证明。静态检查：根check、完整构建（前端无后续源码变化）、最终Backend构建、全量format:all:check、变更E2E严格TypeScript及git diff --check通过。最终日志 `/tmp/nexus-native-archive-{check,backend-build,format,e2e-types}.log`；本轮正式远程Actions尚待执行，不沿用前轮469项通过作为本轮证据。未更新生产容器。

首轮 [40310375522](https://github.com/0honus0/nexus-terminal/actions/runs/40310375522) 对应fd3c2c95：质量/构建/Docker及6个分片通过。新增大目录用例3.3秒通过，实际ZIP20,077项与两处正文、零SFTP OPENDIR、完成后stat均通过；原生ZIP/TAR特殊文件行为通过。分片3缺失源后下一次压缩和分片7失败Toast两项各失败两次，均为代码问题：命令已退出且私有输出不存在/已删除，压缩catch仍包为operation_unknown并阻塞持久突变claim，前端显示未知提示。新增FileArchiveDiscarded仅在未开始发布、原生退出已确认、私有输出已清理、原异常非unknown时产生；最终专属lease关闭失败仍升级RemoteResourceCleanupFailure；已尝试rename/replace、失联或未知原异常不降级。协议用例保留后续真实ZIP读取并明确断言普通失败消息，UI用例不修改。待下一SHA完整回归，失败轮不作发布依据。

失败收尾补修静态：根check、Backend构建、全量格式、E2E严格TypeScript与diff检查通过，日志 `/tmp/nexus-native-recovery-{check,build,format,e2e-types}.log`。两轮复核确认具名确定失败只在私有输出删除后产生，实际lease关闭失败可覆盖并保留全部因果，批量claim分类沿既有RemoteFileFailure分支结算；既有UI失败Toast用例不改。正式回归待补修提交。

## 文件容量清理后续回归

aba02d2f正式Actions 40316497521：质量、构建、Docker及分片1/3/4/5/7/8通过；分片2的mutation fixture使用了重复cwd路径，下载用例仍期待已移除的8任务429；分片6目录force删除把1小时剩余期限传入SSH execute时，被旧5分钟参数检查拒绝，Model因派发状态不明退役文件资源。三项均已修正，用例保留九路重叠下载、迟到OPEN回收、票据内容和失败后恢复；目录删除新增刷新后seed可见及无失败Toast断言，防止列表报错消失造成假通过。最终新SHA正式回归待执行，不复用旧PASS。

清理复核：已移除的容量常量、校验函数及独立资源准入集合全仓引用为零；Shared子项索引按实际来源验证，后台传输子项继承父任务期限。原取消/晚到资源/关闭失败仍由原owner追踪，未修改UI设计。SSH execute仅保留Node setTimeout有符号32位毫秒表示范围，避免溢出变成约1ms，不再自设5分钟上限。

动态清理增量：删除scan无消费者容量参数及专属接口；前端upload准备64批、20,000上传任务和64复制/归档任务门槛同步移除。前后端上传准备集合按既有有效期主动清理，前端仅单个最近到期timer并在断线/dispose回收。新增正式Actions入口执行既有真实浏览器受控协议边界专项，检查65批准备与65复制任务独立完成；这类接缝回归不替代正式SSH/SFTP功能链。最新SHA待远程验收。

141836cf的40318510258：质量/构建/Docker及全部7个非分片2通过，目录删除与9路迟到OPEN/票据恢复均首跑通过。分片2仅新增专项夹具失败：SQLite测试在reconcile后错误调用held专属settle；codec动态import触发Playwright TS/ESM解析差异。改为先完成held结算/重用再reconcile，并验证blocked不能被settle释放；Shared codec与已有测试统一静态导入，未放宽存储围栏或产品校验。

a0cb4f49正式40319856905全部质量/构建/Docker和8个分片通过，新增持久4100 claim、Shared257来源/65目标、65前端准备批/65复制任务与原文件协议专项首跑通过，远程工作流成功；3381d6b1仅自动耗时更新。当前1025来源和动态展开字节增量仍需新SHA完整回归，不将本次PASS扩为未提交增量通过。

### 跨服务器直传优先与中转共用链（2026-10-26）

跨会话剪贴板与发送到服务器共用copyRemoteEntries/RemoteFileModel.copyDirect。正式新增direct-and-relay-transfer六例：两个入口各测源到目标可达/不可达，8MiB单ZIP二进制的中间进度、精确SHA256、实际rsync/sftp方法；夹具记录直传零SFTP READ字节，中转READ字节等于文件大小；另测已派发原生失败/取消不回退且移动源保留。测试限速仅用于稳定观察中间进度，不作生产吞吐证据。http专项增加原生凭据清理与流式取消回归，不依赖sshd。

前轮40321121777质量/构建/Docker成功，分片6/8各一项首次失败、重试通过，整轮因flaky拒绝。分别为响应式按钮定位未过滤可见性，以及保护API后台401先卸载页面而测试还等待Hide；本轮修测试真实入口和401观察，保留最终功能断言及原UI。当前批次行为待正式远程Actions，不复用前轮PASS。

两轮源码复核覆盖直传前只读连接探测、清理失败禁止回退、原生stderr排空/初始化失败退出等待、SFTP顺序流水线/ACK后清理、双端授权、源删除重验。根check（含Backend包级）、完整build及最终Backend build、全量format、变更E2E严格tsc、mjs语法和diff通过；日志/tmp/nexus-direct-final-*。最初E2E类型命令未显式加载Node类型，补types/typeRoots后通过；本地未运行行为测试，遵守D17。pve_debian到amd生产网络吞吐尚未实测；按D20不发布、不更新生产容器。

直传首轮be72f173/40329384553：质量、Docker和5分片通过；原生清理专项通过。分片5同endpoint原路径copy被新冲突检查拒绝；7/8发送使用1小时任务期限建立SSH被底层参数拒绝，随后预派发失败误归unknown导致reset连锁失败。修复原路径copy回退、15秒连接阶段及确定前置失败分类，不放宽真正未知或清理错误。新增目录copy专项200文件精确内容/父路径每任务仅一次检查；上传profile逐组验证32子目录仅33次LSTAT，嵌套8父+32子仅41次，重复任务仍重新读取。发送UI回归验证零前置工具请求，保留真实方法/部分失败/内容断言。追加源码及正式新SHA结果待记录；不发布。

追加静态最终：根check、完整build、全量format、变更E2E严格tsc（显式Node类型及前端@路径）、新增fixture语法/diff通过；日志/tmp/nexus-confirm-review-*。初次构建发现不可达shutting_down比较，已删除；最初E2E命令缺@路径，使用临时配置补齐后通过。行为仍待新SHA正式Actions。

最终验收：产品源码2b64a167的正式[E2E 40331990551](https://github.com/0honus0/nexus-terminal/actions/runs/40331990551)全部成功，质量/构建/Docker及8个分片通过，无重试/flaky。复制与发送各两种路径的实时进度、SHA256、直传零SFTP READ、中转精确READ字节通过；已派发失败/取消保留源、不二次中转通过；目录copy 200文件内容/每任务父检查一次、上传24组profile精确33/41检查次数及失败恢复通过，发送UI零前置工具检查且部分目标失败不影响成功目标。652630f9仅CI耗时更新，已快进同步；工作区交付不包含发布/部署，生产吞吐仍未实测。

### Agent 输入区状态栏整合（2026-10-26，本地静态）

将 Token 统计、上一条／下一条和回到最新消息纳入聊天输入区共同外框。两轮源码复核确认全部事件、显示条件和按钮禁用表达式保留；UiButton 默认 button，不触发表单提交；Token 弹层沿原 portal，宽度测量仍归原 form，状态行进入既有窄屏容器查询。根 `pnpm run check`、`pnpm run build:frontend` 和 `git diff --check` 通过，日志 `/tmp/nexus-agent-composer-{check,build}.log`；全量 `pnpm run format:all:check` 通过，结果记录于同前缀 `format.log`。遵守 D17 未执行本地行为测试，视觉、窄屏与跳转实测待远程；未提交、未发布或部署。

### 手机 Agent 会话抽屉背景（2026-10-26，本地静态）

窄屏 `agent-hub-window <= 760px` 中的会话侧栏改用主题 header 背景，覆盖玻璃材质的透明混色；桌面、宽度、层级、遮罩及 inert/显隐保持。两轮源码复核覆盖选择器作用范围、CSS layer 优先级和默认深浅主题。根 check、前端 build、全量格式与 diff 通过，结果见 `/tmp/nexus-agent-sidebar-{check,build,format}.log`；未本地运行行为或视觉测试，未提交、发布及部署。

### 前端冗余功能门槛（2026-10-26，本地静态）

移除连接创建/导入/导出仅前端500项与本地1MiB上限、附件10项及多选静默截断、公钥确认排队64项拒绝、传输详情5项裁切及目录读取8个在途拒绝。协议分批、逐项严格解码、权限/取消/未知结果保护及缓存LRU保留，UI布局与样式未改。两轮源码复核覆盖导入全批预检/部分成功回执、串行上传首失败停止、信任队列取消、目录去重/失效/真实错误传播、传输滚动容器。

新增 `ui/frontend-capacity.spec.ts`：501项且超过1MiB脚本保留最后项，末尾无效项仍拒绝；12个慢目录读取、同路径去重、真实权限失败、失效晚结果与关闭后读取。仅加入正式远程回归，遵守D17未本地运行行为测试。根check、前端build、新回归严格tsc及diff通过，证据 `/tmp/nexus-frontend-limits-{check,build,types}.log`。首次测试类型检查缺Vue声明，临时静态配置补声明后通过；全量格式首次发现测试方法间距，已按规则修正且全量格式重新检查通过，结果见 `/tmp/nexus-frontend-limits-format-final.log`。未提交、推送、发布或部署。

### 列表记录可达与分页完整性（2026-10-26，本地静态）

传输API删除累计160项协议拒绝，保留逐页严格解码、递增游标及跨页重复ID拒绝；Agent会话搜索沿既有游标串行读取后续页，不再只查首50条，清空搜索/失活/禁用/未决写入停止新页，失败进入原重读围栏。未改模板、样式或布局。两轮源码复核包含刷新/搜索变化、分页期间失活、错误不自动重试、旧结果归原owner，以及其它列表的分页/完整入口。

新增 `ui/list-pagination.spec.ts`：浏览器真实API模块读取161项、21个协议页，跨页重复记录拒绝；创建51个真实Agent会话，搜索位于第二页的会话，注入下一页503后经原Retry恢复。正式远程用例尚未运行，本地仅静态。根check、前端build、新增两份回归严格tsc及diff通过，证据 `/tmp/nexus-list-pagination-{check,build,types}.log`，全量格式检查通过，结果见同前缀 `format.log`。未提交、推送、发布或部署。

### 跨服务器剪贴板页面实时进度（2026-10-26，本地静态）

`ssh/direct-and-relay-transfer.spec.ts` 新增两个浏览器用例，分别覆盖原生直传和不可达时的SFTP中转：登录、连接两个SSH标签、文件管理器复制、切换目标标签并粘贴、确认凭据交付。传输真实8MiB样本，沿用夹具带宽控制，DOM观察要求至少两个递增的中间百分比与正确字节总量；通过正式Workspace codec核对同一任务的实际字节进度及completed，随后确认卡片自动退出，核验源和目标SHA-256一致。完成卡片会立即退役，不要求瞬态100%必须绘制。另核对直传零SFTP READ、中转READ字节精确等于样本大小，保存DOM/WS及路径证据附件。

两轮复审修正第二连接使用Workspace新建标签，避免整页导航销毁首会话；登录使用浏览器context.request共享认证。根check、全量format:all:check、目标E2E严格TypeScript及diff通过，证据`/tmp/nexus-clipboard-progress-{check,format,types}.log`。本批仅测试和文档，无产品/UI代码变更；遵守D17未执行本地行为测试，新增场景待正式远程Actions，不引用前轮PASS作为本批结果；未发布或部署。

首轮25561d1b / [40340550595](https://github.com/0honus0/nexus-terminal/actions/runs/40340550595)：质量/构建/Docker与7分片通过，新增前端容量及列表分页回归通过；分片2新增直传/中转UI两例均在打开目标文件管理器前置断言失败，重试相同。trace/error-context明确已有可见目标dialog及目录，helper却以全文“File Manager”的first匹配首会话隐藏编辑器提示。替换为既有可见dialog定位，实际用户操作、进度/内容和路由证据断言保持。此轮不算验收通过，待修正后新SHA完整回归。

可见弹窗修正静态：根check、全量format:all:check、目标E2E严格tsc、ESLint与git diff --check通过，日志`/tmp/nexus-e2e-visibility-{check,format,types}.log`。产品代码无新增变化，无需重复产品构建；待新SHA正式回归，不发布。

第二轮1e9f8bac / [40342500710](https://github.com/0honus0/nexus-terminal/actions/runs/40342500710)：质量/构建/Docker、7分片及中转UI进度/哈希首跑通过。直传原生进度正常，9.4秒后SFTP核验not_found并发出failed/operation_unknown；两次相同。fixture的remapTransferExecPaths仅替换单独绝对路径，rsync -s的user@host:/folder-seed/目的路径经协议发送，没有在发起端映射到测试虚拟根，接收端exec无法重写协议内路径。修正夹具远端参数映射，保留真实原生传输、限速、最终SFTP核验及哈希；未降低产品unknown围栏或改UI。待新SHA完整验证。

夹具远端路径修正静态：根check、全量format:all:check、MJS语法、目标ESLint与diff通过；日志`/tmp/nexus-e2e-peer-path-{check,format}.log`。两轮源码复核确认实际rootDir路径不重复映射、原凭据临时目录不变、旧协议路径与新页面虚拟路径归同一fixture文件。无产品源码变化。

第三轮b1ba1399 / [40345176173](https://github.com/0honus0/nexus-terminal/actions/runs/40345176173)：质量/构建/Docker及7分片通过，直传和中转页面用例分别17秒/16秒首次通过，分片2全53项通过；DOM多个中间进度、实际总字节、WS completed后卡片退役、源/目标SHA-256及零/精确SFTP READ均通过。分片7现有connection-create失败后重试通过（整轮flaky拒绝），原因是浏览器response.json的CDP Network.getResponseBody返回No data found；页面快照仍有SSH connection failed错误结果。改测试一次性route.fetch捕获真实后端422正文并严格解码，route.fulfill交付同一响应；不重发、不伪造返回、不删除正文或UI断言。新SHA全量回归待验。

连接表单响应采集修正静态：根check、全量format:all:check、目标E2E严格tsc、ESLint和diff通过，日志`/tmp/nexus-e2e-connection-reply-{check,format,types}.log`。两轮复核一次性路由只覆盖失败测试POST，原请求内容/认证和真实响应保留，后续正常测试无拦截；无产品变化。

### 本批最终正式验收（2026-10-26）

产品/测试源码`dd7a558b572a4bb510ca70531d95f691967a7604`的[Actions 40347041664](https://github.com/0honus0/nexus-terminal/actions/runs/40347041664)全部成功：质量、生产构建、Docker部署冒烟和8个分片共494项首次通过；完整日志核对retry_entries=0、flaky_summaries=0，证据`/tmp/nexus-e2e-40347041664-all.log`。新增跨服务器复制粘贴页面直传17秒、中转16秒首次通过，完整覆盖DOM递增百分比/8MiB总字节、正式WS completed及卡片退役、源/目标SHA-256、直传零SFTP READ及中转精确READ字节。连接创建表单失败/成功/真实持久化全链4.5秒首次通过；501项/>1MiB脚本、12个慢目录、161条传输21页与重复拒绝、51会话跨页搜索及503后Retry恢复通过。

本次修复的远程失败均归测试：SSH多标签可见弹窗定位、rsync -s虚拟根路径映射、CDP响应正文采集；原产品UI设计、内容核验、unknown围栏和全部功能断言保留。`f340063f`只更新CI耗时估计并已同步本地。前述“待验”记录保留对应轮次边界，本批功能远程已验收；专项视觉未执行。本轮未发布镜像或部署，用户自行增删截图未纳入提交。

### Agent 输入框外侧玻璃底色（2026-10-26，本地静态）

按用户指定doc截图，移除AgentAppSurface输入区footer的ui-glass-chrome材质类，使外侧不再铺满导航玻璃底色、渐变和内高光。两轮源码复核确认只改该footer的一个类，输入框自身边框/焦点反馈、原间距/响应式尺寸、Token与跳转控件、公共玻璃材质定义和其它界面保持。USAGE对应输入区章节已同步。根check、前端build、全量format:all:check和diff通过，日志`/tmp/nexus-agent-footer-{check,build,format}.log`。按D17未运行本地行为或视觉测试；不为单项材质删除新增行为用例，不沿用前轮494项通过作为本轮证据。未提交、推送、发布或部署。

### 矮状态面板网络读数（2026-10-26，本地静态）

按doc服务器状态截图，沿原max-height:210px分支将网络标题与上下行速率改为左右同排；移除network-reading的0.68em父字号，将数值从0.58em恢复为与紧凑指标一致的0.76em，箭头保留独立字号及两方向间隔。紧凑加载骨架同步单行。两轮源码复核检查普通/窄栏/缩放规则优先级、趋势模式隐藏速率并保留网卡名、方向/完整aria-label与title、固定数据与点击入口未改。根check、前端build、全量format:all:check及diff通过，日志`/tmp/nexus-status-network-{check,build,format}.log`。D17下未本地运行行为或视觉测试，本轮不新增样式专用行为测试，不沿用旧Actions结果作为视觉证据；未提交、推送、发布或部署。前轮Agent footer样式修改保留。

### Agent 输入框上方独立控件（2026-10-26，本地静态）

按用户最新布局要求将Token、回到最新、上一条/下一条状态块移至form之前；只保留各自全局控件，无整条底色或边框。原footer透明表面保留。composer容器声明从form移到既有外层agent-composer-area，使上方控件和输入工具栏继续按相同可用宽度响应式收缩，不依赖整个聊天面板宽度；form测量ref、提交、键盘、详情弹层和导航条件/事件保持。两轮源码复核包含窄屏容器查询、Popover portal、按钮类型及既有E2E定位无失效消费，USAGE共同外框描述已按最新选择更新。根check、前端build、全量format:all:check与diff通过，证据`/tmp/nexus-agent-controls-{check,build,format}.log`。按D17未运行本地行为或视觉测试，不将旧轮次494项PASS当作本轮结果；未提交、推送、发布或部署。

### Agent 控件与紧凑网络读数交付（2026-10-26，正式远程通过）

产品提交 `7865bfc159b0ca750f80d06f93d01125576c695d` 的正式 [E2E 40355305638](https://github.com/0honus0/nexus-terminal/actions/runs/40355305638) 全绿：质量、格式、生产构建、Docker 部署 smoke 和全部 8 分片成功，共 494 项首次通过，无重试或 flaky。日志 `/tmp/nexus-ui-dev-e2e.log`；不把功能回归扩大为专项视觉验收。`a797ecd2` 只自动更新测试耗时估计，无产品代码差异，已快进同步。

用户随后授权的 [dev amd64 发布 40357533124](https://github.com/0honus0/nexus-terminal/actions/runs/40357533124) 成功，生产依赖审计通过。发布标签为 `ghcr.io/0honus0/nexus-terminal:dev` 和 `sha-a797ecd2bf79`，索引摘要 `sha256:5bff81c96b9d8cbd6f9e39f97a12ac00014d7f8c2d2a23126bae97527352a488`。通过 `docker buildx imagetools inspect` 核对实际平台 `linux/amd64`，镜像配置 OCI revision 精确为 `a797ecd2bf7967541e5ee52acfa031fd683d5845`；附属 `unknown/unknown` 清单为 BuildKit attestation。证据 `/tmp/nexus-ui-dev-publish.log` 与 `/tmp/nexus-ui-dev-image-config.json`。未更新服务器容器，个人截图增删未提交。

### 文件管理器路径栏垂直对齐（2026-10-26，本地静态）

路径原生输入框使用 flex stretch 跟随栏内高度、清除原生 margin，行高由 1 改为 normal，保留栏高、字体大小及各响应式断点。两轮源码复核确认左侧图标与父层 items-center、输入/导航/历史事件及焦点反馈保持。根 check、前端 build、全量 format:all:check 与 git diff --check 通过；日志 `/tmp/nexus-path-align-{check,build,format}.log`。按 D17 未执行本地行为或视觉测试，不沿用前轮 Actions 作为本次对齐修复的行为证据。未提交、发布或部署。

### 跨服务器安装准备与 SCP 性能（2026-10-26）

根因：amd 缺 rsync，RemoteFileModel 将 auto 强制映射为 rsync，阻断 Native adapter 原有 SCP 候选，退至 SFTP 中转。现在原样传递 auto，复制与发送复用已有远端依赖确认；用户跳过 rsync 安装后，普通文件再检查 SCP，跳过 SCP 后才中转。自动目录在 rsync 不可用时保留 SFTP 链接语义；不为此扫描目录。仅 SCP 单文件控制通道启用 PTY，原生百分比换算字节，最终仍核验目标；sshpass 仅包装 SCP 的 SSH 子进程，0700私有启动脚本与原凭据一起清理。

真实限定专项：源 pve_debian `/root/.hermes.zip` 1,665,738,475 bytes，目标 amd 的独占临时目录，原用户源与目标文件未改。原生 SCP 3.179秒/524 MB/s；最新 NativeServerTransfer 自动选scp，含探测/清理3.953秒/421 MB/s，原生进度32%/66%/100%；同文件 copyRemoteEntries SFTP中转10.222秒/163 MB/s，测试Node CPU user8.96秒/system3.25秒。两种路径及原生样本 SHA-256均与源一致，文件数据未损坏。SFTP对照进程位于VM，并非生产容器，未复现生产50 MB/s，不能以此作为浏览器端到端或稳定吞吐承诺。证据 `/tmp/nexus-transfer-{native,relay}-perf-result.json` 与 `/tmp/nexus-transfer-perf-hashes.json`；已清理本次自建临时数据及含凭据的临时测试脚本，原文件保留。

两轮源码审核覆盖安装跳过/失活/离页、网络拒绝延后、重复确认、auto选择、链接语义、SCP认证/原生进度/清理、已派发失败不换路径及fixture真实SCP进程与虚拟路径映射。根check、完整双端build、新回归严格tsc、fixture `node --check`、全量格式及diff检查通过，日志 `/tmp/nexus-transfer-final-{check,build,types,format}.log`。新正式回归覆盖两个协议入口rsync/scp/sftp，页面安装rsync、跳过改SCP、两工具都跳过改中转，保留真实字节/SHA及零SFTP READ断言；本地未运行这些E2E，待新SHA正式Actions，不引用前轮494项PASS。CDP9223/9224仍是未认证的api登录页，浏览器入口未验；未重启后端、提交、推送或发布。

### 远端工具默认选择、归档依赖与安装全流程（2026-10-26，本地静态）

逐项核对跨服务器粘贴、发送、ZIP/tar.gz/tar.bz2压缩与解压、普通SFTP文件操作、目录下载、服务器状态、Docker和Agent执行。修正ToolService的auto检查提前选择现有SCP、跳过默认rsync安装提示的问题，客户端严格验证预期工具；前后端共用archiveToolRequirements，归档一次只读预检包含压缩器及校验/快照/链接工具，早于写入；Native/Installer共用GNU能力探测；Shared缺失工具名取值补齐gzip/bzip2/grep/cp/ln，失败事件保留具体原因。普通SFTP不依赖这些可选工具，下载打包由后端归档库处理；Docker daemon与用户自定义命令没有相同默认候选/安装遗漏，本轮不改变其交互或自动安装策略。

新增remote-tool-flows：HTTP auto默认rsync安装计划；协议侧缺gzip/bzip2与ZIP逐项缺zipinfo/od/grep/cp/ln，验证COMMAND_NOT_FOUND/实际工具名及零归档进程；页面ZIP/tar.gz/tar.bz2安装后真实输出内容，root/免密sudo/密码sudo，错误密码、安装退出失败、成功退出但工具仍缺失、取消、无包管理器/无权限，以及存在非GNU tar时安装再继续。ZIP解压辅助工具安装后验证实际UTF-8内容；安装前/失败后均无原操作派发。扩充direct-and-relay-transfer的发送页面rsync安装、跳过改SCP、再安装SCP与离页不派发，保留真实方法/内容哈希；目录回退验证嵌套和根符号链接保留。包管理器安装由受控SSH夹具模拟，传输、原生压缩解压和文件读写仍真实执行；不在CI宿主实际apt安装或修改软件源。

两轮源码审核覆盖全部依赖消费者、Model/Platform隔离、协议字段、默认工具优先、取消/未知结果、提权密码stdin、工具安装后再次核验及测试夹具。复核修正新用例同target/peer ID非法前置与夹具对普通命令身份的影响，保持产品UI。根check、Shared/Backend及Frontend构建通过，日志 `/tmp/nexus-all-tools-{final-check,backend-build,frontend-build}.log`；新增/修改E2E严格TypeScript、fixture node语法与diff通过。21份生成的工具/归档脚本通过sh -n，16组夹具提权/缺工具/无包管理器变体通过bash -n，均未执行脚本内容，证据 `/tmp/nexus-all-tools-shell-syntax.log`。全量格式通过，日志 `/tmp/nexus-all-tools-final-format.log`；E2E类型结果 `/tmp/nexus-all-tools-final-e2e-types.log`。最初前端检查发现未重建Shared导出和残留清单赋值，修正并完整检查通过；首次格式检查发现夹具两处函数间距，已修正。

按D17未运行本地行为或E2E。本批新增场景待新SHA正式Actions，不能引用旧494项或上轮真机SCP吞吐作为本批验收；未重启、提交、推送、发布或部署。前轮路径栏修改与个人截图增删保留。

### 图片生成 HTTP 400 内容审核拒绝（2026-10-26）

用户指定 ssh.honus.top 的图片失败已通过宿主只读日志及 SQLite 关联：部署镜像 revision 为 a797ecd2bf7967541e5ee52acfa031fd683d5845，Run `25e2515b-f3bb-4e29-8ac7-c08af21c2cda` 的 image_generate 使用 gpt-image-2.5，约 43 秒后失败。对应上游 Images 请求在 UTC 16:44:56 返回 HTTP 400，日志明确说明安全系统拒绝并标记 sexual；发生在供应商生成接口，未进入 Artifact 保存或前端预览。未重放该提示词、未发起付费验证、未修改生产记录或部署。生产日志未保留返回 JSON 的结构化 code，因此该字段的线上透传仍需后续实际拒绝请求核对，不把日志中的 message 当作稳定错误协议。

源码在 SDK Adapter 识别结构化 moderation_blocked/content_policy_violation，Provider Model 转换到已有 PROVIDER_CONTENT_FILTERED，Run 使用 model_content_filtered；设置与聊天的三语文案说明请求或生成结果遭内容审核拒绝。SDK 原始正文和 cause 不进入协议或日志正文，未知 code 不通过正文字符串推断。依据为 [OpenAI 图片内容审核文档](https://developers.openai.com/api/docs/guides/image-generation#content-moderation)。不改变图片不重试及已派发 unknown 的现有规则，不改 UI 布局、样式或控件。

新增正式远程待测场景：

- `agent/functional-regressions.spec.ts`：分别验证 moderation_blocked、content_policy_violation、以及正文包含已知代码但 code 未知的 HTTP 400；必须返回对应安全失败码、不泄漏 fixture 私有正文、无 generatedImageId 或成功图片预览；重载保留提示且图片请求仍只有一次。
- `agent/provider.spec.ts`：两种已知拒绝在图片模型测试中返回 PROVIDER_CONTENT_FILTERED，不泄漏私有正文、不重试。
- 原图片成功用例保留，继续验证生成后的自动预览、下载字节和刷新恢复。图片 fixture 仅增加有限错误场景与独立计数，不使用真实上游或生产提示词。

两轮源码审核完成：第一轮核对 SDK→Model→Run/设置的有限失败转换、cause 与原取消/清理/不重试语义；第二轮核对图片落盘先后、首个失败与持久失败投影、重载无重发、未知 code 安全兜底，并补齐诊断日志 content_filtered 白名单。根 `pnpm run check`、双端 build、`pnpm run format:all:check`、新增用例严格 TypeScript、fixture `node --check` 和 `git diff --check` 均通过；证据为 `/tmp/nexus-image-rejection-final-{check,backend-build,frontend-build,e2e-types}.log` 与 `/tmp/nexus-image-rejection-format.log`。按 D17 未执行本地行为测试，新增 5 个用例尚未在远程 Actions 验证；未部署，不将源码或静态通过作为线上修复验收。

### 矮服务器状态面板网络读数间距（2026-10-27）

已读取用户 doc 截图：服务器状态处于矮面板单行模式，网络上下行读数均出现省略号。用户授权缩小左右留白与字体；改动仅在原 `max-height:210px` 容器分支，收紧非趋势内容边距、卡片内距、图标/标签/上下行间隔，并将速率字号结合实际容器宽度计算。正常高度布局、趋势内容留白、速率格式、配色和完整 title/aria-label 保留。

两轮源码复核覆盖容器查询、极窄面板隐藏图标规则、趋势选择器优先级与原状态缩放：数值字体只调整本层，上限不因缩小面板而反向增大；不增加 JS 测量或采样请求。根 `pnpm run check`、前端构建、`pnpm run format:all:check` 及 `git diff --check` 全部通过，日志为 `/tmp/nexus-status-compact-{check,build,format}.log`；遵循 D17 不运行本地视觉/浏览器或行为测试。本批实际待验为截图尺寸下两项速率与单位无截断，及宽窄拖动、滚轮缩放、展开趋势后的原布局。

### 远端工具准备、SCP 进度与图片拒绝诊断正式验收（2026-10-27）

产品/测试提交 `0f174219ca0cdac181035d57a33b42b8ec339732` 的正式 [E2E 40382042043](https://github.com/0honus0/nexus-terminal/actions/runs/40382042043) 全部成功：质量、格式、双端构建、Docker 部署 smoke 与全部 8 分片，共 526 项首次通过。逐分片日志 `/tmp/nexus-e2e-fourth-shard{1..8}.log` 核对重试 0、失败条目 0、flaky 摘要 0。

本轮三次失败回归修复均归测试：SSH exec 未转发 EOF 导致 SCP sink 无法退出；SCP/mkdir 的虚拟路径与 SFTP 不一致导致完成核验找不到目标；夹具缺 READLINK/SYMLINK。另外两个首次失败后重试通过的页面用例在标签激活 animation frame 前沿旧 active surface 操作，补等待目标标签 aria-selected=true。保留所有原产品 UI、进度/字节/哈希/元数据/链接断言、超时与 unknown 保护，没有扩大超时、强制点击或跳过完成核验。

最终回归确认：clipboard/send 原生 SCP 分别 13 秒/11 秒首次完成；页面 relay、skip-rsync、skip-all 均 16 秒首次完成；发送入口准备/安装/跳过/离页、目录及根相对符号链接回退通过。工具依赖与提权流程、归档格式/辅助工具、两种已知图片内容审核码与未知码安全兜底，以及原图片成功预览均通过；图片拒绝不重放、不泄漏上游正文或生成伪成功预览。此处行为验收不等于状态面板截图尺寸的专项视觉验收。

`0695d0bf1f24fb21d157924d620c8fb458dc7177` 只自动刷新测试耗时估计，已快进同步，无产品代码差异。[dev amd64 发布 40383423178](https://github.com/0honus0/nexus-terminal/actions/runs/40383423178) 已成功，生产依赖审计通过。标签 `ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-0695d0bf1f24` 的索引摘要均为 `sha256:059d333a3fa22f81c4fbae18d0b8053c4c3234dfd0dc5649a010e5c7235df0fb`；实际镜像平台 `linux/amd64`，OCI revision 精确为 `0695d0bf1f24fb21d157924d620c8fb458dc7177`，附属 unknown/unknown 项为 BuildKit attestation。证据为 `/tmp/nexus-release-publish-full.log`、`/tmp/nexus-release-image-inspect.txt` 和 `/tmp/nexus-release-image-config.json`。本轮不更新服务器容器，个人截图增删未提交。

### Agent 会话列表删除按钮居中（2026-10-27，本地静态）

NativeThreadPanel 列表行为 items-stretch，全局 UiButton 固定高度配 my-1 使右侧按钮靠上；按钮改用 self-center 并移除垂直外边距，按整行居中。全局按钮尺寸/危险色、禁用态、再次点击确认及选择/搜索事件保持，USAGE 对应章节已同步。两轮源码复核、根 check、Frontend build、全量 format:all:check 及 diff 通过，日志 `/tmp/nexus-thread-delete-align-{check,build,format}.log`。遵循 D17 未执行本地浏览器或行为测试，桌面/手机实际视觉待验；不以之前 526 项通过作为本次样式验收，未提交推送或发布。

### Agent 工具卡片调用详情（2026-10-27）

本批新增单调用认证 GET，卡片展开后展示完整格式化参数 JSON 与持久失败码对应说明；加载失败仅重读详情，取消/未知不宣称远端回滚。源码两轮核对范围为 user/App/Run/tool 身份、Shared 严格解码、逐字段投影、原列表容量、失败码白名单、页面失活/卸载取消及 revision 晚响应保护；没有 schema 改动。

按 PLAN D17 未新增或运行本地行为/浏览器/E2E。正式远程待验：成功/失败/取消/未知调用，空对象与长参数/Unicode/换行/HTML 字符，失败详情读取后重试，展开/收起与切换会话/账号时的旧响应，以及执行中卡片状态更新；身份错配和越权应拒绝。本批根 `pnpm check`、双端 `pnpm build`、`pnpm format:all:check` 和 `git diff --check` 通过，日志为 `/tmp/nexus-tool-details-{check,build,format}.log`；不引用前批 526 项通过作为本批验收。

### Agent PHP/Typecho 规划任务与资源错误分类（2026-10-26）

本轮按用户明确要求，只读核对 ssh.honus.top 所在线上指定线程 `4b7dd2b9-bdfc-4064-8c16-e1cd21471938`、Run `8cd50043-c9dc-40f4-ad0a-9dc3abdc3f0c`。原提示要求“先定好计划”：Run completed，12 个模型步骤、15 次只读工具调用，无部署/启停/写入工具；其中 1 次 `file_list /home/honus/product/npm` failed，持久结果为 tool_target_unavailable，随后同 SSH 的正确父目录与 Compose 读取成功。宿主只读 ls 确认该路径不存在，实际目录为 `/home/honus/product/nginx_proxy_manager`，因此这是资源 not_found 被误报目标不可用，不能据此认定 SSH 断线。

计划明确注明仅从 Compose 判断结构且待核对运行态，未声称已完成迁移。本轮宿主只读 `docker ps -a --filter name=typecho` 与端口 20000 查询均为空，`joyqi/typecho:1.3.0-php7.4-apache` 镜像仍在；实施前应先核对实际站点来源，不能直接照“从当前容器导出”执行。没有启动镜像、恢复容器或修改生产数据。原参数与配置不落入公开日志/本文，不保留含凭据的诊断正文。

修复范围：ToolModel 保留 Remote not_found/forbidden 的独立具名拒绝，Run 投影资源不存在/远端权限拒绝安全码，Shared 有限码和三语原因同步；原可恢复只读失败继续反馈模型，身份失效、App 未授权、写入未知及清理失败不降级，file_list 说明通过父目录真实名称定位。两轮源码审核核对完整调用链与全部拒绝消费者。本批根 `pnpm check`、双端 `pnpm build`、`pnpm format:all:check` 与 `git diff --check` 通过，日志 `/tmp/nexus-agent-resource-failure-{check,build,format}.log`；按 D17 未新增/执行本地行为测试，新代码未部署、未正式 E2E。待远程覆盖缺失路径后继续读取、缺失 SSH 目标、远端权限拒绝与 App 撤权区分，以及写入派发后失败/清理异常的 unknown 围栏和卡片新码展示。

### 服务器状态卡片左右留白（2026-10-26）

用户授权收紧卡片左右外侧空隙，原 StatusMonitor.css 同步修改指标与加载列表水平 padding，去掉窄栏内容覆盖并同步矮栏骨架。两轮源码核对普通/150px/118px 窄栏、210px/270px 矮栏、趋势与手机覆盖次序；卡片内部间距、纵向尺寸、触控区域和数据逻辑保持。根 `pnpm check`、前端构建、全量格式及 `git diff --check` 通过，日志 `/tmp/nexus-status-card-inset-{check,build,format}.log`。按 D17 未运行本地浏览器或行为测试，真实宽窄/矮栏/手机及加载切换视觉待验；未提交发布。

### 文件管理器 `..` 返回行紧凑高度（2026-10-26）

用户授权缩小父目录返回行：只为父行单元格设置更小垂直 padding，移除父行名称原有底部留白；其他文件行、缩放、点击/键盘、20ms 预加载、右键和拖入不变。两轮源码核对全部可见列单元格与 CSS 优先级，父行仍独立于虚拟条目和 spacer，不修改虚拟文件行尺寸。根 `pnpm check`、前端 `pnpm build:frontend`、`pnpm format:all:check` 与 `git diff --check` 通过，日志 `/tmp/nexus-file-parent-row-{check,build,format}.log`；按 D17 未运行本地行为或浏览器。待正式远程验证宽窄栏与行缩放、父目录跳转、键盘/右键/拖入以及大目录滚动；未提交发布。

### 工具详情及界面细节本批正式回归（2026-10-27，待远程）

本轮补充既有图片成功/三类拒绝用例，验证持久工具详情、错误 Run 返回 404、展开卡片后的格式化参数与安全失败码，不改变图片预览、下载、内容审核及不重试断言。其余源码静态证据见上述各节。用户授权整批提交推送，完整正式 E2E 成功后发布 dev linux/amd64；不更新生产容器。

本批代码已提交推送 `22718980`。最终根检查、全量格式、变更 E2E 严格 TypeScript 与 diff 检查通过，日志 `/tmp/nexus-final-release-{check,format,e2e-types}.log`；临时 TypeScript 配置首次缺少 Node 类型路径，修正配置后通过。源码构建证据沿上述各节，未执行本地行为测试。

正式远程回归被 GitHub 平台阻断：2026-10-27 UTC，push 后没有创建新运行，手动 dispatch 两次均返回 HTTP 422 `Actions has been disabled for this repository`。仓库 Actions permissions.enabled=true、E2E 工作流 state=active、当前账号有 admin 权限；显式启用工作流后仍被拒绝，因此不是测试失败，不能宣称本批通过。账户计费/平台限制尚无法证实，当前令牌无 user scope，计费接口不可读；未更改令牌或账户设置。需所有者在 GitHub 恢复 Actions 可执行状态后再触发本批完整 E2E，通过后发布 dev amd64。镜像未发布，生产容器未更新。

### 手动清理 workflow（2026-10-27，静态待验）

新增 cleanup-history.yml 与维护脚本；仅手动触发，无 schedule/push/release。源码审核两轮核对包/仓库范围、latest/dev 多层 manifest 与证明闭包、渠道移动围栏、历史运行/产物保留、缓存删除、活跃运行与权限失败路径。只读实际 GHCR 核实 dev 索引包含 amd64 manifest 与 unknown/unknown attestation，不能只保留有标签的索引版本。未执行删除、未运行本地行为测试；实际清理与权限验证仍待手动运行。

### Actions 恢复及复制取消竞态（2026-10-27）

手动触发已恢复：40436334225 验证 7810d6ad，检查/格式/构建、Docker smoke 和 6 个分片成功；第 4 分片用例 registered copy progress 首次失败、重试通过，flaky 门禁正确拒绝，不能称全绿。截图与调用日志显示 Cancel 后任务直接消失且没有 unknown Toast。沿 FileService 核对：dispatchedMutation=false 的已取消任务应返回 cancelled；任务注册与实际远端写入之间存在正常异步间隔。用例先等待非零字节进度再点击 Cancel，以进入其声称验证的写入后 unknown 分支；原 Toast/隐藏任务/源文件断言、超时及产品 UI 保留。第 1 分片另有 4 项新工具详情用例失败：按 data-tool-name 同时匹配工具与审批历史 summary，严格定位正确报错；新增 data-tool-state 限定实际工具卡片，保留完整参数/失败码断言。详情认证读取、wrong Run 404 和安全码解码已先于页面定位通过，卡片显示断言仍待修复后的完整远程回归。

### 本批正式 E2E 与 dev amd64 交付（2026-10-27，完成）

GitHub Actions 限制已恢复。测试修复提交 `441dcc740660d337b6e7480bbb1f891a90a3079d` 的正式 [E2E 40437638548](https://github.com/0honus0/nexus-terminal/actions/runs/40437638548) 全绿：检查/格式/双端构建、Docker smoke 和 8 分片全部成功，共 526 项通过；完整日志 `/tmp/nexus-final-green-e2e.log` 核对失败、重试、flaky 均为 0。此前失败分别来自工具/审批同名定位和复制写入前取消的错误前提，均修在测试，未修改产品 UI、断言目标或超时。工具详情认证读取、错误 Run 拒绝、格式化参数、安全失败码和原图片成功/拒绝流程均通过。

CI 机器人 `440cb9e9271f16ac7c3eccb20437a25cf1e679be` 仅更新测试耗时估计，已快进同步，无产品代码变化。正式 [dev amd64 发布 40438690356](https://github.com/0honus0/nexus-terminal/actions/runs/40438690356) 成功，生产依赖审计通过。`ghcr.io/0honus0/nexus-terminal:dev` 和 `sha-440cb9e9271f` 索引摘要均为 `sha256:953b6ef14d7a02cca8076625706aa1bced9a774ed18618152872937f8b8cea64`；唯一实际平台为 linux/amd64，OCI revision 精确为上述机器人提交，unknown/unknown 项为证明 manifest。证据 `/tmp/nexus-final-dev-publish.log` 与 `/tmp/nexus-final-dev-image.json`。未更新生产容器，个人截图增删不提交。

手动清理 workflow 随 `cb9d1df3` 提交，脚本 node --check、ESLint、Prettier 和 diff 通过，完整 E2E 的仓库检查亦通过。依据用户最新“先创建”指令未触发清理，远程实际删除/包管理权限尚待手动验收；workflow 文件仅在 dev，GitHub 的手动入口首次注册仍要求默认分支存在该文件，未擅自合并 main。

## E2E 依赖拆分与构建复用（2026-10-27）

参考 [Grafana 构建分发](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[项目分组](https://playwright.dev/docs/test-projects)与原生 failOnFlakyTests。未增加 Actions 总并发、放宽超时、删断言或修改产品 UI。现有按耗时分片只增加 backend/browser 清单过滤，未来未登记文件默认保留在浏览器组，不漏测。

静态列举（`playwright test --list --reporter=json`，未运行场景）确认 all 526、backend 122、browser 404，两个分组全集与 all 完全相同，无交集；移动撤权测试只改变文件，不减少场景。backend 直接使用配置的 localhost 后端 Origin；原非配置 127.0.0.1 Host 拒绝仍验证。浏览器使用 preview，Vite 8.3.4 源码确认继承 server.proxy。直接加载客户端的浏览器用例改用测试专用 Vite bundle，仍执行真实客户端与原断言，不把测试代码加入正式发布。

共享构建 artifact 保留 shared/backend/frontend 的 dist 目录，download 到 packages 后原相对依赖不变；每次下载来自同一个工作流 SHA。原应用关闭与未知/清理失败围栏不动，仅跳过不依赖的外部夹具重置。SSH 文档样本进程内生成一次再复制到各例目录，不硬链接可变文件；相对/失效符号链接原样保留。原生 failOnFlakyTests 替换 reporter 状态覆盖，首次失败 Trace/截图/录像继续保留。

基线 E2E 40437638548 墙钟约 620 秒；按其实测用例耗时 backend 串行约 395 秒、browser 约 2788 秒，默认同 8 runner 采用 1/7。真实新耗时与冷/热 runner image 待远程 Actions，不把理论估计写成提速结论。本地仅执行静态列举、检查与构建，按 D17 不运行行为测试。

静态已通过：根 `pnpm run check`、正式双端 build、测试客户端 Vite build、变更 E2E 严格 TypeScript、Node 脚本语法、`git diff --check`。日志 `/tmp/nexus-split-{root-check,build,clients-build,e2e-types}.log`。两轮源码复审覆盖配置、唯一清单、各启动命令、共享 artifact 目录、同源校验、夹具关闭/重置/复制与 reporter；未发现需更改产品接口或 UI 的项。正式 Actions 待推送后执行，全部首次通过才收口。

首轮 40442149074 的质量作业暴露旧根检查的干净环境顺序依赖：Frontend vue-tsc 在 Backend check 生成 Shared 声明之前运行；旧 workflow 额外 Backend check 曾掩盖它。本地既有 dist 无法暴露该问题。修复为根 check 先执行含 Shared build 的 Backend check，再执行双端 lint 和 Frontend vue-tsc，检查项不减；不恢复重复检查。后端独立命令及未预构建的后端分片/远程入口只构建后端和 Shared，不因前端构建失败而阻断手动协议回归；完整 CI 仍要求两组、全量构建、质量与 Docker 同时成功。

修复后的根检查及全量格式复核通过：`/tmp/nexus-split-root-check-order.log`、`/tmp/nexus-split-format-final.log`。另以 `/tmp/nexus-split-clean-check` 独立安装冻结依赖，不复制任何 dist，执行根检查全部通过（`/tmp/nexus-split-clean-check.log`）；初次 offline 安装因隔离目录无元数据缓存失败，改为正常冻结安装后成功。以上仅静态验证，没有本地行为执行。

首轮分组行为结果：4 个浏览器分片成功，其余失败均为测试环境入口偏差。backend 的 3 项 RDP 用例由 CommonJS 辅助器固定前端端口造成；browser 另有 4 项客户端场景与 19 项终端生命周期场景仍直接导入开发源码/解析开发版 Vue 模块。此前搜索输出截断遗漏这些入口，已完整核对全部 `/src/` 浏览器导入：改为两个测试专用 Vite library entries，包含真实客户端、真实 TerminalView、同一 Vue runtime、原 i18n 与会话状态，并加载真实终端 CSS；原功能断言不删、不放宽。RDP 辅助器按 suite 选择与 TS 配置相同的公开后端/前端端口，保留 Origin、票据与拒绝断言。构建配置位于 frontend/build，仅 E2E 命令调用，正式构建不包含这些入口。原日志 `/tmp/nexus-split-job-121985799{276,301,304,338}.log`，修复后的全量行为仍待下一轮。

第二轮 40443702665：质量、集中构建、Docker smoke 与完整后端 122 项通过，RDP 端口修复已验证。浏览器受同一测试打包配置问题影响：Vite library 模式默认保留 process.env.NODE_ENV，打包 Vue 后出现浏览器 process 未定义。测试专用配置显式将该值定义为 production，重新构建后全部测试 bundle 中已无 process.env 引用；不添加 process polyfill 或修改产品逻辑。库入口类型/全量格式及构建通过，证据 `/tmp/nexus-split-{types-final,format-adapt,clients-build4}.log`。共享 artifact 上传增加官方 overwrite:true，完整 rerun 重建同名产物，失败分片单独 rerun 仍可读取原 SHA 产物。下一轮 runner 指纹不变，可测热缓存完整结果。

## 最耗时任务优化（2026-10-27，正式全量通过）

上一阶段正式 [40444825177](https://github.com/0honus0/nexus-terminal/actions/runs/40444825177) 在 899d4107 上 526 项首次通过、0 skipped/retry/flaky，完整墙钟 532 秒；原基线 40437638548 为 620 秒。新基线尚不满足用户提速目标。

本轮将 125 秒 CAPTCHA SDK 过期等待改为 Playwright 官方 Clock，真实跨域组件、供应商验证、过期后不派发、拒绝后清 token 和新 token 成功断言全部保留。后端 30 秒资源缓存和 31 秒桌面票据过期使用 Node 内置 MockTimers 仅推进 Date，网络和清理时钟保持真实；成功关闭原应用后恢复，关闭失败保持围栏。资源缓存增加过期前命中断言。

最大 Agent 文件按部署修复、文件搜索、会话交付、记忆、图片拆分，原测试正文不变，公共辅助归唯一文件。SSH 两分钟真实空闲场景独立文件保留 125 秒真实等待和完整文件操作断言。已有耗时清单按上次成功日志逐项迁移并扣除被替换的固定等待，无新调度器或 runner 并发。静态清单确认前后均 526 项，按项目和测试标题比较完全相等；本地按 D17 不运行行为测试。新版本静态、两轮审核与正式远程结果如下。

本轮静态：根 check、完整 format:all:check、变更 E2E 严格 tsc（含 noUnusedLocals）、夹具 node --check 与 diff 通过，日志 `/tmp/nexus-slowest-{check,format-check,types}.log`。两轮源码复核确认控制仅本地随机令牌可用、输入白名单、真实定时器不被虚拟、关闭失败不恢复基线；Agent 拆分的所有顶层测试/参数化声明 AST 与原文件一致，完整测试标题集合不变。耗时计划仅用于调度，不作为实测提速结论。

正式 [40447142849](https://github.com/0honus0/nexus-terminal/actions/runs/40447142849)，源码 `451e37a9d4b94f6f4617bdfc4ecd08628cf353a9`：526 项首次通过，0 failed/skipped/retry/flaky；后端 122、浏览器 404，质量、Docker smoke、8 个测试 runner 全成功。日志 `/tmp/nexus-slowest-final.log`，运行/作业元数据 `/tmp/nexus-slowest-final-run.json`。验证码过期/拒绝/新 token 成功的整例从133秒降至8.8秒，资源缓存过期32→1.4秒、桌面票据过期31→0.181秒；原125秒真实空闲SSH回归仍126秒通过，拆分场景功能清单不减。

墙钟以 GitHub createdAt→updatedAt 比较：620秒原始基线→532秒上一阶段→477秒本轮（03:58:35→04:06:32 UTC），本轮再降55秒/10.3%，累计降143秒/23.1%。本轮准备61秒，后端301秒、浏览器各312/330/395/362/311/381/375秒；最慢测试作业441→395秒。累计有效作业2992秒，相对上一轮3228秒降低7.3%，不视作精确计费，截图条件跳过作业不计入。Node Date-only MockTimers 和真实跨域 hCaptcha SDK 的 Playwright Clock 均已整链验证；并发仍1后端+7浏览器，原关闭/unknown隔离保留。自动提交 `de824567` 仅刷新耗时估计并已同步。未发布或部署，用户截图未提交。

## E2E 功能目录与剩余前端计时等待（2026-10-27，已验收）

基线40447142849完整477秒、526项首次通过。当前最重文件为跨服务器传输约181秒，重组为 `ssh/cross-server-transfer/{protocol,clipboard-ui,send-ui}.spec.ts` 与唯一 `fixtures.ts`；同一功能统一维护，原分片器递归发现、按文件实测耗时自动均衡，保持单例内顺序和原数据隔离。原native rsync/SCP/relay、安装/跳过与离页流程、实时非零进度、完整8MiB字节/SHA及软链接断言不缩减；未移到后端组，避免让既有单后端runner成为新瓶颈。

手机状态订阅在已验证短期复用后用Playwright Clock推进30秒原idle timer，再核对真实status.stop与重开真实采样。压缩取消使用同一官方Clock跨原30秒边界，真实远端preflight hold保持；新增测试专用preflight进程开始/退出计数，取消前确认真实命令已进入，释放后等实际进程退出代替固定4秒。不修改产品超时、布局或正常交互；原125秒SSH空闲覆盖、首次Trace/录像/截图与8个runner保持。

静态清单比较项目/标题集合完全一致，共526项；传输五个顶层参数化/普通测试声明AST与原文件一致（仅移除一个未使用变量绑定，保留其await创建），所有原断言保持。两轮源码审核核对嵌套目录全部import、配置递归发现与单例重置、Clock安装顺序和真实进程计数；原archive/processes响应不变，新计数独立测试端点。根check、目标E2E严格tsc（含noUnusedLocals）、夹具node --check及diff通过，日志 `/tmp/nexus-e2e-more-{check,types}.log`；全量format:all:check亦通过，日志 `/tmp/nexus-e2e-more-format-check.log`。

正式 [40454422925](https://github.com/0honus0/nexus-terminal/actions/runs/40454422925)，源码76a28b1e9626588d29d8d64fa2d90a41a4a60937：526项首次通过（122后端/404浏览器），0 failed/skipped/retry/flaky，质量/构建/Docker smoke/全部8个测试runner成功。传输新三文件18项全部通过；手机状态订阅5.4秒、归档取消3.8秒。完整日志 `/tmp/nexus-e2e-more-final.log`，元数据 `/tmp/nexus-e2e-more-final-run.json`。完整墙钟05:16:57→05:24:37 UTC，共460秒，比477秒减少17秒/3.6%，相对620秒原始基线减少25.8%。后端299秒，浏览器340/293/296/332/281/366/338秒，最慢395→366秒；累计有效作业2799秒，比2992秒少6.5%，不等于精确计费。准备作业72秒、质量99秒，均存在运行波动；均衡为基于历史耗时的近似，不能保证完全等时。CI耗时提交a5d445b9已同步；未发布镜像或部署，个人截图保持。

## E2E 复制取消与插件分片（2026-10-27，已验收）

优先处理最新实测39秒复制取消和约119秒Agent插件大文件。复制场景改用测试SSH的真实WRITE gate，取消前确认已有写入进入，前端Clock跨32秒原清理边界后确认原WRITE仍阻塞；明确释放后等待真实pending归零及对应任务WS终态，再保留第二文件不存在断言。gate不会因channel close清掉观测，reset先释放再停止旧SSH并等待真实I/O归零。原延迟写入接口及其它消费者不变，产品期限不变。

插件统一归agent/plugin目录，分为repository/custom-surface/browser-lifecycle/subagent-lifecycle/native-run/native-surface六份spec和唯一fixtures；8个原测试AST逐项对比完全一致。未知Child副作用与invalid-tool仍各用独立后端进程；只是让原分片器能分别安排两份spec，不取消关闭围栏。完整静态清单仍526项，项目/标题Counter与上一版一致。按上次逐例实测迁移耗时估计，复制文件仅扣除替换的36秒固定等待，作为调度估计而非实际提速结论。根check、严格测试tsc（含noUnusedLocals）、Node语法、全量格式及diff通过；日志 `/tmp/nexus-e2e-large-{check,types,format}.log`。两轮源码审核覆盖递归发现/导入、隔离spec全部消费者、逐例重置、gate取消后保留与真实终态收敛；静态7浏览器分片预计306.7–309.5秒，不代表实测。新SHA正式全量行为与耗时待验，不发布部署。

首轮40456075048中7个测试分片成功，第6分片有两处测试改动错误：插件native-run移动目录后两条__dirname相对夹具路径未加一层；复制取消错误读取隐藏任务行不存在的data-task-id。修正前者至原真实ssh-root，后者从严格解码的真实WS transfer.copyMove请求关联ID，同时等待真实cancelling事件后再推进Clock，避免取消请求尚未被后端接纳。产品源码/UI无改动、功能断言及期限不减；修复后类型/格式与新SHA正式全量仍待验，失败轮不计提速证据。

最终正式 [40457002804](https://github.com/0honus0/nexus-terminal/actions/runs/40457002804) 验证f3586ec1a5fbf32b36a582dd436a206c61d35d7c：526项首次通过（后端122/浏览器404），0 failed/skipped/retry/flaky，质量、构建准备、Docker smoke与8测试runner全部成功。修复后严格tsc `/tmp/nexus-e2e-large-types-fix.log`、目标ESLint/Prettier和diff通过，正式质量作业再次覆盖根check与全量格式。复制取消从39秒降至3.8秒，原生插件完整Run18秒、六份插件文件全部通过；真实SSH空闲仍完整验证。日志 `/tmp/nexus-e2e-large-final.log`、元数据 `/tmp/nexus-e2e-large-final-run.json`，单分片证据 `/tmp/nexus-e2e-large-browser6.log`。

完整墙钟05:44:10→05:51:52 UTC，共462秒（7分42秒）；上轮460秒，本轮没有整体提速证据。准备60秒、质量120秒、Docker78秒、后端335秒；浏览器352/359/347/348/357/383/343秒，累计有效作业3093秒，比上轮2799秒增加10.5%，不等于计费。同526项测试时间合计约2084→2286秒，尽管复制取消省35秒，说明其它真实执行整体变慢；不能仅凭两轮断言CPU或平台根因。最慢分片包含两次额外隔离启动（Child、ACP），保留原清理/未知围栏，后续优先剖析初始化与生命周期开销。本轮成功耗时更新作业无新提交，不虚构自动同步。源码已推送dev，未发布镜像或部署，用户截图增删不提交。

## E2E 构建与容器准备重叠（2026-10-27，已验收）

实测40457002804：准备作业60秒；最慢分片后置的容器初始化28.3秒、依赖链接6.6秒、产物下载4.3秒。原依赖将共享构建与全部容器准备串行。本轮将同一次完整构建移入既有quality作业、先上传产物再执行原根检查和全量格式；镜像准备作业提前结束，让8个测试runner同时准备。作业数量与测试并发不变，不改UI/产品/测试断言/隔离生命周期。

等待复用官方github-script的分页API和既有p-retry，库实查1037stars；只为未上传重试，错误类别明确，权限/网络错误和构建已结束而产物缺失直接失败，外层原Actions作业期限保持。产物按当前run、SHA、latest构建job的run_attempt匹配：完整重跑使用新attempt，单独重跑失败分片可复用同run原成功构建；最终官方download-artifact按不可变artifact ID下载，不搜索其它运行。参考Grafana的集中构建分发与GitHub官方API；质量/Docker仍是全绿及耗时更新的必需门禁。根check、全量format:all:check、脚本node --check、actionlint与diff通过，日志 `/tmp/nexus-e2e-overlap-{check,format,actionlint}.log`；静态清单项目/标题Counter保持526项。两轮源码审核覆盖构建先后/质量门禁、当前run/SHA/attempt绑定、全量/失败分片重跑、权限/取消/缺失产物与既有job期限；保持质量作业原显示名，避免改变既有检查名消费者。正式新SHA全量与墙钟待验，不发布部署。

正式 [40459146818](https://github.com/0honus0/nexus-terminal/actions/runs/40459146818)，源码a24c38c7fb76840ee372db059d1c1e5e8267e034：526项首次通过（122后端/404浏览器），0 failed/skipped/retry/flaky，质量、Docker smoke与全部8个测试runner成功。完整日志 `/tmp/nexus-e2e-overlap-final.log`、运行/作业元数据 `/tmp/nexus-e2e-overlap-final-{run,jobs}.json`。8条等待记录全部为artifact ID12713856335、build attempt1，官方按ID下载成功。镜像作业7秒；quality中构建27秒、上传3秒，原全部检查与格式完成后quality共131秒。第1分片容器初始化23秒/依赖8秒/产物等待6秒/下载1秒，在06:07:32开测，距创建55秒，原同分片为约110秒；全部分片开测55–64秒，准备重叠有实际证据。

完整墙钟06:06:37→06:13:18 UTC，共401秒（6分41秒）；对比462秒减少61秒/13.2%，相对最初620秒减少35.3%。最慢测试作业383→367秒；有效作业总计2927秒，相对3093秒减少5.4%，不视作精确计费。测试执行仍有波动，不能将整个61秒都归因于重叠；本轮未新增作业或测试runner，也未减少真实SSH空闲、弱网、字节/进度或未知结果覆盖。耗时机器人56407f6f已快进同步。全量/失败分片重跑和构建失败/取消等分支仅有源码审核，未额外进行行为注入；当前证据不扩大至这些分支。未发布或部署，个人截图保持。

## E2E 成功传输进度限速（2026-10-27，已验收）

40459146818的protocol成功原生路线单例约13秒、clipboard-ui五条路线每例约15秒；其中真实8MiB样本的1MiB/s夹具传输本身占数秒。本轮只将成功进度场景的rsync/SCP及UI relay现有限速提高至原生3MiB/s、relay 4MiB/s；原生命令约一秒输出一次，保留多次中间采样窗口，保留SSH读延迟和专门2Mbps/10Mbps等弱网profile；取消/失败路线原512KiB/s不变。保持8MiB数据、完整SHA、真实中间进度、UI至少两个不同百分比/单调增长、安装/跳过/真实方法和未知结果断言。无产品/UI/调度变更。根check、严格目标tsc（含noUnusedLocals）、全量格式、diff及526项项目/标题Counter比对通过，日志 `/tmp/nexus-e2e-transfer-rate-{check,types,format}.log`。两轮源码审核确认仅成功路线参数变化，原8MiB/至少两个不同UI百分比/单调进度/SHA/方法断言不变；耗时清单仅扣除按带宽变化推算的等待差额，作为调度种子，正式526项及总耗时待验，不将参数推算写成实测收益；本地按D17仅静态，不发布部署。

首轮40460877397失败：clipboard-ui的direct/install-rsync/skip-rsync三条路线在中间进度locator读取处超时，relay/skip-all及protocol通过。原生UI夹具速率恢复已验收的1MiB/s以保留可观察窗口，protocol 3MiB/s与UI relay 4MiB/s保持；所有原断言、数据量与期限保持。修复后正式全量待验，不能把先前静态通过或部分分片通过当作验收。

正式验收 [40469028918](https://github.com/0honus0/nexus-terminal/actions/runs/40469028918)：源码e621b2bef1cf22317eb95682ed648c7cb62d5df5，526项首次通过（122后端/404浏览器），0 failed/retry/skipped/flaky，质量/格式、Docker smoke与8个测试runner全成功。direct/install-rsync/skip-rsync均约14秒；relay/skip-all分别8.9/8.1秒，保留至少两个不同真实UI中间百分比、单调进度与完整SHA断言。修复静态日志 `/tmp/nexus-e2e-transfer-fix-{check,types}.log`；526项清单 `/tmp/nexus-e2e-transfer-fix-list.json` 与前版Counter相等；变更格式和diff通过。8分片正式日志 `/tmp/nexus-e2e-transfer-fix-122*.log`，最终运行元数据 `/tmp/nexus-e2e-transfer-fix-final-run.json`，Docker日志 `/tmp/nexus-e2e-transfer-fix-smoke.log`。

最终墙钟07:45:22→07:56:24 UTC，662秒（11分02秒）；开头约94秒等待，Docker Chromium安装07:47:16→07:55:23耗487秒，8测试分片07:53:21已全部完成。不能宣称本轮整体更快，也不移除安装/部署验证来换取速度。PR运行仅生成耗时建议artifact，不自动写入dev。按最新用户要求修复成功后收口，不再扩展优化或发布部署。

## 手动清理活跃运行修复验收（2026-10-27）

原40483067327因任意其它未完成Actions全局拒绝而失败。脚本现在保留活跃运行/产物，删除前复查重启；有其它活跃任务时跳过镜像和缓存清理，真实权限与manifest异常仍失败。正式 [40483588668](https://github.com/0honus0/nexus-terminal/actions/runs/40483588668) 在c49663a5上成功，141条旧运行和684个历史产物实际删除，保留当前clean、渠道源码成功记录和最新成功E2E。34749067364从2026-09-13起queued且无job，本次仍保留，没有自行取消；因此99个旧产品版本、61个runner版本、769个缓存保留，实际镜像/缓存删除分支仍未验证。latest/dev递归manifest和HEAD校验成功，日志 `/tmp/nexus-cleanup-success.log`。脚本语法、ESLint、Prettier、actionlint和diff通过，源码两轮复核，无产品/UI变更。

## 快速输入回跳与连续退格（2026-10-27，源码及静态完成）

本地dev的TerminalTypeAhead修正：未完成CSI保留至下包、仅光标显隐/报告的包不触发退格空匹配失败；右边界仅限制前向打印，触边不立即撤回旧预测而由HardBoundary等待真实回显；连续DEL按解析顺序逐字预测，原输入仍只派发一次。原双解析屏障、reset/失活/resize/快照撤销与复杂模式保守策略保持，无UI或协议变更。源码两轮复核完成，未用关闭预测或放宽期限规避。

既有terminal-lifecycle增加两个场景：快速连续输入经拆分SGR/DECTCEM与光标独立帧确认，批量退格保持已删内容并核对ACK和唯一输入；按实际列宽填充到右边界，删除不触发向前换行保护，下一字符触边时此前字符不消失，最后真回显及快照无重影。静态目标清单21项，严格目标tsc通过。根check、Frontend生产build、全量格式、目标ESLint/Prettier/diff通过，日志 `/tmp/nexus-typeahead-fix-{check,build,types,format,final-types}.log`；用例清单 `/tmp/nexus-typeahead-fix-list.log`。按D17未运行本地行为/E2E，远程及真实用户网络表现仍待验，不将源码推理或编译PASS称为复现/实测修复。用户未要求提交推送，留在dev工作区，个人截图保持。

首轮main正式40498800461仅新增两例失败，原526项通过，质量/Docker通过；已按日志和trace区分：快照包含合法SGR，不能对原始ANSI做连续纯文本匹配，改为真实重挂载验证文字；右边界场景大批输入仅约14ms回显，24样本窗口被真实低延迟覆盖，按既有策略正常停用预测，测试改为沿训练同样延迟70ms交付批量回显。不改产品、不削减文字/输入唯一/ACK/边界断言、不扩大期限；全量528项重新验收后再发布。

正式收口：[40499973200](https://github.com/0honus0/nexus-terminal/actions/runs/40499973200) 验证main/89772b6484bf6090100db2b80784c23641bf9934，528项全部首次通过、无failed/retry/skipped/flaky，质量/格式、Docker smoke及8分片成功。新增分包控制/连续退格与右边界回归分别2.7/2.8秒，完整日志 `/tmp/nexus-terminal-echo-main-pass.log`；首轮失败日志 `/tmp/nexus-terminal-echo-main-failed.log` 与trace `/tmp/nexus-terminal-echo-traces` 保留原失败证据。机器人7d5ddbae只更新耗时，随后正式发布 [40500930565](https://github.com/0honus0/nexus-terminal/actions/runs/40500930565) 成功。只读GHCR核对dev及sha-7d5ddbaebf50同摘要sha256:16b65d1534c4ac2006c2b78df69f1edbad59f02cc999783ebaa96d026874b8b6，应用manifest为linux/amd64（另含unknown/unknown证明manifest），config revision=7d5ddbaebf50f696a54f48fe8579a0719bd2b274，无arm64应用manifest。日志 `/tmp/nexus-terminal-echo-publish.log`，核对结果 `/tmp/nexus-terminal-echo-published-image.json`。按用户授权推送main并发布amd dev完成，未部署服务器或修改个人截图，不把浏览器回归扩展为全部真实网络/Android环境验收。

## ZIP 压缩中间进度（2026-10-27，静态完成、行为待验）

根因：取消源目录预扫描后，压缩期间只有 fileCount，没有总数或 percent，原前端按 0% 展示。Native zip 改为 -dc，采集它已有扫描的已处理/剩余条目，Model 逐参数转交，FileService 沿原 transfer.archive 发出 totalFiles/percent；发布验证前不足 100%，成功后才 100%。前端布局/CSS/协议未改，无新工具或二次目录扫描。进度按条目，单大文件内部无连续字节百分比，tar 仍只报告计数，不伪造时间进度。

既有 file-capacity-regressions 的 65 来源/70 层目录往返场景增加对真实 WS 进度的严格 Shared 解码、多个中间百分比、原生总条目数、单调增长和终态前不足 100% 断言，原完整内容/删除/下载/解压断言保留；目标仍 5 项，没有新增固定等待。按 PLAN D17 未运行行为测试，不能据此称远程进度已实测。

根 check、Backend 生产 build、全量格式、目标 E2E 严格类型和 --list 通过，日志 `/tmp/nexus-zip-progress-{check,build,format,types,list}.log`；两轮源码核对包含 Info-ZIP DisplayRunningStats 在添加条目前打印 completed/remaining 的顺序、Shell 仅拆数值而不计算不可信字段、JS 安全整数降级、回执前缓存和失败/取消原出口。最后源码微调后再次目标类型/lint/格式，日志 `/tmp/nexus-zip-progress-final-{types,lint,format}.log`。尚未提交/推送/发布。

### 传输进度提示统一 Toast（2026-10-27）

浮动进度、隐藏任务及服务器传输详情移除行内警告/错误说明；本地原任务回执补完成警告通知，后台 store 按快照状态/错误变化通知，列表加载和取消/移除失败使用 Toast。两轮源码复核覆盖上传、移动、剪贴板、归档密码重输、后台读取/写入、身份代次及网络错误去重，保留原进度、状态、操作和 CSS。既有 progress-display-baseline 真实多目标场景继续验证成功目标内容、失败目标状态及 rsync 方法，改为检查文件名和具体失败原因的全局 Toast，且任务详情没有 Error 行内说明。

根 `pnpm run check`、Frontend build、目标严格 E2E tsc 与 Playwright `--list`（原 5 项）通过；日志 `/tmp/nexus-progress-toast-{check,build,types,list}.log`。全量格式结果记录于 `/tmp/nexus-progress-toast-format.log`。遵循 D17，未执行本地行为或远程 Actions，不宣称真实浏览器验收通过；本轮未提交/发布。

### 状态趋势真实采样与紧凑刻度（2026-10-27）

用户明确授权启动测试环境并通过 CDP 专项验收，本轮复用已在运行的 3001/9998 环境和 172.30.30.11:9223 中登录 api.honus.top 的浏览器。真实 amd SSH 五类指标 × 1/5/10/30 分钟共 20 组验证窗口跨度、样本在窗内及网络整档刻度；短历史不被压成不可见单点，时间左侧不足部分仍为空。截图 `/tmp/nexus-network-30-final.png`，日志 `/tmp/nexus-trend-real-cdp.log`。前端热更新期间会重挂组件，测试最终版本重新连接后完成，不将中断轮次计为通过。

在同一浏览器隔离挂载实际 StatusCharts 组件，使用可区分的真实时间坐标和合成数值，验证短历史、单点、空历史、仅 Tx、间断/缺测及 1800 条完整历史，共 60 组范围/指标组合；校验首尾、单点/孤立点、绘制断点、空指标仍按最新监控时间推进、刻度无重复、等距命中或上下行样本不齐时 Tooltip 仅显示同一时间数据，退出销毁隔离实例。该部分为合成数据专项，不冒充 30 分钟真实采样验收。日志 `/tmp/nexus-trend-cdp-check.log`。原会话 controller 隔离通道核对失败及停止后恢复连续性序号间隔为 2、start=2/stop=1，保留历史 3 条；定时回调由测试显式调用，不等待真实 30 秒。

源码两轮复核覆盖有界历史/首尾与缺测、原采样 owner/30 秒订阅宽限、当前样本时间权威、最近时间交互/等距点、自动纵轴与低流量、主题及卸载；标题行缩至 16px、标题 10px、时间选项 9px/20px、网络纵轴 8px，缩放继续使用既有 inverse scale。根 check、Frontend build、全量格式通过，日志 `/tmp/nexus-trend-final-{check,build,format}.log`；既有两例 E2E `--list` 与严格类型通过，日志 `/tmp/nexus-trend-final-list.log`、`/tmp/nexus-trend-types.log`。既有时间轴场景加强短历史第一条真实采样保留，并同步已授权时间控件字号断言；响应式场景增加趋势标题行高度断言，防止关闭按钮受全局 min-height 再次撑大。CDP 发现最初仅改 height 时仍为 38.4px，补局部 min-width/min-height 后实测标题行和关闭按钮均为 16px。未运行全量本地或远程 E2E，本轮未提交、推送、发布或部署。

### 2026-10-27：传输安装偏好、实际工具、TAR 进度与原生文件拖动

新增/扩展远程用例：cross-server-transfer/clipboard-ui 的 SCP/SFTP 跳过安装分支，再次复制不重复弹窗，仍验证协议实际方法、内容摘要；SCP 分支继续模拟后来手动安装，第三次自动重新识别 rsync。保留原字节进度、单调性、直传/中转计数及内容断言。file-capacity-regressions 新增 tar.gz/tar.bz2 单个 4 MiB 文件压缩/解压原生中间字节及发布后 100%；file-manager-navigation 新增精确 VMA.ZST 文件名的真实鼠标起拖，不用合成 dragstart 代替，核对 payload、点击焦点与方向键。

CDP 专项复用 `172.30.30.11:9223`，api.honus.top 新建隔离页挂载正式 composable/组件，工具检查响应受控且不执行安装或实际远端写入。确认第一次跳过→SCP、再次/刷新不询问、显式传输共享偏好、其它服务器独立、失活取消不记忆、后来安装重新探测到 rsync；进度显示 rsync/scp/sftp，归档未知总量显示真实字节与不定进度，已知总量恢复百分比。脚本及结果 `/tmp/nexus-tool-choice-cdp.{cjs,log}`。

正式 FileManager 配合真实鼠标修前复现：先选中文件，第二次 mousedown 被 preventDefault，未产生 dragstart；修后产生精确远端路径 payload，文件元数据使用大文件大小但不实际创建大文件。扩展核对选中/未选中起拖、列表焦点、Ctrl/Shift 多选、方向键/Enter、双击和右键菜单均通过，未改 CSS、触摸分支或业务权限。记录 `/tmp/nexus-file-drag-{before,after,review}.log`、脚本 `/tmp/nexus-file-drag-cdp.cjs`。初次扩展隔离页未加载全局 CSS，菜单后的滚动等待超时；按正式入口加载原全局 CSS 后通过，没有据此修改菜单实现。

两轮源码复核覆盖偏好取消/身份围栏、自动探测不锁工具、全部 WS/Shared decoder/adapter/controller/后台方法消费者、TAR 字节单位/数字解码、未知总量、退出哨兵缺失不能报完成及原取消/清理 owner。根 check、完整双端 build、目标严格 tsc、测试 ESLint 及 --list（19 项）通过，日志 `/tmp/nexus-{tool-choice,tar-drag}-*.log`；最终前端构建、全量格式与 diff 结果记录于 `/tmp/nexus-transfer-final-*.log`。未执行本地或远程完整 E2E，也未执行真实原生 TAR 归档验收；浏览器隔离验证不等同于真实服务器整链通过。本轮不提交、推送或发布。

### 2026-10-27：趋势静默断采样与安卓前台恢复

前轮趋势修复只处理序号不连续，漏掉“序号连续但时间相隔约 22 分钟”的情况。现在按完整保留历史的实际正向连续间隔下中位数识别明显时间断点（大于两倍），再按所选窗口过滤；不删除旧点、不补造历史、不改变采样频率。既有时间轴 spec 增加真实 SSH/WS 入口注入五个受控采样时间的场景：各范围首个真实时间正确，30 分钟画布保留上下行颜色，但中间无采样区没有两种颜色的连线。此为时序故障注入，不冒充真实等待 22 分钟。

手机恢复补齐 pageshow/visibility 及失焦后的聚焦清理，恢复输入资格和 inputmode，取消旧布局帧并立即拟合；工作区 visualViewport 立即测量，保留下一帧收敛。普通聚焦不清理活动触摸/IME，不主动弹键盘、不合成 composition 事件、不重发输入；当前未就绪仍只读。keyboard-geometry 新增真实 SSH 场景，模拟 touchstart 后漏发结束事件、旧 rAF 阻塞和仅可视视口缩小，保留真实 transport/timer，断言恢复 textarea、缩小/恢复行数、真实 terminal.input 与命令输出。

CDP 复用 172.30.30.11:9223，在 api.honus.top 自建隔离页挂载正式 StatusCharts/TerminalView，不改用户页，不访问实际 SSH 或安装工具。20 组范围/指标验证真实 Chart.js 分段：30 分钟两段，其余范围一段；画布读回 Rx 168/Tx 68 个匹配色像素，中段 0 个；中断触摸留下 readOnly/inputmode=none 后，动画帧保持延迟时 pageshow 恢复实际 xterm 输入并发送缩小行数；未就绪恢复仍只读且不派发输入。脚本/日志 `/tmp/nexus-resume-trend-cdp.{cjs,log}`。初始测试错误地等待 xterm 隐藏 textarea 可见，以及让上下行相同数值完全重叠而要求两种颜色，已修正测试入口/数据，没有因此修改产品。工作区整合用例及真实安卓系统键盘仍待远程/实机验收，组件专项不扩大为其通过。

两轮源码复核完成。根 check、前端生产 build、全量 format:all:check、目标严格 tsc（含 noUnusedLocals）、目标 ESLint、Playwright --list（四项）及 diff 通过，日志 `/tmp/nexus-resume-trend-{check,build,format,types,lint,list}.log`。首次静态发现两处新函数缺少间隔，已修正后重跑通过。未运行本地或远程完整 E2E，后端未重启，未提交、推送或发布；用户截图增删保持。

### 2026-10-27：发布前本地正式入口整链专项

用户本轮授权启动测试环境并验证本批修改，随后提交 main、完整远程 E2E 通过后发布 amd64 dev，最后停测试环境。本地使用独立 `/tmp/nexus-release-data-*` 数据目录、3001 正式后端、原9998 Vite 和专用22222 SSH夹具，不覆盖旧实例/生产数据。CDP 使用用户指定9223 Chrome的新隔离Context访问 api.honus.top，创建临时测试账户/目标与夹具文件。

正式页面完成 SSH 连接、输入输出、文件管理器路径切换及精确 VMA.ZST 文件名原生拖动；正式 Workspace WS 执行 tar.gz/tar.bz2 压缩和解压，每步4条递增原生字节事件，4 MiB随机内容完整一致，终态前无100%；ZIP保留多个中间百分比。脚本最后经正式关闭标签入口确认会话关闭，临时文件清理；早轮仅测试清理误传空 workspace.close 与关闭按钮大小写错误，修正测试后完整通过，未因此修改产品。日志 `/tmp/nexus-release-live-cdp-final.log`。

完整桌面 Workspace 经真实 WS/SSH 注入五条受控时间样本，1/5/10/30的窗口及真实首点正确；30分钟画布实际 Rx91/Tx44 个匹配色像素，中段0，无跨22分钟空白斜线。完整手机 Workspace 模拟中断touch、旧rAF延期及仅visualViewport变化，实际PTY行数42→25→42，帧未恢复时真实输入已派发，恢复后真实SSH命令输出正确；正式关闭测试标签。日志 `/tmp/nexus-release-{trend-live,mobile}-cdp.log`，截图 `/tmp/nexus-release-live-{desktop,trend,mobile}.png`。此为受控故障时序，不视作真实安卓系统IME或等待22分钟采样验收。

安装偏好与三种工具显示再次通过正式 composable/组件隔离专项，日志 `/tmp/nexus-release-tool-choice-cdp.log`；工具缺失/后来安装为测试页受控HTTP，不冒充真实远端包安装。源码两轮审核沿全部 Shared decoder/mapper、原生退出/清理、偏好取消/身份围栏、历史/输入就绪/几何屏障，未发现新增功能缺口。正式完整远程 E2E 与发布仍待本次 main SHA，不用本地专项代替全绿门禁。

首轮 main 0512a45e 的40547420086有两例失败：新增状态标题断言错误要求所有缩放下整行≤17px，但数值读数保留原0.82em随面板缩放，1.6倍时真实行高21.825px；修正测试为关闭按钮16px及标题不被额外撑高，不改产品CSS。服务器传输移除是实际通用HTTP读取问题：DELETE真实返回204，浏览器却暴露非null的空ReadableStream，原readJson误拒绝成protocol_failure，后端已删除但本地卡片保留。本轮CDP受控204复现bodyNull=false/text为空，修正为按既有容量读取并验证真实零字节，保留非法Content-Length和非空正文拒绝；原移除E2E补实际DELETE204回执断言，卡片消失断言不减。其它分片首次通过，未发布；新SHA完整回归待验。

修正后 CDP `/tmp/nexus-release-remove-proof.log` 真实暴露空流的DELETE返回成功；`/tmp/nexus-release-204-boundaries.log` 验证null正文、未声明长度空流、声明0空流均成功，非空正文和非法长度保持protocol_failure。`pnpm run check`、`pnpm run format:all:check`、前端正式构建及两项回归严格TypeScript检查全部通过；补充修正沿HTTP读取/清理/错误分类及测试响应等待完成两轮源码审核。通用204修复恢复原删除行为，USAGE原传输任务说明仍符合实际。

第二轮40549848325：HTTP204移除与缩放标题所在2、5分片通过。1分片普通31例通过后，独立Agent用例的桌面夹具启动因X_SetInputFocus BadMatch退出（0 tests）；Xterm标题建立时尚未映射，原search不检查可见，改为在原waitFor内search --onlyvisible、设置并核对焦点。4分片80例通过、1例flaky导致fail-on-flaky：收藏弹层缩小窗口后读取旧右界1153，原poll宽度320在resize前后恒成立；改为poll完整宽高/边界直到既有弹层异步碰撞定位完成，仍保留原8/952px和318–322宽度条件，不修改产品UI。不发布失败轮次。

新增收藏默认路径回归加入file-manager-navigation：初次新增等于当前浏览路径，仍可手改并保存；编辑保持已保存值；导航至收藏目录后再新增默认更新到该目录且名称重置，取消不写入。源码核对FileManager传入browser.path唯一事实，openAdd只在打开时赋值，编辑/保存/身份撤销不变；不增加请求、watch或UI样式。

main 2c73f686 完整远程40608135532成功：质量/格式、Docker smoke及全部8分片首次通过，桌面映射和收藏定位修正已验收。新增默认路径独立完成两轮源码审核、pnpm run check及归档/文件管理专项严格TypeScript检查；因追加功能，发布等待包含该功能的新main SHA完整回归。

最终交付：main 53671c68 的完整远程 [40608930071](https://github.com/0honus0/nexus-terminal/actions/runs/40608930071) 成功，533个Playwright用例全部通过（含独立Agent变体），质量/格式及Docker smoke通过，无flaky。包含新增收藏默认当前目录的实际新增/编辑/导航后重新新增断言。CI随后仅更新duration-estimates为dda619db，产品源码无变化；[40609690539](https://github.com/0honus0/nexus-terminal/actions/runs/40609690539) 成功发布linux/amd64，`ghcr.io/0honus0/nexus-terminal:dev`、`sha-dda619db127a`，digest `sha256:fef7ddd68111d99f83036de21139a7a5d05cf523e86c38a366e874224b8a7808`。未部署生产。收口检查本地前端/后端/SSH夹具进程均已退出，9998/3001/22222/22223/22224/22225无监听。个人截图增删未纳入提交。

### 归档标题移除与隐藏入口百分比（2026-10-28）

归档ProgressCenter终态“移除”移动至任务标题右侧，保留done条件与原remove(task.id)，活动取消/未知副作用处理不变；标题flex-1/min-w-0截断、按钮shrink-0，无局部新样式。WorkspaceSessionSurface对现有progressTasks的已报告进度钳位后等权平均，空列表为0且入口原条件不显示，单任务跟随其百分比；原hide/restore/拖动与身份生命周期不变。原上传隐藏入口E2E补“Progress Display (xx%)”断言，保留拖动与恢复全链路。

两轮源码复核覆盖终态/活动分支、窄标题、任务变更与原事件owner；pnpm run check、前端正式build、修改E2E严格TypeScript检查及git diff --check通过，日志 `/tmp/nexus-progress-title-{check,build,tsc}.log`。未启动测试环境或执行本批浏览器/远程E2E，既有533例不作为本批验收。pnpm run format:all:check通过，日志 `/tmp/nexus-progress-title-format-check.log`；随后记录文档经Prettier再次格式化。

### 项目依赖维护（2026-10-28）

递归outdated初始30项，更新29项直接依赖、catalog、pnpm锁文件及pnpm11.28.9。包括Vue/编译器3.5.44、Vite8.3.5、Monaco0.57.0、Pino10.4.0、Undici8.12.3、MCP2.4.0、OpenAI7.45.0、Playwright1.64.1。jschardet4.1实读安装包README的迁移说明：置信度分布变化与原<0.9中文回退不兼容；实构建其chunk gzip709.66KB，因此回留3.1.4，不在依赖升级中改动编码判据。pnpm12未迁移；vendor IronRDP/SheetJS来源不变。

Monaco旧补丁无法直接应用于0.57，基于新原生文件重建原剪裁祖先边界/上下翻转修复，保留新版contentsMaxHeight；旧0.56补丁移除。原版0.57包实际patch成功，与node_modules已应用文件cmp一致，无丢失上游新逻辑；xterm/splitpanes补丁原样保留。两轮源码审核核对catalog/清单/lock、Node engine、logger/Agent调用、补丁和CI指纹消费者，USAGE原产品说明仍适用，部署章节同步pnpm/Undici/Playwright要求。

最终`pnpm run check`、`pnpm run build`（双端）、`pnpm run format:all:check`、`pnpm install --frozen-lockfile`、`git diff --check`通过；`pnpm audit --json`各等级0漏洞，最终outdated仅剩jschardet。新版Playwright静态发现533例/134文件，runner-image-info正确读取1.64.1/11.28.9。证据`/tmp/nexus-deps-final-{check,build,format-check,frozen,audit,outdated,test-list,runner}.log/json`及`/tmp/nexus-deps-monaco-patch-check.log`（实际文件后缀各依其内容）。未启动测试环境，未执行本批浏览器/完整远程E2E，未发布；前批进度UI改动与个人截图保留。

依赖升级首轮main fffd7b8e / 40612625396：质量、Docker及其它7分片通过；browser1新增隐藏入口断言失败，日志显示`Progress Display (0%) `直至`(100%) `均有末尾模板空白。Playwright toHaveText使用正则时不做字符串空白规范化，严格行尾断言误拒绝，随后上传结束入口消失。修正测试为toHaveAccessibleName，按按钮实际语义名称断言0–100整数百分比，保留原可见、拖动/记忆、恢复及取消的全部断言；不改模板或UI。此前库升级与产品显示没有对应失败证据，不回退依赖。

main 98ceac0f 完整回归 [40614218253](https://github.com/0honus0/nexus-terminal/actions/runs/40614218253) 成功：533个Playwright用例全部首次通过，无失败或flaky，质量/格式及Docker smoke通过；原隐藏入口百分比/拖动/恢复/取消链路本轮通过。修改测试ESLint、严格tsc、Prettier和diff检查通过，源码两轮核对断言只过滤无语义模板空白且仍要求0–100百分比，没有改动产品UI。CI后继f481bab9仅更新耗时估计。证据 `/tmp/nexus-percent-assert-final-e2e.log`；本次未发布镜像或更新远程部署。

## 直传安全提示记忆与网络读数对齐（2026-10-28）

范围：跨服务器粘贴、“发送到服务器”的凭据确认共用“下次不再提醒”；网络速率等宽半栏内居中。两轮源码审核：第一轮追踪两个入口到公共确认 composable、Feedback store/host 与 browser storage，核对取消、替换弹窗、signal、用户切换及原 generation 保护；第二轮核对持久化仅在确认且勾选时发生，三语言标签、全局 UiCheckbox 关联标签，以及普通/极窄/矮栏和趋势 CSS 的覆盖关系。未更改后端、工具探测或传输派发协议。

静态证据：根 `pnpm run check`、前端 build、全量格式及 `git diff --check`；日志 `/tmp/nexus-transfer-warning-{check,build,format-check}.log`。行为按 D17 未新增或执行本地测试，真实交互/视觉及正式远程回归待后续授权；不复用上一批 533 项 PASS 作为本轮证据。待验：未勾选仍提示；勾选取消仍提示；勾选确认后两个入口及刷新不再提示；其它用户仍提示；失活不派发；不同宽高/缩放下速率完整显示。

### 本轮授权 CDP 专项验收

用户追加“使用cdp确认下效果”，作为本轮 D17 限定例外。CDP 为 `172.30.30.11:9223`，实际访问 `https://api.honus.top`；原测试服务已停止且页面 502，本轮复用隔离 `/tmp/nexus-release-data-YdlpzU`，启动本地后端3001、Vite9998和真实SSH夹具22222/22225。仅操作自建浏览器 context、测试连接和唯一命名的临时文件，未使用生产SSH目标。

最终脚本 `/tmp/nexus-warning-acceptance.cjs`，日志 `/tmp/nexus-warning-acceptance-final.log`，退出0：勾选后取消，下一次仍提示且复选框重置；勾选确认后真实服务器发送完成，目标文件内容一致；刷新后通过另一入口跨服务器粘贴，直接完成且无重复安全弹窗，目标内容一致；未捕获浏览器 pageerror。两条实际传输均使用真实后端和SSH夹具，不 mock 成功响应；测试文件及自建附件已清理。初次脚本被正常自动打开的传输进度弹窗遮挡，修正脚本按实际层级关闭弹窗后最终通过，未修改产品交互。

人工查看 `/tmp/nexus-warning-checkbox-desktop.png`、`/tmp/nexus-warning-checkbox-mobile.png`（393px viewport），标签/勾选及两按钮完整，手机弹窗未横向溢出。实际200px状态栏截图 `/tmp/nexus-warning-network-200.png` 和受控118px窄栏 `/tmp/nexus-warning-network-118.png` 中上下行均完整，居中且分隔线两侧有留白；受控240/320px DOM测量无文字截断，但截图受到原父栏裁剪，不作为宽栏视觉通过证据。该专项不等同正式全量E2E；跨用户、其它主题及更大字号未验，不复用前批PASS。本轮启动的测试后端、前端及SSH夹具均已停止，并确认对应端口无监听。

## 任务操作全部移至标题行（2026-10-28）

本轮按用户补充授权将归档活动状态的“取消／取消中”与终态“移除”统一放到各任务标题最右侧；复制/移动/混合模式底部“取消”也移至对应标题右侧，删除旧底部操作容器。上传和批量取消原已在同排/窗头，保留原入口。第一轮源码审核逐一核对按钮条件、emit类型/ID、取消中文字及禁用；第二轮核对互斥分支、标题min-w-0/flex-1/truncate、按钮shrink-0、所有任务模式与底部容器无残余。不新增CSS、协议、状态或后端改动。

本轮根check、前端build、全量format检查、git diff --check均通过，日志 `/tmp/nexus-progress-actions-{check,build,format-check}.log`。按D17本轮未运行浏览器或行为测试，不复用此前CDP或533项E2E作为本轮证据；待验为归档活动/取消中/完成、复制移动及混合列表、长文件名与280px窄窗的同排显示与原按钮功能。

### 任务标题操作正式远程回归通过

用户授权提交推送并等待E2E。main产品提交 `a726e6c3cc0df8cc5e3e05615e0490f1b15a4587`，正式 [40662321872](https://github.com/0honus0/nexus-terminal/actions/runs/40662321872) success：质量/格式、Docker deployment smoke、1个后端和7个浏览器分片全部成功，共533项首次通过，无flaky。各次测试报告通过数为64、64、40、1、1、1、124、57、64、48、69；完整日志 `/tmp/nexus-progress-actions-remote-e2e.log`。截图更新作业按默认输入跳过，不代表已进行截图专项验收；更多窄窗视觉仍待专项。CI随后仅更新duration estimates（`df36b6e2`），无产品代码变更。本轮不发布镜像、不更新生产环境，个人截图增删保持原样。

## nethogs 全接口停顿与退出输入专项（2026-10-30）

用户授权启动测试环境、经 CDP 访问 api.honus.top，并明确测试 SSH。干净 main `09e6c79871bf4e831aa9fbc83a1f931f0fba474b`；本机 Node v22.23.1、pnpm 11.28.9、Playwright 1.64.1。全部临时数据、实例密钥、工具、缓存和日志集中 `/tmp/nexus-nethogs-20261030/`，目录0700，凭据和原始流限制访问，不进入仓库。依赖 frozen 安装通过；ssh2 可选原生加速因没有 make 未构建，JS实现正常；Backend build及正式启动通过。3001后端/9998 Vite使此前502的指定站点恢复200，CDP `172.30.30.11:9223` 使用自建context，不操作用户原页面。

用户先给19902后更正9902。前者hermes无nethogs，测试使用仅解压在上述目录的Debian包；更正后停止该机测试，其结果不计AMD验收。9902主机honus已有nethogs 0.8.8-1，未安装或修改远端文件及系统配置，只建立专用测试目标/连接、运行工具和只读观察。

默认命令捕获82条Ethernet提示，第一幅统计画面距首条提示51.247秒，最长无新输出80.483秒；主机接口观察为87–89项，进程约95–99%单核CPU。正式网页观察300秒（末段结束自有全接口进程），无WS断线或pageerror，最终7,320字节全部确认。绕过项目的独立ssh2直连90秒也复现，约34.8秒产生第一幅统计画面，随后超过55秒没有新输出。直连轮与网页轮有重叠，不能据此比较精确性能或推断唯一内部热点，但证明该停顿独立于项目渲染链发生。

正式网页运行 `nethogs enp35s0` 连续120秒按秒刷新，无断线或pageerror，最终12,046字节全部确认。该网卡由目标实际出口路由核实；仅代表该接口，不能冒充所有容器网络覆盖。此轮Ctrl+C未退出，不记退出通过；另建连接运行15秒后按q退出，随后真实printf的 `NETHOGS_TEST_FINISHED` 标记及Shell提示符完整回显。日志为 `logs/reproduce-amd.log`、`logs/direct-baseline.log`、`logs/reproduce-interface.log`、`logs/reproduce-exit.log`；原始帧及截图均在专用目录。

用户补充默认命令下Ctrl+C与q均不响应。独立自有nethogs专项在发送两键后，通过远端Python只读FIONREAD验证：TTY输入队列保留2字节，ISIG=false、ICANON=false，退出管道无数据，程序尚未读取输入。说明按键已到远端，不能将Ctrl+C等同SIGINT。上游v0.8.8的cui.cpp将键盘读取放在ui_tick，q调用quit_cb写退出管道；main.cpp先对全部接口dp_dispatch再处理UI，仅无数据轮次调用wait_for_next_trigger读取该管道，存在抓包繁忙时输入/退出延迟。上游文件仅保存在tools供核对，未修改远端nethogs；底层热点和所有发行版补丁未进一步剖析，不夸大为完整工具修复。日志 `logs/verify-interrupt.log`、`logs/verify-tty-mode.log`。测试使用自有预先标记PID，按comm复核后SIGTERM清理，不批量终止其他任务；最后只读ps确认无遗留nethogs。

本轮没有改项目源码/UI/协议/容量或部署生产，只补USAGE操作说明及PLAN证据。原“自动重连”未复现；不将单网卡运行方式调整称为项目修复。流程静态审核另发现TypeAhead action异常可使串行队列processing保持true，属于待故障验证的独立异常收口风险。测试服务和全部专用目录按用户要求保留，未提交、推送、运行全量E2E或删除现场。

### 手动重置终端专项（2026-10-30）

用户最后选择只新增手动恢复，不实施通用检测。源码沿SSH标签右键/长按菜单、全局确认、RuntimeSession/Registry和原workspace.close链；三语同步。确认前不关闭，原实例收到明确closed才清理scope并按原标签顺序建立新Shell；后台标签重置保留当前选择。detached/unknown拒绝新建并保留原标签/未知提示，挂起标记禁用入口；原实例重置意图避免关闭过程中显示无法执行的“按键重连”，结束后移除旧进度呈现记录。新增 `tests/e2e/specs/ssh/terminal-reset.spec.ts` 覆盖确认取消、等待输入的前台命令、标签替换、其他Shell变量保留及新Shell变量隔离；仅做严格类型检查，未执行正式夹具/全量E2E。

最终CDP脚本为专用目录的 `verify-reset.cjs` / `verify-reset-mobile.cjs`，日志 `logs/reset-cdp-release.log` / `logs/reset-cdp-mobile.log`，均退出0。通过 `api.honus.top` 连接9902真实SSH，原始模式程序设置TTY raw后等待、不消费输入，重置后原PID已不存在，新Shell真实执行printf，输出标记由远端变量组装，不能被命令回显满足；其他标签的环境变量和输入正常，标签顺序/选择不变。通过持有真实关闭回执验证先关闭后新建并合并重复重置；确认框取消无close请求；挂起禁用/取消标记通过；确认期间原标签被关闭后不新建；关闭期间页面signal取消后完成旧资源清理且不新建；真实远端close成功后注入客户端回执丢失，旧标签进入error/未知围栏，无新connect且无误导按键重连提示。全部自建标签和测试进程收尾，无pageerror。

393×852触屏context经CDP真实touchStart/touchEnd长按打开菜单，重置确认框及两个按钮均完整处于viewport，取消后同一Shell仍connected；桌面1440×1000及393px截图人工检查通过，沿用既有全局UI。截图 `reset-confirm-desktop.png`、`reset-menu-mobile.png`、`reset-confirm-mobile.png`、`reset-close-unconfirmed.png` 留专用目录。

本轮目标机 `command -v/type nethogs`、包路径及dpkg查询均未找到nethogs，与前次0.8.8-1实测不同；未推断变化原因或安装系统包。本轮使用不写远端文件的临时Python程序复现原始模式不读输入，不能称为最新nethogs实机恢复通过。初次原命令验证因此未覆盖；早期Shared构建也触发过Vite热更新，相关轮次不计验收。开发模块注入脚本曾因Vite时间戳/资源时序未取得真实Registry而失败，已改用实际加载的模块URL，最终轮次覆盖全部上述断言，不改产品以适配脚本。

最终静态：根 `pnpm run check`（含Backend包级检查/Shared构建、双端ESLint及Frontend vue-tsc）与 `pnpm run build:frontend` 通过，日志 `logs/reset-release-check.log` / `logs/reset-release-build.log`；目标测试 `tsc --ignoreConfig --noEmit --strict --noUnusedLocals --target ES2023 --module ESNext --moduleResolution Bundler --esModuleInterop --skipLibCheck --types node` 通过，日志 `logs/reset-test-types.log`；全量 `format:all:check` 通过，日志 `logs/reset-release-format.log`，最终 `git diff --check` 通过；只读进程核对未发现自建原始模式测试进程遗留，日志 `logs/reset-remote-cleanup.log`。两轮源码复核覆盖错误回执、pending Promise/cleanup归属、原实例/认证generation、signal取消、清理失败阻止新建及新连接失败保留错误标签。测试后台3001、Vite9998及全部现场仍保留，未提交、推送或生产部署。扩大范围尚未验证：真实网络丢包/休眠、各发行版后台进程信号语义、传输进行中重置和编辑保存竞争；不声称重置必定终止所有远端后代进程。

### SSH 测试主机密钥确认专项（2026-10-30）

终端恢复已按用户要求提交038855a1；本批修复连接测试丢失实际Host Key挑战的问题。沿用独立测试数据库、3001 Backend、9998 Vite及api.honus.top，CDP为172.30.30.11:9223，真实SSH目标为honus.top:9902。Backend按本批源码重新构建后启动；所有脚本、日志、截图和私有状态继续集中在 `/tmp/nexus-nethogs-20261030/`，服务和目录保留至用户通知清理。未推送或部署生产。

最终脚本 `verify-ssh-test-trust.cjs` 退出0，日志 `logs/ssh-trust-cdp-final.log`。首次422挑战的实际指纹与独立保留的主机公钥扫描哈希一致后才确认。连接列表取消不写信任、不重试、不保留旧成功；确认后422→信任写入→200真实握手。已信任仅单次请求，无弹窗。只在隔离测试库注入错误pin验证密钥变更，弹窗含新旧指纹及danger警示，取消保留旧pin，明确确认后替换并成功。编辑保存凭据表单、新建未保存表单均完成确认重试；未保存连接目录前后相同，无连接保存或凭据写入。离页取消不信任/续测；注入缺少挑战的旧错误码响应得到protocol_failure，无信任框；与预期相同的指纹拒绝只测试一次，不循环询问。全部分支无pageerror，finally恢复测试前原始主机信任并仅关闭自建浏览器context。

截图 `ssh-test-first-trust.png`、`ssh-test-changed-trust.png` 已人工核对，目标、指纹和操作完整显示，沿用既有确认框。初轮脚本尝试点击被弹窗遮挡的导航而超时，修正测试为触发真实SPA离页生命周期后最终轮次通过，产品UI未改。

根 `pnpm run check` 与双端 `pnpm run build` 通过，日志 `logs/ssh-trust-check.log`、`logs/ssh-trust-build.log`。新增正式回归 `tests/e2e/specs/ssh/connection-test-host-key.spec.ts` 覆盖保存首次/变更密钥的取消与确认，以及未保存测试不建记录；同步targets.integration对具名挑战和HTTP状态的断言。目标测试严格tsc通过（`logs/ssh-trust-test-types.log`），`node --check tests/frontend/targets.integration.mjs`、全量 `pnpm run format:all:check`（`logs/ssh-trust-format.log`）及 `git diff --check` 均通过。构建后Shared codec定向断言验证合法挑战与普通错误，并拒绝缺失挑战、非法端口/指纹、嵌套额外字段、非主机错误携带挑战及外泄cause，日志 `logs/ssh-trust-codec.log`。正式夹具/全量E2E未运行；代理/多跳真实环境、并发密钥更换、确认写入丢失及权限撤销交错不扩大为本轮实测通过。

### 后台挂起恢复与密码单次保存专项（2026-10-30）

用户授权继续修改并通过CDP验证；沿用 `/tmp/nexus-nethogs-20261030/` 的独立数据库、Backend3001、Vite9998，CDP `172.30.30.11:9223` 访问 `https://api.honus.top`，实际SSH为honus.top:9902。仅操作自建context、临时连接及原PTY变量，无生产配置、容器或系统文件写入；服务与专用目录按用户要求继续保留。

根因源码核对：编辑的配置提交原先不包含密码，另有独立凭据按钮；编辑测试始终读取已保存的凭据。现在单次PUT同时提交配置与可选凭据，共用原版本事务，空密码省略、勾选清除才发送null，新密码测试使用当前草稿。移除独立凭据操作与分开保存说明，保留测试信息浮层。挂起前台恢复先向服务端复验控制权，失败未知与明确租约撤销分开；Page观察权威available集合，在最初等待结束后仍能恢复原PTY，不静默接管。

最终 `verify-suspend-password.cjs` / `logs/suspend-password-cdp-final.log` 退出0：真实错误密码握手失败；输入正确密码草稿测试成功而配置版本不变；一次保存只有一个PUT和一次版本推进，已保存SSH测试成功；密码留空改备注后仍可握手；不存在密钥引用使名称/凭据/版本一起回滚；旧CAS不能覆盖密码或配置；勾选清除和主保存一起删除凭据。截图 `password-edit-simplified.png` 已人工核对，密码遮罩、清除勾选、单保存及保留的信息图标完整。

同一脚本先使本地deadline过期但服务端owner仍有效，前台复验后不关闭健康附件。随后受控隐藏页面并停止JS续租49秒，由真实Backend独立执行45秒租约；恢复可见后自动恢复原PTY，读取先前Shell变量完全相同，workspace.connect总数仍为1。另注入续租响应失败，并在原目录store将真实available快照暂存7秒，使短暂轮询结束时仍见attached；此时旧标签保持error/disconnected而不新建Shell，释放快照后自动恢复，变量保留，耗时约7.28秒，错误为operation_unknown。所有自建资源解除挂起并关闭，无pageerror。该控制覆盖协议/状态链，不等同真实Android操作系统冻结或弱网全量验收。初轮脚本对引用错误HTTP预期误写422（实际404），延迟脚本曾只允许disconnected而实际error；修正测试预期后最终通过，未据此修改产品。

两轮源码审核：第一轮沿HTTP严格解码、公开入口投影、Service凭据政策、Model加密及SQLite CAS/关系/凭据同事务追踪，确认失败回滚及明文不进入结果；第二轮沿编辑/取消/失活、旧signal和generation、前台续租/本地deadline、目录延迟/其他owner、串行reconcile及后台标签选择复核。原45秒服务端租约、15秒续租及既有恢复次数均未扩大。USAGE和三份架构同步。

新增正式回归 `tests/e2e/specs/ssh/connection-password-edit.spec.ts` 覆盖错误密码、草稿测试取消不保存、一次保存配置及密码、留空保留、引用失败/旧CAS回滚和明确清除；原密钥切换及frontend integration消费者同步。目标测试严格tsc（含noUnusedLocals，显式Backend @types路径）与integration脚本语法检查通过，日志 `logs/suspend-password-test-types.log`。本轮未运行正式夹具或全量E2E；代理/多跳、不同移动系统真实锁屏、并发接管/权限撤销交错仍待扩大验收，不引用旧批次全量PASS。

补充 `verify-password-cancel-mobile.cjs` / `logs/password-cancel-mobile.log` 退出0：393×852触屏context四个底部动作完整处于viewport；正确草稿测试成功后取消，保存版本及原错误密码均未改变；改端口但不输入密码时明确要求当前密码且无旧配置测试请求；勾选清除后取消仍保留凭据，无PUT及pageerror。桌面及手机截图已人工核对。后续按用户明确范围恢复保留“当前保存的凭据”状态说明，只移除清除凭据后的分开保存说明。

Shared编译后codec定向断言通过（`logs/suspend-password-codec.log`）：省略保留、null清除、密码/密钥替换、密码空白原样保留，并拒绝显式undefined、空密码、非法ID和额外字段。

最终根 `pnpm run check`、双端 `pnpm run build` 及恢复保留状态说明后的 `pnpm run build:frontend` 全部通过；日志 `logs/suspend-password-final-check.log`、`logs/suspend-password-final-build.log`、`logs/suspend-password-final-frontend-build.log`。全量 `pnpm run format:all:check` 和最终 `git diff --check` 通过，格式日志 `logs/suspend-password-final-format.log`。当前改动未提交、推送或部署生产，原测试服务与证据目录继续保留。

### 普通文本原生查找恢复专项（2026-10-30）

用户明确仅恢复基本文本查找，不回退图片及其它文件预览。沿用 `/tmp/nexus-nethogs-20261030/`、Backend3001/Vite9998，CDP `172.30.30.11:9223` 实际访问 `https://api.honus.top`，自建桌面1440×1000和393×852触屏context连接honus.top:9902；通过正式文件管理器只读打开 `/etc/hosts`，未修改目标文件、测试偏好或生产部署。File-preview、filesystem产品源码无本批diff，前批密码/挂起改动保留。

源码两轮复核：先追踪FileEditor底部按钮→Monaco actions.find / CodeMirror openSearchPanel、原生快捷键和关闭；再核对父级Ctrl+F全局拦截、自建高亮/缓存/定时器/状态接口及消费者全部删除，原editor/view销毁仍负责库资源。保留Codicon、find贡献加载以及加载/保存/缩放/标签逻辑。USAGE及Frontend八节架构已同步。替换仍由原编辑器更新本地草稿，经原显式保存写入；本批只读验收未执行替换或保存。

最终脚本 `verify-native-find.cjs` 退出0，日志 `logs/native-find-cdp.log`：桌面底部搜索打开Monaco原生Find/Replace，输入自动聚焦，匹配计数/高亮、大小写开关、全词开关、正则 `^127\.0\.0\.1` 各分支实际生效；Escape关闭后点击正文Ctrl+F再次打开并聚焦，再次Escape关闭。手机打开原生CodeMirror面板，输入/匹配高亮、下一项选中、大小写/正则控件、Escape关闭及正文Ctrl+F重开通过。两端没有dirty标记、写文件请求或pageerror，自有SSH会话均关闭。截图 `native-find-desktop.png` / `native-find-mobile.png` 已人工核对：桌面紧凑VS Code查找框，窄栏保留原生布局；手机自带搜索区完整显示。

初轮脚本错误假设当前桌面使用文件管理器弹窗，实际是分栏；后续定位曾使用input而Monaco实际是textarea，并把原生translateY收起误当DOM不可见。最终使用Find可访问名称和aria-hidden契约，并在手机文件管理器关闭后操作下层编辑器；没有为脚本修改产品样式或强制点击。正式桌面/移动回归只同步原生查找消费者，目标严格tsc通过，日志 `logs/native-find-test-types.log`；未运行正式夹具/全量E2E，图片等预览没有扩大为本轮行为验收。

根 `pnpm run check`、前端 `pnpm run build:frontend`、目标测试严格tsc、全量 `pnpm run format:all:check` 和最终 `git diff --check` 通过；日志分别为 `logs/native-find-check.log`、`logs/native-find-build.log`、`logs/native-find-test-types.log`、`logs/native-find-format.log`。所有脚本、截图和日志仍在原专用目录，服务按用户要求保留，未提交或推送。

## 复制任务总进度标注专项（2026-10-30）

沿用户指定 `https://api.honus.top` 与 CDP `172.30.30.11:9223`，在自建桌面1440×1000与393×852触屏context加载当前Vite实际ProgressCenter组件，以受控TransferTask模拟三文件累计进度。使用真实Vue/i18n模块和原全局样式，不修改保存配置或远端文件；本轮只验呈现，不称为真实跨服务器传输验收。

`/tmp/nexus-nethogs-20261030/verify-total-progress.cjs` 两端通过：first.zip切换second.zip时，完整任务标题保留，35%/350MB/1项累进为60%/600MB/2项，总量1000MB/3项保留；当前文件独立且进度条可访问名称为Overall progress。完成项数与字节并存；后台传输无字节时只显示项数，未知总量不编造分母；混合下载及上传不加总进度/当前文件文案；中英日文案、取消与隐藏事件、视口边界及无pageerror均通过。证据 `logs/total-progress-cdp.log`、`total-progress-{desktop,mobile}.png`，截图已检查。实际累计公式及后台子任务平均口径保持原实现，不扩大为字节加权变更。

首次静态检查只报新helper缺少声明空行，已按原ESLint修正。最终根check、前端build、全量format及diff通过；日志 `logs/total-progress-{check,build,format}.log`。未运行全量E2E。测试服务和专用目录继续保留，未推送或部署生产。本批只提交进度呈现及其文档，前批未提交的挂起/密码/原生查找变更保留原工作区。

## 终端目录等待清行提示与全部本地变更提交（2026-10-30）

用户最终撤销草稿保留方案，要求仅提示清行并提交全部本地改动。Native Shell/Model/Service/Port 的本轮草稿试验已完整撤回至原实现；最终仅 FileManager 消费现有 onQueued.waitingForPrompt，在当前有效视图中显示一次原 feedback 信息提示。提示同时区分未执行输入（Ctrl+C 清行后原请求自动切换）与前台命令（等待正常结束），不自动清行/保存草稿，不改变后端或 UI 布局。

沿原专用目录、Backend3001/Vite9998、`https://api.honus.top` 和 CDP `172.30.30.11:9223`，`verify-directory-hint.cjs` 自建桌面与393px触屏context连接原测试SSH。两端通过：输入带光标移动的未执行printf后，按钮等待、信息提示一次、实际目录保持；手动Ctrl+C后同requestId收到directoryChanged且真实cwd变为/etc；正常提示符下切换/tmp无通知；sleep前台命令正常完成后自动切换/etc，无中断或pageerror。截图 `directory-hint-{desktop,mobile}.png` 已核对，日志 `logs/directory-hint-cdp.log`。只读现有目录及自有PTY，无远端文件写入，所有自建会话已关闭。

本次根check、双端build、四个已修改E2E的严格tsc及targets.integration脚本语法通过；日志 `logs/directory-hint-{check,build,test-types}.log`。最终全量format及diff通过，记录于 `logs/directory-hint-format.log`，未运行全量E2E。此前密码编辑、挂起恢复与文本原生查找的专项证据仍分别见上文，不扩大为本轮重复实测；按用户本次要求一并提交这些已验证的本地变更。保留专用测试目录、工具和服务，未推送、发布或部署生产。

## E2E 连接选项加载失败提示（2026-10-30）

main/96ea73b2 的远程 [41049355889](https://github.com/0honus0/nexus-terminal/actions/runs/41049355889) 只有 browser shard 7 一项失败（同组57通过），其余7个测试分片、质量与Docker smoke通过。失败为 ssh-key-management 的320px密钥加载失败场景，首次与重试均在 options_failed 提示消失处失败；日志 `logs/e2e-41049355889-failed.log`，作业元数据 `e2e-41049355889-jobs.json`，继续保存在原专用目录。

根因是新form深度watch将普通草稿变化同时当成清除submitError的依据；列表失败已到达后点击SSH Key，错误被误清空。修复删除这一次清空，保留testResult随草稿失效，显式测试/提交及reset仍按原路径清除旧操作提示，不改变UI、契约或错误处理。既有用例先等真实选项错误，再切换认证、修改名称并分别断言错误保留；原管理器网络Toast和320px无溢出断言保留，没有删除场景、延长超时或放宽断言。

两轮源码复核覆盖初始加载先后、字段deepwatch、显式操作清错、reset和旧异步代次；本轮不运行本地行为/E2E；根check、前端build、目标严格tsc、全量format与diff通过，按D17/D18提交推送，整轮远程验证见下方收口。日志 `logs/e2e-options-{check,build,test-types,format}.log`；不发布或部署，原测试现场保留。

修复提交 `3b98d81f` 的新远程 [41050797589](https://github.com/0honus0/nexus-terminal/actions/runs/41050797589) 完整成功。原SSH key selector/manager失败项首次通过；各轮passed计数48+1、71+1、53+1、60、66、55、58、124，共538，日志中的538条passed标题互不重复；无failed测试事件，也无failed/flaky/skipped摘要，未重试场景。质量、Docker、8测试分片及耗时维护均成功。完整日志 `logs/e2e-options-41050797589.log`、汇总 `e2e-options-summary.json`、作业与产物元数据同目录；额外维护提交 `72b2fa55` 已fast-forward到本地，仅变更duration-estimates。全部测试服务和专用目录继续按用户要求保留。本次最后仅提交验收文档，不触发发布或部署。

### 2026-11-02：弱网输入回退与删除停顿专项

基线为main `beff7a99`，起始工作区干净。本轮使用Node v22.23.1、隔离工具pnpm 11.28.9和仓库Playwright 1.64.1；CDP `172.30.30.11:9223`，页面 `https://api.honus.top`，前端Vite9998。原临时目录与服务在当前环境已不存在，重建 `/tmp/nexus-nethogs-20261030/` 保存全部脚本、工具、缓存、截图和日志，仅启动前端，不启动后端或修改远端数据。每项使用自有浏览器context并关闭；不复用用户页或登录数据。

修复前CDP挂载真实TerminalView，沿onInputSent及onOutput回放：学习延迟后将回显延迟1600ms，已显示i撤回；输入ijkl后立即DEL两次，在旧字符回显前仍显示ijkl；退格前SGR被拆包时误判Failure，已删除内容重现。证据 `baseline.log`、`delete-style-baseline.log`。第一版修复复核还发现新行首探测在合并回显中解锁generation时，删除的撤销单元格尚未解析，快照漏还原已确认jk；证据 `rollback-baseline.log`，最终保留配对字符及真实样式修正。早期脚本CommonJS转换动态import导致的__importStar缺失已改为保留ES动态import，不作为产品失败。

最终 `final-regression.log` 的10项均通过、pageerror为空：原慢回显分歧校正；新增抖动输入与退格保留（官方虚拟时钟推进2秒/4秒）；新增未确认输入后立即删除/替换，旧回显及分包SGR/退格到达时内容不复活；新增远端实际文字分歧校正；新增合并回显后的快照/重挂载还原确认内容；新增20次DEL跨未确认与已确认文字、真实两种Bash退格模式分批确认；原颜色/光标分包与多DEL；原行尾保护；原未确认快照隔离；原密码首字符与粘贴保护。回放复用正式terminal-lifecycle的函数及测试正文，仅将浏览器模块地址替换为Vite源码入口、去掉构建产物CSS地址，未运行完整测试夹具。输入记录断言保持每次输入只派发一次，输出消费次数逐包核对。

源码两轮审核覆盖可见预测不因沉默超时撤销、不可见探测及失效timer、同代字符/删除覆盖和真实样式、匹配成功/分包/失败、合并回显与snapshot/reset、原始ACK和Transport派发链；不增加新期限、重发或UI变更。根 `pnpm run check`、`pnpm run build:frontend`、目标严格tsc（含noUnusedLocals）、Playwright静态列举26项、全量 `pnpm run format:all:check` 与 `git diff --check` 通过；日志分别 `check.log`、`build.log`、`e2e-types.log`、`e2e-list.log`、`format.log`。本轮验证为受控延迟/分包的真实组件回放，未验证真实SSH网络抖动、全部Shell/TUI或完整远程Actions，不以旧538项PASS替代本轮证据；未提交、推送或部署。目录与前端服务继续保留，等待用户明确删除。

## 安卓普通文本查找呈现专项（2026-11-02）

指定站点api.honus.top的独立CDP context挂载真实FileEditor与内存文档，Android14 UA/touch模拟。修复前英文渐变默认面板证据mobile-search-before._，修复后mobile-search-after._，脚本mobile-search.cjs，均位于 `/tmp/nexus-nethogs-20261030/`。三语×320/360/393px、横屏及缩小高度共15组合，无控件重叠、越界或横向溢出；查找3项、大小写2项、正则2项、前后导航、切换语言保留正则query、替换全部只改草稿、关闭/重开/Escape通过，pageerror为空。深色面板输入16px、按钮32px，导航及关闭独立占位；桌面Monaco、文件列表搜索和其他预览未改。未使用真实安卓设备或真实软键盘，缩小视口不等同真机输入法验收。静态结果见下方本轮最终记录。

## 命令历史恢复与 SSH 半关闭专项（2026-11-02）

指定站点CDP使用独立context、真实store/API/Shared和完全拦截的历史接口，不向生产写入。`/tmp/nexus-nethogs-20261030/history-recovery.cjs` 与同名log验证：首次POST已在夹具保存但丢回执；下一次新意图GET→POST→GET、旧POST仅一次；恢复GET失败不发送新POST；普通load成功恢复；读取中撤权不派发；reset后旧读取和旧写不污染新scope；两个新意图共享串行恢复、各POST一次。另提取当前WorkspacePage的真实sendCommand正文，以esbuild仅去类型后在CDP执行，挂载真实NotificationHost和store：显示准确未知提示、刷新动作只读，两个终端命令及追加各一次，无pageerror。终端adapter为内存记录，未据此宣称真实SSH整页回归。正式command-history-management新增真实SSH丢失201回执用例，观察WS输入、POST次数、GET先于下一次写入及原界面提示，静态检查通过后留远程E2E。原app-lifecycle消费者同步无参load。

`tests/backend/remote/backend-next-ssh-close.integration.mjs` 使用真实ssh2 Server/Client和本机TCP中继，认证后丢弃数据且不回应FIN；仅运行这个Adapter定向文件，不启动应用后端或全量套件。`ssh-close-regression.log` 五项通过：直连、HTTP代理、SOCKS5代理、跳板半关闭和正常关闭，并断言并发close共享Promise。原2秒结束等待＋2秒强制关闭确认不变。回归发现代理readBytes在流动状态unshift会同步重入、HTTP握手超时；归还多余字节前pause后HTTP/SOCKS5均通过，早期失败见ssh-close-handshake.log。本轮未重启或更新生产容器，未把SSH清理失败当作历史写入失败的证据。

生产日志与只读库元数据调查见指定目录history-investigation.md：最近24小时7次历史POST全部201且responseFinished，最近两条已落库，原始客户端故障触发点仍不确定；上述修复针对已独立复现的缺陷。本轮最终根 `pnpm run check`、`pnpm run build:backend`、`pnpm run build:frontend`、`pnpm run format:all:check`、`git diff --check` 均通过，日志history-ssh-check.log、history-ssh-backend-build.log、history-ssh-frontend-build.log、history-ssh-format-check.log位于指定目录。两个改动E2E文件严格tsc（含noUnusedLocals、显式Node类型）通过，Playwright只列举28项，日志history-ssh-e2e-types.log和history-ssh-e2e-list.log；新增Node用例及原app-lifecycle语法检查通过。初次检查发现新夹具函数空行不符合项目ESLint、目标tsc漏显式Node类型，已分别修正格式和检查参数后通过，未放宽规则。未执行正式全量/远程E2E，未验证真机软键盘、生产SSH关闭故障全集或原始报错现场；未提交、推送或部署。测试临时目录及前端服务按要求保留。

## Agent Shell 等待/执行分离与旧围栏拒绝专项（2026-11-02）

生产仅使用指定SSH和Node只读SQLite查询（readOnly/query_only），没有更新记录、重放原命令、重启或部署。指定临时目录内agent-db-{inventory,details,chain}.jsonl确认同一线程2026-10-29三个Run，目标为fxm/connection 7：首轮完成；第二轮shell_execute从取得突变占用至unknown约45.136秒，持久failureCode=tool_timeout，原claim保持blocked；第三轮新shell_execute约35ms即因原claim被拒绝，却误记tool_state_changed/unknown。24个模型步骤全部completed，诊断结果里Hermes的429/503及NameError不能算作Nexus模型故障。当前容器11月1日才启动，10月29日stdout已不在现容器中，不能确定原长命令内部哪个子步骤耗时或证明远端进程已停止。旧生产claim未解除。

采用OpenAI Docs技能读取[官方Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)：该文明确exec_command启动持续PTY、write_stdin可输入或轮询原session。另核对[官方Shell指南](https://developers.openai.com/api/docs/guides/tools-shell)的exit/timeout和捕获结果区分。Nexus实现借鉴持续任务标识与后续观察，复用现有Job，不声称复制Codex内部实现，也不新增交互TTY或持续输出能力。

定向运行命令（非本地全量E2E）：`TMPDIR=/tmp/nexus-nethogs-20261030 NODE_COMPILE_CACHE=/tmp/nexus-nethogs-20261030/node-compile-cache node --test --test-concurrency=1 tests/backend/http/backend-next-agent-shell-yield.integration.mjs tests/backend/remote/backend-next-machine-admission.integration.mjs tests/backend/storage/backend-next-authority-monitor.integration.mjs`。模型输出为本机HTTP夹具，不调用付费模型；应用HTTP/治理/SQLite/Run/Job与独立OpenSSH真实执行。最终agent-yield-regression-final.log共18项PASS，零失败/跳过：前台和后台以1秒等待预算运行3秒命令并多次续查，副作用各一次；yieldSeconds=0可查询、短命令保留原非零/双输出结果；held与blocked新命令均failed且未启动、原claim及修订不变；前台交回后的撤权、原Run3秒总预算及未知效果围栏；多资源blocked优先于held且无部分占用；650秒调用预算传到命令但SSH握手仍最多原300秒（通过真实应用owner与受控技术Port观测参数，不等待650秒）；65项Job列表分页；ACP/Job真实1秒权限监测的晚到存储失败/执行失败及清理汇总。

第二轮并发回归发现新的前台交付竞态：Job读取dispatched版本后，原工具完成交付导致revision变化，监测错误中止原命令。修复仅容忍同哈希、单次dispatched→completed交付后只读重验，未重派命令。保留失败夹具数据库nexus-agent-shell-yield-8SxchA用于核对；最终定向回归及确定性交错测试覆盖成功、撤权、哈希变化、修订异常、失败终态与存储拒绝。另一个测试夹具初次使用非哈希资源键，被真实存储解码器正确拒绝，已改为实际64位SHA-256，不放宽产品解码。

指定api.honus.top/CDP独立context挂载真实NativeToolCallDetails，拦截且仅模拟两次详情GET，沿真实HTTP/Shared codec验证busy/blocked在原区域显示“尚未执行”及“机器突变恢复”，三语无漏键、pageerror为0。证据agent-errors-cdp.cjs/log；未登录用户会话或调用生产执行接口，不把前端夹具当已部署Agent验收。所有脚本、数据库、SSH测试夹具、缓存和日志均保留在原专用目录；自建SSH daemon/客户端和应用实例已正常关闭。

本轮最终根check、Shared check、Shared/Backend/Frontend build、全量format及diff均通过，结果见agent-check-final.log、agent-shared-check.log、agent-backend-build-final.log、agent-frontend-build-final.log、agent-format-check-final.log。USAGE与双端/Shared架构已同步，工具模型私有Job参数未另建Shared DTO。未运行全量/远程Actions、真实付费模型或原生产Hermes命令，不承诺任意远端派生进程可停止；未知效果恢复仍需独立核对。未提交、推送或部署，前端及专用目录继续保留。

## Agent 工具故障后总任务结束等待（2026-11-02）

本轮在原专用目录 `/tmp/nexus-nethogs-20261030/` 保留全部夹具、日志和缓存。使用 Node 22.23.1、pnpm 11.28.9；TMPDIR 和 NODE_COMPILE_CACHE 均指向该目录。只运行以下定向回归，不执行本地全量 E2E：

```bash
node --test --test-concurrency=1 \
  tests/backend/http/backend-next-agent-job-failure.integration.mjs \
  tests/backend/http/backend-next-agent-ledger-faults.integration.mjs \
  tests/backend/http/backend-next-agent-shell-yield.integration.mjs \
  tests/backend/remote/backend-next-machine-admission.integration.mjs \
  tests/backend/storage/backend-next-authority-monitor.integration.mjs
```

`agent-task-stop-regression-transport.log`：35 项 PASS，零失败、取消或跳过。新故障场景通过真实应用 HTTP/治理/SQLite/SSH，只脚本化本机模型输出：实际 SSH 进程写入一次后按原 `/proc` 出生身份终止，验证前台、Job wait、后台模型流及无关审批等待自动结束；没有手动取消、模型收尾响应、执行期限或重启参与唤醒。断流 Job 保留 unknown/blocked，Root 进入终态，原待审批工具 superseded，模型不再请求或重复轮询；重启不重放，仍能从原 Job 查到具体原因。Child 故障只停止原 Root/族，另一 Run 的模型仍可完成；已取消 Run 的晚 Job unknown 不覆盖 cancelled。

另以真实 TCP relay 切断 SSH 传输，确认 Root 已进入 unknown 并关闭模型等待时，按原出生身份核对的远端进程仍然存活，副作用仅一次，机器围栏仍 blocked；之后由测试 owner 独立终止原 helper。该场景直接验证本地停止等待不证明远端停止，不能把真实未知改写为确定失败。

新增实际主机信任拒绝验证：命令从未执行，工具和 Job 均 failed/not_started，Root failed/tool_host_untrusted，无机器围栏。原长命令多次 yield、快速非零退出、held/blocked 拒绝和绝对 Run 期限用例继续通过。对 Job 终态写入注入确认丢失，原模型流自动关闭，Job 没有猜测补写，原异常可从关闭汇总确认；重启只围栏不重发。实际工具派发、审批消费、完成事务先提交再丢回执的三项回归新增“重启前 Root 已 unknown”断言，原工具没有补偿写入，完成结果及单次文件效果保持。真实间隔权限监控的晚存储/清理失败只在监控收敛后通知一次；未知 Job 四种查询均抛具名失败。

指定 `api.honus.top` CDP 独立 context 挂载实际 NativeToolCallDetails，经真实 HTTP/Shared codec 只拦截一次详情 GET，验证 tool_result_unconfirmed 在中文、英语、日语原错误区均明确任务已停止，无漏键和 pageerror。实际 native-run-rules 验证 unknown 不再算执行活跃，但保留显式结束资格；composer/详情/订阅/续发调用链同步核对，没有新增控件或改变布局。脚本与输出为 `agent-task-stop-cdp.cjs`、`agent-task-stop-cdp-final.log`。这是前端隔离验证，不代表生产已部署或真实供应商验收；没有用户会话、生产命令或业务写入。

根 `pnpm run check`、Shared check、Backend/Shared build 和最终 Frontend/Shared build 通过，证据为 `agent-task-stop-check-final.log`、`agent-task-stop-shared-check.log`、`agent-task-stop-backend-build-final.log`、`agent-task-stop-frontend-build-final.log`；全量 `pnpm run format:all:check` 和 `git diff --check` 通过，格式日志为 `agent-task-stop-format-check-final.log`。新增 SSH helper、daemon、应用及 CDP context 均关闭，原用户要求保留的 Vite 和临时目录继续保留。未提交、推送、部署或解除生产旧围栏。完全不可写的数据库仍不能保证提交终态；保留原错误和恢复事实，不以本机故障注入宣称覆盖真实断电或持久介质故障。

## 手机终端自适应底部越界（2026-11-02）

沿用 main beff7a99 的现有未提交工作区、Node 22.23.1/pnpm 11.28.9、原 Vite9998 及专用 `/tmp/nexus-nethogs-20261030/`；指定 `https://api.honus.top` / CDP `172.30.30.11:9223`，独立 context 挂载真实 WorkspaceLayoutRenderer、TerminalView、WorkspaceMobileTools，内存 TerminalChannel 记录真实拟合行列，无 SSH/生产数据写入。不是生产整页或真机输入法验收。

修前 `mobile-terminal-geometry.cjs before` 的 42 组高度/字号/键盘开关中，键盘关闭有 7 组超出内容区 1–4px，开启也有 9 组超出；实际容器没有越界，是 FitAddon 把父元素上下 7px 内边距算入可用行高。原边距移至外层 terminal-container，拟合父节点无内边距。修后同 42 组全部通过，另 `mobile-terminal-geometry-extra.cjs extra` 的 320/360px、横屏和宽屏共 8 组通过，`desktop-terminal-geometry.cjs extra` 的真实非触屏桌面 context 1280/1920px、14/16px 字体 4 组通过。屏幕底边全部在终端内容范围内，页面错误为零；输出日志为同名 before/after/extra/desktop 文件，均在专用目录。mobile-terminal-geometry-keyboard-off/on.png 已人工检查末行文字完整、原边距及底部控件位置。自有 context 已关闭，保留原 Vite 和目录。

既有 mobile/keyboard-geometry 回归补充 gap 非负及虚拟键盘开关后 screen.bottom 不越过内容底边/工具栏顶边的断言，未启动正式全量 E2E。目标严格 tsc（含 noUnusedLocals、Node 类型路径、TS6 --ignoreConfig）通过；首次命令缺 --ignoreConfig 被 TS6 拒绝，修正命令后通过，未放宽代码校验。根 check、前端 build、全量格式和 git diff --check 通过；日志为 mobile-terminal-geometry-check/build/e2e-types/format-check.log。没有新增监听、延迟、协议或数量限制，未提交、推送或部署。

## 服务器状态趋势时间轴与加载呈现（2026-11-02）

同一 main beff7a99 未提交工作区、原 Node22/pnpm11 工具、Vite9998 和 `/tmp/nexus-nethogs-20261030/`。指定站点/CDP 的独立 context 挂载真实 StatusMonitor/StatusCharts，提供只读内存样本与控制器，拦截真实 StatusCharts.vue 模块请求以保持加载，释放后加载原模块；不假造图表组件、不调用生产 SSH/采样接口、不修改用户配置。脚本 status-trend-layout.cjs，日志 status-trend-layout-before/after.log，截图 status-trend-loading-before/after.png 和 status-trend-chart-before/after.png，均在原目录。

基线在 180/294/393px、0.65/1/1.6 倍及四种时间范围共 36 组确认：X 轴默认占 23.6 CSS px，屏幕占位随缩放从约 15.3 到 37.8px；加载直接显示左侧 15px 转圈。修后禁用 tick 留白，时间文字/间距抵消父缩放，36 组屏幕轴高均约 13.6px、零倾斜，完整时间跨度保留、曲线仍有可用高度。另核对网络四范围数据逐点等于原样本，真实鼠标悬浮同时展示同一时刻的上下行值。初次加载的同区域网格/提示、三语、prefers-reduced-motion 静止及骨架切换后 top/height 差异小于 1px 均通过；截图人工核对，无 pageerror。骨架仅装饰网格，不伪造指标曲线。

前两轮脚本分别遇到 Vite 热更新查询参数绕过精确路径匹配，以及根 check 重建 Shared 引起 Vite 页面刷新；调整拦截只匹配 pathname，并在会产生写入的静态构建完成后重跑。脚本还纠正 emulateMedia 所属 page API；这些均是验证脚本/执行时序问题，最终记录为新的独立 context 全部 PASS，未修改产品来适配夹具。

本轮根 check、前端 build、全量 format:all:check 与 git diff --check 通过，日志 status-trend-check/build/format-check.log；没有新增正式低影响样式测试或执行全量 E2E。用户授权仅改变趋势时间轴和加载呈现，其余卡片/标题/选项及数据转换不变。指定 CDP 为隔离组件验证，不代表真机、生产整页或新部署验收；自建 context 已关闭，保留原 Vite 与专用目录，未提交、推送或部署。

## 依赖升级与 main dev 发布（2026-11-02，完成）

本轮基线 main/beff7a991caa09b3a8bd70a90f494ed05da54027；用户确认从 main 发布 dev/amd64，包含当前会话全部已授权未提交修复。最近失败的更新工作流 [41422400796](https://github.com/0honus0/nexus-terminal/actions/runs/41422400796) 在生产依赖审计失败，后续 E2E 调度未执行；不能把此前完整通过的 41050797589 当成本轮结果。原始 job 日志为专用目录的 dependency-update-job.log。

沿用 Node 22.23.1、隔离 pnpm 11.28.10，所有缓存、脚本和日志放 `/tmp/nexus-nethogs-20261030/`，pnpm store 继续用 cache/pnpm-store。稳定直接依赖升级，并保留三个现有库补丁；follow-redirects 锁定 1.16.2。readdir-glob 与三个开发工具消费者分别定向使用 minimatch 11.0.3，其上游的实际 Minimatch/glob API 已核对，没有忽略公告或放宽审计。最终 install、dedupe、frozen install 成功，生产及完整依赖审计 info/low/moderate/high/critical 全零，证据 dependencies-{install,dedupe,frozen}-final.log 和 dependency-audit-{prod,all}-final.json。

升级后根 check、Shared check、Backend/Frontend build、全量 format:all:check 和 git diff --check 通过，日志 dependencies-check-final.log、dependencies-shared-check-final.log、dependencies-build-final.log、dependencies-format-final.log。archiver 真正 glob 嵌套及隐藏文件，生成有效 ZIP，见 dependency-archive-smoke.mjs/log 与 dependency-archive-fixture/；该夹具也保留。指定 api.honus.top/CDP 的自有 context 运行实际编辑器 decodeEditorDocument，UTF-8、GB18030、Shift-JIS、带 BOM 的 UTF-16LE 均还原完整原文，无 pageerror，证据 dependency-encoding-cdp-final.log。初次脚本只匹配双引号，未匹配 Vite 的单引号动态导入，已修正验证脚本后通过，未为此修改产品。所有自有 context 已关闭；原 Vite 与专用目录保留。

这些是依赖兼容及静态证据；完整远程 8 分片、Docker smoke 与实际 dev 发布尚待新提交运行。未更新生产容器。

升级后另复跑既有 Agent/SSH 定向场景（原 35 项加 SSH 半关闭），dependencies-agent-ssh-regression.log 共 36 项通过，零失败、取消或跳过，使用真实隔离 HTTP/SQLite/SSH 与本机模型夹具；临时数据库保留，原 Vite 未停止。

首轮远程 [41446828166](https://github.com/0honus0/nexus-terminal/actions/runs/41446828166) 在产品提交 27598ee0 上完成：检查/格式、Docker smoke 和 5 个 browser 分片通过；backend1、browser3、browser7 分别有一项失败，首次和重试同因。mutation-capacity 夹具在 reconcile 后仍期待 conflict，实际新契约为 blocked；terminal-ui 仍从旧 inner 节点读取 4/5/3/5px，间距已按此前修复移至外层；reconnect-ui 假设正确拟合列数一定超过 80，但 1280px 桌面实际分栏宽度正确对应 80 列。日志 e2e-41446828166-{backend-1,browser-3,browser-7}.log，browser7 全部诊断包含失败截图/trace 保存在 e2e-41446828166-browser-7-artifacts/；截图已核对。

修复仅同步这三个真实测试消费者：保留 4100 项容量、held 冲突、reconcile/snapshot 和未知围栏断言，明确 blocked；间距检查改读外层并同时检查 inner 零 padding 及屏幕四边在内容区域内；重连改为实际窗口放宽时列数增加、恢复后原尺寸一致，保留其全部后台/唤醒/重连及协议画面断言。没有改变产品 UI、降低断言、扩大超时或跳过测试。修复后根 check、目标严格 tsc（含 noUnusedLocals）、全量格式和 diff 通过，正式发现保持 137 文件/544 项，未删除或跳过场景；4100 项真实 SQLite 容量夹具通过。证据 e2e-repair-{check,types-final,format-check,discovery,mutation-capacity}.log。严格 tsc 同时发现 terminal-ui 一条旧的未使用导入，已删除后重新通过。仅测试/文档变化，无产品源码变化，复用本轮相同产品构建；完整远程结果继续回填。

第二轮远程 [41448770819](https://github.com/0honus0/nexus-terminal/actions/runs/41448770819) 在539067a8上完成：几何、窗口拟合及后台重连通过，检查、Docker smoke和6个browser分片通过。backend1的4100项夹具本身通过，但外层spec漏同步stdout完成文案，本轮同时修正消费者；browser3的OSC52首次失败、重试通过，failOnFlaky正确拒绝整轮。trace和截图显示零间隔100多个按键发生terminal_input_server_rejected、shell命令缺字并停在续行提示，证据为e2e-41448770819-{backend-1,browser-3}.log及browser3完整artifacts目录。这是真实后端通知准入问题，未放慢测试、扩大RPC名额、移除原断言或接受重试换绿。

修复归原WorkspaceFilesSession：无回执输入复用原Shared解码，捕获原附件和代次，串行合并并按完整wire字节占用既有1MiB预算，批次不超过原256KiB；每批重新鉴权，await后复验关闭/身份，断线不重放。有回执输入及普通RPC继续64个名额。新增backend-next-terminal-input.integration.mjs的8项定向测试通过（input-burst-owner-regression-final.log）：192条逐字通知精确有序、活跃鉴权与排队共用预算、空输入envelope、多字节批次、撤权、关闭等待、worker收尾微任务交错和旧附件晚授权不误投新附件。该测试直接调用真实WS协议owner，Workspaces/channel为受控能力，不能冒充真实SSH；首次夹具遗漏订阅与resumeOutput能力，补齐夹具后通过，未为夹具放宽产品代码。另新增正式SSH/WS突发通知用例，原OSC52零间隔输入保持，正式发现为137文件/545项。

本轮最终根check、Shared随Backend构建、双端build、目标严格tsc（protocol/http容量/terminal-ui，含noUnusedLocals）、全量format:all:check及git diff --check通过，日志input-burst-{check,build,types,format}-final.log；最终Backend产物重跑8项owner测试通过。没有运行本地全量E2E，完整远程8分片及发布继续验收，未更新生产。

第三轮 [41452555703](https://github.com/0honus0/nexus-terminal/actions/runs/41452555703)（514cb946）中，质量、Docker smoke、全部7个browser分片通过，OSC52首次通过且无flaky；backend仅新突发输入测试失败。该spec使用默认pipe Bash却硬等CRLF，修正为显式开启夹具已有真实PTY模式，保留完整marker断言。backend失败日志及完整artifacts保留原目录，不能把本轮记作全绿。

随后本地真实OpenSSH+完整HTTP/WS复验又发现独立传输缺口：159帧在同一网络批次触发Platform的WS_INPUT_QUEUE_EXCEEDED，64条仅3072字节便断开；原8项owner测试未经过技术通道，未覆盖该层。失败日志input-burst-real-openssh{,-second}.log、数据库/密钥均保留。修复原Platform通道，让同步回调立即释放、真正的异步回调保持原容量和顺序；Workspace注册同步accept，不改阈值。初版通道6项加WS owner8项共14项通过，真实OpenSSH同159帧完整CRLF marker、零protocol.error、后续suspend.list通过，证据input-burst-channel-regression.log和input-burst-real-openssh-final.log；只对本机自建daemon与数据库操作，应用/SSH正常关闭但文件保留，原Vite未停止。最终补充防重入及CLOSING读取验证和静态结果继续回填。

最终通道7项与WS owner8项共15项全部通过（input-burst-channel-regression-final.log）；真实OpenSSH在最终Backend产物上再次通过159帧、精确CRLF输出、零协议拒绝及后续查询（input-burst-real-openssh-current.log）。根check、双端build、目标严格tsc、全量format及diff通过，日志input-burst-channel-{check,build,format}-final.log和input-burst-pty-types.log。onMessage的Agent、PTY、upload、catalog消费者逐一核对，保留原异步串行等待；只有Workspace原同步准入声明为void。完整远程继续验收，未发布或部署。

第四轮完整远程 [41455018366](https://github.com/0honus0/nexus-terminal/actions/runs/41455018366) 在8996615593c0ad96eece7f6d6eb33d9f828b5f4d上全绿：质量、Docker smoke、backend及全部7个browser分片成功。backend125项，browser各51/63/62/52/59/71/62项，共545项，零失败/跳过/flaky；browser1包含普通48项与三组独立入口场景各1项，统计全部notice，不能漏掉后续三组。新PTY逐字159帧319ms通过，原零间隔OSC52首次1.9s通过。完整8个job日志为e2e-41455018366-{backend-1,browser-1..7}.log，状态与逐分片统计为e2e-41455018366-status.json、e2e-41455018366-verification.json。

CI随后自动提交fb54344459e61f17b831df5e6f3854ff9919ae3d，只改变scripts/e2e/duration-estimates.json。fetch/diff及Docker COPY输入核对没有产品、依赖或镜像构建输入变化，保存e2e-tested-build-inputs.txt/dev-publish-build-inputs.txt；发布使用该main HEAD，不声称bot新SHA直接跑过E2E。[41456251490](https://github.com/0honus0/nexus-terminal/actions/runs/41456251490)生产审计及镜像发布均成功；workflow日志和状态为publish-41456251490-{prepare,image}.log、publish-41456251490-status.json。未使用release/latest渠道。

直接用docker buildx imagetools只读核验GHCR：ghcr.io/0honus0/nexus-terminal:dev与sha-fb54344459e6指向相同摘要sha256:98148fc6ea192e42d2d8e2a7504d468dd8406b9841392397e7d6641c74dbca21，排除证明清单后的唯一运行平台为linux/amd64，config OS/arch与OCI revision=fb54344459e61f17b831df5e6f3854ff9919ae3d、version=sha-fb54344459e6均匹配。证据dev-publication-verification.json/log、dev-image-after*.json/txt及immutable清单，全部保存在/tmp/nexus-nethogs-20261030/。该验证不启动或替换生产容器；原Vite PID5849及测试目录按用户要求保留。最终仅回填文档并提交，不重复触发无产品差异的全量E2E。

## 手动清理 Actions API 瞬时失败（2026-11-02，完成）

用户要求解决另一条Actions失败。实际为手动清理[41461823321](https://github.com/0honus0/nexus-terminal/actions/runs/41461823321)，job125332537068已解析latest/dev并计划删除旧资源，DELETE artifact13145138530返回GitHub HTTP500；github-script@v9 retries默认0，直接中断，不能推断此前删除已回滚。原生产和dev镜像均无故障证据。

改动只在cleanup-history workflow及原maintenance owner：按github-script官方示例配置3次单请求退避，不自建重试库或重跑整个脚本；精确DELETE返回404视为已不存在、单独统计，只有成功回执计为本次删除，权限或最终5xx仍失败。运行读取404保留无法复验的artifact；包版本删除request.retries=0，避免退避后绕过verifyChannels。原latest/dev manifest闭包、最新绿E2E、关联成功运行、当前/活跃/重启运行与缓存保护保持。

scripts/maintenance/cleanup-history.test.mjs使用真实脚本和受控GitHub/GHCR能力，8项PASS：渠道及共享平台/attestation/成功证据保留、五类DELETE404继续且统计不虚增、403/最终500传播、运行读取404、活跃及重新启动保护、渠道移动停止。该无依赖Node测试作为手动workflow首步骤执行，失败阻止真实删除。另以官方Octokit Core7.0.6和retry8.1.1验证5组实际插件请求，并核对github-script@v9锁文件后用准确的retry8.1.0复验通过：500→204成功，500后404最终可分类，403最终拒绝，镜像请求retries=0单次派发，持续500按3次重试耗尽；实际请求尝试数依次2/4/4/1/4，不能把上游exempt说明当作永久拒绝始终只发一次的证据。最初夹具误期待第二组只调用2次，修正为实测插件行为后全部通过，没有更改产品以匹配夹具。

本地Node22.23.1、隔离pnpm11.28.10，根check、全量format:all:check、目标ESLint/Prettier、node --check与git diff --check通过；没有业务包源码或依赖变化，不重复应用build/全量E2E。工具与日志集中/tmp/nexus-actions-cleanup-20261102，任务完成后按用户清理要求删除。远程工作流和保留镜像核验继续回填，不更新生产容器。

修复提交6f20c9d5ab0e29b5460335f57df726d2427184dc后，手动工作流[41468963720](https://github.com/0honus0/nexus-terminal/actions/runs/41468963720)及job125357193266的回归/真实清理全部成功。15:10:35–15:13:38 UTC日志计划29个旧运行/190个产物并完成；事后仓库仅剩本次清理、成功发布41456251490、成功E2E41455018366及排队E2E34749067364，artifacts为12个。因34749067364仍queued，明确跳过123个候选产品版本、70个runner版本及888个cache，属于原活跃保护，不是失败或已删除；未取消旧排队任务。原失败运行按既有历史清理策略已删除。

清理前后用docker buildx imagetools inspect实际核对latest=sha256:10dde94e2ef020a823d42643d980f175a915c108a4c36c3d69dca8c0264b4724、dev=sha256:98148fc6ea192e42d2d8e2a7504d468dd8406b9841392397e7d6641c74dbca21，均未变化；当前E2E及发布记录API仍success。新增本地日志、npm工具/缓存、Octokit故障夹具全部集中/tmp/nexus-actions-cleanup-20261102，完成后删除，长期证据以本段与保留的远程成功工作流为准。只改维护脚本/工作流及文档，没有UI、产品包、依赖或生产改动，不重新发布镜像或执行无关全量E2E。

## 文件拖动悬停导航与右键取消（2026-11-02）

FileManager 的内部原生拖动在目录行和 `..` 行停留2秒进入，导航保留本次原始条目，当前目录空白松手沿原moveTo链派发。右键取消清空拖动源、选择、悬停等待和目标；不更改当前浏览目录，也不派发移动。文档级捕获右键drag/dragover/drop覆盖源节点因导航移除、容器外及快速松手，失活/断线/换通道/卸载清理计时与监听。保留原快速drop、移动过滤、外部上传和UI。

通过指定 `http://172.30.30.11:9223` CDP、Chrome156，在 `https://api.honus.top/__file_drag_probe__` 独立自有context挂载当前Vite编译的真实FileManager、真实useFilesystemBrowser及样式/i18n。仅目录Port和moveTo消费者受控，没有连接真实SSH或移动用户文件。8组PASS：文件夹连续进入两级后空白放置只发一次原源移动；原目录即时右键取消清选择且2秒后不导航；两级后右键保留当前路径且不移动；多选文件返回两个上级（含源目录）再进入兄弟目录仍保留两个源；自身悬停拒绝及快速drop；换行重置2秒；视图失活；断线。无pageerror，截图drag-final.png。工具、日志及缓存集中 `/tmp/nexus-file-drag-navigation-20261102`，验收记录为verify.log。

测试驱动核对：Playwright1.64.1的DragManager接管拖动时RawMouse.down直接忽略第二鼠标键，RawMouse.up改为drop，不能用page.mouse右键结果推断产品故障。受控验收和新增正式回归改用Chromium原生Input.dispatchMouseEvent，保留buttons左+右组合；实际DOM的drop可仍显示原生move效果，但产品必须无moveTo派发。测试初轮的expect导入和裸CDP移动步数问题已修正，不计为产品通过证据；最终verify.log为8组完整PASS。

正式 `tests/e2e/specs/ssh/file-manager-navigation.spec.ts` 新增实际SSH夹具断言，覆盖待导航右键、两级后取消、常规右键恢复、多选文件/文件夹通过两级上级与兄弟目录、源删除及文件夹内容保留；原触控桌面快速移动/上级移回断言完整保留。新正式用例尚未在完整后端/SSH E2E运行，不把Port受控验证称为远端文件移动验收。未提交、推送或部署。

最终静态检查：根 `pnpm run check`（Backend包级含Shared构建、双端ESLint、Frontend类型）及 `pnpm run build:frontend` 通过，日志check-final.log/build-final.log；变更E2E的严格tsc（strict/noUnusedLocals、ES2023、Bundler）通过，日志e2e-types-final.log。新增测试的函数间空行已按原ESLint规则修正，全量 `pnpm run format:all:check` 与 `git diff --check` 通过；本轮不运行完整本地E2E或触发发布。自有CDP context在finally关闭；Vite9998和集中测试目录按用户要求保留，等待用户通知删除。

## 手机编辑器底栏两行布局（2026-11-02）

用户报告路径及amd服务器名遮挡、换行符太窄，随后要求最多两行且保持紧凑。基线通过指定CDP在390px手机、16px边距的真实FileEditor受控挂载复现：原路径可见宽度仅3.33px；320px时路径0px，scope超出identity范围；换行符被原窄屏规则压至49.59px。原footer强制nowrap，identity与元信息/按钮竞争且overflow裁剪；换行符固定3.1rem。只改组件560px容器查询：两行Grid、首行路径/服务器与保存状态分别让位，第二行编码占剩余空间、5rem换行符与原三个动作按钮。低高度且极窄容器的原紧凑模式显式恢复flex；没有改共享UiSelect、色彩、编辑/保存逻辑或宽屏布局。

指定 `http://172.30.30.11:9223`、Chrome156，以Android UA/触摸与320/360/390/420/560/880px viewport，通过 `https://api.honus.top/__editor_footer_probe__` 独立context挂载真实FileEditor、createFileEditorSession、CodeMirror、UI/FontAwesome和既有darkUiTheme；仅FileDocumentPort为受控读取/保存。最终前五种宽度footer分别约66–69px，均只有两行，路径206.84–443.64px，换行符80px，服务器无裁剪，三个实际按钮与两个下拉同排且在footer内；880px仍为原单行。CRLF选项文字完整、实际选择转换草稿并在点击保存后以CRLF交付一次Port回调。saving/saved/error三态在320/390/560px共9组均不挤第三行，保存中选择与保存禁用；长路径/文件名/服务器名3组、无scope状态通过。无pageerror。测试中修正隔离挂载的Pinia安装和#app全局min-height影响后，以最终after.log/after.json与after-{320,390,880}.png为证据；不把测试挂载尺寸错误当作产品越界原因。

原mobile/touch-workflows正式用例补路径/服务器不遮挡、首行/次行分离、所有实际控件同排及CRLF菜单文字不截断断言；用实际按钮范围替代display:contents容器无布局盒后的空泛scrollWidth检查，保留原菜单宽度、选项名称、CodeMirror打开与弹窗边距断言。正式手机/SSH E2E尚未运行，本轮不连接真实SSH、不保存用户文件，不提交/推送/部署。工具和产物集中/tmp/nexus-mobile-editor-footer-20261102，复用原Vite9998，保留先前拖动功能变更与测试现场。

本轮静态收口：根 `pnpm run check`（Backend包级/Shared构建、双端ESLint、Frontend类型）及前端生产构建通过，日志check.log/build.log；变更mobile E2E严格tsc通过，日志e2e-types.log；全量format与diff结果记录在format.log。所有自有CDP context在finally关闭，原Vite与两轮集中测试目录按用户要求保留，未新增后端进程。

## 重置/删除共用确认弹窗布局（2026-11-02）

用户要求优化重置终端、删除等确认弹窗并提供截图。基线为原UiConfirmationPanel：图标占正文左列，默认slot即使仅Vue条件注释也留18px（手机20px）内容padding；同一手机content样式存在重复覆盖。改为标题/图标同行、整行正文，描述字号13px/行高1.75，空content用:empty隐藏；确认按钮区有细分隔和浅底，手机等宽且44px高。只改Foundation原组件及确认选择器，统一其手机规则，没有改文案、按钮名称、store、用例或上传冲突行为，之前拖动及编辑器变更保留。

通过指定CDP172.30.30.11:9223、Chrome156，在api.honus.top/__confirmation_probe__自有context挂载真实DialogHost/useDialogStore、UiConfirmationPanel与真实UploadConflictModal，加载三语产品文案、UI/FontAwesome及既有主题。重置采用原workspace.terminal.confirmReset（amd），删除采用原confirmDeleteFile（.gitattributes），只完成本地确认Promise，不执行SSH重置或远端删除。桌面1280与手机390/320两场景共6组截图与几何PASS：正文宽度分别由338/256/186增加为394/312/242px；空白内容块由18/20变为0；无横向溢出，按钮44px高、手机等宽，确认顺序不变。附加覆盖确定/取消返回、Escape/焦点恢复、长路径与详情、复选回调、loading防关闭、signal取消、实际上传冲突中止回调及apply-to-all、英/日长文案与浅色主题，最终after.log为ALL PASS且无pageerror。脚本初轮误用“跳过”而真实按钮为“中止此文件”，修正测试定位后完整通过，未改产品文案。

before/after-{reset,delete}-{1280,390,320}.png为实际面板截图；after-details-320、after-upload-320、after-reset-{en-US,ja-JP}及after-delete-light-390另存集中目录/tmp/nexus-confirmation-layout-20261102，几何记录before.json/after.json。本轮不增加读取源码的自定义测试或重复全量本地E2E；正式SSH重置和文件删除尚未执行，不把组件确认回调视为这些远端操作验收。所有自有CDP context在finally关闭，原Vite9998及先前目录继续保留，不提交/推送/部署。

## 手机终端点击键盘跳动与全局确认消费者（2026-11-02）

本轮main/78997c1a及既有未提交拖动/编辑器/确认布局变更之上，用户确认终端普通输入和htop点击均导致软键盘反复跳动，并要求排查后统一全部同类确认弹窗。沿TerminalView触摸→xterm textarea→TUI鼠标链核对：原handleTouchStart每次无条件suppressMobileSoftKeyboard，将readOnly=true/inputmode=none并blur；touchend又恢复和focus。指定CDP172.30.30.11:9223/Chrome156的390×844触屏context，通过api.honus.top/__terminal_focus_probe__挂载真实TerminalView与xterm、受控TerminalChannel：连续三次真实触摸基线记录三组blur/focus和输入属性切换，输入节点始终相同。修复以document.activeElement为事实，已聚焦输入普通按下不抑制，未聚焦及长按选区沿原策略，不新增延时或第二份键盘状态。

集中目录/tmp/nexus-mobile-keyboard-focus-20261102的verify.cjs、before.json/log、after.json/log记录修复前后；修复后三次触摸focus/blur事件与输入属性变更均为零。实际xterm启用alternate buffer、1000/1006鼠标报告后，两次触摸各发送一次SGR按下/松开且零失焦；普通abc输入、IME期间点击不打断焦点、键盘关闭时滚动不聚焦、长按选字关闭键盘并弹菜单、退出选区后点按恢复输入、touchcancel、视口缩放和inputEnabled变更恢复均PASS，最终ALL PASS且无pageerror。脚本首次加载触发Vite依赖重新优化导致导航中断，重跑取得基线；选区后测试点落在菜单内，改为真实空白位置后通过，未改产品菜单行为。正式mobile/touch-workflows新增连续点击时监听真实blur、断言零失焦及readOnly恢复；只做类型检查，不运行完整E2E。桌面触屏CDP不等同真实Android/iOS软键盘动画或真实htop/SSH执行，实机验收保留。

基础面板原已覆盖全部feedback.confirm/alert及UploadConflictModal；全仓消费者复核发现Agent的ModelProviderSettings删除、AppIntegrationEditor删除、AppManagementSettings卸载仍拼装UiModal，现统一改为UiConfirmationPanel，直接传原文案、风险、禁用/加载/关闭条件和原回调。普通表单/管理弹窗、开发页原生window.confirm与行内二次确认不属于本次同类面板；不增加业务定点CSS。全部标题/正文/操作区规则留Foundation，取消在危险确认之前。真实卸载排空的三个英文按钮在320px初测出现面板2px、按钮11/21px溢出；共用操作组改为可换行，手机复用原96px按钮基准，长文案允许换行且最小44px，最终两取消操作同排、继续卸载独占下一排，全部溢出为0，未隐藏任何操作。

global-confirmation.cjs/global.log在api.honus.top/__global_confirmation_probe__挂载真实DialogHost及上述三真实组件，Pinia、三语与既有主题。GET用严格契约受控响应，所有写请求均本地拦截，绝不发送远端删除；ModelProvider/Integration取消零请求，确认各一次原DELETE路径（原版本参数由源码复核）；卸载调用原retire、取消排空标志及busy时Escape/按钮保护均PASS。主机密钥详情、单按钮提示、备份导入，以及三个组件×1280/390/320几何/截图、排空英文三按钮均无横向溢出，最终ALL PASS且无pageerror。截图global-{host-key,alert,backup}-390、global-{ModelProviderSettings,AppIntegrationEditor,AppManagementSettings}-{1280,390,320}和global-uninstall-draining-320均留集中目录；原确认六组、确认取消、详情/复选/loading、signal撤销、上传冲突和英日/浅色回归在基础样式最终改动后重跑，confirmation-final.log为ALL PASS。同类确认面板覆盖的是呈现和本地回调，不代验真实远端删除/卸载；自有context均finally关闭，Vite及测试目录按用户要求保留。

最终源码复审覆盖TerminalView触摸/长按/取消/就绪/失活清理、基础确认面板及所有五处直接消费者和feedback全部调用入口、三个迁移组件及原删除版本/排空/数据清理回调；无新状态owner、通信或存储变化，普通表单/管理UI保留。Node22.23.1、复用pnpm11.28.10在根执行pnpm run check、pnpm run build:frontend、pnpm run format:all:check、mobile/touch-workflows严格tsc及git diff --check均退出0；check.log/build.log/format.log/e2e-types.log留集中目录。最终只回填文档，再定向Prettier及diff检查；无提交、推送或部署。

最终静态：根pnpm run check（Backend包级/Shared构建、双端ESLint与Frontend类型）、前端生产build、全量format:all:check及git diff --check全部通过，日志check.log/build.log/format.log保存在上述专用目录。最后仅补本段并定向核对文档格式；没有重复无变化的完整E2E或发布。

## 本批 UI 修复远程 E2E 与发布（2026-11-02，完成）

用户授权推送、修复E2E并发布，08b6b2b58a6d8aa5f121816bd112fb05b800673d已推送main。首轮41484802901质量、Docker及7个测试分片成功，browser 6出现两项首次/重试相同失败：新增拖动多选初始化点击hover-source后，触屏桌面正常单击导航到/hover-source，随后寻找原目录hover-one.txt超时；既有touch-advanced搜索用例读取display:contents的.editor-actions.boundingBox得到null。失败截图/页面快照与源码分别确认真实路径和无盒语义，属于测试前提，不改产品UI。

修复仅既有测试owner：拖动begin先通过实际多选按钮重建干净选择，明确两个源已选和路径仍为/后才开始原CDP拖动；取消、连续进入/上层、兄弟目录放置和最终源/内容断言保留。手机搜索改测真实footer及三个按钮，保留同排/顺序且补四边界，不恢复无意义的容器盒；原弹窗边距、CodeMirror尺寸、搜索高亮与后续行为断言保留。严格tsc、定向Prettier、diff通过；根检查与全量格式后推送新SHA完整重跑，不运行本地全量E2E、不扩超时/跳过用例。

全部元数据/失败日志、e2e-shard-browser-6-1解压trace/error-context/截图、后续运行与发布核对集中/tmp/nexus-publish-ui-fixes-20261102；旧目录与Vite按用户要求保留。完整远程成功和发布来源/digest待回填，不将旧CDP或其他7分片通过当整轮成功。

第二轮847fb6a5/41486648381：质量、Docker及7分片成功，手机搜索恢复，browser 6仅拖动取消首次/重试失败。trace的根目录文件选择使列表向下滚动，hover-target坐标已在可视裁剪之外；裸Input.dispatchMouseEvent不含Playwright动作自动滚动。受控同touch条件目标可见时可正常清选择且无moveTo（drag-touch-diagnostic.log）；故意裁剪的drag-clipped-target.log未出现目标高亮，作为失败前提证据，不计通过。第三轮修复moveTo先滚目标再读bounds，右键取消前断言有效目标is-drop-target（返回源目录仍允许导航但不是放置目标），保留全部导航/取消/实际移动断言。未改UI、产品或超时，静态及完整Actions结果待回填。

第三轮补丁提交前：Node v22.23.1、集中工具pnpm 11.28.10，根check、全量format:all:check、变更E2E严格tsc和git diff --check通过；日志e2e-clip-check-final.log、e2e-clip-format.log、e2e-clip-types-final.log。首次手工tsc未指定Node类型目录而失败，显式使用仓库Backend现有@types后通过，未改依赖或类型配置。仅既有测试和本阶段证据变更，产品构建由本轮Actions统一核对。

第三轮ff440403/41489494982质量、Docker与7分片成功，原取消前步骤已通过，同用例第二级目录停留在/hover-target。trace显示deep已可见且不busy，但无有效悬停高亮。受控CDP缩小列表并按正式脚本滚动/快速移动可复现目标不高亮；首次到达可能仅产生dragenter，进入新目录后旧位置与新行相同也可能没有真实移动。按Chromium原生拖放语义在moveTo末尾于目标内再移动1px，实际交付dragover，不改产品或等待时长。drag-same-coordinate.log为基线失败，drag-same-coordinate-fixed.log完整通过同坐标连续导航与取消；裁剪列表对照见drag-rapid-no-observation.log/drag-clipped-fixed.log。后续第四轮完整回归及发布待回填。

第四轮提交前根check、变更E2E严格tsc、全量format和diff通过（e2e-dragover-*.log）。受控同触屏/裁剪列表完整链drag-complete-fixed.log通过取消、连续两级、两个上级及兄弟目录唯一放置，原文件夹与文件两个源保持；首次运行受Vite重优化导航中断，完成构建后重跑通过，不记首次为产品失败或成功。原USAGE拖动/取消操作仍符合实际，无产品行为差异。

第四轮8599670a/41492022020已通过取消与连续两级导航，仅同用例第三段重新选择失败；其余7分片、质量和Docker成功。沿FileManager.openContext→longPress.suppressClick→clickEntry.consumeClick确认产品问题：supportsTouchInteraction使鼠标右键也进入800ms长按抑制，Escape后立即点击第一个源被吞。第五轮设计：① 状态与事件归原FileManager/longPress；② 沿原组件，不改基础手势实现；③ 输入事件→组件→原选择/手势；④ 原MouseEvent用PointerEvent实例及pointerType缩窄，无新契约；⑤ 仅touch/pen原生菜单追加抑制，鼠标/键盘不追加；⑥ 不增加等待或第二份状态；⑦ 原触摸长按、取消/失活/清理保持；⑧ 同CDP菜单关闭后立即重选基线drag-context-reselection-before.log实际失败，修复后验证原完整链，静态/构建及第五轮全量Actions待回填。原E2E已覆盖菜单Escape后新拖动，不增加隐藏等待；USAGE及前端架构同步。

第五轮提交前：同一脚本基线在菜单关闭后source首次选择失败；修复后drag-context-reselection-after-final.log完整通过立即重新选择、连续两级、两个上级及兄弟目录唯一放置。首次after与Shared构建并行，Vite热重载使已挂载受控页面销毁，该次不计验收；构建结束后最终脚本通过。根check、前端build、全量format及diff全部通过（e2e-context-check/build/format.log）；两次源码复审确认只按真实PointerEvent来源区分，原useLongPressGesture触发/松手的抑制与清理保留，鼠标/键盘不再误入触摸保护，无UI样式差异。正式现有E2E已覆盖同一路径，完整Actions待运行。

第五轮最终完整远程41494011094成功，验收SHA ed59258e2f6a5261ba17235d61ce4dc463fe4f93。全部547场景首次通过，无失败/重试/flaky/跳过；各分片场景数：backend1=125、browser1=58、2=41、3=69、4=61、5=60、6=68、7=65。既有失败分片6完整通过，真实SFTP多选源连续导航、右键取消、菜单关闭立即重新选择、双上级及兄弟目录最终移动均通过。质量和Docker成功；完整原始日志e2e-full-41494011094.log、最终元数据e2e-result-41494011094.json与计数e2e-summary-41494011094.json保留。自动c9c35835只更新scripts/e2e/duration-estimates.json，核对后快进。发布41495174680使用main/c9c358351912f84c86424e6b5e096b0d8cebbd3f、dev/amd，等待Registry最终核对，不更新生产容器。

最终发布 [41495174680](https://github.com/0honus0/nexus-terminal/actions/runs/41495174680) 成功：Prepare publication（含high级生产依赖审计）及Publish Unified Image全部成功，源SHA c9c358351912f84c86424e6b5e096b0d8cebbd3f。通过docker buildx imagetools实际读取ghcr.io/0honus0/nexus-terminal的dev与sha-c9c358351912：两者digest均为sha256:70dd507001cff8ad3749616e1d7b93005da2ff2ed34d0ffeeb034e6005e6152a，仅linux/amd64（排除attestation条目），OCI revision和version分别严格等于发布SHA和固定标签。publication-verification.json/log及两标签Manifest/Image、publication-result-41495174680.json为真实Registry证据。所有本轮CDP自有context已关闭，未更新生产容器，未删除原Vite、测试环境、工具和集中目录，等待用户后续清理指令。最终收口仅PLAN/testing文档，产品与已验/已发布SHA保持一致。

## 文件拖动父目录反馈与600ms悬停（2026-11-03）

基线main/7e6a26e9，起始工作区干净；用户明确确认列表只有一个文件夹和`..`，并要求缩短进入目录的等待。沿FileManager的remoteDropAllowed/remoteDragNavigationAllowed→handleRemoteTargetDragOver与scheduleRemoteDragNavigation复核：原父目录不需实际move，但可导航；dropEffect/高亮只按move判定，导致可导航目标错误显示禁止。本轮统一行目标接受状态为可移动或可导航，原dropRemote继续独立过滤实际移动项；不更改布局/样式、容量、权限或后端，拖动源自身/后代仍拒绝。停留2000ms按用户要求缩短600ms，同目标连续dragover不重置计时。

指定CDP172.30.30.11:9223/Chrome156、api.honus.top的独立自有context挂载实际FileManager/useFilesystemBrowser与原样式；仅目录Port/最终moveTo消费者受控，不连接真实SSH或移动用户文件。before.json记录从/home/work上行到/home后work行、下行到target后`..`行的原生事件处理后dropEffect均none；四次导航2007–2015ms。after.json同路径均move且is-drop-target，四次导航601–606ms；导航过程零moveTo。效果观察在真实行原监听之后读取，不在document capture的微任务中提前读取浏览器默认效果。regression.log最终ALL PASS：两种原位松手都不移动且取消待执行导航；拖动源文件夹自身保持none且不进入；600ms内右键取消后不导航/不移动；连续dragover仍在610ms导航；正常目标最终仅派发一次原源移动。全部context在finally关闭且无pageerror。

工具/脚本/JSON/日志全部集中/tmp/nexus-file-drag-navigation-20261102/cursor-20261103，重启原Vite9998并复用旧缓存，保留原目录/服务等待用户通知清理。既有ssh/file-manager-navigation的hoverInto补真实dragover后dropEffect=move断言，覆盖下级、上级及返回源父目录，观察句柄/监听随本次目标finally清理，不依赖短暂高亮和600ms竞速。根check、前端build、变更E2E严格tsc通过，日志check.log/build.log/e2e-types-final.log；首次全量格式发现新测试3处声明空行，按原ESLint修正，最终结果见format-final.log及diff。未运行本地全量/远程E2E，未提交、推送或发布；上轮547通过及已发布镜像不包含当前补丁。

最终全量format-final.log通过（含全部ESLint与Prettier），git diff --check通过。通过同一CDP另行运行verify-e2e-observer.cjs，直接复用正式新增观察句柄/事件逻辑，四条上下级路径都在原事件处理后读取move，解除监听与句柄后无移动、无pageerror，证据e2e-observer.log。最终仅6个预期文件变更，无新依赖或散落测试文件。

用户追加授权提交推送并发布main的dev镜像。发布前复核当前6文件diff与前轮静态输出一致，HEAD/origin/main均7e6a26e9、无上游差异，git diff --check通过。完整远程E2E及发布结果待实际执行后回填，所有新增产物集中本节目录的publication/，原测试服务和目录保留。

本轮提交4e2b2be374ffdeb2fb502eed2598e39a02052cc5并推送main后，完整远程[41563556193](https://github.com/0honus0/nexus-terminal/actions/runs/41563556193)成功：547场景全部首次通过，无失败/重试/flaky/跳过；backend1=125、browser1=37、2=55、3=69、4=50、5=78、6=62、7=71。新增原生dragover后dropEffect断言及上下级导航、原源保留/右键取消、最终真实SFTP移动全部通过；质量、Docker与8分片成功。真实日志和最终元数据为publication/e2e-full-41563556193.log、e2e-result-41563556193.json及e2e-summary-41563556193.json。核对自动0eb52704只改耗时估算后快进；发布41564383424使用main/0eb52704ab3dc12bac04c8c8737e897df1f09368，channel=dev、architecture=amd，发布及Registry核验已完成，详见下段。

最终发布[41564383424](https://github.com/0honus0/nexus-terminal/actions/runs/41564383424)成功，包含high级生产依赖审计；来源为main/0eb52704ab3dc12bac04c8c8737e897df1f09368。实际Registry核对ghcr.io/0honus0/nexus-terminal:dev与sha-0eb52704ab3d，排除attestation后仅linux/amd64，OCI revision/version严格匹配来源SHA及固定标签，两者digest均为sha256:062d3369e34caa5633bf7c15242f4d4828a7072bc0d5cfc3e30721decf16c1dd。原始Manifest/Image、publication-verification.json/log与publication-result-41564383424.json保存在本节publication目录。验收源码仍为4e2b2be3，后续自动提交仅耗时估算、最终收口仅文档，产品代码一致；不把后继SHA称为直接跑过E2E。生产容器未更新，所有测试目录与原Vite9998继续保留，等待用户通知删除。本轮实现、远程回归与发布完成。

## 连接表单底部错误 Toast（2026-11-03）

用户明确只迁移底部操作错误区域，测试结果与延迟说明保持。沿原useConnectionForm→useFeedback通知owner：修改连接参数且密码为空使用warning Toast，选项加载/提交校验错误使用error Toast，删除submitError及ConnectionForm内唯一UiInlineNotice；测试成功/失败徽标、耗时、信息图标、草稿变动失效、保存/Host Key流程全部保留。现有ssh-key-management失败/320px用例改定位全局选项错误，并断言表单内无错误文本，原认证切换与编辑后提示保持、后续管理器网络Toast和无溢出断言保留。无Shared/Backend/存储变更。

通过指定CDP172.30.30.11:9223、api.honus.top/__connection_toast_probe__自有context挂载真实ConnectionForm/useConnectionForm和NotificationHost，加载真实三语/全局样式与Pinia；引用目录和测试HTTP受控，不发送真实SSH、不保存用户配置。cdp.log为ALL PASS：修改22→2200且密码为空只显示右侧warning，测试请求为零，关闭后重新点击再显示；输入临时密码后请求严格为当前2200及新密码，422 connection_failed仍在原底部红徽标；200/37ms仍为成功徽标及耗时，原延迟说明可展开，字段修改后清除旧结果。未改连接且密码留空仍调用原保存连接测试端点。非法编辑范围只弹error且零保存，关闭后再提交仍提醒；选项失败Toast不因改字段消失、表单无错误文本；卸载后晚到选项失败/测试成功均不通知。桌面1280右侧位置与320px无横向溢出通过，截图toast-desktop.png/toast-mobile.png已检查。所有自有context关闭，不影响原页面/服务。

产物集中/tmp/nexus-connection-form-toast-20261103，verify.cjs/result.json/cdp.log与截图保留。首轮受Vite依赖重优化导致context销毁，第二轮脚本宽泛**/api/**误匹配源码路径，修正为/api/v1/后最终完整通过；前两次不计产品验收。根check、前端build、全量format:all:check、既有选项E2E严格tsc均退出0，日志check.log/build.log/format.log/e2e-types.log。首次静态启动未补工具PATH导致pnpm子进程找不到，补现有工具目录后通过，未新增依赖。两轮源码审核确认只替换反馈出口、保留generation/signal与原测试状态，不更改字段/按钮布局。文档定向格式与diff检查通过；本轮未运行本地全量或正式远程E2E；用户随后明确“提交推送”，核对当前6文件、原检查日志及上游后提交推送main。本次不触发镜像发布，原环境及专用目录继续保留。

## 网络趋势上下行标题对齐（2026-11-03）

用户要求当前网络上下行速率与CPU当前值一样放在趋势标题右侧。根因是原network-legend为history-header的第三个单列网格项，在range-tabs之后。将原图例移入history-heading、放到关闭按钮前；原flex图例增加收缩/最小宽度/右对齐与自动左边距，窄栏可在标题右侧区域将两个速率换成两行。上下行色标、方向、compactRate完整取值、11px实际字体和缩放补偿保留，CPU/其他指标、范围、Chart.js及session生命周期不变。既有status-history-time-axis只收紧图例真实定位及所属标题行断言，原字体、图表几何/范围/tooltip/关闭断言全部保留。

通过指定CDP172.30.30.11:9223在api.honus.top/__network_trend_probe__自有context挂载真实StatusMonitor/StatusCharts与createStatusMonitorSession，真实i18n/样式/Pinia，受控Channel交付50个真实形状样本，不连接SSH或修改配置。before.json/log及before.png实测原图例在范围选项下；修改后after.log为ALL PASS：中英日×180/294/320/480/800px×1/1.6缩放30组中图例都在原标题右侧且底部不超过范围控件顶部，两个完整速率均在标题/卡片边界内、绘图区有有效高度；长速率1023.9G/s更新保留，1/5/10/30范围逐个生效，切CPU仍显示4.2%且无网络图例，切回及关闭正常。原极窄标题继续使用既有省略策略，速率不省略。无pageerror，所有自有context关闭并dispose原测试session；未影响用户原页面。截图after-294.png、after-180-zoomed.png及after-long-rates.png已人工核对，产物均在/tmp/nexus-network-trend-header-20261103。

两轮源码复核确认仅原模板/CSS呈现与对应测试定位变化，无协议、采样或存储修改。Node22.23.1及现有pnpm11.28.10执行根check、前端build、全量format:all:check、既有目标E2E严格tsc均退出0，日志check.log/build.log/format.log/e2e-types.log保留；最终仅文档定向Prettier与git diff --check。本轮未运行完整本地/远程E2E；用户随后明确“推送 提交”，核对本轮7文件及既有检查证据后提交推送main。原Vite及所有保留目录继续保留。

## 网络趋势最窄宽度同排与完整标题（2026-11-03）

用户追加要求最窄栏位与手机同样左右同排、左侧网络趋势完整。上版同日after.json的180px记录标题溢出9px、两个速率上边界相差约18px，符合原允许省略/换行设计，本轮依最新要求调整。仅原StatusMonitor增加网络标题行class；该标题不收缩/省略，网络图例改flex:1且不换行，图例自身为inline-size容器，子项字号取原11px/scale与自身6.5cqw的较小值。右侧容器分配完完整标题和原16px关闭按钮后再调整文字，不增加JS测量/状态、数据阈值或采样行为，正常宽度原字号保持。原上下行色标、方向、完整速率/单位和下一行时间选项保留，CPU等原单值不变。

集中目录/tmp/nexus-network-trend-header-20261103/narrow的verify.cjs通过指定CDP172.30.30.11:9223、api.honus.top/**network_trend_probe**，独立hasTouch context、真实StatusMonitor/StatusCharts/createStatusMonitorSession和原样式/语言，Channel只交付受控50点样本、不连接SSH或保存用户配置。最终after.log为ALL PASS：中英日×180/294/320/480/800px×1/1.6缩放30组中标题scrollWidth与clientWidth无溢出，两个速率同排、完整位于标题/卡片内且在范围控件上方。长速率1023.9G/s显示完整，1/5/10/30分钟切换、CPU4.2%及关闭通过。另使用实际UiOverlayPanel、WorkspaceMobileTools原panel/overlay类和mobile-overlay类，在320/390px×1/1.6缩放4组中验证完整标题、同排速率、图表及无横向溢出，手机截图mobile-320-1.6.png等及after-180-zoomed.png/after-294.png已检查。极窄栏速率会按可用空间缩小，标题仍保持完整；无pageerror，自有context与session均关闭。

初次CDP发现原Vite9998已不在运行，仅按既有授权恢复前端并复用原缓存，日志vite.log；没有重启后端或删除旧目录。手机外壳脚本补充时括号错误已修正，最终完整执行退出0，不作为产品失败或旧版通过证据。两轮源码审核确认仅网络标题行和图例CSS改变，不修改采样、协议、模型或其它指标布局。根check、前端build、全量format:all:check、既有status-history-time-axis严格tsc退出0，日志check.log/build.log/format.log/e2e-types.log；最终文档Prettier及diff通过。本版未运行完整本地/远程E2E；用户随后明确“提交推送”，复核本轮6文件、静态/CDP证据及上游后交付main，原环境及所有专用目录继续保留。

### 导航切换布局阻塞（2026-11-04）

基线 main 148736f9，原工作区干净；本版只改变 AppHeader 的观察与自动居中时机，模板/CSS、router/auth/KeepAlive/Workspace 均未改动。Node v22.23.1，pnpm 11.28.10，Playwright 经 CDP http://172.30.30.11:9223 访问 https://api.honus.top。测试使用独立context，静态资源映射本轮真实生产构建，API/WS经Vite连接专用隔离后端；不替换生产容器或生产数据。原Vite/Backend均未运行，按既有授权在本轮恢复Vite9998、启动全新隔离Backend3001；数据库、日志、脚本及构建快照集中 /tmp/nexus-navigation-performance-20261104，按用户要求全部保留。自有context均关闭，环境服务保留。

- 根因：KeepAlive 与已确认认证状态均已复用。旧AppHeader在nextTick读取scrollWidth/clientWidth/offset并居中，迫使新激活页面同步布局。4倍CPU降速、1280px生产构建基线28次切换，导航尺寸读取累计410.6ms，单次116.2ms；CPU profile的函数位置对应revealActivePage。开发模式基线另存before.json，不混为生产证据。
- 中间方案复核：只缓存几何仍会在窄屏直接scrollTo；narrow-v1.json实测滚动单次133.5ms，说明仍有同步布局。最终删除位置缓存，把测量和滚动一并放入ResizeObserver；route提交只重新观察导航条，尺寸未变也请求一次布局后通知。观察器覆盖导航条及链接，自动响应宽度、字体及active字号变化；隐藏/替换/卸载断开观察。
- 最终桌面对照：同一1280px、4倍CPU降速、28次切换，final-desktop.json记录56次导航尺寸读取累计1.1ms，单次最高0.2ms，无页面错误；原同条件尺寸读取累计410.6ms，单次最高116.2ms。
- 最终手机对照：同一390px、4倍CPU降速、隔离后端、7条正式导航路径各4轮。baseline-mobile.json → final-mobile.json：112次导航几何读取/滚动累计493.2ms → 4.2ms，单次最高147.1ms → 1ms。首轮之后21次切换，从点击到第二个rAF回调的中位数16.3ms → 12.6ms；该指标是绘制机会的近似，非像素呈现时间，最大值74ms → 97ms，不能宣称全部页面或每次切换都更快。动态模块加载、页面本身布局和异步设置加载仍有成本；测试目录为空连接目录，未接真实SSH，不代表大目录或所有手机性能。
- 最终交互：verify-final.log通过320/390/700/1280px及来回缩放的35次导航，当前入口完整可见并按原规则居中；实际鼠标拖动不误跳、实际链接点击、工作区隐藏/显示导航后观察器0→1、登出后观察器归零，无页面错误。截图navigation-*.png、verify-final.json保留；未更改现有视觉设计。布局后自动滚动没有引入额外定时器/期限。
- 最终代码检查：根pnpm run check（含Backend包级check及Shared构建）、前端build退出0，check-final.log/build-final.log；最终format:all:check退出0（format-final.log）；最终文档Prettier、git diff --check通过。不执行全量本地或远程E2E，不提交推送。源码两轮复核覆盖正常切换、尺寸不变、字体/宽度变化、隐藏/显示、DOM替换与卸载；无新增公开类型、存储或协议边界。

### 终端标签菜单顺序（2026-11-04）

WorkspaceTabBar仅将原挂起菜单项移到重置之前，原条件、事件、分隔线和关闭项保持。USAGE的SSH会话章节同步顺序；无类型、协议、资源或架构边界变化。沿用前述Node/pnpm和CDP环境，通过api.honus.top加载真实Vue/WorkspaceTabBar，以受控内存session核对桌面右键、手机长按、挂起/取消挂起第一项、重置第二项、重置禁用、断开及非SSH显隐和原事件ID；不建立真实SSH或执行挂起/重置。

专用目录 /tmp/nexus-terminal-menu-order-20261104 保留脚本、日志和手机截图；cdp-verified.log为PASS，无页面异常，自有context关闭。首次Vite依赖预优化触发重载，第二次脚本误将原“关闭标签页”断言成“关闭”，已修正脚本后完整复测；没有修改产品关闭文案。根check与前端build退出0（check.log/build.log）；全量format:all:check退出0（format.log）；最终文档Prettier与git diff --check通过。不运行全量E2E，不提交推送，上一轮性能优化的本地变更与目录继续保留。

### Agent App 卸载目录、数据清除与读取性能（2026-11-04）

复用上一轮隔离Backend3001与Vite9998，CDP http://172.30.30.11:9223 访问 https://api.honus.top，真实签名Full-stack包来自专用本地fixture仓库29092；没有更换生产服务或读写生产库。后端按已授权测试范围编译并重启，数据库仍为 /tmp/nexus-navigation-performance-20261104/data/nexus.sqlite；本批脚本、签名仓库、日志和截图集中 /tmp/nexus-agent-app-performance-20261104，服务及文件全部保留至用户通知。每次验证创建并关闭自己的CDP context。

- 功能：verify-final.log完整PASS。API安装并真实激活Full-stack后写入独立存储，种入执行预算、带加密凭据的MCP配置、聊天线程及真实上传文件。取消卸载不发DELETE；默认保留卸载后App行消失、统计1/1，配置/凭据仍在；市场对应行显示保留标记并能重新安装，复用App身份和原配置。手机勾选清除后存储/预算/集成凭据归零，文件仍ready且可读取；旧集成写入not_found。清除后标记和清除按钮消失，没有独立保留数据面板。
- 失败恢复：在已确认卸载之后拦截一次清除响应为503，App仍从目录消失，真实数据仍可恢复，没有自动重放。移除测试源后仍显示真实对应保留行；取消清除保留数据，明确确认重试沿原operationId，成功后标记消失。verified.json保留请求数、身份、步骤及零pageerror。SQLite只读证据sqlite-confirmation.json记录该轮removed/revision29、存储/集成/grants为0、策略{}，4个聊天及4个文件保留；后续定向复验增加的隔离数据也保留。没有生成真实任务/记忆，二者保留仅经清除SQL调用链核对，不能扩大为实测通过。
- 视觉收口：检查手机截图发现新复选项错误使用UiCheckbox默认slot而缺少可见文字；按基础组件API改为外层label与明确accessible name，未改全局基础设计。verify-checkbox-closeout.log通过文字点击切换、默认不勾选、取消再打开重置、320/390/1280px弹窗不横溢、真实清除和文件保留，零pageerror；checkbox-verified.json和uninstall-mobile-320-final.png、uninstall-mobile-390-final.png、uninstall-desktop-final.png保留。定向脚本前两次已通过业务断言，但在关闭受控错误toast拍市场截图时先遇动画节点移除、后遇目录加载晚到toast，分别记录verify-checkbox.log/verify-checkbox-final.log；最终取消该非必要截图等待，主要行为与弹窗截图均通过，不改产品通知行为。
- 契约：directory-codec.log/json以实际安装目录验证完整响应与合法retained成员，拒绝缺字段/多字段/错型/重复App/重复definition/孤立retained/重复retained/非removed成员/非法ID共9项。三个变更的正式E2E消费者repository、custom-surface、coverage-gaps通过严格tsc（ES2022/ESNext/bundler/strict），e2e-types-final.log退出0；初次从根目录指定types node找不到直接类型依赖，改用Backend现有@types的typeRoots，未新增依赖或放宽类型。
- 请求性能：baseline.json中同目录连续5次刷新共25个GET，publishers/installations/versions/apps/app-definitions各5次；verify-final.log最终15个GET，前三项各5次，App/定义0次。只说明该刷新链请求减少40%，不推断整个前端快40%。mapper-benchmark.json为指定CDP内纯投影合成数据，30组、每组10次：128 App中位0.21→0.06ms，安装身份访问8256→128；512 App中位2.49→0.22ms，访问131328→512。输出与builtin/installed/draining/removed和hash/publisher/version不匹配、重复包首次匹配规则一致；该结果不是页面交互耗时。
- 静态与失败记录：check-closeout.log根check退出0，build-backend.log后端构建和build-frontend-closeout.log最终前端构建退出0；三语清除文案已包含最终构建。初次前端lint未用versions、后端curly及误删PluginFrontendDescriptor导致的构建报错均修复；早期CDP脚本曾改到另一Vite时间戳i18n模块实例、将合法undefined策略字段误断言为{}，脚本已改用实际根i18n与逐值检查，最后完整通过。全量format:all:check、文档格式与git diff --check通过。未运行全量本地/远程E2E，不提交推送；前批导航与菜单变更完整保留。

### MCP / ACP 工具栏换行与手机同排（2026-11-04）

只修改AppIntegrationSettings的应用选择框尺寸及AppIntegrationEditor的操作组排布/窄屏短文案，未修改基础UiSelect或业务状态/请求。原w-40被基础未分层ui-select的width:100%覆盖，选择框占满一行，将刷新/创建挤到下一行。baseline.log/before.json验证单/多App×320/390/640/1280px，多个App时全部头部90px，连1280px也两排。App目录样本在独立浏览器中投影：以真实内置App与之前签名Full-stack的实际App ID提供单/多App和长名称，未修改后端安装状态或应用配置；请求及表单仍经原真实组件/API处理。

指定CDP http://172.30.30.11:9223 访问 https://api.honus.top，复用隔离后端3001与现有账号；本批日志、工具、缓存、脚本和截图集中 /tmp/nexus-integration-toolbar-20261104。验证期间发现原前端的临时pnpm/依赖缓存目录已不存在，开发模块偶发ERR_FAILED及Vue路由边界报错；保留原失败证据后将工具/缓存恢复至本批目录，仅重启测试Vite9998，日志vite.log/tools-install.log，未重启后端或修改生产服务。服务和所有目录继续保留至用户通知删除。

- 最终布局：verify-closeout.log完整PASS，after.json记录中英日×320/360/390/640/1280px×单/多App30组，选择框与更新/创建按钮全部同排、操作组右对齐且页面/控件无横向溢出，头部90→50px。320px完整英文创建按钮曾使选择框仅47.5px，因此360px以下复用common.create简写并保留完整aria-label/title；最终320px选择框中文/日文131.5px、英文118.5px，中文Nexus Terminal完整可见。截图after-320.png、after-390.png、after-1280.png已实际检查，最终不采用手机双行方案。另以hasTouch/isMobile真实浏览器模式复测中英日×320/390px×单/多App共12组及相同更新/切换/表单取消交互，verify-touch-final.log全部通过，touch-after.json/touch-interaction.json及touch-after-320/390.png保留。
- 交互：长名称App下拉选择后确认请求到正确的 /api/v1/apps/:appId/integrations；完整名称在列表与title可读。一次受控挂起列表读取，确认刷新loading、创建禁用及两按钮同排，释放后恢复；真实创建弹窗切换MCP/ACP各自字段、取消后关闭，所有配置写入请求为0。interaction.json记录全部通过，已认证交互consoleErrors与pageerror均为空，自有context关闭。没有创建真实集成或调用外部MCP/SSH，不扩大为全量集成行为验收。
- 失败记录：verify.log脚本错误调用legacy全局i18n.t，改为实际全局$t；verify-third.log误将已有集成路径写成/agent/apps，按真实API owner改为/api/v1/apps。早期开发缓存失效及静态Shared构建期间HMR导致的路由加载失败分别保留verify-second.log/verify-final.log与failure截图/日志；恢复缓存后的verify-inline-final.log所有业务断言已通过，但把登录前预期auth/status401的浏览器资源提示计入交互console断言，最终在已认证视图就绪后开始统计并完整复测通过。触屏脚本首次console监听器对导航已销毁的JSHandle异步求值失败，verify-touch.log记录；改为同步记录浏览器console文本后完整复测通过。没有修改产品错误边界、放宽业务断言或改变API。
- 最终检查：根check-final.log（后端包级check/Shared构建、双端ESLint、前端类型）与前端build-final.log退出0；全量format:all:check及git diff --check通过，日志format-final.log。首次最终格式命令因旧pnpm路径已不存在退出127，恢复本批工具后完成正式检查。未运行全量本地/远程E2E、不提交推送，先前导航、菜单及卸载性能变更完整保留。

### 移除内置 Agent 与官方插件启用引导（2026-11-04）

按用户最新要求采用没有内置应用的当前设计，不实现旧ID映射、旧数据退役或迁移；删除默认初始化、手工创建App链、默认声明/实例字段与快照内置旁路。初始v1签名为backend-next-v1-initial-20261104-plugin-apps。旧测试库和全部既有目录保留；通知后仅重启隔离测试后端3001，新库 /tmp/nexus-agent-onboarding-20261104/data/nexus.sqlite，Vite9998与指定 https://api.honus.top 继续使用。没有读写生产库或更新生产容器，产物及环境保留至用户通知删除。

- 指定CDP http://172.30.30.11:9223 的verify-final.log证明空库三次App/声明读取均为空、真实官方确认可取消且零安装/启用写、目录503与安装400均保持关闭且无App。随后真实官方Nexus Agent 1.0.1下载/验签/安装200（backend.log），插件停用、授权为空。verify-closeout-retry.log和verified-closeout.json完成已安装状态验收：界面只有Nexus Agent、无Nexus Terminal；关闭再开启仅两次设置PUT，无安装POST、不弹确认、UUID不变；刷新后状态不变，pageerror为空。已检查onboarding-desktop/mobile.png与installed-app.png。
- 首轮CDP脚本因异步语言加载、短暂Toast遮挡及关闭动画竞态失败，记录verify.log/verify-second.log/verify-third.log；保存测试账号语言并按实际通知组件关闭后完成失败场景。verify-final.log在真实安装已成功后，无条件读取CDP响应body失败；后续沿已安装事实继续验证，没有重复安装。verify-closeout.log第一次关闭/开启已通过，刷新时Vite动态模块请求失败，保留原日志；新独立context的verify-closeout-retry.log完整通过，未更改产品错误边界或重启生产环境。
- 测试创建统一经真实签名包/信任/仓库stage/install/enable，不添加产品测试后门。regression-final.log为phase2、HTTP、plugins、repositories、images、artifact-streams六文件89/89通过。extended-regression.log扩展220项、207通过/13失败（含父项），失败分别涉及旧默认App/空插件基线、公开DTO字段、可恢复只读工具拒绝、已存在tool详情端点、备份表/文件数、已打包SDK及浏览器环境，均记录后定向修正，没有删场景/跳过或放宽产品契约。
- 定向复验：extended-fixes.log的collaboration继承期限以真实持久deadline核对通过；extended-fixes-secondary.log的tools两组通过，保留tool详情、原参数及失败投影断言。targeted-regression.log的files全部通过（符号链接拒绝以tool_invalid_input交回模型并继续，目标内容不泄漏/不改变）及backup全部通过（88表、签名源插件包与上传文件两份文件，字节/hash保留）。targeted-closeout.log的Agent Browser全部通过、owner-faults四组全部通过、repository-faults六组全部通过；只剩SDK测试旧“超过10个模块”断言，改为实际唯一完整bundle/frontend-v1.mjs成功加载，plugin-browser-closeout.log最终15/15通过，存储/线程/RPC/隔离等断言保持。浏览器full Chromium与headless shell安装在本任务browsers目录，首次缺路径/浏览器的记录保留，不计产品失败。
- 扩展回归还发现snapshot启动崩溃夹具仍使用state.db.appearance等旧路径，实际Bootstrap已使用同目录appearance/artifacts/plugins，导致published场景没有测试到真实恢复根。测试与worker统一引用resolveDataPaths；snapshot-startup-closeout.log保留定位失败，snapshot-crash-final.log最终32/32通过，覆盖SIGKILL窗口、真实启动、提交证据和多根恢复。未改产品恢复算法。
- 新E2E动态签包夹具在独立29102启动，实际E2E createTestAgentApp经esbuild仅做临时编译后，在独立3012/新库实测两次创建，两个不同definitionId/App UUID、名称和启用状态均正确；helper-smoke.log/verified.json保留，后端正常关闭。严格tsc覆盖全部迁移E2E消费者及新增onboarding.spec.ts，e2e-types-closeout.log退出0。新E2E完整runner尚未执行，CDP等价场景与helper实测不冒充全量E2E通过。
- 最终根check-closeout.log（后端包级check与Shared构建、双端ESLint、前端类型）、build-closeout.log双端生产构建、相关修改脚本node --check、全量format-final.log与git diff --check均通过。源码审核覆盖Scope→Plugin→Snapshot与HTTP/Shared→正式Host/设置/DEV/测试，产品和测试源码不再引用nexus.terminal、builtinAppDefinitions、defaultEnabled、AgentCreateApp及内置存储字段。USAGE/三份架构/部署签名同步，四表见PLAN。未提交推送，全部前序变更与测试文件保留。

### 后端架构偏移与容量同步审计（2026-11-04）

本轮用户授权继续架构审核，合理问题直接修正，并统一双端限制/去除不必要固定限制；保留此前全部未提交变更。仅执行源码、AST/类型静态审核与构建，按PLAN D17未新增或运行行为测试、CDP、本地/远程E2E；前序插件/市场/工具栏专项PASS不算本轮行为验证。不重启服务、不操作生产库、不提交推送。日志与扫描脚本集中 `/tmp/nexus-backend-architecture-audit-20261104`，按用户要求保留测试环境及产物。

- 架构范围：scan-before.json扫描769个后端TS、4190个静态依赖，发现Files三个Model直接引具体Adapter；修改为Platform的TextCodec/ArchiveCommands/ZipStream并在Remote register注入，归档原始输出解析收回Adapter。同步归档Service/helper及生命周期夹具，不增加连接或资源owner。RunTool分页范围/双向cursor、SFTP symlink参数、Workspace viewport显式技术投影修正；删除Targets schema转导出与子迁移数组，唯一版本/签名仍归applicationMigrations。手工复核Plugin清除数据的同事务参与者装配、应用准入、SQL位置，无新增分层问题。
- 扫描边界：scan-closeout.log最终769个TS/4199依赖，Model直接依赖Adapter、Service直接依赖存储、Adapter反向引Model/Service、Platform反向业务、跨一级模块私有依赖与Adapter外SQL均未检出。188个展开候选属于条件白名单或内部受控模型clone，6个Shared非values引用实际仅用纯isWellFormedFileText校验；boundaries-closeout.log的66个参数候选及results-closeout.log的17个返回候选结合原辅助投影、标量回调、私有技术helper/闭包外层转换复核，未确认其他违规。扫描只覆盖所列模式和复核调用链，不声称769个文件已逐行穷尽所有架构/并发问题。
- 容量链：limits-inventory.json与limits-frontend/backend/shared.log盘点源码候选；个人偏好七个数值范围由Shared唯一维护，协议、Service、持久解码、两个设置面板/校验、表格预览及实际状态/Files/命令滚轮缩放消费同一取值。目录切换、上传/传输等待及归档密码复用Shared，前端保留原交付余量。命令/标签/收藏固定总数与相关offset上限删除，创建COUNT/回调死类型同步删除；分页聚合无旧总数截断，组删除仍严格核对完整成员/版本，实际SQL用子查询且完整请求1 MiB预算生效，未改成超大IN参数。快照仍逐行严格校验，无旧集合总数。历史读取offset与保留政策分离，10000命令/2000路径同事务裁剪保留。
- Agent与严格存储：Run owner移除重复写死8，并发两个字段仅保留正安全整数表示范围，默认预算4/2、默认硬限制8/8、保存/CAS/围栏与实际占用核验保持；Shared codec、持久解码、UI输入上界与运行准入均消费该契约，不自动增额。Artifact创建原本已经使用现行配置，本轮只删除未被使用的512 MiB默认参数，不把它描述成真实容量封顶修复。偏好行解码删除旧命令栏四字段与objectWithDefaults，严格要求当前完整字段，读取/备份恢复共用原解码；全仓已无旧字段或旧计数契约消费者。
- 保留约束：现有单条/单页/完整编码预算、单命令50标签/单次1000关联、历史裁剪、尚未分页的主题集合、实际owner的缓存/流窗口/任务队列以及端口/浏览器/运行时技术表示边界保持。未机械把时间/字节/token等所有上限改成安全整数，也未新增更紧限制或改变UI视觉。
- 检查记录：第一批check-closeout.log、build.log、format.log通过根check、Backend/Shared构建和全量格式；初次decompress重复参数与夹具函数空行已修正。容量批capacity-check.log根check通过；capacity-scope-format.log只因不存在的favorites/*.ts glob退出2，准确变更名单的format-final.log退出0。最终check-final-capacity.log根check退出0；shared-check-final.log的Shared check、build-final-capacity.log的Shared/Backend/Frontend build、format-all-final.log的全仓ESLint/Prettier均退出0，最终文档变更经docs-format-final.log与docs-check-closeout.log复核格式。两个变更mjs的node --check及git diff --check退出0。

待远程行为回归：文件编辑编码/BOM、目录ZIP与三种归档的成功/失败/取消/清理；工具历史游标；空库唯一初始安装；超过原2000命令/收藏与200标签的创建/完整分页、组删除完整快照及冲突原子性/请求超预算拒绝；偏好七字段边界与旧字段/缺字段严格拒绝及备份恢复；提高已保存并发至8以上后Root/Child/模型派发准入、默认值保持、取消及未知资源占用不提前释放。此处为待验判据，没有执行结果。

### Agent App 操作组垂直居中（2026-11-04）

用户报告App列表右侧安全策略配置、禁用和卸载操作组未垂直居中。源码确认AppManagementSettings父行从sm断点使用flex-row/items-center，子操作组的self-end覆盖父行对齐，令整组贴概要底部；本批仅删除该self-end。组件的嵌入与独立入口共用此行；639px及以下原全宽三列grid规则保持，UiButton、图标、启停/卸载确认及清除数据流程不变。USAGE与Frontend原目录/卸载设计已同步，未新增类型、请求、状态、监听或存储。

本批产物集中 `/tmp/nexus-app-actions-align-20261104`，保留全部已有变更、测试服务及产物，不重启、不提交推送。按PLAN D17仅源码/静态，未运行行为、CDP或E2E，未添加镜像实现的布局测试。check.log根check、build.log前端build均退出0；format.log全仓ESLint/Prettier与git diff --check退出0，最终文档经docs-check.log复核格式；构建CSS已核对包含sm:items-center与原手机grid规则，此为静态产物核对而非浏览器视觉通过。待远程视觉核对640px以上两种列表入口操作组垂直居中，320/390px三列无溢出，以及安全策略展开、启停和卸载确认仍沿原流程。

### Nexus Agent 插件与工具设计审核（2026-11-04）

本批按PLAN D17仅源码、架构和静态检查，未运行行为测试、CDP、本地/远程E2E或付费模型请求。产物集中 `/tmp/nexus-agent-tools-audit-20261104`；正式插件从独立仓库基线bda89fc修改，现有全部工作区变更、测试服务和产物保留，不提交、推送或发布。

- 插件与工具盘点：review.md按14族逐项核对原59工具，无等价能力证据不删除；新增Browser/已保存ACP安全发现后共61。declarations.json由TypeScript AST读取声明，不执行应用；工具描述总UTF-8字节17885→11709（减少34.5%，含新增发现），两Skill含frontmatter共4687→2601（减少44.5%），不是token/延迟/准确率实测。插件源版本1.0.2；旧签名内容不覆写，nexus-agent-plugin.patch可独立审核，未安装/签名/发布新包。
- 源码调用链：每步Child工具上界→Tools.availableDefinitions→Governance同事务政策/Run选择/现存SSH→原authorizationFact，筛声明/授权/denylist及空目标；实际派发/结果交付继续核权。Browser目录不含CDP端点，ACP目录仅当前App已启用且关联选中SSH的安全元数据，无argv/cwd/凭据，不启动进程。技术历史调用只检查名称形状/结果配对，不再与当前目录耦合；当前新提案仍严格按本轮目录校验。九个既有有限文本字段经Model和技术Adapter白名单投影enum，无新增限制。
- 消费者与边界：ToolInput/声明/执行/技术排除联合、Run请求hash/模型流、上下文预算和双协议编码、Root/Child及原审批链均已核对；Governance应用/存储类型独立，Adapter不引用应用对象，SQL归原Adapter。三语工具名称同步；原Child继承fixture明确传同一SSH选择以保留文件工具可用断言，仅语法核验，未运行。工具族保留理由、完整名单与待验场景见review.md。
- 静态：check-initial.log首轮暴露文本helper联合返回导致choices无法窄化，已以真实text分支类型修复；check.log根check退出0，覆盖Backend/Shared构建、双端类型及ESLint。build.log双端build退出0；plugin-check.log独立插件静态check退出0；原fixture node --check、两仓git diff --check退出0。format.log全量ESLint/Prettier退出0，最终文档另经docs-check.log核对格式。

待远程行为验收：未授权/能力未声明、空选择、RDP/删除SSH、denylist与Child目标缩窄的实际工具目录；配置空/变更/过期与Browser安全发现/独立open审批；ACP其它App/禁用/未选目标排除，发现零进程启动及执行审批/版本复核；Chat Completions与Responses实际enum与原非法输入拒绝、file_write显式absent；历史工具移出目录后旧调用仍可编码、当前不可用新提案仍拒绝；新签名1.0.2安装后的Skill搜索/哈希读取。以上均为待验范围，未记PASS。

## 本地文档刷新（2026-11-04）

本批仅整理7份文档：移除 Frontend 与本页误复制的后端架构正文，恢复正确标题与职责；Frontend 重建八节总览并保留前端专项；PLAN 原样保留决定项，退出已完成规划并承接未验清单；纠正旧前端迁移状态、工具审计/认证单调用详情混写、Run 并发与冻结期限、资源目录及部署下载分支。当前源码、规则文档、测试服务和现存数据库未修改，不提交、推送或发布。

产物集中 `/tmp/nexus-doc-refresh-20261104`，`before/doc/` 为本批改前备份。已完成两轮文档与源码事实复核；7份修改文档的 Prettier 检查通过（format-check.log），160项本地 Markdown/HTML 链接及章节锚点通过（links-check.json），git diff --check 通过（diff-check.log）。content-audit.json 核对决定项保留区逐字不变、真实历史证据完整、三份规则文档未修改；已完成阶段的证据仍可在本页原专项找到。仅格式变化不改变历史证据结论。

本批没有运行行为、CDP、E2E或构建；文档检查不作为产品验收。后继未提交源码及独立插件1.0.2的待验/发布缺口保持，详见 PLAN；测试环境、备份和产物按用户要求保留。

## 网络切换自动恢复（2026-11-04，源码与静态）

本批产物集中 `/tmp/nexus-network-recovery-20261104`，保留全部前序变更、测试服务与数据，不重启、不提交推送。按 PLAN D17 未新增/运行行为测试、CDP 或 E2E。

根因：RuntimeSession.runConnect 将所有失败统一写为 waitingForRetry，清除自动重连计时和即时恢复意图；scheduleReconnect 与自动 reconnectNow 均被该标记阻断，因此首次网络重连失败后不再自动恢复。Page 只有 online/前台事件，切换仍在线的网络不一定产生 online。普通 resume 若旧附件尚未释放返回 conflict，同样被永久阻断。

实现：Socket 复用 WebSocketConnectionFailure 归类真实打开/关闭故障，本地等待超时使用 WorkspaceRequestTimeout；Runtime 对未越过新建/所有权未知围栏的传输失败继续原退避，普通 resume 的 conflict/remote_unavailable 重试同一凭据；离线沿原策略暂停，网络事件可唤醒。失败尝试的局部 close 不重复调度，成功后不再次恢复已绑定附件。resumeAck 的本地未派发拒绝可解除本次围栏；已发送而回执缺失、协议失败与其它未知仍停止。Page 可选监听 navigator.connection 的 change，沿原存活检查与挂起目录协调；卸载解除监听，隐藏/失活不派发恢复。

两轮源码复核覆盖 Socket 打开/关闭/请求等待、初次创建、普通续接准备/回放/ACK、确认后尺寸激活、断网和连续网络事件、权限/主机信任/协议拒绝、关闭与销毁；核对后端 resume 只在 ACK 提交新代次，未确认准备随旧附件脱离回滚。未修改输入/上传/复制的派发链，也未放开新建或 ACK 未知重放。既有 reconnect-ui 的 SSH 服务明确拒绝等待按键场景仍符合当前逻辑；未将源码推演记为行为 PASS。

静态结果：check.log 根 check 退出0（Backend/Shared 构建、双端类型与 ESLint）；build.log Frontend vue-tsc 与 Vite 生产构建退出0；format.log 全仓 ESLint/Prettier 退出0；git diff --check 通过。仅文档收口后另做目标格式复核，不把构建当网络切换实测。

待远程/实机验证：多次 WebSocket 打开失败后网络恢复；准备续接中断线/超时、旧附件 conflict 及原 PTY 身份/输出游标；确认未派发与确认已发送回执丢失的区别；onLine 始终为 true 的 Wi-Fi/移动网络切换；离线暂停/上线提前恢复、后台/返回前台、多标签与连续切网不重复续接；主机信任取消、密码/权限/目标失效仍需明确操作；挂起目录可用转换仍不抢占其它 owner；关闭/注销/卸载无重连残留。现有专用目录与产物保留至用户通知清理。

## main dev 交付与数据库维护（2026-11-04，已完成）

用户授权提交推送、修复正式远程 E2E、发布 main dev amd64，并更新指定 Nexus 实例及手动维护数据库；另确认删除新版已移除、不再需要的数据。前序全部已授权变更提交 `4fa936c2`，首轮 [41777130159](https://github.com/0honus0/nexus-terminal/actions/runs/41777130159) 的质量、Docker smoke 与 Backend 分片通过，7个 Browser 分片全部有失败，主要源于同一 pending 目录准入错误，首轮不可发布。

已确认失败：工具目录读取要求 Run 已 running，但首次模型步骤是在读取目录后才 reserve 并将 pending 转为 running，导致只读对话及子任务入口直接 configuration_changed。修复仅允许 pending/running 读取当前授权目录；真实工具派发的 running/权限复查不变。SSH 原有回归补强为连续两次真实 WebSocket 打开阶段关闭，之后自动续接原输出与未完成输入。

源码复核沿目录 SQL→Model→Governance→Tools→Run reserve/dispatch：初次准备允许 pending，不接受任何终态或 unknown；目录裁剪不替代派发授权。重连测试只注入本次创建的两个连接中断，不重发 SSH 输入或修改产品界面。另两处测试基线同步：首启 Modal 按现存标题 Enable Agent with Nexus Agent 定位；执行设置独立用例先安装签名 Nexus Agent，再验收总开关 CAS，首启确认/取消由专项完整保留。根 check 通过，目标 ESLint/格式与 diff 收口，正式远程结果随后记录。

数据库只读对照确认仅定义表删除 installed/default_enabled/source_kind、实例删除 is_default 及默认唯一索引，结构签名更新。指定主机部署目录下 `maintenance/20261104-main-dev` 保存维护脚本和副本演练；演练成功核对全部结构、各表保留行数、完整性与外键。完成最终E2E与镜像发布后，线上维护按下方记录执行；操作前停止本应用、备份整个data/配置与原镜像信息。旧 builtin 的1会话/2任务/1附件及关联行经真实 FK 闭包归档删除，其它 App/账户/连接/配置保留。未扩大为自动开发库迁移。

### 第二轮完整通过与发布

修复提交 `fd41a0fe` 的正式远程 [41778130423](https://github.com/0honus0/nexus-terminal/actions/runs/41778130423) 全部success。549场景首次通过，无失败、重试、flaky或跳过：Backend125；Browser1–7分别41/61/53/57/58/94/60（含隔离场景）。质量、生产构建及Docker启动冒烟通过。连续两次真实WebSocket opening失败后自动续接原输出和未完成输入的回归17秒通过；初次SSH明确失败仍按原断言等待显式重试。首轮只读/图片/协作等任务失败、首启定位及设置安装前提均已复验通过。

本地根check、Backend构建及全量格式通过，证据 `/tmp/nexus-main-dev-release-20261104/round2-{check,build,format}.log`，最后同步测试/文档的目标ESLint/Prettier及diff通过。未运行本地全量行为/CDP/E2E。各分片原日志、两轮结果与数据库维护演练保留同目录；真实运营商切网与设备休眠不因受控中断回归通过而扩大宣称。

CI自动提交 `4aa3b49e` 仅更新耗时估算，已快进同步；按用户授权由main触发 [41778950373](https://github.com/0honus0/nexus-terminal/actions/runs/41778950373)，发布dev/linux-amd64，发布及远端结果如下。

### 指定主机更新与维护结果

发布 [41778950373](https://github.com/0honus0/nexus-terminal/actions/runs/41778950373) success，包含生产依赖审计与镜像构建/推送；镜像 `ghcr.io/0honus0/nexus-terminal:dev`（另有 `sha-4aa3b49e9e5a`），linux/amd64，digest `sha256:5fd697e3d48d67615628f65c8d39c83ba175ed1b22455cd327abf7f495b4d8c6`，OCI源码修订为 `4aa3b49e9e5a957d0d9125b9e70162c5a595f7b3`。

指定主机原部署 `/home/honus/product/nexus_terminal` 已更新。先完成镜像下载/版本核对，再停止本应用、归档完整data/实例配置/Compose及原镜像信息；备份 `maintenance/20261104-main-dev/pre-upgrade-data.tar.gz` 的SHA256复核通过。维护事务删除旧builtin及真实FK关联闭包，移除4个旧字段与默认索引，核对全部最终DDL及所有表的精确保留行数后更新结构签名。没有修改应用自动迁移逻辑，也未操作其它服务。旧附件数据库记录已归档删除，其对应实体文件原已不存在，未删除其他附件。

维护后仍保留1账号、7连接、1代理、原插件安装墓碑与保留KV；两项pragma检查为integrity=ok、foreign_key_check=0。前后端容器均加载上述digest/源码修订并healthy；站点 `https://ssh.honus.top/` 与 `/api/v1/status` 均HTTP200，状态正文 `{status:"ok",service:"nexus-backend"}`。两容器自本次启动起日志未发现warn/error/fatal。证据 `/tmp/nexus-main-dev-release-20261104/deployment-verification.log`；远端完整部署/启动日志、备份、维护脚本与副本均集中部署目录下 `maintenance/20261104-main-dev`，按用户要求保留至通知清理。此结果不扩大为真实设备/所有业务实机验收。
