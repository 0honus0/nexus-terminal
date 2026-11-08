# 测试与验收

本文只维护当前验收基线、可复用执行入口与证据判据。逐轮结果见 [历史验证索引](HISTORY.md)，Agent 任务设计见 [场景清单](AGENT_TASK_SCENARIOS.md)，当前未验和实施安排见 [PLAN](../PLAN.md)。产品操作与实现设计分别见 [USAGE](../USAGE.md) 和 [架构](../architecture/BACKEND.md)。

本体与插件已按[测试架构](../architecture/TESTING.md)完成Vitest/Node/Playwright源码迁移和双仓CI接线，最终全量门禁仍待验证。下列发布/远程基线属于迁移前版本，不证明当前工作区全量通过。

## 当前验收基线

最新完整远程 [E2E42465732392](https://github.com/0honus0/nexus-terminal/actions/runs/42465732392) 验证main/21e36a7b7da73f65470a8b5c4d52a6aca83f4a45：正式矩阵758项全部一次通过（Backend223、Browser535），质量、双端构建、Docker smoke、八个分片及耗时汇总成功。逐项核对原始Reporter记录与正式清单，无失败、重试、flaky、场景跳过或遗漏；本轮覆盖迁移65、插件召回配置、MCP/ACP入口归属、编辑器安全围栏和备份导出导入。首次失败与取消记录见[本轮记录](HISTORY.md#agent-设置归属与插件召回配置2026-11-08)。

最新[main amd64 dev发布42467733089](https://github.com/0honus0/nexus-terminal/actions/runs/42467733089)来源1a32d09771d31365072b986ab83c7957c18c3ce2，相对被测提交只增加CI自动更新的测试耗时估算。`dev`与`sha-1a32d09771d3`摘要均为`sha256:127e73e3cd5e679dabc01438e48c9c2baf4f2a685fa594b0ac5751855e0d95f1`；已只读核对唯一产品平台linux/amd64、manifest/config摘要及OCI revision/source，未拉取完整镜像。完整[发布记录](HISTORY.md#agent-设置归属与插件召回配置2026-11-08)保留；本轮文档收口另行提交，无行为变化。未更新生产主机。

官方Agent工具已发布 [2.1.0](https://github.com/0honus0/nexus-agent-plugins/releases/tag/tools-agent-v2.1.0)，签包源码40515740606254ed9398d15830cce150a4e1c8a8；插件仓最新main为31173d7064d7d5a6a7aba5ee752b91230ae5bbc3，[Validate42464714350](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42464714350)成功。本地完整check/build/格式通过，八包85项独立测试和最终22项仓库测试全过。其余组合保持Browser2.1.1、Agent2.0.2、ChatUI2.0.1、MCP/ACP服务4.0.0及Remote/Integrations工具2.0.0。公开latest目录[catalog-20261108-3](https://github.com/0honus0/nexus-agent-plugins/releases/tag/catalog-20261108-3)保留全部14个不可变版本及三语元数据，旧13条逐项保持不变。Shared4.0.4同步移除Host召回偏好，SDK4沿用现有配置与locale能力，未新增语言RPC。

指定CDP `172.30.30.11:9223`、`https://api.honus.top`与本地9998前端完成正式Agent工具2.1.0的英文1440px、中文320px和日文390px设置保存、800/320/390条及1048576字节读回、无横向溢出和零pageerror验收。公开下载曾返回503，CDP安装改用同一正式签包的本地测试源，归档字节/签名/摘要不变；公开网关可用性不属于该安装证据。此前正式Browser2.1.1安装、三语市场、实例设置及SDK4聊天的证据仍见[历史索引](HISTORY.md)。首次全目录独立Node探测889项的173失败、8取消不作为正式矩阵通过证据。手机真机、真实模型效果、物理音画、介质故障及负载性能等未验边界仍见[待验与外部依赖](../PLAN.md#待验与外部依赖)；受控协议和浏览器回归不代替这些实测。

## 阶段逻辑回归

先按 PLAN 决定项核对本批授权和真实受影响调用链，再选择验证；D17 的默认路径为源码审核、静态检查后按明确授权执行远程 GitHub Actions。下列命令是入口说明，不表示本批已经执行或获得额外测试授权。

| 检查             | 入口与范围                                                                                                                                                             |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态与构建       | 根目录 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check`、`git diff --check`；纯文档可只运行受影响 Markdown 格式、链接及 diff 检查。                     |
| 快速层           | `pnpm test:fast` 直接运行Shared、后端纯逻辑、前端状态与组件，不需要应用构建。                                                                                          |
| 模块集成         | `pnpm test:integration` 构建Backend/SDK后直接运行Vitest存储/HTTP、前端真实HTTP集成和Node原生测试。模块按新入口执行，完整原生结果以当前CI为准。                         |
| 浏览器产品流程   | `pnpm test:e2e` 构建应用与测试客户端后运行Playwright；配置为`tests/playwright.config.ts`，业务用例按功能归`tests/e2e/specs/`。                                         |
| 定向模块         | `pnpm --filter @nexus-terminal/tests exec vitest run <文件或筛选词>`；Node模块使用`node --test tests/backend/<模块>/<层>/*.native.test.mjs`。先核对构建与fixture要求。 |
| 动态隔离端口入口 | `pnpm test:e2e:isolated -- <Playwright参数>` 调用本地 `scripts/e2e/run-remote.mjs`，为服务分配独立环回端口后运行 Playwright；这个名称不表示会触发 GitHub Actions。     |
| 远程 Actions     | `.github/workflows/e2e.yml` 及其实际引用脚本；每轮记录 run URL、提交 SHA、分片结果、首次失败与重试，不跳过失败场景换绿。                                               |

回归覆盖正常流程、授权/身份变化、冲突、取消、未知提交/执行、晚返回及资源关闭；按真实 owner 判断结果，不能从本地等待结束推断远端停止。每项证据注明环境、命令、输出、覆盖和未验范围，实机/外部依赖不能用静态或协议夹具代替。专用环境与产物保留至用户通知清理，凭据不进入文档或日志。

## 分组、隔离与产物

唯一测试workspace为`tests/package.json`（`@nexus-terminal/tests`）。`*.test.ts/mjs`由Vitest直接发现，`*.native.test.mjs`由Node直接发现，`*.spec.ts/mjs`由Playwright发现，不互相包装。快速层无需浏览器；实际IPC/签包/Worker仍需Backend/SDK成品，浏览器层另需Frontend与测试客户端。根`test:all`当前串接静态、构建和以上三层，只执行本体自动测试，不能代替两仓组合与独立Docker smoke完整门禁。

Actions使用统一8个测试runner：每个分片依次执行Vitest模块、Node原生协议、本体Playwright、插件互操作和插件Playwright，模块/原生按框架原生分片，浏览器按实际发现与历史耗时均衡；不再固定1个Backend与7个Browser。所有测试容器启用init回收孤儿进程，并以SYS_PTRACE检查真实OpenSSH句柄。第1分片单独挂Docker socket运行真实Docker协议/模块，同时持有限定的挂载能力，在私有mount namespace执行真实有限tmpfs的ENOSPC测试；其余分片不挂Docker socket或授予挂载能力。ENOSPC文件显式归第1分片，不依赖原生文件排序后的偶然分配。快速层、静态及插件独立测试在质量作业执行，成品Docker部署smoke单独执行；全部必需作业成功才算门禁通过。

质量作业构建Host一次、签候选包一次，上传准确插件源码和包。分片复用绑定本次SHA/不可变artifact ID的同批成品，不重建；完整重跑与部分重跑遵循下文产物身份规则。插件独立Validate选择成功Host E2E的准确SHA和构建产物，执行自己的全部分层。两仓首次接线需要先有新Host门禁成功，之后复验插件Validate，不能引用旧harness的绿色结论。

浏览器使用正式Frontend构建的preview及真实Backend，每例独立数据库，外部协议服务按声明启动。`NEXUS_TEST_ARTIFACT_DIR`与`NEXUS_E2E_DATA_ROOT`指定任务证据/数据库；`NEXUS_E2E_SERVICE_ROOT`为受控SSH运行路径，默认使用短临时路径以保持Unix socket名称互不截断，timings记录对应runtime根。首次trace/截图/录像/日志及数据库保留，重试通过仍阻止CI通过。

验证验证码 SDK 过期使用 Playwright 官方虚拟时钟；后端票据和缓存 TTL 使用 Node 内置 MockTimers 仅推进 Date，不改变产品超时或网络定时器。专门弱网回归保留原带宽与延迟；成功传输的进度回归使用真实8MiB文件及至少两个不同UI百分比、完整字节和SHA验证，以较高夹具带宽减少人为等待。SSH 空闲两分钟仍用真实时间，独立场景与拆分后的 Agent 回归按实测耗时分片，保持原功能覆盖。

ACP取消验证工具取消、旧审批拒绝、禁止文件未生成及原进程实际退出；已确认收尾时要求应用正常关闭，不再强行期待旧`execution_unknown`。真实未知副作用仍保留围栏、数据库和具名失败，不能用重置抹掉。

构建等待与耗时汇总均按当前运行对应最新 job 的实际执行时间、产物创建时间及名称前缀定位不可变产物 ID。GitHub 部分重跑会复制成功 job 并重写 ID/run_attempt，但保持原执行时间；因此复用原产物不能只按 attempt 名称匹配，也不允许回退到其它执行周期的产物。仅重跑失败分片或汇总作业时复用其余成功分片的原产物。耗时发现使用 github-script 的只读请求重试，下载使用官方 Action 的 token/REST 路径并保留摘要校验；任一来源失败、产物缺失、过期或重复均阻止汇总。产物选择逻辑回归 `pnpm test:fast`中的`tests/tooling/ci/logic/timing-artifacts.test.mjs`验证产物选择逻辑。

## 测试重构当前证据（2026-11-08）

源码迁移已完成：`tests/cases/migration.json`记录326份旧来源、86个展开场景及静态资产去向，没有pending来源；来源摘要与替代文件由`pnpm check`核对。完整Agent机制与插件业务浏览器测试归独立插件仓，本体只保留通用Host边界。逐模块实测与首次失败见[历史记录](HISTORY.md#测试重构分模块实测2026-11-08)。映射完整不等于最终门禁通过。

本轮任务证据根为`/home/honus/nexus-task-artifacts/testing-restructure-20261108`；近期运行在`/dev/shm/nexus-testing-20261108`。以下均为本地分组结果，不合并冒充同一轮全量PASS：

| 验证层             | 实际结果与证据目录                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 本体快速层         | `fast-final-layout`：111文件268项通过，双worker完整26.41秒；此前内存压力下的2项超时保留在`fast-refactor-final`，隔离及完整复验通过。                                                                                                   |
| 本体模块层         | `host-modules-final-isolated`：101文件236项通过，双worker357.94秒。                                                                                                                                                                    |
| 本体浏览器代表链路 | `host-browser-structure-final`：认证、趋势、沙箱SDK、UI独立更新、触屏生命周期共10项通过，1.9分钟；并发内存压力下的测量不作为稳定性能基线。                                                                                             |
| 本体原生协议       | 各模块结果见历史；`host-native-audit-current`全目录探测曾有12项失败/取消，分别在`native-failures-resume-current`、`upload-enospc-final`、`suspend-lease-cleanup-current`、`modular-protocol-current`修复并复验。最终全量以新CI为准。   |
| 插件真实Host互操作 | `plugin-interop-complete-current`：54 testcase全部通过，使用准确签包及真实应用、权限与资源收尾。                                                                                                                                       |
| 插件浏览器         | `plugin-browser-full-after-repairs`：70项中67通过、3失败，12.3分钟；后续`plugin-browser-three-repaired`两项通过、关闭同名App定位失败，`plugin-checkpoint-final`修复后1项通过，13.1秒。保留每轮失败，不把分批结果写成完整70项一次通过。 |
| MSW协议修正        | `msw-contract-final`：7文件23项通过，3.51秒，使用当前MSW的`onUnhandledFrame`。                                                                                                                                                         |
| 仓库维护           | `maintenance-final.log`：22项通过，142.8ms；用例已从scripts移入tooling。                                                                                                                                                               |

> 首轮新CI[42518923481](https://github.com/0honus0/nexus-terminal/actions/runs/42518923481)失败，不能作为新架构完整通过证据。已定位容器Git真实路径信任、进程回收/句柄观测/挂载条件、受控SSH关闭后写入、监控响应正文读取时序，以及生产Workspace正常关闭被授权扫描提前断开的缺陷；修复与实测见[远程首轮收敛](HISTORY.md#测试重构远程首轮收敛2026-11-08)。

最终本体`check-final-layout.log`、`build-final-layout.log`和`formatcheck-final-docs.log`通过，插件check/格式、5项Vitest与125项Node测试通过；本体浏览器430项、插件70项发现无错误。仍待同基线远程全量和冷/热耗时回填。3–5分钟是同等8个测试runner下的优化目标，当前未证明达成；自然五分钟认证到期、两分钟SSH空闲和真实弱网/排空不为目标缩短。

## 数据库迁移验收

按 H-21，每条数据库变更独立迁移，dev 与 latest 使用同一版本链；下列为各条迁移的验收要求：

- 从上一发布数据库按顺序执行新增迁移，与空库安装结果核对结构、约束、数据语义和签名；验证完整性、外键与数据保留。
- 连续升级不同 dev 构建、跨多个迁移版本升级及重复启动，确认已应用版本被跳过、签名不匹配被拒、后续变更独立追加；已执行或已发布的迁移及记录不原地改写或合并。
- 验证 SQL/脚本完成旧数值、单位与 JSON 转换，业务读取及解码只接受当前格式；核对 CHECK、关联版本、内容 hash 与快照恢复边界。
- 验证迁移与版本记录同事务提交、失败回滚、提交未知核对及恢复，失败不能写入成功标记，未知结果不能盲目重放。

## 证据与资源管理

- 每轮记录精确源码 SHA、工具链、命令、输出位置、正常与失败范围；首次失败和重试都保留。CI 任务 success 不替代逐项 Reporter 核对，测试 skip 不能算通过。
- 完整验收包含模块、原生协议、两仓浏览器、插件互操作、质量与Docker smoke；截图更新任务按条件跳过不等于测试场景跳过。仅文档修改执行受影响格式、路径/锚点和 diff 检查，不为文档运行行为测试。
- 真模型效果、真实目标/介质故障、手机真机与模拟 Provider/协议 fixture 分开记录；不能用静态构建或微基准声称端到端通过。
- 专用环境和精简产物放在明确归属的本地任务目录，保留至用户通知；凭据不进入文档、日志或截图。清理只操作已确认属于本轮的资源，保留数据、未知副作用与收尾证据。

## 文档截图

截图存放在 `doc/imgs/e2e`，由正式 E2E 的 `refresh_screenshots` 输入和截图夹具生成，不能手工伪造通过状态。图片是特定版本的视觉记录，不能替代当前源码或交互测试。生成脚本仍消费的截图即使未在正文引用，也不按孤立文件删除。
