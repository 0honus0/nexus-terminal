# 历史验证索引

本页供检索旧验证，不是当前操作手册或施工计划。当前基线、命令和判据见 [E2E](E2E.md)，未验任务见 [PLAN](../PLAN.md)。每项链接固定到整理前提交的完整原始记录，保留当时 SHA、环境、命令、测量、失败、日志路径与清理边界；旧文中的“当前”“下一步”“尚未提交”只属于当时，不授权继续旧操作。

已退役 Runner/Guacamole 的证据仅用于追溯，不能证明当前 SSH/CDP/浏览器 SDK 的行为。静态、受控 fixture、真实服务与真机结论分别判断。

## 复制移动安全与同类配色扩查（2026-11-05，源码与静态）

基于 `main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区，保留前序文档整理、连接工具栏及配色修改。按本轮授权修复原生 rsync 的 size/mtime 跳过，以及不同已保存连接抵达同服务器时 SFTP 中转的路径重叠；登录并发不改，Docker 镜像更新取消。NativeServerTransfer 增加 `--ignore-times`；Files Model 从实际受信握手公钥生成内部摘要，copyRemoteEntries 对原连接或同密钥连接在首次写入前检查整批规范路径。没有新增探测临时文件，也没有删除原安全 stage 或凭据/known_hosts 暂存；相同密钥只构成保守拒绝依据，物理文件系统身份、不同密钥/共享挂载别名和并发替换的保证边界见 Backend。

配色扩至快捷命令分组、连接标签选择、Agent Provider/MCP/ACP/插件市场及机器突变恢复状态；历史与挂起时间取消额外透明度。普通计数保持中性，快捷命令标题/底色只在非悬停时使用新配色，保留原悬停、选中、焦点、禁用和操作流程。Agent App 现有启停色及审计已有分类色经核对保留。新增私有 FileResource 字段已同步生产构造、五个后端夹具文件及目录复制夹具，无 Shared/数据库变更。

正式跨服务器协议用例增加三项：重复连接的 copy/move 拒绝原位、源父目录链接及递归目标，源字节和目录保持原样；同原连接原位 move 仍可完成；rsync 移动覆盖等大小/时间旧内容后才删除来源。原六条 clipboard/send × rsync/scp/relay 复制路线增加等大小/时间、不同字节的既有目标。目录复制夹具改为不同密钥下的同文本源/目标路径，保留 200 文件内容及任务级父目录检查。SSH 测试服务器的 REALPATH 改为实际解析文件系统链接，避免词法归一掩盖该场景；相关夹具取消、清理和失败开关不变。

Node 26.13.0 / pnpm 12.16.1：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build:backend`、`pnpm run build:frontend` 与 `git diff --check` 全部通过。Playwright `--list` 识别受影响协议文件全部 12 项；仅为用例收集，不表示执行通过。最后的 SSH 夹具修正及文档回填另补 ESLint、语法、格式与 diff 检查。日志集中 `/home/honus/nexus-task-artifacts/copy-safety-and-color-audit-20261105`，按 D17 未运行行为回归、浏览器或远程 E2E，未启动服务、提交、推送或操作远端。深浅主题/手机视觉及真实传输仍在 PLAN 待验。

### 补充浏览器与传输回归授权

用户随后明确要求浏览器验证、增加 E2E 并修复到远程通过。本地复用正式 Playwright 服务和基线，外置配置仅省略不在本批场景中的桌面服务，报告、浏览器下载和临时目录集中在上述任务目录。根 check、全量格式、双端生产构建、E2E 的 vue-tsc（使用任务目录配置）及文档 257 个本地链接均通过；裸 tsc 无法解码 Vue 导入，改用实际 Vue 编译器后通过，不添加源码 shim 或放宽类型。

12 项传输专项全部通过：六条原生/SFTP路线确实覆盖同大小/时间的不同内容，重复连接/源父目录链接/递归目标均在写入前拒绝，源保留；rsync 移动正确覆盖后才删除来源，原取消/失败/链接回退仍通过。另 10 项浏览器检查分轮通过：新增 6 项 light/dark × 1440/390/320px 检查及原 Docker、快捷命令、Provider、插件来源用例补充真实渲染颜色/对比度断言。18 张目录截图经 Chromium CDP 捕获，实际查看深浅手机目录；文字对比度至少 4.5，名称/类型/标签颜色不同且页面无横向溢出。既有目录/表单操作、密钥入口和弹窗关闭均验。自定义主题、真实触屏设备仍不由此证明。

首两轮保留失败：新测试错误假设密钥弹窗有可访问名称且支持 Escape，已按正式旧组件的标题和 Close 按钮定位，未改产品流程。插件来源用例原来等待公网官方目录才渲染本地仓库；浏览器读取现在显式注入网络失败，校验部分目录失败时仍显示受控第三方来源，官方来源不可覆盖的真实后端 400 断言保持。该用例不是官方公网下载/验签成功证据。新增截图/报告及 round1–3 日志均保留，正式远程整轮另记后续结果，不混用本地结论。

### 首轮远程失败与修正

提交 `c7709d80473bd44c61e5184f463a96d0d6fa3ee2` 的 [E2E 42000466180](https://github.com/0honus0/nexus-terminal/actions/runs/42000466180) 中，质量检查、双端构建、Docker smoke 和六个浏览器分片成功；后端一例失败，另一个浏览器分片一例重试通过，flaky 门禁正确拒绝整轮。跨会话旧用例实际将同服务器同目录复制到自身，现改为验证 conflict 且源内容保持；不同服务器同文本路径的成功复制仍由独立夹具覆盖。本地 round4 通过。

Agent App 生命周期旧用例直接等待公网推荐目录，超过 10 秒而重试通过；现先通过真实 API 安装本地签名 Nexus Agent，验证推荐端点准确返回该安装。新增正式 E2E 执行已有真实 HTTP/SQLite 的官方目录契约测试，控制网络 Adapter 返回，保留固定公钥校验、语义版本排序、无兼容推荐和离线已安装读取，并新增未安装且目录离线时明确 503/provider_unavailable。不是公网下载成功证据；本地 round5 两项通过，产品 UI、生产超时和信任政策未改。远程整轮仍待重跑，失败日志及 round4/5 报告留在本轮任务目录。

### 整轮远程验收与收口

修正提交 `08fdd88dbcb18a1edf303826998705c9d5bb55d4` 的 [E2E 42001858049](https://github.com/0honus0/nexus-terminal/actions/runs/42001858049) 全部成功：根质量与格式、双端生产构建、Docker 部署 smoke、Backend 及七个 Browser 分片均通过。正式 Reporter 共 577 条唯一 passed，零失败、重试或场景跳过；Backend 131 项，Browser 1–7 分别 41/46/53/73/65/83/85。耗时估算更新成功，截图更新任务按条件跳过，非测试场景跳过。本轮相对上一完整基线新增 10 项正式 E2E；生产实现提交为 `c7709d80`，远程修正只涉及用例和验证文档，未削弱生产防护或修改已确认 UI。

本地 round4/5 补跑三项通过后，根 check、全量格式、E2E vue-tsc 与 diff 再次通过。远程日志、准确 SHA/jobs JSON 和逐项统计保留为任务目录的 `remote-final-run.log/json`、`remote-final-summary.json`；首轮失败保留 `remote-first-run.log`。自动提交 `94603a33` 只调整 `scripts/e2e/duration-estimates.json`，已核对后快进同步，不将其作为直接被测 SHA。PLAN 清理本轮已验收施工区，自定义主题、真机和三语/身份交错未覆盖项承接待验区。无数据库变更，不需迁移；没有发布镜像、部署或操作生产数据。本地测试服务已退出，产物按要求保留至用户通知清理。

## 管理列表深浅主题信息层级（2026-11-05，源码与静态）

`main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 当前工作区：基础 primary 采用中性色，原类型徽标和标签因此接近普通文字；部分次级字段又叠加透明度。现由 Foundation uiCatalog.css 提供名称、信息色类型、主题强调色标签和语义状态配色，六个源码文件覆盖连接、代理、通知、Docker 与工作区连接分组；不改全局按钮、布局、动作、Shared 或持久数据。已审宽窄屏标签、分组优先级、主题变量应用链及原状态投影。

Node 26.13.0 / pnpm 12.16.1：`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend`、`git diff --check` 通过；最后调整工作区次级透明度和分组悬停后，另跑受影响 Vue ESLint、Prettier 与前端构建通过。产物集中于 `/home/honus/nexus-task-artifacts/management-colors-20261105`。contrast.mjs/contrast.json 对默认主题的九类文字和明确实色背景做 sRGB 设计计算，浅/深色最低分别 4.80/6.56；不是浏览器像素检测，不代表自定义主题、手机或实际视觉已验。本轮未启动服务、运行浏览器或正式远程 E2E，待验范围保留 PLAN。

## 连接目录操作与密钥管理入口（2026-11-05，源码与静态）

基于 `dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区：电脑端将密钥管理、测试全部、连接全部横向排列；760px 及以下保留原两枚竖排操作，密钥管理从更多菜单进入。新入口经 ssh-keys/public 复用原弹窗与读写 owner，按需挂载；页面隐藏或身份变化关闭，原批量 SSH 筛选范围保留。无 Shared、后端或数据库变更。

Node 26.13.0 / pnpm 12.16.1 下，`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend` 和 `git diff --check` 全部通过。日志位于 `/home/honus/nexus-task-artifacts/connection-toolbar-20261105`，本轮未启动服务或执行浏览器/正式远程 E2E；宽窄屏三语及弹窗交互仍待行为回归，见 PLAN。

## RDP 证书交付前审核与发布（2026-11-05，已通过并发布）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书交付前审核与发布2026-11-05已通过并发布)。

## 配置布局保存冲突（2026-11-05，已通过）

同一页面也可触发：preferences/layout/sidebar/focus共享版本；弹窗打开后保存锁定开关或其它偏好、先flush尺寸任务，原布局保存仍携带打开时版本。无需第二会话或其它用户。修复将弹窗原布局/侧栏内容基线送入Store原队列，只有无关版本变化时使用当前版本，真实内容冲突保留草稿；确定409最多恢复一次，unknown不重放。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#配置布局保存冲突2026-11-05已通过)。

## amd64 dev 发布与交付（2026-11-05）

发布运行 [41987211909](https://github.com/0honus0/nexus-terminal/actions/runs/41987211909) 成功。GHCR 的 dev 与 sha-a7f9aeb79491 同为 `sha256:ceb2172ba6eb1bfb5bcd5ca0be7e28937dde2c4a68091c7787c0e61e23692a3e`，可运行平台为 linux/amd64，OCI revision 为 `a7f9aeb7949106967466460c4a93cf817e02d16d`。生产实例未更新。核验 manifest、发布结果及日志保留在 `rdp-certificate-release-20261105` 任务目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#amd64-dev-发布与交付2026-11-05)。

## RDP 证书确认与认证配置核对（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书确认与认证配置核对2026-11-05源码与静态)。

## RDP 当前批次审核与正式 E2E（2026-11-05，已通过）

用户授权审核全部当前本地变更、补充用例、提交推送及修复远程E2E。按H-13保留已确认UI，未扩展产品配置或新增库协议；所有既有输入锚点/文件/音频/浮动工具栏源码、三语、依赖锁及vendor固定补丁已审核。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-当前批次审核与正式-e2e2026-11-05已通过)。

### 首轮远程失败与修正

提交79fbba4d的正式远程41971291558：质量、Docker、runner以及Backend和5个Browser分片成功，Browser3/5各失败一项。新增文件批次取消/重连/AudioContext释放4.4秒通过，真实VNC、DPI及pointer resize/minimize通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程失败与修正)。

### 最终正式远程结果

修复提交2f580434的完整远程[41972562509](https://github.com/0honus0/nexus-terminal/actions/runs/41972562509)最终success，560项一次通过，无失败、重试或测试跳过。首轮失败的桌面RDP综合场景9.6秒、手机RDP场景7.2秒通过，新增文件批次重连/音频context释放4.2秒通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终正式远程结果)。

## Windows RDP 实测、顶部工具栏与清理（2026-11-05）

在独立数据库、指定 Windows 目标及 CDP 中验证连接、常用键盘、双向文本/文件剪贴板、顶部工具栏和触屏仿真。临时启动的 Audiosrv/AudioEndpointBuilder 已恢复原 Stopped/Manual 状态。

- `audio-acceptance.json/log`：真实Windows内存WAV产生非零PCM，32次实际AudioBufferSource.start、44.1kHz立体声、峰值0.36624；原AudioContext时钟运行。暂停期间再播放一段真实声音，start计数不增长，恢复后新声音继续播放；重连时原context为closed、新context为running。排程提前量最高35.41ms，实际块约185.76ms；前者不是网络延迟或端到端声音延迟。Headless浏览器静音，不能证明物理扬声器听感；设备报告延迟也不能代表用户真实硬件。
- `file-acceptance.json`及`upload-acceptance.json/log`：远端2048字节二进制下载逐字节及SHA256一致；浏览器文件选择后在真实Explorer粘贴三文件，131073字节二进制、0字节空文件、33字节中文内容，以及中文/emoji文件名全部核对大小和SHA256。仅本次隔离文件，不宣称目录打包、大文件内存或吞吐已测。
- `toolbar-desktop.json`：4组通过，工具栏移出隐藏、所有原控件同一顶部区域且画面几何不变、Enter/Esc焦点、文件面板超出悬停仍可见及Esc关闭。`window-acceptance.json/log`另4组通过：实际点击锚点偏差小于3px、最小化/恢复不断线、全屏/Esc不断线及恢复浮动工具栏、改宽后仍保持完整高度。原显示区域1062×754，现1062×856，释放102px的上下固定占用。
- `mobile-acceptance.json/log`：390/320px Android UA与真实CDP touch事件仿真通过；顶部展开/桌面点击收起、全部控件无横向溢出，320px文件面板开关及关闭连接通过。三份UI结果pageerror均为空，截图toolbar-desktop-open/hidden、window-desktop及toolbar-mobile-390/320保留。这是浏览器仿真，非原生手机键盘或输入法候选窗口验收。
- `services-restored.log`、`remote-cleanup.log`核对服务原状及远端临时目录删除；`cleanup.json`列出本次和可确认前序临时目录/缓存/工具包/旧trace删除，两个专用Docker镜像及按确切ID匹配的66条本轮构建缓存清理。自建9998/3001/29222及旧43669监听、目标13389测试TCP均已释放，临时数据库/凭据/profile/浏览器二进制已删除；保留产品源码/vendor包、项目node_modules、Node26/pnpm12工具与精简日志。最终磁盘已用16664788992字节（15.52GiB），可用约13.32GiB；与初次约29GiB相比已明显回落，未操作其它项目镜像或用户数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#windows-rdp-实测顶部工具栏与清理2026-11-05)。

## RDP 音频输出（2026-11-05，源码与构建）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-音频输出2026-11-05源码与构建)。

## RDP 输入法定位与文件剪贴板（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-输入法定位与文件剪贴板2026-11-05源码与静态)。

## 依赖升级提交与正式远程验收（2026-11-05，完成）

用户授权提交推送并等待本次完整E2E。复核所有4份workflow引用的11种Actions，均与本轮官方release盘点一致；5份清单共121条依赖声明和catalog/overrides已核对。Vue3 draggable、TS6前端别名、SheetJS官方包及IronRDP锁定上游构建保持实际适用来源，不将npm旧latest标签作为降级目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级提交与正式远程验收2026-11-05完成)。

## 依赖、Node 与 Actions 升级（2026-11-05，静态与构建）

工作区为 `main/e79cf838` 的本轮未提交变更。官方 Node release index 确认最新正式稳定版26.13.0 LTS（Lithium），27 alpha未采用；npm metadata确认pnpm12.16.1及升级版本，Actions按各官方最新正式release更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖node-与-actions-升级2026-11-05静态与构建)。

## 聊天 GIF 与图片预览容量（2026-11-05，源码、静态与限定 CDP）

环境为`/home/honus/nexus-terminal`的`main/92e7f996`未提交工作区，Node v22.23.1、pnpm 11.28.10；pnpm来自`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104/tools/node_modules/.bin`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#聊天-gif-与图片预览容量2026-11-05源码静态与限定-cdp)。

## Agent 提醒、会话列表与虚拟历史（2026-11-05，源码、静态与限定 CDP）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-提醒会话列表与虚拟历史2026-11-05源码静态与限定-cdp)。

## 手机后台恢复后的挂起目录同步（2026-11-04，源码与只读排查）

用户要求排查指定实例运行中手机后台返回、重连失败后刷新列表持续加载，并确认原标签为蓝色。只读SSH核对实际Backend为2b0ab3db、17:03:29 UTC启动；没有重启、修改配置/数据库、发起应用登录或接管用户会话。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机后台恢复后的挂起目录同步2026-11-04源码与只读排查)。

## Agent 输入工具栏图标与对齐（2026-11-04，静态检查）

本轮基于main/9a324a75，仅调整AgentAppSurface及唯一NativeInputArtifacts消费者的布局。SSH目标统一使用既有square图标触发器，保留可访问名称、悬停提示和选择面板，删除旧摘要和对应隐藏规则；模型、思考、目标、权限和停止靠左，文件与发送靠右。图标及附件组不收缩，模型名称沿原flex收缩省略。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入工具栏图标与对齐2026-11-04静态检查)。

## Agent 聊天悬浮区与输入工具栏修正（2026-11-04）

本批基于main/b6bd3b25。用户反馈手机Token/上下条状态行下半部分仍遮挡消息，同时要求权限/添加文件具备SSH目标同款边框、手机隐藏目标数量；授权提交推送、处理远程E2E与发布main dev，沿用linux/amd64，不更新生产。本批按D17执行源码/静态与正式远程测试，不启动本地业务环境。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天悬浮区与输入工具栏修正2026-11-04)。

## 终端工具栏响应优化（2026-11-04，浏览器及远程回归通过）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端工具栏响应优化2026-11-04浏览器及远程回归通过)。

## 工作区尺寸自动保存冲突（2026-11-04，限定浏览器回归通过）

只读排查指定远程实例：生产revision为7262e8ac，14:26:26.894及14:26:51.367 UTC的PUT /api/v1/settings/layout返回409（auditId1504/1506），此前及间隔内preferences写入成功。SQLite只读核对presentation记录仍存在、version136；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工作区尺寸自动保存冲突2026-11-04限定浏览器回归通过)。

## 连接编辑清除凭据布局（2026-11-04，静态检查）

基于main/fac0f2ee，ConnectionForm将清除凭据勾选项移到密码输入框右侧，SSH密钥模式放在选择框右侧。源码核对原输入ID、凭据可见条件、清除后禁用、密码留空保留及保存/取消调用链；复用原UiInput/UiCheckbox，输入可收缩，清除项不换行，无新请求或状态owner。USAGE及PLAN同步。用户随后要求审查代码并提交推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接编辑清除凭据布局2026-11-04静态检查)。

## 插件市场更新确认弹窗（2026-11-04，限定浏览器验收通过）

工作区基于main/d81823bb，将PluginManagementSettings顶部候选包确认区移入共用UiModal；安装及两步升级继续使用原契约。用户明确授权“本地两个修改都用浏览器验证下 没问题提交推送”，作为D17的限定例外。证据保留于`/home/honus/nexus-task-artifacts/plugin-market-modal-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#插件市场更新确认弹窗2026-11-04限定浏览器验收通过)。

## Agent 聊天工具状态与悬浮控件（2026-11-04，限定浏览器验收通过）

工作区基于main/c202c152，本轮仅修改前端聊天展示及对应文档；用户随后明确授权提交推送，未发布或部署。证据保留于`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天工具状态与悬浮控件2026-11-04限定浏览器验收通过)。

## 远程数据库维护与镜像更新（2026-11-04，已完成）

用户在镜像发布后明确授权维护远程数据库及更新镜像。目标仍为指定主机的`/home/honus/product/nexus_terminal`，原双容器健康、源码4a3074da，数据库为旧plugin-apps签名；4个Agent Run均completed，29份上下文缺systemPrompt，压缩/检查点/子任务记录均0。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远程数据库维护与镜像更新2026-11-04已完成)。

## Agent 执行补充回归与 amd dev 交付（2026-11-04，已完成）

用户最新授权补充E2E、提交推送plugin与本体，并在完整远程测试通过后发布main的amd dev。宿主从f789446f工作区接续，保留最小化提醒及全部六项执行优化；官方插件d5dd455/v1.0.3已发布，复核main与tag、公开Release一致且插件工作区干净。本轮不更新远程部署、用户数据库或运行本地行为测试。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行补充回归与-amd-dev-交付2026-11-04已完成)。

## Agent 执行与插件扩展（2026-11-04，源码静态及插件发布）

宿主基线main/f789446f及前序未提交最小化提醒；Node v22.23.1、pnpm 11.28.10。本轮按用户“全部修改”、工具接口可破坏性更新、插件更新后发布及同后端格式的授权实施。产物集中 `/tmp/nexus-agent-flow-plugin-implementation-20261104`，全部原目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行与插件扩展2026-11-04源码静态及插件发布)。

## Agent 最小化任务提醒（2026-11-04，源码/静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-最小化任务提醒2026-11-04源码静态)。

## 累积变更审核与正式远程 E2E（2026-11-04，已完成）

用户最新要求审核当前全部变更、修复残余并推送解决正式远程E2E。本批从main/ce7c135e及累积50个文件工作区继续，不回退前序修改；保留已有RDP提交，覆盖SSH连接、注销反馈、维护清理、终端响应和Agent可编辑硬限制。仅授权正式远程Actions，本地仍不新增行为/CDP/全量E2E、不操作用户数据库或发布镜像。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#累积变更审核与正式远程-e2e2026-11-04已完成)。

## 终端连接等待优化（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端连接等待优化2026-11-04源码及静态)。

## RDP/VNC 绘制性能验证（2026-11-04）

环境为 Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47 与 SwiftShader/软件 Canvas，未使用硬件 GPU。原产物目录为 `/tmp/nexus-rdp-render-performance-20261104`；下文日志及快照路径均相对该目录，历史路径不保证仍存在。

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

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdpvnc-绘制性能验证2026-11-04)。

### 浏览器性能及像素证据

Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47，独立环回HTTP服务、CDP和浏览器profile均在上述目录；浏览器实际为SwiftShader/软件Canvas，无硬件GPU。基线是改前真实presenter快照，最终候选由 `benchmark-final.mjs` 直接编译工作区真实模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#浏览器性能及像素证据)。

## 主动退出的错误提示隔离（2026-11-04，源码与静态）

用户反馈正常退出弹“操作失败／个人数据请求失败，请重新读取”。源码确认：useAuthenticatedViewScope的available/activated原先能在认证已撤销后重新建立scope；个人历史/快捷指令的error观察未核对view，通知的重读动作也未绑定原意图；LatestValueSaver失败回调只有error，工作区自动保存及字体回调未核对原permission；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#主动退出的错误提示隔离2026-11-04源码与静态)。

## 清理工作流超期空排队与执行日志（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#清理工作流超期空排队与执行日志2026-11-05源码与静态)。

## 两包镜像清理保留规则（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#两包镜像清理保留规则2026-11-04)。

## 终端翻页与缩放响应（2026-11-04，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端翻页与缩放响应2026-11-04源码与静态)。

## 可编辑硬限制与固定门槛清理（2026-11-04，源码审核）

用户要求继续去除可编辑硬限制之外无底层依据的常量上界。沿前序模型请求数修复及当前未提交工作区实施，默认预算、默认硬限制和UI不变，未提交推送、部署或操作数据库。产物集中 `/tmp/nexus-editable-hard-limits-20261104`，保留至用户通知。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#可编辑硬限制与固定门槛清理2026-11-04源码审核)。

## 模型请求数硬限制可调整（2026-11-04，源码审核）

用户希望把硬限制模型请求数设为800，却提示最大400。基线 main/ce7c135e 加前序本地SSH、退出提示、维护与终端响应变更；本批未提交推送。源码确认Shared AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests=400被前端硬限制QuantityInput、HTTP codec、ExecutionService与存储行解码共同消费；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#模型请求数硬限制可调整2026-11-04源码审核)。

### 独立 Nexus Agent 1.0.2 提交发布（2026-11-04）

用户要求提交发布此前精简。独立仓库 main `790ccdec91c4c88632d9f90f0378e41d0f9cc4d2` 提交六文件：两份Skill、NexusAgent manifest1.0.2、根版本与README/目录说明；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#独立-nexus-agent-102-提交发布2026-11-04)。

### 设置读取恢复与推荐安装默认授权（2026-11-04，远程回归完成）

用户继续授权只读排查指定 Nexus 主机；本轮 SSH 仅读取 backend 最近3小时/最多5000行 Compose 日志，未修改远端文件、配置、数据库或容器。实际日志66行，范围07:01:09.324Z–07:08:49.789Z，未找到对应设置 GET 失败，execution-settings PUT 为200且 responseFinished=true；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#设置读取恢复与推荐安装默认授权2026-11-04远程回归完成)。

### 本轮 dev 镜像发布（2026-11-04，完成）

[41792924820](https://github.com/0honus0/nexus-terminal/actions/runs/41792924820) 成功发布 main `4a3074da6f8ab7e515a017f949ce03b1d059dc88` 的 linux/amd64 镜像。生产依赖审计成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮-dev-镜像发布2026-11-04完成)。

### Agent 安装与插件仓库布局（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-安装与插件仓库布局2026-11-04源码及静态)。

### Artifact 总空间统一（2026-10-26）

范围：删除单文件设置及固定16MiB Artifact/图片、8MiB截图业务上限，取消10,000项累计文件准入，读取偏移跟随Shared协议容量；生成/截图/下载预检总剩余空间，最终begin事务保证总配额。文件库增量hash与Range分段下载复用现有入口，无额外UI变更。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#artifact-总空间统一2026-10-26)。

### 文件管理器预读20ms（2026-10-26）

原useFilesystemBrowser的PREFETCH_DELAY_MS由50改为20；FileManager普通目录、“..”鼠标停留及键盘定位共用此入口，后继最新候选补调度也引用同一常量。两轮源码审核核对入口与两处定时器，以及缓存命中、单个预读、最新候选、点击复用、离开/失活/dispose取消和revision围栏，无其它代码改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器预读20ms2026-10-26)。

## WebSocket 周期保活（2026-10-26，源码及静态）

范围：Platform HTTP listener 的既有 channel/raw WebSocket，每25秒以 ws 标准 Ping 保活，浏览器自动 Pong；无 UI、Shared 或业务消息变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#websocket-周期保活2026-10-26源码及静态)。

## 全部本地变更审核与远程回归（2026-10-26，已完成）

用户授权审核、提交全部本地代码并修复远程E2E。两轮分组源码审核覆盖 Agent Run/Step/Tool/Child、预算和模型SDK重试、上下文摘要与标题、批准分页/策略、模型来源、Artifact空间与分块下载、前端流合并/乐观消息/目标记忆、终端生命周期/输入恢复、Workspace附件流控及WS保活；保留已有授权UI变更，本轮不增加UI设计修改。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#全部本地变更审核与远程回归2026-10-26已完成)。

### 首轮远程构建反馈

提交1f21e469推送dev，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40259908812 。质量作业通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程构建反馈)。

### 首轮功能失败分类（40259908812）

通过分片4/5/7。产品：备份503（agent_runs approval_mode登记位置与PRAGMA顺序不符）、Custom SDK连接中（trace确认/sdk/common/version.js缺失CORS响应，静态白名单漏新SemVer依赖；改为esbuild单模块交付）、预览刷新点击被透明缩放padding截获（仅修命中，无外观调整）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮功能失败分类40259908812)。

### 第二轮远程反馈（40261572646）

3bb022fd对应 https://github.com/0honus0/nexus-terminal/actions/runs/40261572646 ：质量、Docker构建/启动冒烟及分片1/2/4/5/6/7通过；分片3/8各剩一个旧测试入口。前轮备份503、Custom SDK依赖交付、预览刷新遮挡均已通过真实远程回归；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮远程反馈40261572646)。

### 第三轮远程反馈（40262842979）

e2f66bdf对应 https://github.com/0honus0/nexus-terminal/actions/runs/40262842979 ：质量、Docker及分片1/2/4/5/6/7/8通过；分片3仅完整插件审批出现一次flaky，重试后命令、unknown与上传/下载完整流程均通过，failOnFlakyTests正确阻止假绿。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第三轮远程反馈40262842979)。

### 最终验收：第四轮全绿（40263876745）

代码提交fc5845fd97be449e11bb1b58b03ab2b9150af481，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40263876745 结论success。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终验收第四轮全绿40263876745)。

## 前端无效CSS清理（2026-10-26，源码及静态）

范围：仅删除无实际消费者的样式，不修改UI效果、模板/脚本或交互。复用已安装的Vue compiler-sfc、PostCSS与selector parser做临时审查（/tmp/nexus-css-audit.cjs），扫描91个样式源、2663条规则并得到126个候选选择器。工具输出不是删除依据；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端无效css清理2026-10-26源码及静态)。

## CSS清理交付、dev amd64与原站点升级（2026-10-26，已完成）

代码0fc60b7b127e699efffe99c89987b39b3a78a9bf推送dev。正式E2E https://github.com/0honus0/nexus-terminal/actions/runs/40265599805 完整success：463通过、0失败/0 flaky，8分片、根质量/格式/build和Docker smoke成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#css清理交付dev-amd64与原站点升级2026-10-26已完成)。

### 原部署识别及用户明确的数据处理选择

容器Compose标签定位原部署/home/honus/product/nexus_terminal，原NEXUS_DATA_DIR为./data，公开Origin为https://ssh.honus.top。旧镜像cb693e4c、数据库signature为backend-next-v1-initial-20261023-remote-tool-installer；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原部署识别及用户明确的数据处理选择)。

### 数据和入口验收

远程备份目录/home/honus/product/nexus_terminal/upgrade-20261026T035324Z（0700）：data-env-compose-before-upgrade.tar.gz、nexus-terminal-before-upgrade.db及previous-data完整旧目录；包含实例密钥，保留root权限，不上传仓库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#数据和入口验收)。

### 挂起关闭恢复画面几何修复（2026-10-26）

截图显示恢复后的TUI底部重复提示及空白；源码核对确认快照尺寸缺失、重复PTY resize和checkpoint尺寸排队问题。既有SSH `resizing a suspended fullscreen terminal is ordered after its checkpoint`同步验证baseline尺寸先于快照、live尺寸在快照之后；保留原快照正文断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#挂起关闭恢复画面几何修复2026-10-26)。

### Codex挂起恢复：高延时与滚动区域定向验证（2026-10-26）

用户明确授权api.honus.top的Codex测试及高延时时序排查，本轮限定该链路。使用独立Chrome/CDP与自建测试SSH会话，未接管用户现有终端；初次共享浏览器的恢复定位存在歧义，其结果作废，后续按精确suspend ID隔离。普通静止、执行中排队、75×28窄窗口恢复，以及WS上行700ms/下行900ms（实际往返约1.9秒）均保留输入区背景，未直接稳定复现原截图。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#codex挂起恢复高延时与滚动区域定向验证2026-10-26)。

### 终端逐字符真实回显优化（2026-10-26）

源码沿前端onData→sendConnected→WS terminal.input→requireTerminal→Workspace.write→ssh2 channel及原输出链核对：前端发送/前台输出没有固定防抖；Workspace WS入口仅派发任务，不等待文件操作执行完成，不能把Platform串行消息接收误判为终端等待目录请求完成。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端逐字符真实回显优化2026-10-26)。

### VS Code TypeAhead 移植定向验证（2026-10-26）

本轮沿用户对 api.honus.top 的终端/高延时专项授权，未运行全量本地 E2E、模型请求或修改真实 SSH 文件。复用 VS Code 固定提交 ae11932c6109d3977d78f2fe8937d861e246151d 的 MIT 核心，来源和适配差异见前端 vendor README。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#vs-code-typeahead-移植定向验证2026-10-26)。

### 文件管理器纵向拖动与固定命令栏（2026-10-26）

用户报告api.honus.top连接后文件管理器无法向上拖动。原因是同一纵向Splitpanes中terminal/commandBar/fileManager三项只调整相邻Pane，而commandBar只有38–42px可调整区间；仅打开pushOtherPanes又会遇到库的最大尺寸提前返回、after-pane漏算后续兄弟，以及前侧全部到最小值后重复扣减前序尺寸的问题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器纵向拖动与固定命令栏2026-10-26)。

## Agent 步骤与工具审计移除（2026-10-26）

删除正式 Host/审批卡片及 DEV 页的审计入口，撤销四个专用查询端点和 Shared 审计 DTO。保留步骤/工具状态及内部事件事务，供执行、审批、异常恢复和快照一致性校验。回归改用线程工具列表核对 ACP 和工具终态，继续验证审批 hash、命令预览、真实副作用和取消围栏；插件用例核对审计入口消失及 Run 用量仍可读取，后端 HTTP 用例核对已移除端点 404。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-步骤与工具审计移除2026-10-26)。

### 2026-10-26 自动图片与远程回归修正

- functional-regressions：本地受控 Provider 返回 PNG Base64，模型调用 image_models_list/image_generate，结果只允许文件事实，最终仅回答普通文字。验证审批前无预览、完成后图片实际解码/下载、刷新恢复。无需真实付费图片请求。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-26-自动图片与远程回归修正)。

### ZIP特殊节点与连续拖动补修（2026-10-26）

- 生产只读日志：ssh.honus.top / pve_debian两次压缩在inspectSources非常规文件预检以invalid_input失败；尚未发布本轮ZIP代码，未宣称生产实测通过。 - 原生Info-ZIP实测：普通文件、空目录、FIFO和Unix socket组成的目录，zip退出18，FIFO被忽略、socket报警且添加日志不等于实际入包；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip特殊节点与连续拖动补修2026-10-26)。

### 原生压缩直接递归与限制移除（2026-10-26）

生产只读核对：后端已运行revision `7f8ff3ff9e54594a991e48451baafacb63991125`，最新压缩失败为 `limit_exceeded`，位置 `/dist/modules/remote/files/model/file-resource.js:436`，对应 `scanEntries` 的应用条目预算；不是旧镜像未更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原生压缩直接递归与限制移除2026-10-26)。

## 文件容量清理后续回归

aba02d2f正式Actions 40316497521：质量、构建、Docker及分片1/3/4/5/7/8通过；分片2的mutation fixture使用了重复cwd路径，下载用例仍期待已移除的8任务429；分片6目录force删除把1小时剩余期限传入SSH execute时，被旧5分钟参数检查拒绝，Model因派发状态不明退役文件资源。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件容量清理后续回归)。

### 跨服务器直传优先与中转共用链（2026-10-26）

跨会话剪贴板与发送到服务器共用copyRemoteEntries/RemoteFileModel.copyDirect。正式新增direct-and-relay-transfer六例：两个入口各测源到目标可达/不可达，8MiB单ZIP二进制的中间进度、精确SHA256、实际rsync/sftp方法；夹具记录直传零SFTP READ字节，中转READ字节等于文件大小；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器直传优先与中转共用链2026-10-26)。

### Agent 输入区状态栏整合（2026-10-26，本地静态）

将 Token 统计、上一条／下一条和回到最新消息纳入聊天输入区共同外框。两轮源码复核确认全部事件、显示条件和按钮禁用表达式保留；UiButton 默认 button，不触发表单提交；Token 弹层沿原 portal，宽度测量仍归原 form，状态行进入既有窄屏容器查询。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入区状态栏整合2026-10-26本地静态)。

### 手机 Agent 会话抽屉背景（2026-10-26，本地静态）

窄屏 `agent-hub-window <= 760px` 中的会话侧栏改用主题 header 背景，覆盖玻璃材质的透明混色；桌面、宽度、层级、遮罩及 inert/显隐保持。两轮源码复核覆盖选择器作用范围、CSS layer 优先级和默认深浅主题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机-agent-会话抽屉背景2026-10-26本地静态)。

### 前端冗余功能门槛（2026-10-26，本地静态）

移除连接创建/导入/导出仅前端500项与本地1MiB上限、附件10项及多选静默截断、公钥确认排队64项拒绝、传输详情5项裁切及目录读取8个在途拒绝。协议分批、逐项严格解码、权限/取消/未知结果保护及缓存LRU保留，UI布局与样式未改。两轮源码复核覆盖导入全批预检/部分成功回执、串行上传首失败停止、信任队列取消、目录去重/失效/真实错误传播、传输滚动容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端冗余功能门槛2026-10-26本地静态)。

### 列表记录可达与分页完整性（2026-10-26，本地静态）

传输API删除累计160项协议拒绝，保留逐页严格解码、递增游标及跨页重复ID拒绝；Agent会话搜索沿既有游标串行读取后续页，不再只查首50条，清空搜索/失活/禁用/未决写入停止新页，失败进入原重读围栏。未改模板、样式或布局。两轮源码复核包含刷新/搜索变化、分页期间失活、错误不自动重试、旧结果归原owner，以及其它列表的分页/完整入口。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#列表记录可达与分页完整性2026-10-26本地静态)。

### 跨服务器剪贴板页面实时进度（2026-10-26，本地静态）

`ssh/direct-and-relay-transfer.spec.ts` 新增两个浏览器用例，分别覆盖原生直传和不可达时的SFTP中转：登录、连接两个SSH标签、文件管理器复制、切换目标标签并粘贴、确认凭据交付。传输真实8MiB样本，沿用夹具带宽控制，DOM观察要求至少两个递增的中间百分比与正确字节总量；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器剪贴板页面实时进度2026-10-26本地静态)。

### 本批最终正式验收（2026-10-26）

产品/测试源码`dd7a558b572a4bb510ca70531d95f691967a7604`的[Actions 40347041664](https://github.com/0honus0/nexus-terminal/actions/runs/40347041664)全部成功：质量、生产构建、Docker部署冒烟和8个分片共494项首次通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批最终正式验收2026-10-26)。

### Agent 输入框外侧玻璃底色（2026-10-26，本地静态）

按用户指定doc截图，移除AgentAppSurface输入区footer的ui-glass-chrome材质类，使外侧不再铺满导航玻璃底色、渐变和内高光。两轮源码复核确认只改该footer的一个类，输入框自身边框/焦点反馈、原间距/响应式尺寸、Token与跳转控件、公共玻璃材质定义和其它界面保持。USAGE对应输入区章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框外侧玻璃底色2026-10-26本地静态)。

### 矮状态面板网络读数（2026-10-26，本地静态）

按doc服务器状态截图，沿原max-height:210px分支将网络标题与上下行速率改为左右同排；移除network-reading的0.68em父字号，将数值从0.58em恢复为与紧凑指标一致的0.76em，箭头保留独立字号及两方向间隔。紧凑加载骨架同步单行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮状态面板网络读数2026-10-26本地静态)。

### Agent 输入框上方独立控件（2026-10-26，本地静态）

按用户最新布局要求将Token、回到最新、上一条/下一条状态块移至form之前；只保留各自全局控件，无整条底色或边框。原footer透明表面保留。composer容器声明从form移到既有外层agent-composer-area，使上方控件和输入工具栏继续按相同可用宽度响应式收缩，不依赖整个聊天面板宽度；form测量ref、提交、键盘、详情弹层和导航条件/事件保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框上方独立控件2026-10-26本地静态)。

### Agent 控件与紧凑网络读数交付（2026-10-26，正式远程通过）

产品提交 `7865bfc159b0ca750f80d06f93d01125576c695d` 的正式 [E2E 40355305638](https://github.com/0honus0/nexus-terminal/actions/runs/40355305638) 全绿：质量、格式、生产构建、Docker 部署 smoke 和全…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-控件与紧凑网络读数交付2026-10-26正式远程通过)。

### 文件管理器路径栏垂直对齐（2026-10-26，本地静态）

路径原生输入框使用 flex stretch 跟随栏内高度、清除原生 margin，行高由 1 改为 normal，保留栏高、字体大小及各响应式断点。两轮源码复核确认左侧图标与父层 items-center、输入/导航/历史事件及焦点反馈保持。根 check、前端 build、全量 format:all:check 与 git diff --check 通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器路径栏垂直对齐2026-10-26本地静态)。

### 跨服务器安装准备与 SCP 性能（2026-10-26）

根因：amd 缺 rsync，RemoteFileModel 将 auto 强制映射为 rsync，阻断 Native adapter 原有 SCP 候选，退至 SFTP 中转。现在原样传递 auto，复制与发送复用已有远端依赖确认；用户跳过 rsync 安装后，普通文件再检查 SCP，跳过 SCP 后才中转。自动目录在 rsync 不可用时保留 SFTP 链接语义；不为此扫描目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器安装准备与-scp-性能2026-10-26)。

### 远端工具默认选择、归档依赖与安装全流程（2026-10-26，本地静态）

逐项核对跨服务器粘贴、发送、ZIP/tar.gz/tar.bz2压缩与解压、普通SFTP文件操作、目录下载、服务器状态、Docker和Agent执行。修正ToolService的auto检查提前选择现有SCP、跳过默认rsync安装提示的问题，客户端严格验证预期工具；前后端共用archiveToolRequirements，归档一次只读预检包含压缩器及校验/快照/链接工具，早于写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具默认选择归档依赖与安装全流程2026-10-26本地静态)。

### 图片生成 HTTP 400 内容审核拒绝（2026-10-26）

用户指定 ssh.honus.top 的图片失败已通过宿主只读日志及 SQLite 关联：部署镜像 revision 为 a797ecd2bf7967541e5ee52acfa031fd683d5845，Run `25e2515b-f3bb-4e29-8ac7-c08af21c2cda` 的 image_generate 使用 gpt-image-2.5，约 43 秒后失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#图片生成-http-400-内容审核拒绝2026-10-26)。

### 矮服务器状态面板网络读数间距（2026-10-27）

已读取用户 doc 截图：服务器状态处于矮面板单行模式，网络上下行读数均出现省略号。用户授权缩小左右留白与字体；改动仅在原 `max-height:210px` 容器分支，收紧非趋势内容边距、卡片内距、图标/标签/上下行间隔，并将速率字号结合实际容器宽度计算。正常高度布局、趋势内容留白、速率格式、配色和完整 title/aria-label 保留。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮服务器状态面板网络读数间距2026-10-27)。

### 远端工具准备、SCP 进度与图片拒绝诊断正式验收（2026-10-27）

产品/测试提交 `0f174219ca0cdac181035d57a33b42b8ec339732` 的正式 [E2E 40382042043](https://github.com/0honus0/nexus-terminal/actions/runs/40382042043) 全部成功：质量、格式、双端构建、Docker 部署 smoke 与全部 8 分片，共 526 项首次通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具准备scp-进度与图片拒绝诊断正式验收2026-10-27)。

### Agent 会话列表删除按钮居中（2026-10-27，本地静态）

NativeThreadPanel 列表行为 items-stretch，全局 UiButton 固定高度配 my-1 使右侧按钮靠上；按钮改用 self-center 并移除垂直外边距，按整行居中。全局按钮尺寸/危险色、禁用态、再次点击确认及选择/搜索事件保持，USAGE 对应章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-会话列表删除按钮居中2026-10-27本地静态)。

### Agent 工具卡片调用详情（2026-10-27）

本批新增单调用认证 GET，卡片展开后展示完整格式化参数 JSON 与持久失败码对应说明；加载失败仅重读详情，取消/未知不宣称远端回滚。源码两轮核对范围为 user/App/Run/tool 身份、Shared 严格解码、逐字段投影、原列表容量、失败码白名单、页面失活/卸载取消及 revision 晚响应保护；没有 schema 改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具卡片调用详情2026-10-27)。

### Agent PHP/Typecho 规划任务与资源错误分类（2026-10-26）

本轮按用户明确要求，只读核对 ssh.honus.top 所在线上指定线程 `4b7dd2b9-bdfc-4064-8c16-e1cd21471938`、Run `8cd50043-c9dc-40f4-ad0a-9dc3abdc3f0c`。原提示要求“先定好计划”：Run completed，12 个模型步骤、15 次只读工具调用，无部署/启停/写入工具；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-phptypecho-规划任务与资源错误分类2026-10-26)。

### 服务器状态卡片左右留白（2026-10-26）

用户授权收紧卡片左右外侧空隙，原 StatusMonitor.css 同步修改指标与加载列表水平 padding，去掉窄栏内容覆盖并同步矮栏骨架。两轮源码核对普通/150px/118px 窄栏、210px/270px 矮栏、趋势与手机覆盖次序；卡片内部间距、纵向尺寸、触控区域和数据逻辑保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态卡片左右留白2026-10-26)。

### 文件管理器 `..` 返回行紧凑高度（2026-10-26）

用户授权缩小父目录返回行：只为父行单元格设置更小垂直 padding，移除父行名称原有底部留白；其他文件行、缩放、点击/键盘、20ms 预加载、右键和拖入不变。两轮源码核对全部可见列单元格与 CSS 优先级，父行仍独立于虚拟条目和 spacer，不修改虚拟文件行尺寸。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器--返回行紧凑高度2026-10-26)。

### 工具详情及界面细节本批正式回归（2026-10-27，待远程）

本轮补充既有图片成功/三类拒绝用例，验证持久工具详情、错误 Run 返回 404、展开卡片后的格式化参数与安全失败码，不改变图片预览、下载、内容审核及不重试断言。其余源码静态证据见上述各节。用户授权整批提交推送，完整正式 E2E 成功后发布 dev linux/amd64；不更新生产容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工具详情及界面细节本批正式回归2026-10-27待远程)。

### 手动清理 workflow（2026-10-27，静态待验）

新增 cleanup-history.yml 与维护脚本；仅手动触发，无 schedule/push/release。源码审核两轮核对包/仓库范围、latest/dev 多层 manifest 与证明闭包、渠道移动围栏、历史运行/产物保留、缓存删除、活跃运行与权限失败路径。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-workflow2026-10-27静态待验)。

### Actions 恢复及复制取消竞态（2026-10-27）

手动触发已恢复：40436334225 验证 7810d6ad，检查/格式/构建、Docker smoke 和 6 个分片成功；第 4 分片用例 registered copy progress 首次失败、重试通过，flaky 门禁正确拒绝，不能称全绿。截图与调用日志显示 Cancel 后任务直接消失且没有 unknown Toast。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#actions-恢复及复制取消竞态2026-10-27)。

### 本批正式 E2E 与 dev amd64 交付（2026-10-27，完成）

GitHub Actions 限制已恢复。测试修复提交 `441dcc740660d337b6e7480bbb1f891a90a3079d` 的正式 [E2E 40437638548](https://github.com/0honus0/nexus-terminal/actions/runs/40437638548) 全绿：检查/格式/…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批正式-e2e-与-dev-amd64-交付2026-10-27完成)。

## E2E 依赖拆分与构建复用（2026-10-27）

参考 [Grafana 构建分发](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[项目分组]…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-依赖拆分与构建复用2026-10-27)。

## 最耗时任务优化（2026-10-27，正式全量通过）

上一阶段正式 [40444825177](https://github.com/0honus0/nexus-terminal/actions/runs/40444825177) 在 899d4107 上 526 项首次通过、0 skipped/retry/flaky，完整墙钟 532 秒；原基线 40437638548 为 620 秒。新基线尚不满足用户提速目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最耗时任务优化2026-10-27正式全量通过)。

## E2E 功能目录与剩余前端计时等待（2026-10-27，已验收）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-功能目录与剩余前端计时等待2026-10-27已验收)。

## E2E 复制取消与插件分片（2026-10-27，已验收）

优先处理最新实测39秒复制取消和约119秒Agent插件大文件。复制场景改用测试SSH的真实WRITE gate，取消前确认已有写入进入，前端Clock跨32秒原清理边界后确认原WRITE仍阻塞；明确释放后等待真实pending归零及对应任务WS终态，再保留第二文件不存在断言。gate不会因channel close清掉观测，reset先释放再停止旧SSH并等待真实I/O归零。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-复制取消与插件分片2026-10-27已验收)。

## E2E 构建与容器准备重叠（2026-10-27，已验收）

实测40457002804：准备作业60秒；最慢分片后置的容器初始化28.3秒、依赖链接6.6秒、产物下载4.3秒。原依赖将共享构建与全部容器准备串行。本轮将同一次完整构建移入既有quality作业、先上传产物再执行原根检查和全量格式；镜像准备作业提前结束，让8个测试runner同时准备。作业数量与测试并发不变，不改UI/产品/测试断言/隔离生命周期。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-构建与容器准备重叠2026-10-27已验收)。

## E2E 成功传输进度限速（2026-10-27，已验收）

40459146818的protocol成功原生路线单例约13秒、clipboard-ui五条路线每例约15秒；其中真实8MiB样本的1MiB/s夹具传输本身占数秒。本轮只将成功进度场景的rsync/SCP及UI relay现有限速提高至原生3MiB/s、relay 4MiB/s；原生命令约一秒输出一次，保留多次中间采样窗口，保留SSH读延迟和专门2Mbps/10Mbps等弱网profile；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-成功传输进度限速2026-10-27已验收)。

## 手动清理活跃运行修复验收（2026-10-27）

原40483067327因任意其它未完成Actions全局拒绝而失败。脚本现在保留活跃运行/产物，删除前复查重启；有其它活跃任务时跳过镜像和缓存清理，真实权限与manifest异常仍失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理活跃运行修复验收2026-10-27)。

## 快速输入回跳与连续退格（2026-10-27，源码及静态完成）

本地dev的TerminalTypeAhead修正：未完成CSI保留至下包、仅光标显隐/报告的包不触发退格空匹配失败；右边界仅限制前向打印，触边不立即撤回旧预测而由HardBoundary等待真实回显；连续DEL按解析顺序逐字预测，原输入仍只派发一次。原双解析屏障、reset/失活/resize/快照撤销与复杂模式保守策略保持，无UI或协议变更。源码两轮复核完成，未用关闭预测或放宽期限规避。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#快速输入回跳与连续退格2026-10-27源码及静态完成)。

## ZIP 压缩中间进度（2026-10-27，静态完成、行为待验）

根因：取消源目录预扫描后，压缩期间只有 fileCount，没有总数或 percent，原前端按 0% 展示。Native zip 改为 -dc，采集它已有扫描的已处理/剩余条目，Model 逐参数转交，FileService 沿原 transfer.archive 发出 totalFiles/percent；发布验证前不足 100%，成功后才 100%。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip-压缩中间进度2026-10-27静态完成行为待验)。

### 传输进度提示统一 Toast（2026-10-27）

浮动进度、隐藏任务及服务器传输详情移除行内警告/错误说明；本地原任务回执补完成警告通知，后台 store 按快照状态/错误变化通知，列表加载和取消/移除失败使用 Toast。两轮源码复核覆盖上传、移动、剪贴板、归档密码重输、后台读取/写入、身份代次及网络错误去重，保留原进度、状态、操作和 CSS。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#传输进度提示统一-toast2026-10-27)。

### 状态趋势真实采样与紧凑刻度（2026-10-27）

用户明确授权启动测试环境并通过 CDP 专项验收，本轮复用已在运行的 3001/9998 环境和 172.30.30.11:9223 中登录 api.honus.top 的浏览器。真实 amd SSH 五类指标 × 1/5/10/30 分钟共 20 组验证窗口跨度、样本在窗内及网络整档刻度；短历史不被压成不可见单点，时间左侧不足部分仍为空。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#状态趋势真实采样与紧凑刻度2026-10-27)。

### 2026-10-27：传输安装偏好、实际工具、TAR 进度与原生文件拖动

新增/扩展远程用例：cross-server-transfer/clipboard-ui 的 SCP/SFTP 跳过安装分支，再次复制不重复弹窗，仍验证协议实际方法、内容摘要；SCP 分支继续模拟后来手动安装，第三次自动重新识别 rsync。保留原字节进度、单调性、直传/中转计数及内容断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27传输安装偏好实际工具tar-进度与原生文件拖动)。

### 2026-10-27：趋势静默断采样与安卓前台恢复

前轮趋势修复只处理序号不连续，漏掉“序号连续但时间相隔约 22 分钟”的情况。现在按完整保留历史的实际正向连续间隔下中位数识别明显时间断点（大于两倍），再按所选窗口过滤；不删除旧点、不补造历史、不改变采样频率。既有时间轴 spec 增加真实 SSH/WS 入口注入五个受控采样时间的场景：各范围首个真实时间正确，30 分钟画布保留上下行颜色，但中间无采样区没有两种颜色的连线。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27趋势静默断采样与安卓前台恢复)。

### 2026-10-27：发布前本地正式入口整链专项

用户本轮授权启动测试环境并验证本批修改，随后提交 main、完整远程 E2E 通过后发布 amd64 dev，最后停测试环境。本地使用独立 `/tmp/nexus-release-data-*` 数据目录、3001 正式后端、原9998 Vite 和专用22222 SSH夹具，不覆盖旧实例/生产数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27发布前本地正式入口整链专项)。

### 归档标题移除与隐藏入口百分比（2026-10-28）

归档ProgressCenter终态“移除”移动至任务标题右侧，保留done条件与原remove(task.id)，活动取消/未知副作用处理不变；标题flex-1/min-w-0截断、按钮shrink-0，无局部新样式。WorkspaceSessionSurface对现有progressTasks的已报告进度钳位后等权平均，空列表为0且入口原条件不显示，单任务跟随其百分比；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#归档标题移除与隐藏入口百分比2026-10-28)。

### 项目依赖维护（2026-10-28）

递归outdated初始30项，更新29项直接依赖、catalog、pnpm锁文件及pnpm11.28.9。包括Vue/编译器3.5.44、Vite8.3.5、Monaco0.57.0、Pino10.4.0、Undici8.12.3、MCP2.4.0、OpenAI7.45.0、Playwright1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#项目依赖维护2026-10-28)。

## 直传安全提示记忆与网络读数对齐（2026-10-28）

范围：跨服务器粘贴、“发送到服务器”的凭据确认共用“下次不再提醒”；网络速率等宽半栏内居中。两轮源码审核：第一轮追踪两个入口到公共确认 composable、Feedback store/host 与 browser storage，核对取消、替换弹窗、signal、用户切换及原 generation 保护；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#直传安全提示记忆与网络读数对齐2026-10-28)。

### 本轮授权 CDP 专项验收

用户追加“使用cdp确认下效果”，作为本轮 D17 限定例外。CDP 为 `172.30.30.11:9223`，实际访问 `https://api.honus.top`；原测试服务已停止且页面 502，本轮复用隔离 `/tmp/nexus-release-data-YdlpzU`，启动本地后端3001、Vite9998和真实SSH夹具22222/22225。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮授权-cdp-专项验收)。

## 任务操作全部移至标题行（2026-10-28）

本轮按用户补充授权将归档活动状态的“取消／取消中”与终态“移除”统一放到各任务标题最右侧；复制/移动/混合模式底部“取消”也移至对应标题右侧，删除旧底部操作容器。上传和批量取消原已在同排/窗头，保留原入口。第一轮源码审核逐一核对按钮条件、emit类型/ID、取消中文字及禁用；第二轮核对互斥分支、标题min-w-0/flex-1/truncate、按钮shrink-0、所有任务模式与底部容器无残余。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务操作全部移至标题行2026-10-28)。

### 任务标题操作正式远程回归通过

用户授权提交推送并等待E2E。main产品提交 `a726e6c3cc0df8cc5e3e05615e0490f1b15a4587`，正式 [40662321872](https://github.com/0honus0/nexus-terminal/actions/runs/40662321872) success：质量/格式、Dock…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务标题操作正式远程回归通过)。

## nethogs 全接口停顿与退出输入专项（2026-10-30）

用户授权启动测试环境、经 CDP 访问 api.honus.top，并明确测试 SSH。干净 main `09e6c79871bf4e831aa9fbc83a1f931f0fba474b`；本机 Node v22.23.1、pnpm 11.28.9、Playwright 1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nethogs-全接口停顿与退出输入专项2026-10-30)。

### 手动重置终端专项（2026-10-30）

用户最后选择只新增手动恢复，不实施通用检测。源码沿SSH标签右键/长按菜单、全局确认、RuntimeSession/Registry和原workspace.close链；三语同步。确认前不关闭，原实例收到明确closed才清理scope并按原标签顺序建立新Shell；后台标签重置保留当前选择。detached/unknown拒绝新建并保留原标签/未知提示，挂起标记禁用入口；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动重置终端专项2026-10-30)。

### SSH 测试主机密钥确认专项（2026-10-30）

终端恢复已按用户要求提交038855a1；本批修复连接测试丢失实际Host Key挑战的问题。沿用独立测试数据库、3001 Backend、9998 Vite及api.honus.top，CDP为172.30.30.11:9223，真实SSH目标为honus.top:9902。Backend按本批源码重新构建后启动；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#ssh-测试主机密钥确认专项2026-10-30)。

### 后台挂起恢复与密码单次保存专项（2026-10-30）

用户授权继续修改并通过CDP验证；沿用 `/tmp/nexus-nethogs-20261030/` 的独立数据库、Backend3001、Vite9998，CDP `172.30.30.11:9223` 访问 `https://api.honus.top`，实际SSH为honus.top:9902。仅操作自建context、临时连接及原PTY变量，无生产配置、容器或系统文件写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后台挂起恢复与密码单次保存专项2026-10-30)。

### 普通文本原生查找恢复专项（2026-10-30）

用户明确仅恢复基本文本查找，不回退图片及其它文件预览。沿用 `/tmp/nexus-nethogs-20261030/`、Backend3001/Vite9998，CDP `172.30.30.11:9223` 实际访问 `https://api.honus.top`，自建桌面1440×1000和393×852触屏context连接honus.top:9902；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#普通文本原生查找恢复专项2026-10-30)。

## 复制任务总进度标注专项（2026-10-30）

沿用户指定 `https://api.honus.top` 与 CDP `172.30.30.11:9223`，在自建桌面1440×1000与393×852触屏context加载当前Vite实际ProgressCenter组件，以受控TransferTask模拟三文件累计进度。使用真实Vue/i18n模块和原全局样式，不修改保存配置或远端文件；本轮只验呈现，不称为真实跨服务器传输验收。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#复制任务总进度标注专项2026-10-30)。

## 终端目录等待清行提示与全部本地变更提交（2026-10-30）

用户最终撤销草稿保留方案，要求仅提示清行并提交全部本地改动。Native Shell/Model/Service/Port 的本轮草稿试验已完整撤回至原实现；最终仅 FileManager 消费现有 onQueued.waitingForPrompt，在当前有效视图中显示一次原 feedback 信息提示。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端目录等待清行提示与全部本地变更提交2026-10-30)。

## E2E 连接选项加载失败提示（2026-10-30）

main/96ea73b2 的远程 [41049355889](https://github.com/0honus0/nexus-terminal/actions/runs/41049355889) 只有 browser shard 7 一项失败（同组57通过），其余7个测试分片、质量与Docker smoke通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-连接选项加载失败提示2026-10-30)。

### 2026-11-02：弱网输入回退与删除停顿专项

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-11-02弱网输入回退与删除停顿专项)。

## 安卓普通文本查找呈现专项（2026-11-02）

指定站点api.honus.top的独立CDP context挂载真实FileEditor与内存文档，Android14 UA/touch模拟。修复前英文渐变默认面板证据mobile-search-before._，修复后mobile-search-after._，脚本mobile-search.cjs，均位于 `/tmp/nexus-nethogs-20261030/`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#安卓普通文本查找呈现专项2026-11-02)。

## 命令历史恢复与 SSH 半关闭专项（2026-11-02）

指定站点CDP使用独立context、真实store/API/Shared和完全拦截的历史接口，不向生产写入。`/tmp/nexus-nethogs-20261030/history-recovery.cjs` 与同名log验证：首次POST已在夹具保存但丢回执；下一次新意图GET→POST→GET、旧POST仅一次；恢复GET失败不发送新POST；普通load成功恢复；读取中撤权不派发；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#命令历史恢复与-ssh-半关闭专项2026-11-02)。

## Agent Shell 等待/执行分离与旧围栏拒绝专项（2026-11-02）

生产仅使用指定SSH和Node只读SQLite查询（readOnly/query_only），没有更新记录、重放原命令、重启或部署。指定临时目录内agent-db-{inventory,details,chain}.jsonl确认同一线程2026-10-29三个Run，目标为fxm/connection 7：首轮完成；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-shell-等待执行分离与旧围栏拒绝专项2026-11-02)。

## Agent 工具故障后总任务结束等待（2026-11-02）

本轮在原专用目录 `/tmp/nexus-nethogs-20261030/` 保留全部夹具、日志和缓存。使用 Node 22.23.1、pnpm 11.28.9；TMPDIR 和 NODE_COMPILE_CACHE 均指向该目录。只运行以下定向回归，不执行本地全量 E2E：

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具故障后总任务结束等待2026-11-02)。

## 手机终端自适应底部越界（2026-11-02）

沿用 main beff7a99 的现有未提交工作区、Node 22.23.1/pnpm 11.28.9、原 Vite9998 及专用 `/tmp/nexus-nethogs-20261030/`；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端自适应底部越界2026-11-02)。

## 服务器状态趋势时间轴与加载呈现（2026-11-02）

同一 main beff7a99 未提交工作区、原 Node22/pnpm11 工具、Vite9998 和 `/tmp/nexus-nethogs-20261030/`。指定站点/CDP 的独立 context 挂载真实 StatusMonitor/StatusCharts，提供只读内存样本与控制器，拦截真实 StatusCharts.vue 模块请求以保持加载，释放后加载原模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态趋势时间轴与加载呈现2026-11-02)。

## 依赖升级与 main dev 发布（2026-11-02，完成）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级与-main-dev-发布2026-11-02完成)。

## 手动清理 Actions API 瞬时失败（2026-11-02，完成）

用户要求解决另一条Actions失败。实际为手动清理[41461823321](https://github.com/0honus0/nexus-terminal/actions/runs/41461823321)，job125332537068已解析latest/dev并计划删除旧资源，DELETE artifact13145138530返回GitHub HTTP500；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-actions-api-瞬时失败2026-11-02完成)。

## 文件拖动悬停导航与右键取消（2026-11-02）

FileManager 的内部原生拖动在目录行和 `..` 行停留2秒进入，导航保留本次原始条目，当前目录空白松手沿原moveTo链派发。右键取消清空拖动源、选择、悬停等待和目标；不更改当前浏览目录，也不派发移动。文档级捕获右键drag/dragover/drop覆盖源节点因导航移除、容器外及快速松手，失活/断线/换通道/卸载清理计时与监听。保留原快速drop、移动过滤、外部上传和UI。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动悬停导航与右键取消2026-11-02)。

## 手机编辑器底栏两行布局（2026-11-02）

用户报告路径及amd服务器名遮挡、换行符太窄，随后要求最多两行且保持紧凑。基线通过指定CDP在390px手机、16px边距的真实FileEditor受控挂载复现：原路径可见宽度仅3.33px；320px时路径0px，scope超出identity范围；换行符被原窄屏规则压至49.59px。原footer强制nowrap，identity与元信息/按钮竞争且overflow裁剪；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机编辑器底栏两行布局2026-11-02)。

## 重置/删除共用确认弹窗布局（2026-11-02）

用户要求优化重置终端、删除等确认弹窗并提供截图。基线为原UiConfirmationPanel：图标占正文左列，默认slot即使仅Vue条件注释也留18px（手机20px）内容padding；同一手机content样式存在重复覆盖。改为标题/图标同行、整行正文，描述字号13px/行高1.75，空content用:empty隐藏；确认按钮区有细分隔和浅底，手机等宽且44px高。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#重置删除共用确认弹窗布局2026-11-02)。

## 手机终端点击键盘跳动与全局确认消费者（2026-11-02）

本轮main/78997c1a及既有未提交拖动/编辑器/确认布局变更之上，用户确认终端普通输入和htop点击均导致软键盘反复跳动，并要求排查后统一全部同类确认弹窗。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端点击键盘跳动与全局确认消费者2026-11-02)。

## 本批 UI 修复远程 E2E 与发布（2026-11-02，完成）

用户授权推送、修复E2E并发布，08b6b2b58a6d8aa5f121816bd112fb05b800673d已推送main。首轮41484802901质量、Docker及7个测试分片成功，browser 6出现两项首次/重试相同失败：新增拖动多选初始化点击hover-source后，触屏桌面正常单击导航到/hover-source，随后寻找原目录hover-one.txt超时；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批-ui-修复远程-e2e-与发布2026-11-02完成)。

## 文件拖动父目录反馈与600ms悬停（2026-11-03）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动父目录反馈与600ms悬停2026-11-03)。

## 连接表单底部错误 Toast（2026-11-03）

用户明确只迁移底部操作错误区域，测试结果与延迟说明保持。沿原useConnectionForm→useFeedback通知owner：修改连接参数且密码为空使用warning Toast，选项加载/提交校验错误使用error Toast，删除submitError及ConnectionForm内唯一UiInlineNotice；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接表单底部错误-toast2026-11-03)。

## 网络趋势上下行标题对齐（2026-11-03）

用户要求当前网络上下行速率与CPU当前值一样放在趋势标题右侧。根因是原network-legend为history-header的第三个单列网格项，在range-tabs之后。将原图例移入history-heading、放到关闭按钮前；原flex图例增加收缩/最小宽度/右对齐与自动左边距，窄栏可在标题右侧区域将两个速率换成两行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势上下行标题对齐2026-11-03)。

## 网络趋势最窄宽度同排与完整标题（2026-11-03）

用户追加要求最窄栏位与手机同样左右同排、左侧网络趋势完整。上版同日after.json的180px记录标题溢出9px、两个速率上边界相差约18px，符合原允许省略/换行设计，本轮依最新要求调整。仅原StatusMonitor增加网络标题行class；该标题不收缩/省略，网络图例改flex:1且不换行，图例自身为inline-size容器，子项字号取原11px/scale与自身6.5cqw的较小值。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势最窄宽度同排与完整标题2026-11-03)。

### 导航切换布局阻塞（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#导航切换布局阻塞2026-11-04)。

### 终端标签菜单顺序（2026-11-04）

WorkspaceTabBar仅将原挂起菜单项移到重置之前，原条件、事件、分隔线和关闭项保持。USAGE的SSH会话章节同步顺序；无类型、协议、资源或架构边界变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端标签菜单顺序2026-11-04)。

### Agent App 卸载目录、数据清除与读取性能（2026-11-04）

复用上一轮隔离Backend3001与Vite9998，CDP http://172.30.30.11:9223 访问 https://api.honus.top，真实签名Full-stack包来自专用本地fixture仓库29092；没有更换生产服务或读写生产库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-卸载目录数据清除与读取性能2026-11-04)。

### MCP / ACP 工具栏换行与手机同排（2026-11-04）

只修改AppIntegrationSettings的应用选择框尺寸及AppIntegrationEditor的操作组排布/窄屏短文案，未修改基础UiSelect或业务状态/请求。原w-40被基础未分层ui-select的width:100%覆盖，选择框占满一行，将刷新/创建挤到下一行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#mcp--acp-工具栏换行与手机同排2026-11-04)。

### 移除内置 Agent 与官方插件启用引导（2026-11-04）

按用户最新要求采用没有内置应用的当前设计，不实现旧ID映射、旧数据退役或迁移；删除默认初始化、手工创建App链、默认声明/实例字段与快照内置旁路。初始v1签名为backend-next-v1-initial-20261104-plugin-apps。旧测试库和全部既有目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#移除内置-agent-与官方插件启用引导2026-11-04)。

### 后端架构偏移与容量同步审计（2026-11-04）

本轮用户授权继续架构审核，合理问题直接修正，并统一双端限制/去除不必要固定限制；保留此前全部未提交变更。仅执行源码、AST/类型静态审核与构建，按PLAN D17未新增或运行行为测试、CDP、本地/远程E2E；前序插件/市场/工具栏专项PASS不算本轮行为验证。不重启服务、不操作生产库、不提交推送。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后端架构偏移与容量同步审计2026-11-04)。

### Agent App 操作组垂直居中（2026-11-04）

用户报告App列表右侧安全策略配置、禁用和卸载操作组未垂直居中。源码确认AppManagementSettings父行从sm断点使用flex-row/items-center，子操作组的self-end覆盖父行对齐，令整组贴概要底部；本批仅删除该self-end。组件的嵌入与独立入口共用此行；639px及以下原全宽三列grid规则保持，UiButton、图标、启停/卸载确认及清除数据流程不变。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-操作组垂直居中2026-11-04)。

### Nexus Agent 插件与工具设计审核（2026-11-04）

本批按PLAN D17仅源码、架构和静态检查，未运行行为测试、CDP、本地/远程E2E或付费模型请求。产物集中 `/tmp/nexus-agent-tools-audit-20261104`；正式插件从独立仓库基线bda89fc修改，现有全部工作区变更、测试服务和产物保留，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nexus-agent-插件与工具设计审核2026-11-04)。

## 本地文档刷新（2026-11-04）

本批仅整理7份文档：移除 Frontend 与本页误复制的后端架构正文，恢复正确标题与职责；Frontend 重建八节总览并保留前端专项；PLAN 原样保留决定项，退出已完成规划并承接未验清单；纠正旧前端迁移状态、工具审计/认证单调用详情混写、Run 并发与冻结期限、资源目录及部署下载分支。当前源码、规则文档、测试服务和现存数据库未修改，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本地文档刷新2026-11-04)。

## 网络切换自动恢复（2026-11-04，源码与静态）

本批产物集中 `/tmp/nexus-network-recovery-20261104`，保留全部前序变更、测试服务与数据，不重启、不提交推送。按 PLAN D17 未新增/运行行为测试、CDP 或 E2E。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络切换自动恢复2026-11-04源码与静态)。

## main dev 交付与数据库维护（2026-11-04，已完成）

用户授权提交推送、修复正式远程 E2E、发布 main dev amd64，并更新指定 Nexus 实例及手动维护数据库；另确认删除新版已移除、不再需要的数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#main-dev-交付与数据库维护2026-11-04已完成)。

### 第二轮完整通过与发布

修复提交 `fd41a0fe` 的正式远程 [41778130423](https://github.com/0honus0/nexus-terminal/actions/runs/41778130423) 全部success。549场景首次通过，无失败、重试、flaky或跳过：Backend125；Browser1–7分别41/61/53/57/58/94/60（含隔离场景）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮完整通过与发布)。

### 指定主机更新与维护结果

发布 [41778950373](https://github.com/0honus0/nexus-terminal/actions/runs/41778950373) success，包含生产依赖审计与镜像构建/推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#指定主机更新与维护结果)。
