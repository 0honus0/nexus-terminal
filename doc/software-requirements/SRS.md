# Nexus Terminal 软件需求规格说明书（SRS）

版本：v1.0  
状态：Current refactor baseline

## 1. 文档目的

本 SRS 基于当前仓库 Git 历史、规范化 FR/GREQ 追溯、工程约束与当前代码 owner 分析整理。规范性需求按“模块 → 功能 → 详细需求 → 特殊设计 / 适用工程约束”组织；历史证据通过 FR/GREQ 与 Git 索引追溯，不在主需求表重复堆叠。

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
| [连接管理](requirements/connections.md)                            |          10 |        10 |
| [标签管理](requirements/tags.md)                                   |           1 |         1 |
| [代理管理](requirements/proxies.md)                                |           1 |         1 |
| [SSH 密钥管理](requirements/ssh-keys.md)                           |           1 |         2 |
| [快捷命令、命令输入与历史](requirements/quick-commands-history.md) |           8 |         7 |
| [通知管理](requirements/notifications.md)                          |           2 |         2 |
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
| [RDP / VNC 远程桌面](requirements/remote-desktop.md)               |           7 |         4 |
| [移动端交互](requirements/mobile.md)                               |           4 |         0 |
| [架构与跨模块需求](requirements/architecture.md)                   |           4 |         0 |

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

本需求基线覆盖当前 Nexus Terminal 用户可达能力与已经确认的 clean architecture 行为。Future Agent 目前只有架构边界，没有正式 App route、Frontend Agent runtime implementation 或 Backend Agent public HTTP/WebSocket contract，因此不虚构 Agent 产品功能；只保留未来实现必须遵守的 runtime 隔离约束。
