# 本体测试

职责、目录及CI设计见[测试架构](../doc/architecture/TESTING.md)，当前执行证据见[测试入口](../doc/testing/E2E.md)。旧Agent、SDK及插件候选链已移除；本体测试只覆盖当前实际模块。

- `pnpm check`：Backend/Shared、测试配置与源码、ESLint及Frontend类型。
- `pnpm test:fast`：Vitest Shared、后端逻辑、前端逻辑/组件和tooling。
- `pnpm test:integration`：构建Backend后执行存储、HTTP、前端真实HTTP及原生协议。
- `pnpm test:e2e`：构建应用/测试客户端后运行Playwright。
- `pnpm test:e2e:isolated -- <参数>`：分配本地隔离端口，不触发远程Actions。
- `pnpm --filter @nexus-terminal/tests exec vitest run <文件>`：单模块验证。
- `node --test tests/backend/<模块>/<层>/<文件>.native.test.mjs`：直接运行现有原生场景，须先构建Backend。

`*.test.ts/mjs`归Vitest，`*.native.test.mjs`归Node，`*.spec.ts/mjs`归Playwright；不跨runner重复包装。就近辅助代码归模块support，跨模块协议端归`support/protocols`，静态内容归fixtures。`cases/migration.json`只记录仍有当前owner的历史来源映射，不表示运行通过。

`NEXUS_TEST_ARTIFACT_DIR`指定报告、日志、数据库与协议产物，`NEXUS_TEST_CACHE_DIR`指定缓存。运行前设置明确任务根，保留首次失败和未知效果；不写入源码。Chromium Unix socket需短路径时单独设置本轮TMPDIR。Shared构建与消费其dist的发现/执行不能并行。

真实协议端包括受控SSH、OpenSSH、xrdp/TigerVNC与WS。Actions提供预装runner，服务由仓库夹具按需启动；Playwright用`e2eServices`声明ssh/desktop，普通页面不启动协议端。每worker记录启动、健康、退出与收尾，先排空应用再关闭服务，强杀或清理失败仍失败。

前端真实HTTP集成使用jsdom与独立Backend Worker，APIRequestContext管理Cookie，不启动Chromium/Vite。Vue/Pinia/Router统一实例。普通SSH协议使用`openSshManagement`通过管理API配置连接、私钥及主机信任，不安装Agent。`frontend-workspace.mjs`验证真实前端client→HTTP/WS→OpenSSH；浏览器Cookie、Origin、绘制及IME由Playwright单独验证。

CI质量作业只构建一次应用并执行静态、格式和快速层，质量和共享环境成功后启动8个分片。每片并行原生Node与模块→本体浏览器两条链，第一片额外负责Docker和有限文件系统；发现/断言/分片归框架，薄shell持有进程组、测量和失败传播。两条链失败独立，取消等待实际退出。

Runner通过latest启动并校验依赖指纹，digest只留观测事实；定义见`fixtures/runner/Dockerfile`，指纹见`scripts/e2e/runner-image-info.mjs`。cold关闭依赖和静态缓存恢复，warm允许恢复；不缓存测试通过状态。应用、环境和分片产物按来源job真实执行周期选择不可变ID，部分重跑不猜测attempt名称。

可替代的长短等待均用框架虚拟时钟；真实I/O、进程退出与未知副作用仍保留对应实证。阶段控制台只打印开始/结束/耗时/结果，完整双流归`logs/<phase>.log`，WebServer归`webserver/{backend,frontend}/run-*/output.log`；框架报告保留逐例结果。Linux资源测量使用GNU time，可用`NEXUS_TEST_TIME_COMMAND`指定。

成功远程门禁汇总并回写耗时，手动运行同样回写；源码前进则跳过陈旧更新。`test:docs`在既有构建上执行浏览器并更新截图，明确请求才替换正式图片。`test:ingress`需指定`NEXUS_PRODUCTION_BASE_URL`，发现不等于生产验收。Docker部署smoke独立验证生产镜像/Compose，失败保留数据库及诊断，上传不含临时.env密钥；普通test:all不替代此作业。
