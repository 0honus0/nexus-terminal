# 本体测试

测试按真实代码模块和验证层归档。完整设计见 [测试架构](../doc/architecture/TESTING.md)，当前迁移状态与未验范围见 [PLAN D35](../doc/PLAN.md#d35本体与插件测试体系重设计2026-11-08)。

- `pnpm test:fast`：Vitest 的 Shared、后端纯逻辑、前端状态与组件；通常无需构建应用或启动浏览器。
- `pnpm test:integration`：构建后端后运行存储、HTTP、前端真实HTTP集成与 Node 原生集成。完整原生协议及必需真实I/O时序通过该入口直接执行；全绿结论须核对当前报告。
- `pnpm test:e2e`：构建应用及测试客户端，再运行 Playwright 产品流程。
- `pnpm test:e2e:isolated -- <参数>`：为 Playwright 服务分配独立本地端口；该命令不触发远程 Actions。
- `pnpm --filter @nexus-terminal/tests exec vitest run <文件或筛选词>`：直接验证一个迁移模块。
- `node --test tests/backend/<模块>/<层>/<文件>.native.test.mjs`：直接执行一个真实 Node/协议模块；首次使用需要 `pnpm build:backend`。
- `pnpm check`：包含测试配置、TypeScript 用例及原有存储 double 的类型检查。

各Vitest验证层只发现该层直属文件，避免`platform/http/logic`被HTTP与逻辑project重复执行；按业务进一步分组时在验证层上方增加子功能目录。`*.test.ts/mjs` 只由 Vitest 发现；`*.native.test.mjs` 只由 Node 发现；`*.spec.ts/mjs` 只由 Playwright 发现。helper 放就近 `support/`，跨模块协议环境放根 `support/`，不进入测试发现。原生用例不能由 Playwright 再启动一次。

浏览器分片直接消费 Playwright 的 `--list --reporter=json`，不另存固定项目目录清单；配置按 `specs/<业务>/` 匹配，避免仓库路径碰巧含有业务名而重复发现。先完成同批构建，再执行发现和测试；不能同时运行会重建 Shared 的根 `check`。本地直接查看分片计划前也须先构建所需后端依赖。

各层报告、Node数据库及协议产物统一用 `NEXUS_TEST_ARTIFACT_DIR` 指定，不保留旧Agent/复数别名；缓存使用 `NEXUS_TEST_CACHE_DIR`。真实应用夹具使用独立数据根，浏览器数据根使用 `NEXUS_E2E_DATA_ROOT`。运行前为本轮设置明确的任务目录，保留首次失败和未知结果证据，不把报告、数据库或生成包写入源码目录。

Linux 的 Chromium 临时目录须容纳实际 Unix socket 路径长度；任务产物目录较深时，为 `TMPDIR` 指定本轮独享的短目录，报告与数据库仍放明确产物根。路径限制来自底层 socket，不额外限制产品文件路径。

`cases/migration.json` 保留原测试源文件摘要、断言和场景去向。`framework-native` 仅表示已接入直接执行，`framework-vitest` 表示框架迁移，均不表示运行通过；本轮实测另见测试入口。当前326份旧来源及86个展开场景均有新owner，清单没有pending；两仓完整远程门禁已通过，准确身份与逐层结果见[测试基线](../doc/testing/E2E.md#当前验收基线)。

跨模块受控服务归 `support/protocols/`：`controlled-ssh-server.mjs`（ssh2故障控制）、`openssh-fixture.mjs`（真实sshd）、`desktop-server.mjs`（xrdp/TigerVNC）、`browser-server.mjs`（Chromium/CDP）。模型响应、插件仓库、部署页与ACP进程等可执行协议端也归此处；签包构建器归`support/plugins/`。桌面回归复用runner或本机预装的xrdp/TigerVNC，不再构建独立桌面Docker；`desktop-service-fixture.mjs`按需分配端口、X display和本轮目录，动态配置由服务脚本生成并保留日志/数据库；浏览器步骤仍归 `e2e/support/`。Actions提供运行机器和预装依赖的runner镜像，服务由这些脚本启动，常规回归不依赖公网测试主机。Playwright的`e2eServices`用例选项显式声明`ssh/desktop/browser/provider/plugins/deployment`；worker fixture按需启动并复用，先排空应用再关闭原服务。普通页面默认不启动外部服务。每个worker保留服务日志、启动与关闭耗时和退出状态；强制结束记为失败，失败数据库在下一次重置前归档保留。

`frontend-integration` 用 jsdom 执行真实前端组件/client，在独立Node Worker启动当前Backend成品，以Playwright APIRequestContext管理真实HTTP Cookie，不启动Chromium或Vite。前端故障注入不得污染后端的fetch、全局变量或SDK环境。需要特定安装政策的测试可通过夹具传入明确configuration与trustedProxies，在Worker使用正式createApp装配；需要独立核对凭据密文时，可在测试Worker安装中传明确encryptionKey，原默认仍为随机32字节，重启沿用原密钥。默认值不变，不新增产品测试接口。Vue、Pinia和Vue Router在Vitest中统一解析实例，避免pnpm不同peer上下文产生互不相同的注入标识。夹具支持URL和Request输入，保留完整请求字节及响应媒体类型；空200响应保留空流，与HEAD/204等无正文响应区分。响应按完整字节缓冲，只验证有界JSON/文本消费，不代替真实流背压、原生fetch取消、浏览器布局、IME或iframe隔离专项。框架总耗时包含服务准备和关闭；失败现场保留在当前任务目录。

真实前端工作区集成复用`support/protocols/frontend-workspace.mjs`：每例独立Node应用与SQLite、API cookie jar、实际WS和临时密钥的OpenSSH；通过正常HTTP配置连接与信任，不直接改业务存储。WS显式快照本次API身份，只证明客户端/后端/SSH交付，浏览器Cookie、Origin、绘制和IME仍由Playwright验证。

应用集成夹具沿用浏览器套件的120秒单例测试预算；5秒默认值已在合并运行中实际中断约6–7秒的SSH/文件场景。此预算不改变产品期限，不是等待固定时长。夹具注册框架收尾，超时也关闭原应用与sshd；`restart()`先正常关闭原应用，再使用同一SQLite文件和内存密钥重新装配，不复制活库或重置数据。

插件仓候选互操作通过`support/plugins/host-harness.mjs`作为本体test-artifact入口，共用真实应用/OpenSSH夹具，复用单独的`install-signed-app.mjs`普通签包安装流程。准确候选入口接收完整签包字节与身份，不复制App源码重签；复用安装需核对版本、发布者与归档hash。普通本体专项继续可用固定正式包，不将其结果当作新候选通过。完整Agent互操作测试归插件仓`tests/interoperability/agent/`，完整互操作及70项业务浏览器均归插件仓，已通过准确Host成品组合的完整远程门禁；Host不维护第二份插件业务用例。

CI以统一8个runner执行模块/协议/本体浏览器/插件互操作/插件浏览器，第1分片额外运行真实Docker及私有mount namespace的有限tmpfs/ENOSPC；仅该分片挂载Docker socket并授予必要挂载能力，其余分片不获取这些权限。质量作业只构建及签候选一次，质量和环境准备成功后才启动八个分片，直接复用准确成品，不轮询等待构建；根`test:all`仅串接本体检查，不包括插件仓及独立Docker部署smoke。插件业务浏览器通过公开`support/plugins/browser-config.ts`复用Host测试成品，页面helper在`e2e/support/agent-host/`，任务工程唯一归插件仓。

插件独立CI同样构建签包一次，再由八个容器执行Node互操作和Playwright原生分片，复用成功Host E2E的准确源码及不可变产物。逐片核对原生报告与组合，不能将发现、无场景分片或局部重跑当作完整覆盖。当前耗时及未达性能目标见测试基线。

CI的原生协议与模块/浏览器链重叠执行，浏览器两仓仍顺序启动，本体通用浏览器清除只属于插件候选的`NEXUS_TEST_PLUGIN_SET`；`scripts/e2e/run-test-shard.sh`只装配这两条链，框架继续负责发现、分片和断言。`metrics/`保留GNU time的CPU、墙钟与最大单进程RSS，外层shard和分层数据不能重复求和；cgroup内存峰值不等于聚合RSS。运行这些Linux CI脚本的本地回归需GNU time（默认`/usr/bin/time`，可用`NEXUS_TEST_TIME_COMMAND`指定）。

手动门禁的`dependency_cache=cold`关闭质量作业的pnpm依赖与静态检查缓存恢复；`warm`恢复正常缓存。两种模式都重跑全部测试，保留相同的预装runner镜像依赖；这不是清空OS页缓存、镜像层或公网服务缓存。严格对照必须核对同一源码、插件SHA、不可变runner digest及实际资源。

所有可替代的长短等待使用框架虚拟时钟，按H-22.1控制实际时钟owner。共享CI环境定义归`fixtures/runner/Dockerfile`；分层产物默认归`tests/.artifacts/`，模块与浏览器分别使用`modules/`和`browser/`；发现时创建产物根目录。Vitest缓存归`tests/.cache/vitest/`，不再沿用浏览器专用运行目录。独立插件门禁消费成功Host发布的不可变test-environment产物，沿用同一runner digest与指纹。

Playwright WebServer的完整stdout/stderr保存到本轮产物`webserver/{backend,frontend}/run-*/output.log`，成功/失败均随现有分片报告上传；进程组、健康检查和失败状态仍由Playwright持有。控制台仅保留测试步骤/结果及框架失败摘要，排查服务启动、重置与收尾时读取对应WebServer日志。

分片执行各阶段时，控制台仅显示阶段开始、结束、实际耗时、退出结果和日志位置；模块/协议/本体浏览器/插件互操作/插件浏览器的完整双流追加保存为本轮`logs/<phase>.log`，复用原报告上传。逐用例结果仍在原框架JSON/JUnit/HTML，失败、未知结果和取消状态不变；日志不截断，不再把两条链的全部输出tee到控制台。质量作业的报告器模拟失败单测输出按用户要求保留。

Runner的完整依赖定义见`fixtures/runner/Dockerfile`，内容指纹由`scripts/e2e/runner-image-info.mjs`计算；周标签和digest在每轮准备阶段固定，`latest`仅为便利别名。工作流清理必须保留成功main的Host构建、环境产物和runner闭包，策略见[维护架构](../doc/architecture/MAINTENANCE.md)。两仓Node版本固定且在互操作准备时核对。

`pnpm --filter @nexus-terminal/tests test:ingress`独立执行真实入口验证，须明确设置`NEXUS_PRODUCTION_BASE_URL`；报告默认归`tests/.artifacts/ingress/`，可用统一产物变量覆盖。发现用例不等于通过公网或生产验收。

Docker部署smoke由现有工作流单独构建生产镜像并验证Compose/健康契约。项目、镜像配置和数据库目录均隔离；失败保留`tests/.artifacts/docker-smoke/`的诊断、数据库及工作目录，清理失败使作业失败。上传仅包含诊断和失败数据，不包含`.env`临时密钥。成功时清除可重建工作目录。普通`test:all`不代替此作业或插件独立门禁。

`pnpm --filter @nexus-terminal/tests test:docs`在既有构建上运行完整本体浏览器并更新正式文档截图；使用统一产物根下独立`run-*`目录，失败保留报告与截图且不替换正式图片，不覆盖前次证据。未使用的旧Nginx profiling原型及重复截图核验脚本已移除，正式受控服务与截图入口继续保留。
