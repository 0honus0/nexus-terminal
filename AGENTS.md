# Nexus Terminal AI 开发约束

本文件是仓库内所有 AI 开发工作的必读约束。开始分析、修改、测试、提交或推送前，必须完整阅读并遵守本文全部内容；修改过程中发现新的适用约束时，也必须立即按本文校正实现。

第一节记录项目所有者直接提出的规则，每条规则独立生效。第二节是依据当前代码和文档总结的项目开发规范。第二节与第一节冲突时，以第一节为准；第一节内部出现冲突，或无法判断两条规则能否同时满足时，先停止受影响的工作并询问项目所有者如何处理。

## 1. 项目所有者规则

1. 每次开发都必须遵守本文件的全部内容。
2. 项目所有者提出的新规则应作为独立条目加入本节，不得通过改写其他条目改变其原意。
3. 发现本节规则相互冲突时，必须询问项目所有者如何处理，不得自行选择或合并冲突规则。
4. 处理 `doc/` 中记录的问题时，一次解决一个问题；每解决一个问题，单独提交并推送。
5. 问题修复完成后，必须同步关闭或删除 `doc/` 中对应的未解决记录，不得保留已解决问题的开放状态或残余描述。
6. 自动化测试源码和测试专用 harness 必须统一放在仓库根目录 `tests/` 下，并按功能分类；生产包中不得新增分散的测试目录。
7. 可复用的开发、检查、构建、Docker 和 E2E 辅助脚本必须放在 `scripts/` 下，并按功能目录分类。
8. `tests/` 不得用读取源码文本、匹配字符串、检查 import 写法、统计文件行数或检查目录形状的方式充当架构和编码规范门禁。
9. 不得新增用于强制 AI 开发规范的自定义源码扫描质量门；这类开发约束写入本文件，由 AI 在修改和审查时执行。
10. 测试应验证可观察行为、公开 contract、真实状态变化或故障恢复结果，不得锁定内部实现文本。
11. E2E workflow 保持流程精简；仓库基础检查串行执行，真实产品 E2E 按既定项目拆分执行，Docker 部署 smoke 作为交付验证保留。
12. 优化 workflow、脚本或架构时必须保持产品功能和公开 contract 不变，除非任务明确要求改变行为。
13. 无人消费的旧代码、脚本、检查、文档和引用关系应一并删除，不得保留兼容残骸或历史痕迹。
14. 修改代码时必须同步更新相关文档、命令、workflow 和引用，保证文档描述的是当前实现。
15. 提交前必须检查工作区残余、未跟踪文件、失效引用、未完成标记和对应远程检查结果。
16. 移动端的聊天、终端、文件管理器和其他可滚动交互面必须支持正常的纵向滚动与上下交互，不得由外层手势或遮罩错误拦截。
17. `ui` 组件是通用界面组件的正式入口；不得重新引入已退出的 `base` 组件层，也不得新增检查或文档去维护 `ui`/`base` 双轨结构。
18. 不得保留 image review、截图人工审核流程或其脚本、文档、配置和引用；产品截图只能作为文档或真实 E2E 产物使用。

## 2. 当前项目开发规范

### 2.1 修改流程

- 修改前先查看 `git status`、相关源码、公开 contract、现有测试和文档，确认真实 owner 与调用链。
- 优先修复产生问题的 owner 或边界，不通过放宽断言、复制状态或增加兼容分支掩盖问题。
- 保持改动范围聚焦。发现相邻缺陷时先记录证据；若它不是当前问题的必要组成部分，按独立问题处理。
- 删除或替换能力时同时搜索代码、导出、package script、workflow、文档和测试引用。
- 使用与改动风险匹配的验证。功能缺陷优先补充或调整行为测试；可由 TypeScript、ESLint、Prettier 或构建直接发现的问题不重复编写镜像测试。

### 2.2 仓库与依赖边界

- `packages/protocol` 是跨前后端 HTTP、WebSocket 和 Runner wire DTO 的唯一公共 owner。网络 adapter 直接使用规范 DTO 名称，不在本地重复声明或创建兼容别名。
- Backend 依赖方向遵循 `shared -> platform -> modules -> interfaces/infrastructure -> bootstrap` 的既定职责：`modules` 持有产品用例和 port，`infrastructure` 实现技术 adapter，`interfaces` 只负责协议转换，`bootstrap` 是 composition root。
- Interface 不直接访问数据库，不在 route/session 中实现产品事务。业务模块不直接读取 `process.env`，也不依赖具体 Infrastructure 实现。
- Frontend 按 `app`、`features`、`runtimes`、`foundation`、`shared` 分区。跨模块依赖使用目标模块的 `public.ts` 或 foundation 的 `index.ts`，不得深层导入其他模块的私有文件。
- 不同 feature 不直接耦合私有实现；需要共享能力时提升到已有的 runtime、foundation、shared 或显式公开 contract。
- Workspace transport 由 adapter/session owner 处理。View 和普通 composable 不直接持有 HTTP、WebSocket、二进制 frame、重连、心跳或 backpressure 逻辑。
- Nexus Agent 与 Workspace Runtime 保持独立 owner，通过 Backend contract 或 capability 协作，不读取对方私有状态。

### 2.3 状态、并发与生命周期

- 每份 durable 或 mutable 状态只能有一个明确 owner。前端 view state 不得成为服务端事实的第二来源。
- Vue 模块级响应式可变状态只存在于明确的 store、registry/service owner 或工厂实例中；store 生命周期状态由 `defineStore` 实例闭包持有。
- 异步请求使用 generation、AbortSignal、CAS/version 或等价机制防止过期结果覆盖新状态；旧请求不得清除新请求的 loading/error 状态。
- 外部副作用使用稳定 operation identity、幂等边界、lease/outcome 和 reconcile 表达未知结果，不把 timeout 当作确定失败。
- 创建 listener、timer、进程、channel、文件句柄或临时资源的 owner 负责关闭和清理；关闭流程应等待必要 drain，并保留可诊断失败。
- destructive mutation 遵循 preview/freeze/confirm 和提交前重检；凭据、token、cookie、私钥、文件正文及模型敏感内容不得进入日志。

### 2.4 前端与交互

- 优先复用 `packages/frontend/src/foundation/ui` 的公共组件与 token；共享交互和视觉能力在 foundation 扩展，业务语义留在 feature。
- 组件按职责拆分，避免同时承担 transport、持久化、跨域状态和大段展示逻辑。大组件应提取 composable、子组件或独立样式 owner。
- 用户可见文本进入现有 i18n owner。新增 key 时同步维护 `en-US`、`zh-CN`、`ja-JP`，删除不再可达的 key；品牌、协议名和示例值可保持原文。
- 不在组件中硬编码可翻译的中文、英文或日文 UI 文案。错误码先在边界映射为稳定语义，再由 UI 本地化展示。
- 桌面和移动端都要验证主要流程。移动端特别检查滚动、触摸、虚拟键盘、safe area、drawer/modal 遮罩和固定区域之间的事件竞争。
- 可访问控件提供名称、状态和键盘语义；modal/drawer 管理焦点、关闭语义和背景交互，动画尊重 `prefers-reduced-motion`。

### 2.5 Backend、协议与数据

- 对外 JSON contract 使用 camelCase；数据库 snake_case 仅留在 repository/infrastructure 边界。
- 输入在 HTTP/WebSocket/Runner 边界 decode 和验证，领域层接收明确类型；输出在边界映射为规范 DTO。
- SQLite schema 表达新安装的当前结构，migration 只负责已发布结构的升级，并保持可重入和故障恢复语义。
- 事务由真实状态 owner 建立。状态、事件、Ledger、幂等结果和相关 projection 需要一致时，在同一 commit boundary 内更新。
- Runner 执行冻结的 Workspace generation 和输入，Backend 仍是 durable 产品状态 owner；不得产生第二套 Run、Workspace 或 Plugin 事实源。

### 2.6 测试与交付验证

- `tests/e2e` 验证用户可达的 HTTP、WebSocket、SSH、Agent、移动端和 UI 行为；`tests/backend/agent-scenarios` 保存确定性的 Agent 集成场景。
- 回归测试必须通过调用公开函数、协议、服务或真实 UI 重现失败，并断言输出、状态或副作用。
- 不为可逆的低风险文本或样式改动增加测试；修复并发、持久化、权限、协议和恢复问题时应保留能复现原故障的行为证据。
- 本地至少运行受影响范围的 ESLint、类型检查、构建或定向 E2E。提交前运行 `pnpm run check`、`pnpm run format:all:check` 和 `git diff --check`；涉及发布路径时同时确认远程 E2E 与 Docker smoke。
- 不通过增加 sleep、扩大 timeout 或允许 flaky 来让测试通过。先修复状态同步、等待条件、资源隔离或产品行为。

### 2.7 文档与提交

- `doc/` 只描述当前需求、架构、使用和部署事实。阶段 review、临时问题清单、已完成迁移说明和废弃方案不作为长期文档保留。
- 代码 owner、公开 contract、命令、目录或 workflow 改变时，在同一提交更新对应文档。
- commit message 说明单一完成事项。推送后检查该提交触发的远程 workflow；失败时读取 artifact 和日志，修复真实原因后再提交。
- 合并或发布前确认工作区干净、分支可合并、版本一致、无失效链接、无开放问题记录、无未完成迁移和无被忽略的交付失败。
