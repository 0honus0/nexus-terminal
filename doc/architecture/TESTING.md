# 本体测试体系

本文描述当前测试职责、入口与资源边界。执行结果见[测试入口](../testing/E2E.md)，固定版本的旧插件互操作证据见[历史记录](../testing/HISTORY.md)。旧 Agent、SDK、候选签包及互操作入口已随功能移除；后续插件体系另按[目标设计](AGENT_REFACTOR.md)实施。

## 1. 职责与范围

测试覆盖当前产品全部实际模块。正常产品流程归浏览器，异常/边界矩阵优先下沉到负责侧的逻辑、组件、HTTP或存储；真实协议、跨进程和浏览器特有故障保留必要集成证据。同一风险不在多层重复完整矩阵；测试发现不等于执行通过。

使用已有成熟框架，不构建测试 DSL、状态数据库、环境调度服务或第二套业务实现：

| 验证层                          | 框架与职责                                                              |
| ------------------------------- | ----------------------------------------------------------------------- |
| 纯逻辑、Shared、前端状态和组件  | Vitest projects/fixtures/hooks；Vue Test Utils 与 jsdom                 |
| HTTP及前端失败矩阵              | Fastify inject、MSW；消费真实路由、client、mapper与codec                |
| SQLite及真实Node/协议           | 原生 node:test，直接运行编译成品；不经Playwright再包装                  |
| 产品流程、布局、IME、浏览器资源 | Playwright Test，复用官方fixture、clock、APIRequestContext、trace与分片 |
| 报告                            | 框架JUnit/JSON/HTML及V8覆盖；不同层的数量和覆盖分母不相加               |

选型参考 Fastify 的注入测试、Backstage/Grafana 的模块与成品分离、VS Code 的逻辑与浏览器分层。版本以各 package.json 和锁文件为准，声明兼容不能代替实际运行。

## 2. 子功能与目录

```text
tests/
├── backend/<模块>/<子功能>/<验证层>/
├── frontend/<功能>/<验证层>/
├── shared/<域>/
├── tooling/<职责>/<验证层>/
├── e2e/
│   ├── specs/<功能>/
│   └── support/
├── support/
│   ├── http/                     # 实际应用、认证及HTTP/前端Worker夹具
│   └── protocols/                # OpenSSH、受控SSH、桌面和WS协议端
├── fixtures/runner/Dockerfile
├── cases/migration.json
├── vitest.config.ts
└── playwright.config.ts
```

`*.test.ts/mjs` 只归Vitest，`*.native.test.mjs`只归Node，`*.spec.ts/mjs`只归Playwright。Vitest项目只发现所属验证层，避免重复执行；新子功能放验证层上方。就近辅助代码归模块 support，跨模块服务归根 support，静态内容归 fixtures。失去产品owner的旧用例及专用夹具删除，不通过空断言维持数量。

`cases/migration.json` 保留仍有当前接收owner的历史来源摘要及映射，静态检查核对目标实际存在。它是归属索引，不表示测试通过。旧Agent测试不再要求本体提供接收者。

## 3. 依赖方向

逻辑测试直接调用真实owner；HTTP测试安装实际路由和应用；协议测试使用编译产物及受控真实服务；浏览器从公开产品入口操作。禁止测试自己复制另一份协议解码、业务状态机或完整宿主。

`frontend-integration` 在jsdom执行真实组件/client，独立Node Worker启动Backend，以Playwright APIRequestContext管理Cookie，不启动Chromium/Vite。前端mock不得污染后端fetch或运行时。Vue/Pinia/Router统一解析实例，避免peer上下文分裂。

普通文件、Docker与备份的协议测试使用管理HTTP配置SSH连接、密钥及主机信任；它们不依赖已移除的Agent安装。真实WS夹具复用生产协议。传输背压、IME、Cookie/Origin与绘制仍由对应真实边界验证。

## 4. 类型与转换

测试消费当前Shared、真实转换与安全失败，输入由协议边界严格解码。非法响应、晚响应、版本冲突、撤销、未知副作用和清理失败分别验证；不能把expected failure当flaky，也不能放宽断言掩盖真实故障。

生产对象、存储记录与技术句柄保持原边界。测试支持代码不新增产品专用端点。真实协议夹具只提供必要的可观察故障控制，不替代底层库语义。

## 5. 入口与安装

| 入口                                             | 职责                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| pnpm check                                       | Backend/Shared、测试配置与源码、ESLint、Frontend类型 |
| pnpm test:fast                                   | Shared、后端逻辑、前端逻辑/组件、tooling             |
| pnpm test:integration                            | 先构建Backend，再运行模块、原生协议和Docker模块      |
| pnpm test:e2e                                    | 构建应用/浏览器客户端，再运行Playwright              |
| pnpm test:e2e:isolated                           | 本地动态端口入口，不触发远程Actions                  |
| pnpm --filter @nexus-terminal/tests test:ingress | 明确指定实际入口的独立验收                           |
| pnpm --filter @nexus-terminal/tests test:docs    | 在已有构建上验证并生成文档截图                       |

定向验证使用框架原生筛选和文件入口。首次运行原生协议前构建Backend；浏览器分片计划依赖当前构建。Shared重建与依赖其dist的发现/执行不能并发。

受控SSH/OpenSSH、xrdp/TigerVNC由仓库脚本按需启动，Actions只提供机器和预装依赖的runner。Playwright的`e2eServices`明确声明ssh/desktop，普通页面不启动外部服务。每worker复用只读基础设施，可写目录、身份和故障状态独立；先排空应用再关协议端。

桌面使用预装服务及动态端口/X display，不逐例构建容器。真实Docker仅由指定分片访问socket，有限文件系统专项才授予必要mount权限，其余作业不继承。

## 6. 数据、事务与并发

每个真实应用使用独立SQLite与数据目录。重启先关闭原应用，再使用同库同密钥装配，不复制活库或重置未知结果。备份/迁移验证保留真实事务、FK、签名与恢复证据。

功能迁移用例按真实迁移函数定位前置链，验证对应数据与重启行为，不写死生产迁移编号、签名或当前最后一条迁移。通用迁移测试负责顺序、签名校验与重复执行；其中合成迁移的编号属于被测协议。

CI质量作业只构建一次Shared/Backend/Frontend及浏览器客户端，执行检查、快速层和格式；质量与共享环境成功后启动当前配置的8个runner，不轮询等待成品。分片验证来源、Node、应用成品摘要及runner依赖指纹，离线链接依赖，不重建应用。

每片并行两条进程组：原生Node文件并发2，模块完成后运行本体浏览器；第一片额外负责Docker和有限文件系统。任一链失败仍等待其他链收尾；取消通知两组并等待退出。框架持有发现、分片和断言，shell只编排、测量与汇总。

浏览器按Playwright发现清单及耗时估算分配，不另存固定场景目录。分片报告成功后才汇总和回写耗时，手动成功运行同样回写；源码前进时拒绝陈旧更新。截图只在明确请求且全部门禁通过后更新，保留PNG签名核对。

Runner统一使用latest；内容指纹覆盖Node/包清单/锁文件、Dockerfile、构建脚本、补丁和vendor。按周元数据刷新，digest只记录观测事实，不固定启动；相同依赖指纹不证明OS字节完全一致。产物按来源job真实执行周期选择不可变ID，部分重跑不能猜测新的attempt名称。

ESLint/Prettier用内容缓存，vue-tsc用官方增量检查。cold关闭依赖及静态缓存恢复，warm允许恢复；不缓存测试通过状态或数据库。性能目标和实测分开，不通过删断言、弱化故障或放宽产品期限提速。

## 7. 生命周期与失败

所有能替代的长短等待使用框架虚拟时钟，控制实际持钟进程；真实协议/进程退出等不能被定时推进冒充。断连、取消和提交未知不证明未发生副作用。首次失败、数据库、未知效果和清理证据保留，不能用baseline重置抹掉。

统一产物入口为`NEXUS_TEST_ARTIFACT_DIR`，缓存为`NEXUS_TEST_CACHE_DIR`；数据库、日志、报告、生成包不写入源码。Chromium Unix socket需要短临时路径时，为本轮单独设置TMPDIR，报告仍归任务根。夹具追踪启动、健康、退出与关闭，强杀/清理失败不能算成功。

Playwright持有webServer进程组、健康与失败状态，完整双流写入`webserver/{backend,frontend}/run-*/output.log`。各阶段日志保留在`logs/<phase>.log`，控制台只显示开始、结束、耗时、结果与路径。JUnit/JSON/HTML保留逐例结果，不静默截断日志。

Docker部署smoke单独构建生产镜像、执行Compose和健康契约，隔离项目、环境与数据库；失败保留日志和数据，成功清理可重建目录。上传不含临时.env密钥。普通test:all不代替部署smoke或生产入口验收。

## 8. 当前能力与验收

实际模块包括Access、Targets、Remote、Preferences、Operations与System，覆盖终端、挂起、文件/归档/传输、远程桌面、Docker/监控、认证、安全、外观、设置、诊断、备份与恢复。模块故障矩阵和浏览器正常流程按真实owner持续维护。

本次按用户要求不新增移除功能的测试用例；清除旧Agent用例及失效断言，确认剩余静态、构建、迁移与普通应用运行。历史两仓门禁只证明对应旧版本，新插件宿主及SDK尚未实现，也没有当前互操作门禁。
