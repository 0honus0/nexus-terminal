# Nexus Terminal 软件需求规格说明书（SRS）

版本：v1.10

状态：Current product baseline + Agent live runtime baseline

## 1. 文档目的

本 SRS 基于当前仓库 Git 历史、规范化 FR/GREQ 追溯、工程约束与当前代码 owner 分析整理，以重构 PR #9 的最终文件/行为差异为基线，并持续纳入之后经回归验证确认的软件需求。v1.5～v1.7 收紧 Workspace/File Manager/Preview/Remote Desktop 等 UI 与交互回归约束；v1.8 在 Owner 明确放行后把冻结的 Agent 设计同步为正式分期研发需求；v1.9 根据源码复核更新 Agent 实现基线；v1.10 进一步以当前 `dev` 为事实源，把全局悬浮 Agent Host、运行中输入打断、Workspace Runtime/Host Runner、ACP/Browser/Workspace Terminal live execution、插件 AgentDefinition、Runner cleanup/journal 安全语义写回正式需求，并把 Agent 架构文档收口为 `doc/AGENT.md`。规范性需求按“模块 → 功能 → 详细需求 → 特殊设计 / 适用工程约束”组织；历史证据通过 FR/GREQ 与 Git 索引追溯，不在主需求表重复堆叠。

## 2. 需求解释规则

- `SRS-*`：当前软件需求编号，是研发/评审/验收的主入口。
- `FR-*`：从最终旧产品基线与功能盘点整理的行为需求。
- `GREQ-*`：从 Git 历史、缺陷修复、最终旧实现与重构 owner 边界派生的细粒度需求。
- Git commit：最底层历史证据，可从 GREQ 或 Git 索引直接打开。
- 当 FR/GREQ 描述旧实现机制而当前 clean design 已提供等价行为时，以当前 SRS + GREQ 中的“Required behavior / Refactored design”作为规范性解释。

## 3. 模块目录

| 模块                                                               | SRS/FR 条目 | GREQ 条目 |
| ------------------------------------------------------------------ | ----------: | --------: |
| [身份认证与安全](requirements/identity-security.md)                |           9 |         8 |
| [Dashboard / 系统概览](requirements/dashboard.md)                  |           5 |         5 |
| [连接管理](requirements/connections.md)                            |          11 |        10 |
| [标签管理](requirements/tags.md)                                   |           1 |         1 |
| [代理管理](requirements/proxies.md)                                |           1 |         1 |
| [SSH 密钥管理](requirements/ssh-keys.md)                           |           1 |         2 |
| [快捷命令、命令输入与历史](requirements/quick-commands-history.md) |           8 |         7 |
| [通知管理](requirements/notifications.md)                          |           3 |         2 |
| [审计与全局反馈](requirements/audit-feedback.md)                   |           2 |         2 |
| [偏好与系统设置](requirements/preferences-settings.md)             |           4 |         4 |
| [外观、PWA 与版本信息](requirements/appearance-pwa-about.md)       |           7 |         5 |
| [备份与恢复](requirements/backup.md)                               |           1 |         2 |
| [Workspace 运行时](requirements/workspace.md)                      |           7 |         9 |
| [终端](requirements/terminal.md)                                   |           9 |         6 |
| [远程文件系统 / File Manager](requirements/filesystem.md)          |           9 |        13 |
| [传输、上传与归档](requirements/transfers.md)                      |          11 |         6 |
| [文件编辑器](requirements/file-editor.md)                          |           9 |         4 |
| [文件预览](requirements/file-preview.md)                           |           9 |         5 |
| [状态监控](requirements/status-monitor.md)                         |           1 |         4 |
| [Docker 管理](requirements/docker.md)                              |           2 |         4 |
| [RDP / VNC 远程桌面](requirements/remote-desktop.md)               |           8 |         4 |
| [移动端交互](requirements/mobile.md)                               |           4 |         0 |
| [架构与跨模块需求](requirements/architecture.md)                   |           5 |         0 |
| [Agent Platform](requirements/agent.md)                            |          15 |         0 |

## 4. 系统级特殊设计与非功能需求

见 [特殊设计与系统级要求](design/special-designs.md)。强制工程约束以 [Engineering Constraints](engineering-constraints.md) 为唯一规范源，本 SRS 仅通过 `EC-*` 引用适用规则。

## 5. 可追溯性

- [FR 追溯表](traceability/functional-requirements.md)
- [GREQ 追溯表](traceability/git-requirements.md)
- [Git 历史证据索引](traceability/git-history.md)
- [Frontend Architecture](../architecture/FRONTEND.md)
- [Backend Architecture](../architecture/BACKEND.md)
- [Engineering Constraints](engineering-constraints.md)

## 6. 当前范围说明

本需求基线覆盖当前 Nexus Terminal 用户可达能力与已经确认的 clean architecture 行为。Agent 正式需求见 [Agent Platform](requirements/agent.md)，唯一架构规范为 [`doc/AGENT.md`](../AGENT.md)。当前 Agent 已进入 live product baseline：全局 floating Host、Thread/Run/Ledger、typed Plan、运行中 append-input interruption、Artifact、Policy/Approval/Lease、Workspace Runtime/Host Runner、MCP、ACP、Browser tunnel、Workspace local Terminal、Subagent 与 installable Agent plugin 均已有 production wiring；具体“已实现/待实现”只按 Agent SRS 状态解释。当前用户可编辑 durable Goal、Conversation slash-command 与基于 Ledger/watermark 的 `/queue` inspection 已交付；仍未交付的是 pending-input remove/reorder mutation（如后续确有产品需求），以及真正冻结在 RunDefinition 中的 Next Run Environment selector。既有非 Agent 功能仍以当前已实现基线为准。

## 7. v1.5–v1.7 UI / 交互回归需求索引

本次 UI 修复没有新增平行需求编号，而是收紧现有模块需求的验收条件：

- [SRS-DASH-001](requirements/dashboard.md#srs-dash-001) / [SRS-DASH-002](requirements/dashboard.md#srs-dash-002) / [SRS-DASH-004](requirements/dashboard.md#srs-dash-004)：常见桌面首屏内保持 Recent Activity 可达，长列表在各自面板内部滚动；存在 active suspend 会话时 Dashboard 显示统一 suspended-session 入口/数量并跳转到 Workspace 管理面；tag/sort 控件保持稳定主题 chevron/窄宽文字对齐；SSH 资源卡显示 root disk 百分比以及 used/total 容量。
- [SRS-QC-003](requirements/quick-commands-history.md#srs-qc-003) / [SRS-QC-005](requirements/quick-commands-history.md#srs-qc-005)：分组名称文字负责编辑，标题空白/箭头负责展开收起；工具栏随 pane 宽度缩放，折叠搜索时按钮组在任意支持的 pane 宽度都保持水平居中。
- [SRS-FS-001](requirements/filesystem.md#srs-fs-001) / [SRS-FS-002](requirements/filesystem.md#srs-fs-002) / [SRS-FS-005](requirements/filesystem.md#srs-fs-005) / [SRS-FS-006](requirements/filesystem.md#srs-fs-006) / [SRS-FS-008](requirements/filesystem.md#srs-fs-008)：非 root 路径通过列表 `..` 行返回上级，不保留重复 toolbar 上级按钮；搜索框有内容时右侧提供一键清空 ×；路径历史的 Copy/Delete 放到行 context menu，避免占用路径宽度；文件剪贴板有内容时任意普通文件/目录菜单都可 Paste 到当前浏览目录；Ctrl+wheel 使用方向感知阈值累计且 latest-value-wins；移动 compact 行把 icon 合并到 filename cell，长文件名 ellipsis，并给 Modified 时间保留固定右侧槽，不能再被普通文件名挤出屏幕。
- [SRS-PREV-001](requirements/file-preview.md#srs-prev-001) / [SRS-PREV-006](requirements/file-preview.md#srs-prev-006) / [SRS-PREV-008](requirements/file-preview.md#srs-prev-008)：Markdown preview 内指向同一远程文件系统其他 `.md/.markdown` 文档的相对/绝对链接直接在现有 Preview workspace 打开，外链/锚点不误拦截；统一搜索控件保持圆角主题；Spreadsheet 仅在存在多页时显示分页栏。
- [SRS-WS-005](requirements/workspace.md#srs-ws-005)：挂起会话恢复只在初始事务中回放有界的最新日志尾部并保持终端位于底部，用户向上到边界才分页加载更早日志；历史尾部必须先排空再接管 live PTY；marked Workspace 关闭后的 handoff 使用短时有界静默刷新让目录及时出现；Dashboard/Workspace 共用 suspend catalog；恢复可见 stale tab 时原位替换，移动端不能短暂生成重复 tab；Suspended Sessions card 依实际容器分档响应：中窄先把文字按钮收成紧凑 icon 并保持在信息右侧，只有最窄/手机最小宽度才换到下方，换行后的 icon 组保持内容宽度而不横向铺满。
- [SRS-WS-006](requirements/workspace.md#srs-ws-006)：桌面 Workspace 恢复旧版四侧 frame；popup File Manager 保留可见右下 resize handle，桌面尺寸 browser-local 持久化并在重新打开/viewport 变化时 clamp，viewport 足够时 minimum 为 360×320，移动端不继承桌面 popup size/resize handle；内嵌窄 pane 的响应式 chrome 不能反写 layout 百分比或业务状态。
- [SRS-RD-001](requirements/remote-desktop.md#srs-rd-001) / [SRS-RD-004](requirements/remote-desktop.md#srs-rd-004)：RDP/VNC Connected 后必须实际显示非零远程画布并保持 Guacamole layer 可见；桌面右下 resize handle 必须按 pointer 直接跟手，居中 modal 的尺寸变化不得只走一半位移，并始终 clamp 在 viewport 内。
- [SRS-XFER-005](requirements/transfers.md#srs-xfer-005) / [SRS-XFER-006A](requirements/transfers.md#srs-xfer-006a)：server-transfer 目录轮询保持 silent background refresh，不能周期性触发前台 loading/spinner 或禁用 Send；send/cancel/remove mutation 必须使旧 in-flight poll 失效，并通过串行 fresh refresh 收敛到最新服务端状态，旧响应不能把新任务状态覆盖回去。
- [SRS-TERM-001](requirements/terminal.md#srs-term-001) / [SRS-TERM-004](requirements/terminal.md#srs-term-004)：命令栏 Clear Terminal 使用 xterm 本地 buffer clear 语义，不通过本地 `terminal.write` 注入清屏/归位 ANSI 序列；移动终端单指拖动遵循原生内容滚动方向——向下拖查看更早 scrollback，向上拖回到更新/live 输出，并与长按选择、pinch 缩放共存。
- [SRS-TERM-008](requirements/terminal.md#srs-term-008)：File Manager/Terminal 路径同步所需的 Bash/Zsh 探测、prompt hook 和自动 `cd` 属于 Nexus 内部控制流，不得残留到远端 Shell 的交互历史中；清理历史前必须用每次请求唯一 token 确认当前历史项确实属于 Nexus，避免用户的 `HISTCONTROL`/`HISTIGNORE` 已忽略该行时误删上一条用户命令。
