# 星枢终端 - 技术债务报告

> **状态**：🟡 收敛中 | **更新时间**：2026-05-03 | **收敛率**：37/84 已修复（44%）

---

## 债务健康度（2026-05-02 全面审查基线）

| 指标                              | 状态 | 说明                                       |
| --------------------------------- | ---- | ------------------------------------------ |
| ESLint warnings                   | 0    | `npm run -s lint -- --format json`         |
| ESLint errors                     | 0    | 无阻断错误                                 |
| 业务代码 TODO/FIXME               | 0    | `debt:check` 门禁阻止回流                  |
| `@ts-ignore` / `@ts-expect-error` | 0    | 类型系统已泛型化重构                       |
| `: any`（业务源码）               | 0    | 仅 `auto-imports.d.ts` 自动生成文件含 1 处 |
| `console.log`（业务源码）         | 0    | 结构化日志替代                             |
| `import/no-cycle` 豁免            | 0    | 原 16 处，已全部收敛                       |

---

## 审查总览（2026-05-02 四维度并行审查）

| 维度     | Critical | High      | Medium    | Low       | 合计         | 已修复 |
| -------- | -------- | --------- | --------- | --------- | ------------ | ------ |
| 安全漏洞 | 1→0      | 5→0       | 0         | 3         | **9**        | **6**  |
| 代码质量 | 2→1      | 10        | 20→17     | 15→12     | **47**       | **7**  |
| 边界条件 | 3→0      | 6→1       | 10→1      | 9→3       | **28**       | **23** |
| 测试覆盖 | —        | —         | —         | —         | **独立章节** | 2      |
| **合计** | **6→1**  | **21→11** | **30→18** | **27→15** | **84**       | **35** |

> 注：.env 密钥泄露问题不在本报告跟踪范围内；6 项安全 Medium（CORS null Origin、Helmet CSP、Session cookie 30 天、通知凭据加密、批量命令长度限制、WebSocket Origin localhost）暂不处理。

---

## 🔴 Critical — 必须立即修复（6 项，已修复 5 项）

### ~~C-1. SFTP 压缩/解压 Shell 命令注入~~ ✅

- **位置**：`packages/backend/src/sftp/sftp.controller.ts:450-482`
- **问题**：使用双引号转义 shell 参数，bash 会解释 `$`、`` ` ``、`\`、`!`
- **修复**：✅ 已创建共享 `shellEscape()` 工具函数，sftp.controller / sftp-archive.manager / sftp-path-operations 统一使用
- **关联**：与 C-6、H-4 一并修复

### ~~C-2. SQL 注入 — PRAGMA table_info 未参数化~~ ✅

- **位置**：`packages/backend/src/database/migrations.ts:53`
- **问题**：`tableName` 直接拼接进 PRAGMA 语句
- **修复**：✅ 已添加 `VALID_TABLE_NAME` 正则白名单校验 `/^[a-zA-Z_][a-zA-Z0-9_]*$/`

### C-3. 12 个 Pinia Store 零测试覆盖

- **位置**：`packages/frontend/src/stores/`
- **问题**：`session.store.ts`（核心会话状态）、`notifications.store.ts`、`proxies.store.ts` 等 12 个 store 完全无测试
- **修复**：优先为 `session.store.ts` 补测试，目标 >=80% 分支覆盖

### ~~C-4. `clientStates` Map 无同步原语~~ ✅

- **位置**：`packages/backend/src/websocket/state.ts:12`
- **问题**：Map 被多个异步上下文并发访问，`await` 点产生交错窗口，可导致 SSH 资源双重释放
- **修复**：✅ 已在 `state.ts` 中引入 `acquireSessionLock()` per-session 锁，`ssh.handler.ts` 中使用 `isMarkedForSuspend` CAS 模式防止竞态

### ~~C-5. 前端 `terminalOutputBuffer` 无上限~~ ✅

- **位置**：`packages/frontend/src/composables/useSshTerminal.ts:39`
- **问题**：reactive 数组在高吞吐终端输出下无限增长，可导致浏览器标签页 OOM 崩溃
- **修复**：✅ 已添加 `MAX_BUFFER_SIZE_BYTES = 10MB` 上限，超出时丢弃最旧条目

### ~~C-6. SSH 挂起日志路径遍历风险~~ ✅

- **位置**：`packages/backend/src/ssh-suspend/temporary-log-storage.service.ts:48`
- **问题**：`suspendSessionId` 未经路径遍历验证即用于文件路径构造
- **修复**：✅ 已添加 `VALID_SUSPEND_ID = /^[a-zA-Z0-9_-]+$/` 正则校验

---

## 🟠 High — 一周内修复（21 项，已修复 10 项）

### 安全类（5 项，全部已修复）

| ID      | 问题                                                          | 位置                                               | 状态                                                                   |
| ------- | ------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| ~~H-1~~ | ~~SSRF：远程 HTML 预设 URL 域名后缀匹配可绕过~~               | ~~`appearance.service.ts:742`~~                    | ✅ 已改为精确匹配 `hostname === domain`                                |
| ~~H-2~~ | ~~Docker 命令注入：WebSocket handler 与 controller 分别校验~~ | ~~`docker.handler.ts:380`~~                        | ✅ 已提取共享 `sanitizeDockerContainerId()` + `isValidDockerCommand()` |
| ~~H-3~~ | ~~批量命令执行无审计日志~~                                    | ~~`batch.controller.ts:32`~~                       | ✅ 已集成 `AuditLogService.logAction()`                                |
| ~~H-4~~ | ~~SFTP 三处 shell 转义策略不一致~~                            | ~~controller / archive.manager / path-operations~~ | ✅ 已统一使用 `shellEscape()`                                          |
| ~~H-5~~ | ~~glob 依赖命令注入漏洞 (GHSA-5j98-mcp5-4vw2)~~               | ~~`node_modules/glob`~~                            | ✅ 已更新至安全版本                                                    |

### 代码质量类（10 项）

| ID   | 问题                                                      | 位置                                                      | 修复建议                                                         |
| ---- | --------------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| ~~H-6~~ | ~~7 个空 catch 块静默吞错（含迁移失败）~~                     | ~~`migrations.ts:531` 等~~                                    | ✅ 31 处空 catch 块已修复，统一使用 console.debug/warn 记录      |
| H-7  | 170 个 catch 块未使用 `error: unknown` 类型               | 全局                                                      | 批量替换为 `catch (error: unknown)`                              |
| H-8  | `auth.controller.ts` 1,445 行上帝对象，25 处直接 SQL 引用 | `auth/auth.controller.ts`                                 | SQL/Repository 调用提取到 service 层                             |
| H-9  | `useAddConnectionForm.ts` 1,204 行上帝函数                | 前端 composable                                           | 拆分为 6 个职责单一的 composable                                 |
| H-10 | `useSftpActions.ts` 1,319 行上帝函数                      | 前端 composable                                           | 拆分为 navigation / operations / upload / download / permissions |
| H-11 | `StatusMonitorService` 507 行上帝类                       | 后端 service                                              | 提取健康检查和数据聚合为独立类                                   |
| H-12 | `ssh.service.ts` 207 行递归跳板连接函数                   | `ssh.service.ts:569`                                      | 拆分代理连接、跳板解析、错误恢复为辅助函数                       |
| H-13 | 6 个后端模块完全缺失 repository 层                        | sftp / transfers / ssh-suspend / docker / services / auth | 为每个模块创建 `*.repository.ts`                                 |
| H-14 | `appearance.store.ts` 1,073 行上帝 Store                  | 前端 store                                                | 拆分为 theme / font / background 子 store                        |
| H-15 | `settings.store.ts` 1,025 行上帝 Store                    | 前端 store                                                | 按域拆分为 system / security / layout 子 store                   |

### 边界条件类（6 项，已修复 5 项）

| ID       | 问题                                                             | 位置                     | 状态                                         |
| -------- | ---------------------------------------------------------------- | ------------------------ | -------------------------------------------- |
| ~~H-16~~ | ~~SSH 挂起移交竞态：检查与接管之间有 await~~                     | ~~`utils.ts:121-184`~~   | ✅ 已使用 `isMarkedForSuspend` CAS 模式      |
| ~~H-17~~ | ~~Silent exec 按 sessionId 键导致请求被覆盖~~                    | ~~`ssh.handler.ts:65`~~  | ✅ 已改用 requestId 作键                     |
| ~~H-18~~ | ~~Silent exec 超时后未发送 Ctrl+C 中止当前命令~~                 | ~~`ssh.handler.ts:255`~~ | ✅ 超时后先发 `\x03` 再启动下一尝试          |
| ~~H-19~~ | ~~`pendingSilentExecRequests` 定时器在会话断开时未清理~~         | ~~`ssh.handler.ts:65`~~  | ✅ 已在 `cleanupClientConnection` 中遍历清理 |
| ~~H-20~~ | ~~`cleanupClientConnection` 异步但被同步调用，未捕获 rejection~~ | ~~`utils.ts:98`~~        | ✅ 所有调用点已添加 `.catch()`               |
| H-21     | SSH shell ready 无超时，连接成功后 shell 挂起则无限等待          | `ssh.service.ts`         | 添加 shell-ready 超时（如 10s）              |

---

## 🟡 Medium — 一个月内修复（30 项）

### 代码质量类（20 项）

| ID      | 问题                                                  | 位置                      | 修复建议                                                         |
| ------- | ----------------------------------------------------- | ------------------------- | ---------------------------------------------------------------- |
| M-1     | `services/` 目录扁平堆放 14 个无关服务                | `backend/src/services/`   | 域服务移入各自模块                                               |
| M-2     | 239 个事件监听注册 vs 136 个清理调用（1.76:1 泄漏比） | 全局                      | 审计 WebSocket / 终端 / Vue 组件的 `onUnmounted` 清理            |
| ~~M-3~~ | ~~`useWebSocketConnection.ts` 641 行~~                | ~~前端 composable~~       | ✅ 已提取消息解析 (messageParser)、重连逻辑 (reconnect) 为子模块 |
| ~~M-4~~ | ~~`useSshTerminal.ts` 522 行~~                        | ~~前端 composable~~       | ✅ 已提取缓冲管理 (bufferManager)、事件处理为子模块              |
| M-5     | `transfers.service.ts` 1,435 行                       | 后端 service              | 拆分为 orchestrator / sftp-transfer / rsync-transfer             |
| M-6     | 前端 `utils/` 目录 6 个工具模块零测试                 | `frontend/src/utils/`     | 优先 `output-processor.ts` 和 `apiClient.ts`                     |
| M-7     | `settings.controller.ts` 30 个重复 try-catch 块       | 后端 controller           | 使用已有 `asyncHandler` 包装所有路由                             |
| M-8     | `auth/` 模块 26 个扁平工具文件                        | 后端 auth/                | 按功能分组到子目录：flows / actions / utils                      |
| M-9     | 前端 `router/` 目录零测试                             | `frontend/src/router/`    | 为路由守卫添加单元测试                                           |
| M-10    | `metrics/` 模块有 routes+service 但无 controller      | 后端 metrics/             | 添加 controller 或文档说明跳过原因                               |
| M-11    | `passkey/` 模块有 service+repository 但无 routes      | 后端 passkey/             | 移入 auth/ 或文档说明跨模块依赖                                  |
| M-12    | `connection.service.ts` 61 处 encrypt/decrypt 调用    | 后端 connections/         | 创建 `encryptConnectionCredentials()` 辅助函数                   |
| M-13    | 46 个 catch 块使用短变量名 `catch (e)`                | 全局                      | 统一为 `catch (error: unknown)`                                  |
| M-14    | 硬编码 OpenAI API base URL                            | 前端 aiSettings           | 提取为共享常量 `AI_PROVIDER_DEFAULTS`                            |
| M-15    | `useFileUploader.ts` 495 行                           | 前端 composable           | 提取分块管理和重试逻辑                                           |
| M-16    | 硬编码 `50000` 作为审计日志最大条目                   | `settings.service.ts:806` | 定义 `DEFAULT_AUDIT_LOG_MAX_ENTRIES` 常量                        |
| M-17    | `index.ts` 后端入口 598 行单体文件                    | `backend/src/index.ts`    | 提取中间件配置、路由注册、服务器启动                             |
| M-18    | Catch 块仅 `console.warn/error` 不传播错误            | 多处                      | 评估是否应传播 / 设置 UI 状态 / 记录理由注释                     |
| M-19    | `SuspendedSshSessionsView.vue` 模板嵌套 13 层         | 前端 view                 | 提取子组件，使用 `v-if` 守卫减少嵌套                             |
| M-20    | 后端 `logging/` 和 `middleware/` 模块零测试           | 后端                      | 为中间件行为和日志配置添加测试                                   |

### 边界条件类（10 项）

| ID       | 问题                                                      | 位置                                      | 修复建议                                                     |
| -------- | --------------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------ |
| ~~M-21~~ | ~~前端 WebSocket 重连无 jitter（惊群效应）~~              | ~~`useWebSocketConnection.ts:42`~~        | ✅ 已添加随机抖动                                            |
| ~~M-22~~ | ~~SFTP 上传 `activeUploads` 在流未触发 close 时可能泄漏~~ | ~~`sftp-upload.manager.ts:47`~~           | ✅ 已有 5s 超时回退 `stream.destroy()`                       |
| ~~M-23~~ | ~~SSH 挂起日志轮转丢弃全部历史~~                          | ~~`temporary-log-storage.service.ts:75`~~ | ✅ 已实现环形缓冲（100MB 上限，保留 80MB）                   |
| M-24     | 多设备会话状态不一致                                      | `websocket/state.ts:15`                   | 文档说明行为，考虑添加会话列表端点                           |
| M-25     | SFTP 操作 payload 使用 `z.any()` 绕过 Zod 验证            | `websocket/schemas.ts`                    | 为每个 SFTP 操作定义专用 Zod schema                          |
| ~~M-26~~ | ~~无端口范围验证（1-65535）~~                             | ~~`connections.controller.ts`~~           | ✅ 已添加 `port >= 1 && port <= 65535` 校验（create/update） |
| ~~M-27~~ | ~~无主机名格式验证~~                                      | ~~`connections.controller.ts`~~           | ✅ 已添加最大 253 字符 + 合法域名/IPv6 正则校验              |
| ~~M-28~~ | ~~注册无用户名长度/密码复杂度限制~~                           | ~~`auth.controller.ts`~~                      | ✅ 用户名 3-64 字符 + 字母数字下划线连字符；密码含字母和数字  |
| ~~M-29~~ | ~~`ssh:resize` 无 cols/rows 上限~~                        | ~~`ssh.handler.ts`~~                      | ✅ 已添加 `cols <= 1000 && rows <= 500` 上限校验             |
| ~~M-30~~ | ~~SFTP readdir 响应无分页（大目录可超 4MB）~~             | ~~后端 SFTP~~                             | ✅ 已实现按大小分批发送（3MB 阈值），并修复重复发送 bug      |

---

## 🟢 Low — 可选优化（27 项）

### 安全类（3 项）

| ID  | 问题                              | 位置                      | 修复建议                                |
| --- | --------------------------------- | ------------------------- | --------------------------------------- |
| L-1 | Swagger 在非生产环境暴露 API 结构 | `index.ts:466-489`        | 文档说明 `NODE_ENV=production` 必须设置 |
| L-2 | uuid 依赖缓冲区边界检查           | `node_modules/uuid`       | `npm audit fix --force`                 |
| L-3 | 错误消息可能泄露内部路径          | `error.middleware.ts:100` | 生产环境仅返回通用错误消息              |

### 代码质量类（15 项）

| ID   | 问题                                          | 位置                         | 修复建议                                               |
| ---- | --------------------------------------------- | ---------------------------- | ------------------------------------------------------ |
| L-4  | 硬编码 GitHub 仓库 URL（3 处）                | 前端 settings composable     | 提取为 `GITHUB_REPO_URL` 常量                          |
| L-5  | 硬编码 CORS 默认 origin                       | `index.ts:242`               | 生产环境日志警告                                       |
| L-6  | Passkey 超时硬编码 60000ms                    | `passkey.service.ts:168,287` | 定义 `PASSKEY_CHALLENGE_TIMEOUT_MS` 常量               |
| L-7  | SSH 重连延迟硬编码 5000ms                     | `ssh.handler.ts:433`         | 定义 `DEFAULT_SSH_RECONNECT_DELAY_MS` 常量             |
| L-8  | SQLite PRAGMA 值硬编码                        | `connection.ts:96,100`       | 定义 `SQLITE_CACHE_SIZE_KB` / `SQLITE_MMAP_SIZE_BYTES` |
| L-9  | `loginBanDuration: '300'` 硬编码为字符串      | `settings.repository.ts:280` | 定义 `DEFAULT_LOGIN_BAN_DURATION_SECONDS`              |
| L-10 | `output-processor.ts` 395 行零测试            | 前端 utils                   | 添加 ANSI 转义码处理、分块、边界测试                   |
| L-11 | `cacheManager.ts` 250 行零测试                | 前端 utils                   | 添加缓存命中/未命中、TTL 过期、驱逐测试                |
| L-12 | Docker handler 硬编码 500ms 延迟              | `docker.handler.ts:430`      | 提取为命名常量并注释原因                               |
| L-13 | catch 变量命名不一致（`error` / `e` / `err`） | 全局                         | 统一为 `catch (error: unknown)`                        |
| L-14 | `@types/node` 落后 5 个大版本（v20 vs v25）   | package.json                 | 下次依赖审查周期更新                                   |
| L-15 | `vuedraggable` 版本需验证 Vue 3 兼容性        | `frontend/package.json`      | 手动验证正确包和版本                                   |
| L-16 | 前端 `locales/` 目录无翻译完整性测试          | `frontend/src/locales/`      | 添加 key 一致性校验测试                                |
| L-17 | 5 个前端 composable 超过 200 行               | 多处                         | 下次重构时考虑进一步拆分                               |
| L-18 | 5 个 `as any` 类型断言在生产代码中            | 多处                         | 创建类型化访问函数或全局 `.d.ts` 声明                  |

### 边界条件类（9 项）

| ID       | 问题                                              | 位置                             | 修复建议                                     |
| -------- | ------------------------------------------------- | -------------------------------- | -------------------------------------------- |
| L-19     | `lastPingTime` Map 非 OPEN 连接条目可能累积       | `heartbeat.ts:30`                | 在连接 close 处理中清理                      |
| L-20     | `requestIdleCallback` Safari 降级方案未显式测试   | `useSshTerminal.ts:49-52`        | 使用 polyfill 或辅助函数                     |
| L-21     | `Uint8Array` 终端输出大拼接可能昂贵               | `useSshTerminal.ts:55-64`        | 考虑使用 Blob 或逐块写入                     |
| L-22     | PWA Service Worker 可能缓存过期 WebSocket 状态    | `public/sw.js`                   | 后端握手时发送版本号，前端检测不匹配提示刷新 |
| L-23     | DNS 解析失败错误消息不友好                        | `ssh.service.ts`                 | 捕获 `ENOTFOUND` / `EAI_AGAIN` 提供友好消息  |
| L-24     | 代理连接失败不区分代理不可达和目标不可达          | `ssh.service.ts`                 | 包装错误上下文                               |
| ~~L-25~~ | ~~`flushPendingChunks` 重入守卫非原子~~           | ~~`sftp-upload.manager.ts:311`~~ | ✅ 已使用 Promise 锁实现                     |
| ~~L-26~~ | ~~SFTP base64 分块解码无全局内存跟踪~~            | ~~`sftp-upload.manager.ts:280`~~ | ✅ 已有 `globalBufferedBytes` 跟踪           |
| ~~L-27~~ | ~~WebSocket 4MB maxPayload 但出站消息无大小限制~~ | ~~`websocket.ts`~~               | ✅ 已实现分批发送（3MB 阈值）                |

---

## 📉 测试覆盖缺口

### 覆盖率统计

| 类别                     | 源文件   | 测试文件 | 覆盖率   | 目标      |
| ------------------------ | -------- | -------- | -------- | --------- |
| Backend Services         | 14       | 14       | **100%** | 100%      |
| Backend Repositories     | 13       | 13       | **100%** | 100%      |
| Backend Controllers      | 18       | 5        | **28%**  | >=70%     |
| Backend Routes           | 22       | 0        | **0%**   | >=60%     |
| Backend Infrastructure   | 12       | 2        | **17%**  | >=80%     |
| Backend SFTP Sub-modules | 10       | 7        | **70%**  | >=80%     |
| Backend Config           | 6        | 2        | **33%**  | >=50%     |
| Frontend Stores          | 24       | 12       | **50%**  | >=80%     |
| Frontend Composables     | 45       | 10       | **22%**  | >=60%     |
| Frontend Utils           | 6        | 0        | **0%**   | >=80%     |
| Frontend Components      | ~80      | 10       | **13%**  | >=60%     |
| Remote Gateway           | 2        | 1        | **50%**  | >=80%     |
| **总体**                 | **~252** | **~81**  | **32%**  | **>=70%** |

### P0 关键路径缺口

| 缺口                             | 影响                                       | 当前覆盖 |
| -------------------------------- | ------------------------------------------ | -------- |
| `session.store.ts`（前端）       | 核心 SSH 会话状态管理零测试                | 无       |
| `session/actions/*.ts`（前端）   | 仅 `editorActions` 有测试，其余 5 个无测试 | 1/6      |
| `database/connection.ts`（后端） | SQLite 连接池、初始化、错误恢复            | 无       |
| `database/migrations.ts`（后端） | Schema 迁移逻辑、数据完整性                | 无       |
| `websocket/upgrade.ts`（后端）   | WebSocket 升级握手、认证校验               | 无       |
| `websocket/state.ts`（后端）     | 共享客户端状态管理、清理                   | 无       |

### P1 高优先级缺口

| 缺口                              | 影响                                    |
| --------------------------------- | --------------------------------------- |
| `middleware/error.middleware.ts`  | 全局错误处理器 — 未处理错误可崩溃服务器 |
| `sftp/sftp-upload.manager.ts`     | 文件上传逻辑、分块、续传                |
| `useTerminalSocket.ts`（前端）    | WebSocket 终端连接生命周期              |
| `useSessionTabActions.ts`（前端） | 标签页创建/销毁/切换逻辑                |
| `utils/cacheManager.ts`（前端）   | TTL 缓存、驱逐策略                      |
| `utils/errorExtractor.ts`（前端） | 错误消息解析用于展示                    |
| 全部 22 个 `*.routes.ts`（后端）  | 路由定义、中间件链、参数解析            |

### 测试质量评估

**优势**：

- 已有测试质量高：`ssh.service.test.ts`（72 测试）、`sftp.service.test.ts`（70 测试）覆盖充分
- Mock 质量高：使用 EventEmitter 模拟类，`vi.clearAllMocks()` 清理状态
- 加密模块边界测试完善：空字符串、无效 hex、密钥轮换
- 认证模块覆盖充分：33 个测试文件覆盖 2FA 状态机、Passkey 流程

**不足**：

- 路由/控制器层系统性无测试：HTTP 层的输入校验、中间件应用、状态码正确性未验证
- 前端文件管理器 composable 1/15 测试覆盖
- 数据库层零测试
- Vitest 配置 90% 阈值当前无法达到

---

## ✅ 正面发现

1. **XSS 防护到位**：`v-html` 均使用 DOMPurify 严格白名单（ALLOWED_TAGS / ALLOWED_ATTR / FORBID_TAGS / FORBID_ATTR）
2. **加密设计成熟**：AES-256-GCM + 多版本密钥轮换 + 旧格式检测 + 重新加密支持
3. **认证体系完备**：bcrypt 12 轮、2FA TOTP、Passkey/WebAuthn、IP 黑名单自动封禁
4. **SQL 查询参数化**：所有数据库查询使用 `runDb(db, sql, params)`
5. **WebSocket Origin 校验**：CSWSH 防护已实现
6. **分层架构总体遵循**：大部分业务模块正确实现 routes → controller → service → repository
7. **错误类型化意识**：65% 的 catch 块使用 `catch (error: unknown)` 正确模式
8. **`asyncHandler` 工具存在**：可消除控制器层重复 try-catch 样板代码

---

## 修复优先级

| 优先级 | 任务                                                    | 预估工时  | 状态      |
| ------ | ------------------------------------------------------- | --------- | --------- |
| ~~P0~~ | ~~统一 SFTP shell 转义为 `shellEscape()`（C-1 + H-4）~~ | ~~2h~~    | ✅ 已完成 |
| ~~P0~~ | ~~修复 PRAGMA SQL 拼接（C-2）~~                         | ~~30min~~ | ✅ 已完成 |
| **P0** | 补 `session.store.ts` 测试（C-3）                       | 4h        | 待执行    |
| ~~P0~~ | ~~修复 clientStates 并发竞态（C-4）~~                   | ~~4h~~    | ✅ 已完成 |
| ~~P0~~ | ~~添加 terminalOutputBuffer 上限（C-5）~~               | ~~2h~~    | ✅ 已完成 |
| ~~P0~~ | ~~修复挂起日志路径遍历（C-6）~~                         | ~~30min~~ | ✅ 已完成 |
| ~~P1~~ | ~~修复 SSRF 域名后缀匹配（H-1）~~                       | ~~1h~~    | ✅ 已完成 |
| ~~P1~~ | ~~统一 Docker 命令校验（H-2）~~                         | ~~2h~~    | ✅ 已完成 |
| ~~P1~~ | ~~批量命令审计日志（H-3）~~                             | ~~2h~~    | ✅ 已完成 |
| ~~P1~~ | ~~更新 glob 依赖（H-5）~~                               | ~~30min~~ | ✅ 已完成 |
| ~~P1~~ | ~~修复空 catch 块（H-6）~~                                  | ~~2h~~    | ✅ 已完成 |
| **P1** | 补数据库层 + WebSocket 层测试                           | 8h        | 待执行    |
| **P2** | 拆分上帝对象（H-8 ~ H-15）                              | 24h       | 待执行    |
| ~~P2~~ | ~~修复边界条件 High（H-21）~~                           | ~~2h~~    | ✅ 已完成 |
| **P2** | 补前端 utils / composables 测试                         | 20h       | 待执行    |
| **P3** | Medium 代码质量项（M-1 ~ M-20）                         | 40h       | 持续      |
| **P3** | Medium 边界条件项（M-24 ~ M-29）                        | 12h       | 持续      |
| **P4** | Low 项（L-1 ~ L-24）                                    | 16h       | 持续      |

---

## 📋 剩余债务分析（55 项待处理）

### 按级别分布

| 级别     | 剩余   | 占比  | 主要类型               |
| -------- | ------ | ----- | ---------------------- |
| Critical | 1      | 2.0%  | 测试覆盖               |
| High     | 11     | 22.0% | 代码质量 + 边界条件    |
| Medium   | 18     | 36.0% | 代码质量 + 边界条件    |
| Low      | 19     | 38.0% | 代码质量 + 安全 + 边界 |
| **合计** | **49** | —     | —                      |

### 按修复类型分类

#### 1. 代码重构与拆分（15 项，预估 60h+）

大型上帝对象/函数是最高密度的债务来源：

| ID   | 文件/模块                                 | 行数  | 拆分策略                                           |
| ---- | ----------------------------------------- | ----- | -------------------------------------------------- |
| H-8  | `auth.controller.ts`                      | 1,445 | SQL/Repository 调用提取到 service 层               |
| H-9  | `useAddConnectionForm.ts`                 | 1,204 | 拆分为 6 个职责单一的 composable                   |
| H-10 | `useSftpActions.ts`                       | 1,319 | 拆分为 navigation / operations / upload / download |
| H-11 | `StatusMonitorService`                    | 507   | 提取健康检查和数据聚合为独立类                     |
| H-12 | `ssh.service.ts` 递归跳板函数             | 207   | 拆分代理连接、跳板解析、错误恢复                   |
| H-14 | `appearance.store.ts`                     | 1,073 | 拆分为 theme / font / background 子 store          |
| H-15 | `settings.store.ts`                       | 1,025 | 按域拆分为 system / security / layout 子 store     |
| M-3  | `useWebSocketConnection.ts`               | 641   | 提取消息解析、重连逻辑为子模块                     |
| M-4  | `useSshTerminal.ts`                       | 522   | 提取缓冲管理、事件处理为子模块                     |
| M-5  | `transfers.service.ts`                    | 1,435 | 拆分为 orchestrator / sftp-transfer / rsync        |
| M-8  | `auth/` 26 个扁平工具文件                 | —     | 按功能分组到子目录：flows / actions / utils        |
| M-12 | `connection.service.ts` 61 处加解密       | —     | 创建 `encryptConnectionCredentials()` 辅助函数     |
| M-17 | `index.ts` 后端入口                       | 598   | 提取中间件配置、路由注册、服务器启动               |
| M-19 | `SuspendedSshSessionsView.vue` 嵌套 13 层 | —     | 提取子组件，使用 `v-if` 守卫减少嵌套               |
| L-17 | 5 个前端 composable 超过 200 行           | —     | 下次重构时考虑进一步拆分                           |

#### 2. 测试覆盖补充（14 项，预估 36h+）

测试是第二大债务来源，核心模块零测试风险最高：

| ID   | 目标                                    | 当前覆盖 | 优先级 | 预估工时 |
| ---- | --------------------------------------- | -------- | ------ | -------- |
| C-3  | 12 个 Pinia Store 零测试                | 0%       | P0     | 4h       |
| H-13 | 6 个后端模块缺 repository 层            | —        | P1     | 8h       |
| M-6  | 前端 `utils/` 6 个模块零测试            | 0%       | P2     | 6h       |
| M-9  | 前端 `router/` 目录零测试               | 0%       | P2     | 4h       |
| M-20 | 后端 `logging/` 和 `middleware/` 零测试 | 0%       | P2     | 4h       |
| L-10 | `output-processor.ts` 395 行            | 0%       | P3     | 3h       |
| L-11 | `cacheManager.ts` 250 行                | 0%       | P3     | 2h       |
| L-16 | 前端 `locales/` 翻译完整性              | 0%       | P3     | 2h       |

#### 3. 输入验证与边界条件（10 项，预估 16h）

| ID   | 验证缺失                   | 影响        | 修复建议                               |
| ---- | -------------------------- | ----------- | -------------------------------------- |
| H-21 | SSH shell ready 无超时     | 连接挂起    | 添加 shell-ready 超时（如 10s）        |
| M-24 | 多设备会话状态不一致       | 用户困惑    | 文档说明行为，考虑添加会话列表端点     |
| M-25 | SFTP payload 用 `z.any()`  | 验证绕过    | 为每个 SFTP 操作定义专用 Zod schema    |
| M-26 | 无端口范围验证             | 无效连接    | 添加 `port >= 1 && port <= 65535`      |
| M-27 | 无主机名格式验证           | 无效连接    | 添加最大 253 字符 + 合法主机名/IP 正则 |
| ~~M-28~~ | ~~注册无密码复杂度限制~~       | ~~弱密码~~      | ✅ 用户名 3-64 字符 + 密码含字母和数字    |
| M-29 | `ssh:resize` 无上限        | 资源消耗    | 添加 `cols <= 1000 && rows <= 500`     |
| L-19 | `lastPingTime` 条目累积    | 内存泄漏    | 在连接 close 处理中清理                |
| L-20 | `requestIdleCallback` 兼容 | Safari 降级 | 使用 polyfill 或辅助函数               |
| L-21 | `Uint8Array` 大拼接开销    | 性能        | 考虑使用 Blob 或逐块写入               |

#### 4. 代码质量清理（10 项，预估 10h）

| ID   | 问题                                         | 修复建议                                  |
| ---- | -------------------------------------------- | ----------------------------------------- |
| ~~H-6~~ | ~~7 个空 catch 块静默吞错~~                      | ✅ 31 处已修复，统一 console.debug/warn    |
| H-7  | 170 个 catch 块未 `error: unknown`           | 批量替换                                  |
| M-1  | `services/` 目录 14 个服务扁平堆放           | 域服务移入各自模块                        |
| M-7  | `settings.controller.ts` 30 个重复 try-catch | 使用 `asyncHandler` 包装所有路由          |
| M-13 | 46 个 catch 块用短变量名 `e`                 | 统一为 `error: unknown`                   |
| M-14 | 硬编码 OpenAI API base URL                   | 提取为共享常量 `AI_PROVIDER_DEFAULTS`     |
| M-15 | `useFileUploader.ts` 495 行                  | 提取分块管理和重试逻辑                    |
| M-16 | 硬编码 50000 审计日志最大条目                | 定义 `DEFAULT_AUDIT_LOG_MAX_ENTRIES` 常量 |
| M-18 | Catch 块仅 console.warn/error 不传播         | 评估是否应传播 / 设置 UI 状态             |
| L-13 | catch 变量命名不一致                         | 统一为 `catch (error: unknown)`           |

#### 5. 安全与配置（6 项，预估 4h）

| ID   | 问题                           | 严重程度 | 修复建议                           |
| ---- | ------------------------------ | -------- | ---------------------------------- |
| L-1  | Swagger 非生产环境暴露         | Low      | 文档说明 `NODE_ENV=production`     |
| L-2  | uuid 依赖缓冲区边界检查        | Low      | `npm audit fix --force`            |
| L-3  | 错误消息泄露内部路径           | Low      | 生产环境仅返回通用错误消息         |
| L-22 | PWA SW 缓存过期 WebSocket 状态 | Low      | 后端握手时发送版本号，前端检测刷新 |
| L-23 | DNS 解析失败消息不友好         | Low      | 捕获 `ENOTFOUND` 提供友好消息      |
| L-24 | 代理连接失败不区分目标         | Low      | 包装错误上下文                     |

#### 6. 硬编码常量提取（6 项，预估 3h）

| ID  | 硬编码位置                | 建议常量名                           |
| --- | ------------------------- | ------------------------------------ |
| L-4 | GitHub 仓库 URL（3 处）   | `GITHUB_REPO_URL`                    |
| L-5 | CORS 默认 origin          | 生产环境日志警告                     |
| L-6 | Passkey 超时 60000ms      | `PASSKEY_CHALLENGE_TIMEOUT_MS`       |
| L-7 | SSH 重连延迟 5000ms       | `DEFAULT_SSH_RECONNECT_DELAY_MS`     |
| L-8 | SQLite PRAGMA 值          | `SQLITE_CACHE_SIZE_KB` 等            |
| L-9 | `loginBanDuration: '300'` | `DEFAULT_LOGIN_BAN_DURATION_SECONDS` |

### 修复建议优先级

| 优先级 | 批次                       | 预估工时 | 收益                                              |
| ------ | -------------------------- | -------- | ------------------------------------------------- |
| **P0** | C-3：补 session.store 测试 | 4h       | 核心状态管理零测试→基础覆盖                       |
| ~~P1~~ | ~~H-6 空 catch~~ + H-7 类型化  | 4h       | H-6 已完成，H-7 待处理                    |
| **P1** | H-21 shell ready 超时      | 2h       | 防止 SSH 连接挂起                                 |
| ~~P2~~ | ~~M-25~~/~~M-28~~ 输入验证补全     | 4h       | M-28 已完成，M-25 待处理（M-26/M-27/M-29 已修复） |
| **P2** | M-6/M-9/M-20 测试补充      | 14h      | 基础设施层测试覆盖                                |
| **P3** | H-8~H-15 上帝对象拆分      | 40h+     | 长期可维护性，需逐个推进                          |
| **P3** | L-tier 常量提取 + 代码清理 | 13h      | 代码整洁度，可随开发穿插完成                      |

---

## 收敛记录

### 2026-05-03（输入验证增强 + 空 catch 块批量修复）

**提交 `3296d99d`**：13 文件，137 行新增，57 行删除

| 类别        | 已修复           | 说明                                                                                              |
| ----------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| Medium 验证 | M-28             | 用户名长度/格式验证(3-64字符) + 密码复杂度验证(字母+数字) + 端口正则验证 + 主机名格式验证         |
| High 代码   | H-6 (31处)       | 空 catch 块批量修复：status-monitor(16), ssh-suspend(5), websocket(10), ssh.service, transfers.service, 前端组件 |

### 2026-05-03（输入验证 + 事件监听 + composable 类型修复）

**提交 `bc44514e`**：8 文件，121 行新增，50 行删除

| 类别        | 已修复                  | 说明                                                                                                     |
| ----------- | ----------------------- | -------------------------------------------------------------------------------------------------------- |
| Medium 边界 | M-26, M-27, M-29 (3/10) | 端口范围验证、主机名格式验证、SSH resize 上限                                                            |
| Medium 代码 | M-3, M-4 (2/20)         | useWebSocketConnection/useSshTerminal composable 拆分已在前期完成                                        |
| High 代码   | H-6 部分, H-7 部分      | ipWhitelist/metrics 替换 `as Error` 为 pino 结构化日志；ssh.handler .catch() 类型化；H-6 剩余 31 处已在本批次修复 |
| 事件监听    | M-2 部分                | Terminal.vue wheel zoom 提取为命名函数；useResizable.ts mouseleave 修复                                  |
| TS 类型修复 | —                       | bufferManager 补充 3 个缺失方法导出；useWebSocketConnection 修复 scheduleReconnect/parseWebSocketMessage |

### 2026-05-02（84 项全面修复 + Codex 审查补漏）

**原 84 项修复（子代理并行执行）**：19 项落地到代码

| 类别      | 已修复                             | 说明                                                         |
| --------- | ---------------------------------- | ------------------------------------------------------------ |
| Critical  | C-1, C-2, C-4, C-5, C-6 (5/6)      | shellEscape、PRAGMA 校验、per-session 锁、缓冲上限、路径遍历 |
| High 安全 | H-1, H-2, H-3, H-4, H-5 (5/5)      | SSRF、Docker 注入、审计日志、shell 转义统一、glob 更新       |
| High 边界 | H-16, H-17, H-18, H-19, H-20 (5/6) | CAS 竞态、requestId 键、Ctrl+C、定时器清理、异步 catch       |
| Medium    | M-21, M-22, M-23, M-30 (4/30)      | jitter、上传超时回退、环形缓冲、readdir 分批发送             |
| Low       | L-25, L-26, L-27 (3/27)            | 已在代码中实现（Promise 锁、内存跟踪、分批发送）             |

**Codex 审查补漏（7 项）**：

| ID           | 级别     | 问题                                                             | 修复内容                                               |
| ------------ | -------- | ---------------------------------------------------------------- | ------------------------------------------------------ |
| C-readdir    | CRITICAL | SFTP readdir 分批发送最后一个 chunk 被重复发送                   | 移除多余条件，仅保留 `isLast` 分支                     |
| C-readyState | CRITICAL | SFTP readdir 错误路径缺少 `readyState` 检查                      | 两处错误发送前添加 `WebSocket.OPEN` 前置检查           |
| H-memory     | HIGH     | `cancelUploadInternal` 未释放 `globalBufferedBytes` 导致内存泄漏 | 删除前遍历 `pendingChunks` 减去缓冲字节                |
| H-test       | HIGH     | `output-processor.test.ts` ANSI 剥离断言反转                     | `not.toContain('red text')` → `not.toContain('\x1b[')` |
| H-flaky      | HIGH     | `ssh.service.test.ts` 键盘交互测试用 `setTimeout` 做同步等待     | 替换为 `vi.waitFor()`                                  |
| M-cd         | MEDIUM   | `sftp-archive.manager.ts` 两处 `cd` 命令缺少 `--` 终止选项标记   | 改为 `cd --`                                           |
| L-resolved   | LOW      | L-25/L-26/L-27 实际已在代码中实现                                | 标记为已解决                                           |

### 2026-05-02（四维度全面审查）

**审查范围**：406 源文件、~129,914 行代码、152 测试文件
**审查维度**：代码质量 + 安全漏洞 + 测试覆盖 + 边界条件
**发现**：84 项债务（6 Critical + 21 High + 30 Medium + 27 Low）+ 测试覆盖缺口报告

### 2026-05-02（L6 移动端体验 + 类型泛型化）

| 提交      | 内容                                                           |
| --------- | -------------------------------------------------------------- |
| `c2101b0` | L6 移动端体验优化：虚拟键盘适配、设备检测增强、触摸区域优化    |
| `1162be0` | WebSocket 消息类型系统泛型化重构（~30 个新接口，50+ 消息类型） |
| `270ad5d` | AI issue 工作流文件上下文提取优化                              |

### 2026-04-28（SFTP/文件管理器修复）

| 提交      | 内容                                     |
| --------- | ---------------------------------------- |
| `bd11d6e` | 修复切换标签页时文件管理器路径被重置     |
| `237eb7d` | 修复 SFTP 管理器会话 ID 重映射后找不到   |
| `fb725b2` | 修复拖拽上传目录遍历路径拼接错误         |
| `1f17e39` | 修复拖拽上传路径显示为 `[object Object]` |

### 2026-04-25（大组件拆分 + 流控）

| 提交      | 内容                                          |
| --------- | --------------------------------------------- |
| `f994007` | FileManager 大组件拆分：提取 19 个 composable |
| `7502a31` | SFTP 滑动窗口流控，防止大文件上传 OOM         |
| `521cfd7` | pino 结构化日志支持运行时动态调整级别         |

### 2026-04-24（全面代码审计 26 项全部修复）

| 类别          | 数量 | 说明                                                         |
| ------------- | ---- | ------------------------------------------------------------ |
| 🔴 高优先级   | 6    | Shell 注入、XSS、Docker 配置、健康检查、类型安全、body limit |
| 🟡 中优先级   | 10   | 组件拆分、Store 测试、速率限制、CSP、错误格式等              |
| 🟢 低优先级   | 9    | 结构化日志、Metrics、a11y、主题系统、命令面板文档等          |
| ~~L4 路线图~~ | —    | 已从债务跟踪中移除（功能规划不属于技术债务）                 |

### 2026-04-22（基础设施整改）

| 提交                   | 内容                                          |
| ---------------------- | --------------------------------------------- |
| trust proxy 默认不信任 | 仅 `TRUST_PROXY` 显式配置时启用               |
| quality:check 三端覆盖 | frontend + backend + remote-gateway typecheck |
| migrations SQL 修复    | `favorite_paths` 建表语句分隔符               |
| 部署口径对齐           | 端口、镜像来源统一                            |

---

**文档维护者**：工程治理
**最后更新**：2026-05-03（输入验证 + 空 catch 块修复，累计 37/84 已修复，收敛率 44%）
