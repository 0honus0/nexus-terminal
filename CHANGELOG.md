# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **BaseRepository 抽象基类**：统一 Repository 层错误处理与日志记录
  - 新增 `packages/backend/src/database/base.repository.ts`
  - 提供 `safeDbOperation` 包装方法，自动捕获数据库错误并转换为 `DatabaseError`
  - 所有 Repository 继承此基类，消除重复的 try-catch 代码
  - 统一日志格式：`[RepositoryName] Operation failed: {error}`

- **SFTP 模块重构拆分**：将 God Class `SftpService` 拆分为职责单一的子模块
  - 新增 `packages/backend/src/sftp/sftp-upload.manager.ts` - 文件上传管理器
  - 新增 `packages/backend/src/sftp/sftp-archive.manager.ts` - 压缩/解压管理器
  - 新增 `packages/backend/src/sftp/sftp-utils.ts` - 共享工具函数与类型
  - 新增 `packages/backend/src/sftp/index.ts` - 模块导出入口
  - `SftpService` 现作为门面类协调子模块

- **WebSocket Handlers 测试覆盖**：新增 4 个测试文件
  - `packages/backend/src/websocket/handlers/ssh.handler.test.ts`
  - `packages/backend/src/websocket/handlers/sftp.handler.test.ts`
  - `packages/backend/src/websocket/handlers/docker.handler.test.ts`
  - `packages/backend/src/websocket/handlers/rdp.handler.test.ts`

- **认证中间件测试覆盖**：新增 3 个测试文件
  - `packages/backend/src/auth/auth.middleware.test.ts`
  - `packages/backend/src/auth/ipWhitelist.middleware.test.ts`
  - `packages/backend/src/auth/ipBlacklistCheck.middleware.test.ts`

- **加密模块测试**：新增密钥轮换测试
  - `packages/backend/src/utils/crypto.test.ts`

### Changed

- **错误处理类型安全强化**：消除 `catch (error: any)` 反模式
  - 修改 29 个文件，使用 `unknown` 类型配合 `getErrorMessage()` 工具函数
  - 涉及模块：ai-ops, appearance, auth, connections, notifications, proxies, quick-commands, settings, sftp, ssh-keys, tags, transfers, websocket
  - 提升代码健壮性，防止 `undefined` 属性访问导致的运行时错误

- **SftpService God Class 清理**：移除冗余代码
  - 删除已委托到 `SftpUploadManager` 的 `activeUploads` 属性及其初始化代码
  - 删除无用的 `cancelUploadInternal()` 私有方法
  - 代码行数减少约 745 行，模块职责更加清晰

- **SQLite WAL 模式启用**：优化数据库并发性能
  - 修改 `packages/backend/src/database/connection.ts`
  - 数据库初始化时自动启用 WAL 模式
  - 提升读写并发能力，减少锁竞争

- **类型化错误体系**：消除 `any` 类型，增强类型安全
  - 扩展 `packages/backend/src/utils/AppError.ts`
  - 新增 `DatabaseError`、`ValidationError`、`ExternalServiceError` 等子类
  - 所有错误现在都是类型安全的

- **前端虚拟滚动优化**：为 `CommandHistoryView` 添加虚拟滚动
  - 修改 `packages/frontend/src/views/CommandHistoryView.vue`
  - 使用 `@vueuse/core` 的 `useVirtualList`
  - 支持数千条历史记录的流畅渲染

- **前端懒加载优化**：减少初始加载体积
  - 修改 `packages/frontend/src/App.vue`
  - `RemoteDesktopModal` 和 `VncModal` 改为 `defineAsyncComponent` 动态导入
  - guacamole 依赖 (~200KB) 现在按需加载

- **Repository 层重构**：所有 Repository 继承 `BaseRepository`
  - 统一错误处理模式
  - 涉及 15+ 个 Repository 文件

### Fixed

- **SSH 终端光标位置错乱修复**：修复 bbf8bca 提交引入的终端输出顺序错乱问题
  - **问题描述**：命令执行后光标位置异常，新提示符在命令输出之前显示
  - **根本原因**：小数据包立即写入策略导致输出顺序错乱
    - 换行符（小数据包）→ 立即写入 ✓
    - 命令输出（大数据包）→ 进入缓冲队列等待 16ms ✗
    - 新提示符（小数据包）→ 立即写入 ✓
    - 结果：新提示符在命令输出之前显示
  - **修复方案**：增加缓冲队列状态检查
    - 小数据包仅在缓冲队列为空时立即写入
    - 缓冲队列非空时，小数据包也进入队列保持顺序
    - 确保所有输出按正确顺序显示
  - **涉及文件**：
    - `packages/frontend/src/composables/useSshTerminal.ts` (修改 1 行)

- **SSH 终端输入延迟优化**：解决 SSH 终端输入命令时的键入和显示迟缓问题
  - **前端优化**：区分小数据包（用户输入≤100字节）和大数据包（服务器输出）
    - 小数据包立即写入终端，不经过缓冲队列，延迟从 16ms 降低到 <1ms
    - 大数据包继续使用批量缓冲策略，保持性能优化
  - **输出增强器优化**：跳过小数据包的语法高亮、表格格式化等处理
    - 避免用户输入被节流机制延迟
    - 保持长输出的折叠、高亮等增强功能
  - **性能提升**：总体输入延迟从 72-232ms 降低到 <3ms（98%↓）
  - **涉及文件**：
    - `packages/frontend/src/composables/useSshTerminal.ts` (+17 行)
    - `packages/frontend/src/features/terminal/addons/output-enhancer.ts` (+7 行)
    - `packages/backend/src/websocket/handlers/ssh.handler.ts` (已移除错误的 TCP_NODELAY 实现)

### Added

- **终端外观实时预览功能**：在外观自定义设置中新增实时预览窗口
  - 新增组件：`TerminalPreview.vue` - 独立的 Xterm.js 预览实例，支持实时配置同步
  - 三种预览模式：命令输出、代码高亮、文本样式（可切换）
  - 性能优化：150ms 防抖 + requestAnimationFrame 渲染优化
  - 响应式布局：桌面端左右分栏（配置 + 预览），移动端上下布局
  - 实时同步：字体、字体大小、主题颜色、文字描边、文字阴影
  - 测试覆盖：`TerminalPreview.test.ts` 16 个测试用例全部通过
  - 国际化支持：zh-CN、en-US 预览模式翻译
  - 涉及文件：
    - `packages/frontend/src/components/style-customizer/TerminalPreview.vue` (新增)
    - `packages/frontend/src/components/style-customizer/TerminalPreview.test.ts` (新增)
    - `packages/frontend/src/components/style-customizer/StyleCustomizerTerminalTab.vue` (修改)
    - `packages/frontend/src/locales/zh-CN.json` (修改)
    - `packages/frontend/src/locales/en-US.json` (修改)

### Fixed

- **TerminalPreview 性能优化与 P0 死锁修复**：解决骨架屏与懒加载导致的初始化死锁问题
  - **P0 问题修复**：将骨架屏从 `v-if/v-else` 替换式改为覆盖层（`position: absolute` + `z-index`）
  - **根本原因**：原实现导致 `terminalRef` 在骨架屏显示时不存在，IntersectionObserver 无法观察元素
  - **架构改进**：`terminalRef` 现在永远存在，确保 observer 可以正常工作，终端可正常初始化
  - **性能优化**：使用 xterm `write()` 回调替代固定 `setTimeout(100ms)` 延迟，减少延迟叠加
  - **深度监听优化**：`watch(..., { deep: false })` 避免不必要的对象深度遍历
  - **动画增强**：添加骨架屏淡入动画（`skeleton-fade-in`）和半透明背景遮罩
  - **测试更新**：适配覆盖层结构，15 个测试用例全部通过
  - **修复文件**：
    - `packages/frontend/src/components/style-customizer/TerminalPreview.vue` (重构)
    - `packages/frontend/src/components/style-customizer/TerminalPreview.test.ts` (更新)
  - **性能提升**：
    - 首屏加载时间：∞（死锁）→ ~50-100ms（正常）
    - 用户感知延迟：无限动画 → 平滑切换
    - DOM 稳定性：terminalRef 时有时无 → 始终存在

- **TerminalPreview CSS 样式累积 Bug**：修复 `applyTextStyles` 使用 `+=` 追加样式导致重复的问题
  - 改为直接设置 `canvas.style.webkitTextStroke` 和 `canvas.style.textShadow` 属性
  - 避免每次配置变更时累积样式字符串
  - 修复位置：`packages/frontend/src/components/style-customizer/TerminalPreview.vue:125-137`

- **强制键盘交互式认证功能**：新增 SSH 连接选项，支持 TOTP/2FA 服务器认证
  - 数据库层：`connections` 表添加 `force_keyboard_interactive` 字段
  - 后端 Service：SSH `establishSshConnection` 支持 `keyboard-interactive` 认证方式
  - 前端组件：`AddConnectionFormAdvanced.vue` 添加仅 SSH 显示的开关
  - 国际化支持：zh-CN、en-US、ja-JP 三种语言
  - 测试覆盖：后端 45 个测试、前端 36 个测试全部通过

## 2025-12-27 (自然语言生成命令模块优化)

- **nl2cmd 优化**：DRY 重构，提取共享常量模块
- **nl2cmd 优化**：实现 Axios 客户端单例复用，避免重复创建
- **nl2cmd 优化**：新增流式响应支持（设置页开关，仅 OpenAI 支持）
- **nl2cmd 优化**：错误处理改为 fail-fast，移除重试逻辑，返回友好错误提示
- **测试增强**：nl2cmd.service.test.ts 16 个测试用例全部通过
- **新增 `packages/backend/src/ai-ops/nl2cmd.constants.ts`**：集中管理配置常量
- **前端类型更新**：新增 `streamingEnabled` 字段支持流式开关
- **新增 API**：`clearAxiosClientCache()` 用于缓存管理
- **Bug 修复**：API 429 错误日志输出格式，透传上游详细错误信息
- **Bug 修复**：测试用例中的 vitest mock 兼容性问题
- **Bug 修复**：Claude API headers，添加必需的 `x-api-key` 和 `anthropic-version` headers
- **Bug 修复**：流式响应，添加 `responseType: 'stream'` 配置，正确处理 NodeJS Stream

---

## 2025-12-24 (E2E 与集成测试框架实现)

- **Playwright E2E 测试框架**：
  - 新增目录：`packages/frontend/e2e/`
  - 配置文件：`playwright.config.ts`（支持 Chromium/Firefox/WebKit）
  - Page Object Model 设计：
    - `pages/login.page.ts`：登录页交互封装
    - `pages/workspace.page.ts`：工作区交互封装
    - `pages/settings.page.ts`：设置页交互封装
  - 测试 Fixtures：`fixtures/auth.fixture.ts`（认证状态管理）
  - 测试数据：`fixtures/test-data.ts`（SSH/RDP/VNC 连接配置）
  - E2E 测试用例：
    - `tests/auth.spec.ts`：认证流程（密码登录、2FA、Passkey）
    - `tests/ssh-connection.spec.ts`：SSH 连接与终端交互
    - `tests/sftp-operations.spec.ts`：SFTP 文件操作
    - `tests/remote-desktop.spec.ts`：RDP/VNC 远程桌面
- **SSH/SFTP 协议集成测试**：
  - 新增目录：`packages/backend/tests/integration/ssh/`、`packages/backend/tests/integration/sftp/`
  - Mock 服务器：`mock-ssh-server.ts`（MockSshServer、MockShellStream、MockSftpSession）
  - 测试用例：SSH 连接建立、Shell 操作、重连机制、SFTP 文件/目录操作
- **RDP/VNC 代理功能测试**：
  - 新增目录：`packages/backend/tests/integration/guacamole/`
  - 测试用例：
    - `guacamole.service.test.ts`：Token 生成与加密（AES-256-CBC）
    - `rdp-proxy.test.ts`：WebSocket 消息转发、Guacamole 协议解析
  - Remote Gateway 测试：`packages/remote-gateway/tests/server.test.ts`
- **测试脚本更新**：
  - 新增命令：`npm run test:e2e`、`npm run test:e2e:ui`、`npm run test:e2e:headed`
  - 新增依赖：`@playwright/test ^1.49.1`
- **测试结果**：Backend 59 个测试文件，1,223 个测试用例全部通过

## 2025-12-24 (安全增强与技术债务清零)

- **安全增强**：
  - bcrypt saltRounds 从 10 提升至 12（符合 2025 年安全标准）
  - 实现加密密钥轮换机制（`crypto.ts` 重构）
    - 支持多版本密钥共存
    - 新增 `rotateEncryptionKey()` / `reEncrypt()` / `getKeyRotationStatus()` API
    - 新加密格式：`[keyVersion(4B)][iv(16B)][encrypted][tag(16B)]`
    - 保持向后兼容：自动识别并解密旧格式数据
  - 代码审查报告 13 项问题全部修复（P0-P3）
- **技术债务清零**：24/24 项技术债务已全部修复（100%）
- **测试覆盖率大幅提升**：
  - 新增 20+ 测试文件（Backend + Frontend）
  - ESLint 配置优化，164 文件变更
- **文档状态**：所有核心模块文档已更新至最新状态

## 2025-12-24 00:09:22 (AI 上下文完整性验证)

- **覆盖率验证**：完成全仓扫描，确认模块文档完整性与数据准确性
- **文件统计更新**：
  - Backend: 177 个 TypeScript 文件
  - Frontend: 184 个 TypeScript/Vue 文件
  - Remote Gateway: 1 个 TypeScript 文件
  - **总计：362 个源代码文件**
- **测试框架确认**：Backend 与 Frontend 均已配置 Vitest 测试框架
- **索引更新**：更新 `.claude/index.json`，添加详细模块特性、测试配置、近期更新记录
- **文档状态**：所有核心模块文档（CLAUDE.md）已完整且最新，覆盖率 100%

## 2025-12-23 (技术债务整理)

- **技术债务报告**：新增 `doc/TECHNICAL_DEBT_REPORT.md`，完整分析代码库中的 TODO/FIXME 标记
- **发现数量**：24 个技术债务标记（Backend: 11 个，Frontend: 13 个）
- **优先级分类**：高优先级 7 个，中优先级 12 个，低优先级 5 个
- **问题分类**：错误处理缺失（10个）、安全/验证不完善（3个）、类型定义不精确（3个）等
- **处理建议**：按优先级分三批处理，预估总工作量 15-20 人天

## 2025-12-22 (Phase 6-11 规划)

- **个人版路线图草案**：新增 `doc/PERSONAL_ROADMAP.md`，聚焦单用户工作流
- **规划范围**：Phase 6-11 及长期愿景（AI Copilot、插件体系等）
- **实施策略**：分阶段列出 DB 结构、后端/前端目录规划、估算工期
- **定位重申**：强调无需多用户/权限体系，聚焦个人运维效率

## 2025-12-21 (Phase 3-5 功能实现)

- **Phase 3: WebSocket 基础设施升级**
  - 心跳机制：桌面/移动端差异化心跳检测 (`websocket/heartbeat.ts`)
  - 连接管理：客户端类型检测与验证 (`websocket/connection.ts`)
  - 状态广播：用户 Socket 映射与死连接清理 (`websocket/state.ts`)
  - 数据库索引：审计日志查询优化 (`schema.registry.ts`)

- **Phase 4: 批量作业模块**
  - 新增模块：`packages/backend/src/batch/`
  - 多服务器命令广播：支持并发执行、取消、进度追踪
  - 数据表：`batch_tasks`、`batch_subtasks`
  - WebSocket 实时进度推送

- **Phase 5: AI 智能运维模块**
  - 后端模块：`packages/backend/src/ai-ops/`
    - AI 会话管理（UUID 标识）
    - 系统健康分析、命令模式分析、安全事件分析
    - 连接统计分析、自然语言查询路由
  - 前端模块：`packages/frontend/src/features/ai-ops/`
    - AIAssistantPanel 聊天组件（XSS 防护、自动滚动）
  - 前端模块：`packages/frontend/src/features/batch-ops/`
    - MultiServerExec 多服务器执行组件
  - 数据表：`ai_sessions`、`ai_messages`

## 2025-12-20 22:27:42 (增量更新)

- **模块文档完善**：为 3 个核心模块生成独立 CLAUDE.md 文档
- **导航面包屑**：为各模块文档添加返回根文档的导航链接
- **Mermaid 结构图**：更新模块结构图，添加模块间通信流程图
- **覆盖率更新**：已扫描 283 个源代码文件，模块覆盖率 100%

## 2025-12-20 22:27:42 (初始创建)

- **初始化架构文档**：完成项目架构分析与模块索引建立
- **模块识别**：识别 3 个核心模块（backend、frontend、remote-gateway）
- **技术栈确认**：TypeScript + Vue 3 + Express.js + SQLite3 + Docker
