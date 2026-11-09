# 测试与验收

本文只维护当前验收基线、可复用执行入口与证据判据。逐轮结果见 [历史验证索引](HISTORY.md)，Agent 任务设计见 [场景清单](AGENT_TASK_SCENARIOS.md)，当前未验和实施安排见 [PLAN](../PLAN.md)。产品操作与实现设计分别见 [USAGE](../USAGE.md) 和 [架构](../architecture/BACKEND.md)。

本体与插件已按[测试架构](../architecture/TESTING.md)完成Vitest/Node/Playwright分层迁移和两仓完整门禁。当前自动验收与既有实机证据分别记录，耗时目标未达及未验范围继续保留。

## 当前验收基线

本体[完整E2E42529604782](https://github.com/0honus0/nexus-terminal/actions/runs/42529604782)验证`ccd612d953ac725a04f087817493fdc5be332ae3`：质量、Docker部署smoke、八个测试分片及耗时汇总全部成功。原始报告核对模块236、原生协议848、ENOSPC5、Docker模块1及原生9、本体浏览器430、插件互操作54、插件浏览器70，全部一次通过，无测试跳过、重试、flaky或遗漏。快速层112文件275项，31.72秒。不同层不相加作为独立产品功能总数。

插件[独立Validate42533036672](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42533036672)验证`0ef2c76c7f35dc892e38fdb9510cc1059146534a`，绑定上述Host源码与不可变构建，质量及八分片全部成功。原生包报告有122个叶case和3个父测试组，Node计数125，另有Vitest5项；互操作54个叶case、浏览器70项全部一次通过。17份组合记录一致，准确绑定源码、Host成品、SDK及八签包。相对本体门禁使用的插件`9c1681e4`，新提交仅修改独立CI和测试说明，运行包源码与SDK不变；新候选仍完成独立组合验收。

本体整轮墙钟16分9秒，插件独立门禁5分53秒。3–5分钟整轮目标尚未达到；冷/热缓存同基线对照、CPU分钟及峰值RSS尚未完成。自然五分钟认证到期、两分钟SSH空闲、弱网与真实排空均保持。完整身份、首次失败及统计口径见[最终验收](HISTORY.md#测试重构最终验收与独立插件分片2026-11-08)。

当前正式插件组合保持Agent2.0.2、ChatUI2.0.1、Browser2.1.1、Agent工具2.1.0、MCP/ACP服务4.0.0及Remote/Integrations工具2.0.0；公开目录为[catalog-20261108-3](https://github.com/0honus0/nexus-agent-plugins/releases/tag/catalog-20261108-3)。本轮测试/CI重构未修改正式包运行源码，不重新发布相同不可变版本。Shared4.0.4与SDK4保持。

已有指定CDP `172.30.30.11:9223`、`https://api.honus.top`及本地9998前端的SDK4聊天、刷新恢复、三语市场和正式Agent工具设置验收继续作为对应产品版本的实机证据，见[历史记录](HISTORY.md#agent-设置归属与插件召回配置2026-11-08)。手机真机、真实模型效果、物理音画、介质故障与负载性能等未验范围见[PLAN](../PLAN.md#待验与外部依赖)。本轮不更新生产主机。

本轮[main amd64 dev发布42534310922](https://github.com/0honus0/nexus-terminal/actions/runs/42534310922)成功，来源`b527057ce80629627412a212e437f509cee97866`；相对被测提交仅增加CI耗时估算及文档/测试说明。`dev`与`sha-b527057ce806`摘要同为`sha256:05f9dd3ae7b49482447fc691aa1ca493f61d89d521d90ace6cf1bd48b6f7fc6f`。已只读核对唯一产品平台linux/amd64、manifest/config摘要及OCI revision/source，未拉取镜像层、未更新生产；最终发布记录补充提交只改文档。

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

Actions使用统一8个测试runner：每个分片将Node原生协议与“Vitest模块→本体Playwright→插件互操作→插件Playwright”链重叠执行，模块/原生按框架原生分片，浏览器按实际发现与历史耗时均衡；不再固定1个Backend与7个Browser。所有测试容器启用init回收孤儿进程，并以SYS_PTRACE检查真实OpenSSH句柄。第1分片单独挂Docker socket运行真实Docker协议/模块，同时持有限定的挂载能力，在私有mount namespace执行真实有限tmpfs的ENOSPC测试；其余分片不挂Docker socket或授予挂载能力。ENOSPC文件显式归第1分片，不依赖原生文件排序后的偶然分配。快速层、静态及插件独立测试在质量作业执行，成品Docker部署smoke单独执行；全部必需作业成功才算门禁通过。

八个测试runner仅在质量检查和共享环境准备都成功后启动；构建或检查失败不启动分片。产物直接解析并下载，无构建等待轮询。质量作业构建Host一次、签候选包一次，上传准确插件源码和包。分片复用绑定本次SHA/不可变artifact ID的同批成品，不重建；完整重跑与部分重跑遵循下文产物身份规则。插件独立Validate选择成功Host E2E的准确SHA和不可变构建产物；质量作业构建签包一次并执行包测试、浏览器发现与类型检查，八个容器分片恢复同批产物执行Node互操作与Playwright。开发签名私钥不分发给测试分片。测试环境归`tests/fixtures/runner/Dockerfile`，只预装Chromium headless shell及协议工具；成功Host发布准确SHA、镜像digest与依赖指纹，插件独立门禁消费同一不可变环境。分片离线链接匹配依赖，不回退旧镜像。Docker部署smoke仅构建生产镜像、等待Compose健康及读取真实HTTP契约，不装测试工作区或浏览器。两仓组合记录须绑定真实源码、成品和包摘要，不能引用旧harness的绿色结论。

浏览器使用正式Frontend构建的preview及真实Backend，每例独立数据库，外部协议服务按声明启动。`NEXUS_TEST_ARTIFACT_DIR`与`NEXUS_E2E_DATA_ROOT`指定任务证据/数据库；`NEXUS_E2E_SERVICE_ROOT`为受控SSH运行路径，默认使用短临时路径以保持Unix socket名称互不截断，timings记录对应runtime根。首次trace/截图/录像/日志及数据库保留，重试通过仍阻止CI通过。

按H-22.1，所有可替代的长短等待均使用所属进程的框架虚拟时钟：浏览器使用Playwright clock；后端认证、票据和租约推进Node MockTimers的Date；Workspace两分钟空闲推进实际回收定时器。产品期限与原断言保持，不能以页面快进代替后端或SSH完成。WS消息排序、真实SSH/传输及关闭等待明确回执、输出或资源状态；CPU/绘制性能、原生timer溢出和真实背压保留物理时序。专门弱网回归保留原带宽与延迟；进度回归使用真实8MiB文件、至少两个不同UI百分比及完整字节/SHA验证。

ACP取消验证工具取消、旧审批拒绝、禁止文件未生成及原进程实际退出；已确认收尾时要求应用正常关闭，不再强行期待旧`execution_unknown`。真实未知副作用仍保留围栏、数据库和具名失败，不能用重置抹掉。

应用成品解析、插件消费成功Host测试环境与耗时汇总均按当前运行对应最新 job 的实际执行时间、产物创建时间及名称前缀定位不可变产物 ID。GitHub 部分重跑会复制成功 job 并重写 ID/run_attempt，但保持原执行时间；因此复用原产物不能只按 attempt 名称匹配，也不允许回退到其它执行周期的产物。仅重跑失败分片或汇总作业时复用其余成功分片的原产物。耗时发现使用 github-script 的只读请求重试，下载使用官方 Action 的 token/REST 路径并保留摘要校验；任一来源失败、产物缺失、过期或重复均阻止汇总。产物选择逻辑回归 `pnpm test:fast`中的`tests/tooling/ci/logic/timing-artifacts.test.mjs`验证产物选择逻辑。

## 测试重构当前证据（2026-11-08）

`tests/cases/migration.json`记录326份旧来源、86个展开场景及38份资产的去向，没有pending；55处外仓替代owner已逐文件核对。旧入口、Playwright→Node包装和重复任务工程已移除，固定签包及来源锁定仍由真实消费者使用。迁移索引证明归属，完整报告证明执行；二者均需核对。

当前两仓完整门禁与耗时见上方基线。逐模块本地实测、生产缺陷修复、首次失败与逐轮远程结果统一见[分模块记录](HISTORY.md#测试重构分模块实测2026-11-08)及[最终验收](HISTORY.md#测试重构最终验收与独立插件分片2026-11-08)，不再在当前入口重复旧的待验表。

证据根为`/home/honus/nexus-task-artifacts/testing-restructure-20261108`：`delivery/`保留最终报告摘要和组合，`cleanup/archives.jsonl`登记归档路径、SHA256及完整tar比较结果。首次失败、数据库和未知效果证据已校验归档后移除展开副本；早期记录中的`/dev/shm/nexus-testing-20261108`和短临时路径通过此索引追溯。活动开发环境及无关资源不在清理范围。

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
