# 历史验证索引

本页供检索旧验证，不是当前操作手册或施工计划。当前基线、命令和判据见 [E2E](E2E.md)，未验任务见 [PLAN](../PLAN.md)。每项链接固定到整理前提交的完整原始记录，保留当时 SHA、环境、命令、测量、失败、日志路径与清理边界；旧文中的“当前”“下一步”“尚未提交”只属于当时，不授权继续旧操作。

已退役 Runner/Guacamole 的证据仅用于追溯，不能证明当前 SSH/CDP/浏览器 SDK 的行为。静态、受控 fixture、真实服务与真机结论分别判断。

## 必需插件启用引导与权限折叠验收（2026-11-09）

本体基于`f153bcbc27ab2b7dd510b42bd06d6e59b8b0ffbb`、插件仓基于`d00f12315c12de06fe830370178987ffff4208b5`的本地工作区。用户授权同时实现安装引导与权限展示；本批未提交、推送、发布或部署，不替换正式远程基线。Node26.13.0、pnpm12.16.1；全部专用环境、签包、私钥、首败日志及截图归`/home/honus/nexus-task-artifacts/agent-market-layout-20261109/required-onboarding`，凭据不进入源码或截图，保留至用户通知。

| 功能对应 | 实际入口与结论                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首次启用 | AgentSettingsPanel经prepare/install发现全部必需包；签名manifest和目录声明一致，宿主不写死包ID。安装完整集合并按contract组合App/UI/roots后才开启总开关。 |
| 安装恢复 | 已安装包复用；取消不安装，部分成功保留，失败重新准备。来源失败、集合缺失、签名不符或CAS失效明确拒绝；不持久化安装流程，不自动重放未知写入。             |
| 权限展示 | 安装确认和App安全策略共用六类折叠组件；默认只见分类/数量，展开后显示名称、说明和技术ID。逐项与批量编辑仍沿原授权保存入口。                              |

| 职责归属       | 审核结论                                                                                                                                                                                                  |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 声明与发现     | 签名包声明requiredOnEnable，目录作发现，RepositoryService编排原安装、组合和版本用例；兼容性、依赖闭包、信任与完整绑定在就绪判断中核对。                                                                   |
| 初始授权与并发 | PluginService/Model/SQLite持真实组合及CAS；新App按声明授权，已有App保留授权与启停。首个安装前校验全批，仅本批已确认修订可代替自身改变的安装前提；包写入与总开关不假称原子事务。                           |
| 前端与生命周期 | onboarding operation持活动视图及未知写入围栏，共用展示组件不持授权状态。实际浏览器发现撤销权限后草稿数组含嵌套Vue代理，保存时structuredClone抛错；useAppGovernance改为逐字段快照，补回归并验证保存/刷新。 |

| 类型归属         | 消费者与边界                                                                                                                                                                                   |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| manifest/catalog | Shared持可选布尔声明，签包Adapter、存储、Model、HTTP、Frontend逐字段投影；未声明即非必需，无旧ID推断，无新数据库迁移。                                                                         |
| prepare/install  | Shared onboarding/codec持完整联合与关联验证，两端保留内部model和白名单mapper；旧recommended端点、类型及出口移除。                                                                              |
| SDK与发布工具    | Shared4.0.5最终源码/编译摘要与导出归档核对一致，插件实际装载的onboarding codec与本体dist逐字节一致；Agent与Chat源码版本2.0.3声明必需，其余六包仍可选。签包及目录聚合保留字段并拒绝元数据篡改。 |

| 完成证据   | 实际执行及范围                                                                                                                                                                                                                                                                                              |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 源码/静态  | 根check、全量build、最终Backend类型/构建、全仓格式与diff通过；插件仓check、App/UI构建与diff通过。无新增固定数量/深度/期限限制。                                                                                                                                                                             |
| 快速/协议  | 契约、组合规则、权限组件及草稿保存12项通过（1.06秒）；真实HTTP/SQLite/签包及仓库故障46项通过（6.88秒）；前端设置真实HTTP集成2项通过（5.39秒）。插件仓发布工具17项通过（1.86秒）。各层不相加冒充独立产品功能总数。                                                                                           |
| 浏览器回归 | onboarding两项通过（7.0秒）。扩展Agent宿主组初轮19项中16通过：两项缺少本地专用browser-clients构建，一项总开关用例仍假设旧推荐流程；补构建并以真实签名必需App事实隔离ready响应后，三项定向复验全部通过（12.0秒）。本轮未运行完整远程矩阵。                                                                   |
| 指定CDP    | `172.30.30.11:9223`访问`https://api.honus.top`的9998测试前端及独立SQLite，使用真实本地可信签名源安装Agent/Chat2.0.3；取消无安装、完整组合后启用、新App全授权、权限编辑保存/刷新、再次启用保留绑定/授权均通过。320/390/1440px引导及权限无横向溢出；截图为onboarding-390.png、permissions-390.png及展开版本。 |

主要日志为`delivery-check.log`、`delivery-build.log`、`delivery-backend-build.log`、`delivery-fast.log`、`delivery-protocols-retry.log`、`settings-integration.log`、`plugin-check.log`、`plugin-repository.log`、`playwright-final.log`、`playwright-delivery.log`、`playwright-host-fixed.log`及CDP结果JSON。首轮测试端口占用、缺少本地浏览器、未创建原生测试产物父目录与截图脚本错误显示名均保留首败，修正环境/脚本后复验，不放宽产品条件。手动中断整个后台进程组曾同时中断插件进程并产生关闭未知日志；随后正常总开关关闭/重启恢复及协议关停回归通过，不将强制中断记录当作正常关闭成功。

提交发布追加授权后，首次远程[Host42613882980](https://github.com/0honus0/nexus-terminal/actions/runs/42613882980)在快速层353项中1项失败：signed-registry旧断言未包含解码器新增的可选requiredOnEnable字段（undefined）。同步明确输出断言后，原签名/namespace/schema拒绝断言保留，定向1项253ms通过；完整门禁待后续成功轮回填。首败日志为publication/host-first-quality.log。

第二轮[Host42614414918](https://github.com/0honus0/nexus-terminal/actions/runs/42614414918)质量/smoke及7个分片通过，第6片performance-settings旧用例在只安装App后期待直接启用，实际进入新必需集合引导，首次和重试均失败。该用例改用真实Host先启用，验证关闭总开关的原CAS/持久设置；所有原校验、写入次数、刷新及弃用字段拒绝断言保留，首次启用仍由独立onboarding/host用例覆盖，不修改产品UI或旁路权限。本地整份performance-settings四项首次通过（13.9秒），格式/ESLint/diff通过。首败日志及原始ZIP为publication/host-second-failed.log、host-second-shard6.zip。

公共官方目录尚未交付本轮required声明；上线此引导需随后续授权发布插件及更新目录。本轮CDP使用本地开发签名，不冒称官方发布签名通过；真实手机键盘、供应商模型效果和完整远程门禁仍不由本轮专项代替。

## Agent扩展与插件市场布局验收（2026-11-09）

基于本体`5729b178`后的本地工作区；最终布局已由用户确认并授权本地提交，不推送、发布或部署，不替代正式远程基线。用户授权启动测试环境与指定CDP截图，环境为Node26.13.0、pnpm12.16.1；独立SQLite、日志、脚本和截图归`/home/honus/nexus-task-artifacts/agent-market-layout-20261109`，保留至用户通知。

| 审核表         | 结论                                                                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应       | App与扩展的三个页签等分铺满；插件卡片按标题/说明/版本操作三层排列，手机单列、宽容器两列；保留安装、校验、信任及保留数据操作。            |
| 职责归属       | 布局归AgentExtensionsSettings与PluginRepositorySettings；版本与动作统一消费Foundation的comfortable密度，无基础组件高度覆盖或跨功能状态。 |
| 类型与边界     | 无Shared、SDK、Backend、SQL或迁移变化；原版本选择、操作条件及事件绑定保留。                                                              |
| 生命周期与证据 | 无新增请求、缓存或监听；原活动页签、写入围栏与恢复流程保留。指定CDP矩阵及真实签包校验通过，最终截图已由用户确认。                        |

- `check-final.log`、`frontend-build.log`、`format-all.log`及diff检查通过；前端构建3.68秒。原三条本地化E2E场景补充三页签等宽与铺满断言，本轮仅类型检查，未运行正式远程E2E。
- `layout-results.json`：在`https://api.honus.top`通过`http://172.30.30.11:9223`连接真实浏览器，实际加载官方目录8个包；320/390/820/1440px各深浅主题，加英语320px及日语390px，共10组通过。验证无页面/卡片横向溢出、页签等分满宽、版本选择与动作等高，中文手机端同排；1440px显示两列。浏览器pageerror为0，未模拟接口或改写DOM截图。
- `actions-results.json`：搜索、来源折叠及三个页签切换通过；版本菜单可打开并取消，真实官方签名包校验成功进入确认弹窗并取消，没有安装插件。`mobile-review.png`、`light-1440.png`、`dark-390.png`供审核。真实手机触摸、第三方信任、安装/升级和多操作组合不由本轮截图代替。
- 首轮发现设置页默认按钮高度覆盖造成选择器与动作高度不同，改用两者现有comfortable密度统一为36px；根check发现删除重复计数后遗留props绑定，已清除。补充折叠检查首次点击落到组标题内的复制URL按钮，修正定位为来源名称后通过，首次日志`cdp-actions-first.log`保留；产品复制/折叠语义未修改。

用户随后明确指出手机端卡片外侧空白偏多。本轮按真实祖先尺寸确认页签、仓库、分组三层padding叠加，在原24rem窄容器分支取消后两层横向缩进，仓库标题/搜索/卡片共用左右对齐线，保留卡片内部12px留白；390px下卡片起点由51px变为25px、宽度由280px变为332px，320px下由210px变为262px，宽容器原间距保持。更新USAGE与前端设计，证据位于原目录的`alignment-review`，原截图保留。10组CDP矩阵、真实签包校验及取消再次通过；根check、前端构建（3.63秒）、全仓格式和diff通过。搜索/分组/页签操作及左右对齐断言见`cdp-actions.log`。检查重建Shared产物期间误并发重载开发页造成两次操作脚本失败，已保留首次日志并重启本次Vite、待构建完成后复验；无产品逻辑变更。该阶段截图保留，后续按最终确认收口。

用户进一步要求移除贴近卡片的外框：AgentExtensionsSettings去掉整体面板边框，保留独立圆角页签；PluginRepositorySettings移除仓库及来源分组装饰底色，仅保留插件卡片边框与原内部留白。无状态、请求、协议或事件变化，USAGE/前端设计已同步。`outer-frame-review`保留新截图与独立证据：10组CDP宽度/主题/语言矩阵和真实签包校验取消通过，搜索/折叠/页签及左右对齐再次通过；前端类型检查及生产构建通过（3.48秒），格式/ESLint与diff检查通过。本轮未运行正式远程E2E，后续按最终确认收口。随后按用户要求将官方URL收进原紫色徽标的原生复制按钮，不单列地址；第三方来源原样保留。`official-url-review`验证320/390/1440px无溢出、徽标仍为18px高，实际剪贴板点击/Enter/Space均复制完整地址，展开及折叠状态下均不触发分组切换；保留原徽标样式、复制失败反馈及键盘焦点。前端类型/构建、格式/ESLint与diff通过，更新后的截图同目录保留。

## 登录入口与常驻缓存验收（2026-11-09）

基于`98434f16`后的本地工作区；未提交、推送、发布或部署，不替换上方正式远程基线。Node26.13.0、pnpm12.16.1；证据归`/home/honus/nexus-task-artifacts/workflow-consolidation-20261109/oidc-binding-login-options-20261109`，首次失败、数据库和报告保留至用户通知。

| 审核表         | 结论                                                                                                                                                                                                                        |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应       | 删除OIDC独立显示开关，绑定显示、解绑隐藏；Passkey注册显示、最后删除隐藏；无可用方式隐藏分组。登录页只读取一次聚合公开选项，其余布局/CSS保持。USAGE/API/部署说明同步。                                                       |
| 职责归属       | Platform ResidentCache复用lru-cache原生异步fetch去重与取消；LoginOptionsModel持展示快照和失效政策，实际写入Model通知；SQL仍归Adapter。正常关闭、初始化失败和恢复替换均纳入原模块生命周期。                                  |
| 类型与边界     | LoginMethods、存储公开名称记录与Shared聚合响应分别由真实owner持有，边界逐字段投影；双端、严格codec、设置/三语、协议与浏览器用例同步。迁移66独立删除enabled，历史迁移保持原样，无旧协议兼容。                                |
| 生命周期与证据 | 缓存命中不重复读取OIDC/Passkey元数据；并发冷读合并，false/null/undefined保留。失效拒绝迟到回填；失败可重读；未知提交失效但不重放；关闭拒绝新读并排空当前和已失效loader，重入共享同一Promise。实际认证与来源准入仍实时校验。 |

- `targeted-tests-json-fix.log`：Vitest10文件52项全部通过，总14.83秒；覆盖真实签名OIDC三种认证、设置组件真实HTTP绑定/保存/解绑、10并发缓存命中、空库延迟部署初始化、未知提交、公开codec及正式LoginPage单次请求。新增关闭重入和失效loader排空后，`cache-closure.log`9项通过，case合计10毫秒、进程132毫秒；相对52项增加1个独立case，不将重跑相加冒充覆盖数。缓存测试全部使用Promise屏障，无真实时间等待。
- `native-tests-json-fix.log`：8项通过，Node总3.10秒。实际WebAuthn none-attestation验证4种AAGUID命名、注册后显示、删除一个但仍有另一个时保持显示、最后删除后隐藏；两个既有Agent迁移专项继续验证数据保留、重启与回滚，不再硬编码整个应用最终迁移版本。
- `check-complete.log`、Backend `backend-build-json-fix.log`、Frontend `frontend-build-complete.log`及Shared构建通过，全仓`format:all:check`与`git diff --check`通过。本轮不启动Docker、不触发正式远程CI，不声称浏览器或真实Pocket ID已验。
- 首轮45项中1项因SQLite无原型行与普通对象的深比较夹具失败，已改为同类查询结果比较。后续定向52项首次发现聚合接口自定义serializer未明确JSON类型，已修正并保留成功响应/前端读取断言；两条新增组件用例补齐jsdom缺少的matchMedia。首次原生日志`native-tests-complete.log`中原认证专项的Chromium子场景因本机未安装匹配headless shell失败，其余10个子场景通过；Passkey命名项当时亦被上述响应类型问题阻断，最终独立回归已通过。环境首次调用`/usr/bin/time`不存在，改用shell time记录，不调整测试断言。

正式浏览器用例已同步OIDC绑定即显示、解绑隐藏、Passkey最后删除隐藏、旧端点不再请求，以及无额外登录方式时的既有主题/六视口几何断言；尚未执行。真机、外部提供方、线上负载及完整恢复故障组合继续保留于PLAN，不由本轮静态或模块回归替代。缓存只承诺上述元数据命中不查库，不承诺整页无SQL或未经测量的QPS提升比例。开源选型、Gitea页面参考与原始维护核对文件同目录保留。

## OIDC Compose环境变量验收（2026-11-09）

本轮在`98434f16`后的本地工作区实现；未提交、推送或部署，不改变现有远程基线。Node26.13.0、pnpm12.16.1；证据归`/home/honus/nexus-task-artifacts/workflow-consolidation-20261109/oidc-environment-20261109`，保留至用户通知清理。运行配置沿用v4表，无新增迁移。

| 审核表   | 结论                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 六个NEXUS_OIDC变量自动配置并启用；显式sub可直接绑定已有管理员，省略时保留同提供方绑定或要求页面绑定，不信任首个SSO用户。USAGE/DEPLOYMENT和.env示例同步。 |
| 职责归属 | Bootstrap解析环境，register转换安装契约，OidcModel拥有配置与幂等，SQLite Adapter事务更新并撤销关联OIDC会话；无Shared/HTTP/UI变化。                       |
| 类型归属 | 安装、内部应用、存储配置分别归register、model、storage，逐字段转换；Issuer校验复用原owner，无新增无依据容量限制。                                        |
| 完成证据 | 定向4文件30项通过，根check、Backend生产构建、全仓格式、Compose静态配置与diff检查通过；本次不启动Docker，不触发正式远程全量或真实Pocket ID验收。          |

定向命令为`pnpm --filter @nexus-terminal/tests exec vitest run backend/platform/bootstrap/logic/oidc-environment.test.mjs backend/access/oidc/storage/transactions.test.mjs backend/access/oidc/http/environment.test.mjs backend/access/oidc/http/flow.test.ts`：总11.81秒；解析8项6毫秒、存储7项1.351秒、部署HTTP1项1.042秒、原协议HTTP14项9.8秒。覆盖三种认证、精确密钥、空变量/缺项、首次管理员、绑定保持/重置、真实签名登录、其他主体拒绝、重启保留登录、密钥轮换撤销及提交未知不重放。无时间等待可替换为虚拟时钟。

初始化共用Promise；无管理员时延后，失败或提交未知保留拒绝，不自动重放。相同配置保留revision/会话，变化才撤销OIDC会话与流程，普通登录保留。环境变量按每次启动应用，页面仍可修改当次配置，删除所有变量后由页面管理，部署文档明确优先关系。静态首次发现5处函数空行问题已修正；Compose首次原始输出比较未归一`config`的`$$`序列化，已校正验证断言，并同时核对插值源保留字面`$`；无产品绕过。首次与最终记录保留在工具记录及证据目录，原30项逻辑均未修改。真实提供方、浏览器组合及远程全量以另行执行结果为准。

## Agent 设置归属与插件召回配置（2026-11-08）

主代理独立完成本体与 `0honus0/nexus-agent-plugins` 两仓修改，环境为 Node26.13.0、pnpm12.16.1。本轮产物归 `/home/honus/nexus-task-artifacts/agent-settings-ownership-20261108`，保留测试现场和首次失败；不更新生产主机。

| 审核表   | 本轮结论                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能对应 | 移除独立MCP/ACP设置页，协议连接从对应已安装插件的设置进入；召回条数、字节偏好迁入Agent工具插件，每个App/实例独立保存。模型、权限、执行预算、并发和宿主资源保留仍归Host。 |
| 职责归属 | 插件持排序、召回预算、schema与三语设置Surface；Host只核验来源、权限、版本及实际编码容量。跨帧结果分批核验后完整汇总，任何一批变化或取消均不返回部分成功。                |
| 类型归属 | Shared4.0.4及双端移除重复召回字段；Host memory不依赖ExecutionService。迁移65转换官方未配置实例并清理旧字段，不覆盖已编辑实例或第三方同名包，迁移1–64和签名保持不变。     |
| 完成证据 | 本地检查、构建、格式、插件独立测试、专项迁移和指定CDP通过；正式签包与目录已发布。完整远程758项一次通过，main amd64 dev发布及镜像平台、摘要、源码核对成功。               |

- 本体产品提交 `1290b62f17be380375971de5245c2f9daf36cc7f`，修正提交 `21e36a7b7da73f65470a8b5c4d52a6aca83f4a45`。根check、完整build、format和diff检查通过，见 `final-fixes-check-sequential.log`、`local-browser-final.log`、`final-fixes-format-all.log`。首次并行重建Shared时check遇到dist暂缺，改为重建完成后顺序检查通过，未放宽类型。
- `migration-order-final.log`的2项覆盖偏好转换、App覆盖、未配置实例、第三方隔离、不覆盖已编辑配置、重复启动、完整性、外键和失败回滚。`host-memory-final.log`覆盖Host无重复策略上限、100条完整选择和超帧明确拒绝；插件20项Agent工具专项覆盖跨帧、编码容量、可信配置、缺项、变更与取消。首轮新增迁移夹具的实例列顺序错误触发enabled约束，修正seed后通过，原失败保留；已有Browser迁移消费者的末版本断言同步更新至65。
- `local-browser-first.log`3项覆盖窄屏召回配置、实例隔离和MCP/ACP设置；`local-browser-final.log`3项覆盖预算单位/非法输入、凭据保留/清除与App隔离、真实备份导出导入。`frontend-execution-fixed.log`保留真实编辑器的未知写入围栏、身份撤销、冲突和重新读取断言，按当前Shared字段数核对控件，未删除功能验证。
- 指定CDP `172.30.30.11:9223`、`https://api.honus.top`和9998前端完成正式Agent工具2.1.0设置验收：英文1440px、中文320px、日文390px，保存800/320/390条及1048576字节，API读回一致，无横向溢出、零pageerror，见 `cdp-acceptance.json`及`recall-settings-*.png`。首次脚本按未显示的包ID定位安装行失败，改按实际manifest名称定位后通过，保留首次日志和截图，未为测试改产品UI。
- CDP安装时公开下载入口曾返回503；改从本轮本地测试源交付同一正式签包，原归档字节、签名和SHA保持一致。该验收证明真实宿主安装与设置链路，不表示当时公开网关可用；原失败和镜像源回执分别见 `cdp-plugin-install.log`、`cdp-install-mirror-receipt.json`。
- 插件源码 `40515740606254ed9398d15830cce150a4e1c8a8` 的Validate42463914462及签包42464033527通过，正式发布[Agent工具2.1.0](https://github.com/0honus0/nexus-agent-plugins/releases/tag/tools-agent-v2.1.0)，归档SHA256为 `3fc4c00503f53031db02a1028a31d837dcaaedd62b2831e6d4482122349858eb`。正式fixture按原字节固定并验证签名、逐文件摘要及tar重建，见 `pin-agent-release.log`。8包85项独立测试通过，最终仓库22项通过。
- 公开目录下载多次遇到GitHub504；失败42464115421、42464563735及首次下载脚本测试日志保留。只读下载增加瞬态重试，仍失败时用官方CLI/API读取规范release asset，保留完整容量、摘要和签名核验。插件仓最终 `31173d7064d7d5a6a7aba5ee752b91230ae5bbc3` 的Validate42464714350通过；[目录42464734376](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42464734376)发布latest [catalog-20261108-3](https://github.com/0honus0/nexus-agent-plugins/releases/tag/catalog-20261108-3)，14条中旧13条完整保留，新条目三语齐全，见 `catalog-verification.json`。
- Shared4.0.4归档SHA256为 `766f73efa5e8a0afc1d89d2d24f3a97cb32506f62711d8ed43c0de1167c7d1f6`。导出后源码空行格式变化使再次导出指纹不同，未改写不可变归档或origin；506个编译文件逐一与最终dist比对一致，见 `sdk-byte-verification.json`，原失败日志保留。
- 首次完整远程[42464335199](https://github.com/0honus0/nexus-terminal/actions/runs/42464335199)发现旧召回控件、编辑器固定控件数、市场已缓存不重新加载的测试消费者，以及新增迁移声明顺序导致备份签名校验失败。修正入口和迁移顺序，新增迁移链有序断言，保留既有单位校验、凭据与未知围栏断言；本地回归通过。原轮在后端未结束时随新提交取消，不计通过；首次分片原日志和Reporter汇总保留。
- 最终本体 `21e36a7b7da73f65470a8b5c4d52a6aca83f4a45` 的完整远程[E2E42465732392](https://github.com/0honus0/nexus-terminal/actions/runs/42465732392)成功，正式758项（Backend223、Browser535）全部一次通过；八分片、质量/格式/双端构建、Docker smoke及耗时汇总成功。`remote-final-reporter-verified.log`逐项核对758个唯一passed记录，零失败、重试、跳过、遗漏或额外场景。
- [main amd64 dev发布42467733089](https://github.com/0honus0/nexus-terminal/actions/runs/42467733089)成功，来源 `1a32d09771d31365072b986ab83c7957c18c3ce2`；相对被测提交只有CI自动更新的`scripts/e2e/duration-estimates.json`，产品源码一致。`dev`与`sha-1a32d09771d3`摘要均为`sha256:127e73e3cd5e679dabc01438e48c9c2baf4f2a685fa594b0ac5751855e0d95f1`，已只读核对唯一产品平台linux/amd64、manifest/config摘要及OCI revision/source，见`publication/image-verification.json`。未拉取完整镜像或更新生产主机；本轮随后只提交验收文档，无行为变化，测试现场及首次失败继续保留。

## 插件 CDP 配置、市场移动布局与语言（2026-11-08）

基于本体 `main/801b518b`，主代理独立完成；插件正式源码归 `0honus0/nexus-agent-plugins`。Node26.13.0、pnpm12.16.1，产物集中 `/home/honus/nexus-task-artifacts/agent-plugin-settings-20261108`，指定CDP为 `172.30.30.11:9223`，访问 `https://api.honus.top`，前端9998、隔离后端3002。不更新生产主机，保留原数据库和首次失败。

| 审核表   | 本轮结论                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 移除宿主全局Browser设置，浏览器插件持每实例CDP目标、端点信任与页面规则；市场名称/介绍/搜索随本体语言，手机标题、版本、来源及操作分区；新增三语市场和配置保存E2E。                                                 |
| 职责归属 | 插件持工具定义、设置schema/UI；Host保留可信连接、安全URL执行及资源关闭，从实际调用source注入只读配置，不接受模型自报实例或端点。配置与退役按准确实例/代次隔离。                                                   |
| 类型归属 | Shared4.0.3新增目录localizations与实例配置解码，双端/HTTP/目录适配器逐字段投影；沿用SDK4既有locale环境事件，不新增语言RPC。迁移64由SQLite Adapter执行，旧值不留运行兼容。                                         |
| 完成证据 | 本地根check、双端build、全仓format通过；下列专项和指定浏览器验收分别记录。Browser2.1.1与最新目录已发，本地浏览器与指定CDP验收通过，完整远程756项一次全绿，main amd64 dev42462199531发布及摘要/平台/源码核对成功。 |

- `main-targeted-final-first.log`：41项40通过；序列化测试误用非UUID操作键，修正夹具后 `serializer-second.log` 7项全部通过，保留写入后序列化超预算仍为operation_unknown断言。`main-targeted-third.log`迁移/本地化3项通过。
- `browser-functional-first.log`：真实CDP浏览器与文件HTTP专项19项全过，含URL拒绝、准确Run/实例、节点操作、附件与关闭；`migration-snapshot-first.log`11项全过，覆盖迁移61–64、快照列注册、旧官方目标迁移/第三方隔离/不覆盖已编辑配置、重复启动、完整性和外键。
- Browser生命周期专项新增实例隔离、配置修订失效、准确旧代退役、清理失败、全局关闭与另一实例不被等待中的退役阻塞。按session顺序执行，跨实例不共用全局barrier；沿Run/tool真实取消，不另设60秒硬期限。
- `check-final-third.log`、`format-all-final-second.log`与双端build通过。此前两次在Shared重建删除dist时并行执行另一消费者导致环境失败，改为顺序执行后通过，未放宽类型或改产品构建契约。
- 插件首批 `1843c3df` 的完整check/build与100项测试通过，正式Validate42458001647成功；Browser2.1.0及catalog-20261108已发布并真实验签。指定CDP发现320px设置fieldset的min-content默认宽度造成溢出，另发现复选框不支持文字插槽、表单说明应使用description；在源码修正并以新版本2.1.1交付，原2.1.0签名产物不改写。
- 插件源码 `478b31c2` 的Validate42458902661与签名发布42459026198成功；Browser2.1.1归档摘要 `480063dac69b232cec8b5e4e0cb5ae21f40b7f798a6be140027634488c15dac8`，正式fixture原字节复制且签名/逐文件hash/完整tar重建均通过，见 `pin-2.1.1.log`。`local-e2e-mobile-first.log`正式Playwright入口7项一次全过，含三语市场、缺译回退、移动设置的非法明文拒绝、优先级800保存/重开、可见说明/标签与无横向溢出。
- 插件源码 `4dee500a` 的Validate42459303193及Aggregate catalog42459302603成功；公开latest `catalog-20261108-2`保留此前全部12项并新增Browser2.1.1，13项均有三语说明。`catalog-reaggregation-tests.log`17项通过，`catalog-reaggregation-live.log`使用真实公开旧目录和新签包连续链聚合成功，原摘要与版本保留。
- 截图复核发现宿主插件启用、未知操作确认和卸载清数据选项同样误用UiCheckbox插槽，已改为可见且关联控件的标签；通用配置布尔项沿已有表单标签并补可访问名称。`check-host-labels.log`、`build-host-labels.log`通过，`local-e2e-host-label-text.log`一项通过，覆盖点击清理文字切换勾选、取消卸载及设置保存重开。19a76674的首次本体远程42459304789因追加此UI缺陷修复而主动取消，不计通过；最终完整远程见下方871a0516记录。
- 新目录首次聚合42459106697失败，旧目录翻译文案被误按签名发行元数据作整项比较；修复为独立投影可执行身份和展示文案，继续核对原签名/摘要/兼容声明，不修改已发布归档。新增连续两次聚合翻译的回归，并保留首次失败日志 `catalog-mobile-first-failed.log`。
- 本体a5095c69的完整远程42459675080发现两条旧宿主设置用例仍要求全局CDP面板；按本轮归属改为核对旧面板不存在、旧全局配置和Runner请求均未发起，Provider及运行设置断言保留。插件配置保存由新增正式场景承接。首次分片原日志保留 `remote-shard4-first.log`，本地两条受影响场景通过，见 `local-e2e-host-ownership-final.log`。推送修正后原轮取消，后端未完成，不计通过。
- 三语市场1440px英文、320px中文和390px日文已通过真实偏好及公开目录显示、卡片/标签/页面宽度检查，截图为 `market-final-*.png`。首次设置页失败保留 `cdp-acceptance-first.log`、`browser-overflow-first.png`；最终正式2.1.1经真实prepare-update/update安装后，三语市场与320px设置保存、优先级800、说明与选项文字、无溢出和零pageerror通过，见 `cdp-acceptance.json`、`cdp-acceptance-final-second.log` 与 `browser-settings-final-320.png`。第二次脚本误用三击选中导致输入追加、首次宿主标签断言早于设置读取完成，均修正验收脚本后通过，首次日志保留；不将这些自动化操作问题计为产品缺陷。

- 最终本体 `871a0516d08f21445af766b28cb8df12f11050b6` 的完整远程[E2E42460337738](https://github.com/0honus0/nexus-terminal/actions/runs/42460337738)成功；正式756项（Backend222、Browser534）全部一次通过，八分片、质量/格式/双端构建、Docker smoke及耗时汇总均成功。`remote-final-reporter-verified.log`与`e2e-42460337738/reporter-summary.json`逐项核对756个唯一passed记录，零重试、失败、跳过、遗漏或额外场景。
- 发布[42462199531](https://github.com/0honus0/nexus-terminal/actions/runs/42462199531)成功，来源`fc73c8f6e58c987feb0b270037c091f8c258ff6a`；相对被测提交只有CI自动更新的`scripts/e2e/duration-estimates.json`，产品源码一致。`dev`与`sha-fc73c8f6e58c`摘要均为`sha256:1428fd0138dc2b7eff1511c5eb84d5733fb9219ebe5786a1b54ac98c0d2d8232`，只读核对唯一产品平台linux/amd64、manifest/config摘要和OCI revision/source，证据见`publication/image-verification.json`。未拉取完整镜像或更新生产主机；本轮只读核对后补交付文档，不另跑行为测试，测试现场和首次失败保留。

## Agent 限制复审与容量回归（2026-11-07）

继续未提交的 SDK4 重构，主代理独立执行。环境为 Node26.13.0、pnpm12.16.1；本轮文件清单、候选扫描、日志及浏览器现场归 `/home/honus/nexus-task-artifacts/agent-modular-20261106/limit-review`。最终清单覆盖主仓866项、独立插件仓411项（含删除项及生成物），这是完整文件清单与限制候选扫描，不表示全部文件均已逐行人工审阅。产品修复按 Shared → HTTP/WS/隔离宿主 → Service/Model/SQL → SDK/独立插件/前端消费者核对，保持权限、CAS、幂等、取消、完整续读及实际关闭语义。

- 去掉重复的工具参数/命令/路径/正文截断、文件树数量及深度、目录和指引私有扫描预算；文件树hash流式读取，目录按实际字节缩页，短页不能当作EOF。
- 去掉模型调用/定义、Provider模型/发现结果/Registry、App/可选模型/授权目标、Intent附件及JSON深度、Browser目标/规则/端点、Integration/MCP例外、denylist和上下文源的额外数量门槛。深层Intent采用显式栈遍历，重复身份、敏感字段和不安全URL仍拒绝。
- Plugin KV去固定1024键/8MiB总量；外壳沿所属传输预算，真实JSON编码容量、CAS/tombstone/事务/receipt不放宽。协作消息、Memory和Skill按最终RPC二次编码预算分页，只消费实际交付的消息；工具结果页允许读取至64KiB，默认4KiB，未删完整结果。
- 去掉隔离宿主/前端桥的私有并发和固定heap门槛；模型工具流增量计量UTF-8字节并正确合并跨delta代理对。MCP协商不再另加10/15秒期限，Host取消传到SDK实际fetch；ACP沿SDK帧预算并保持批准、排空与关闭。工具说明同步移除旧消息页4条和TTL300秒描述。
- 本轮限制修改未改变持久数据格式；上下文快照SQL容量仍为原实际5MiB。既有Agent重构迁移保留，不能把本轮结论外推为整个重构无需迁移。单帧、分页、传输/存储容量和用户配置的执行预算继续生效。

最终验证分别记录如下，避免将不同阶段重复项相加：

- `capacity-final-6.log`：22项通过。包括真实Chromium深/宽DOM与完整字段、真实OpenSSH大文件及长路径、SQLite KV/Memory、Provider HTTP创建800/发现1500/重启/更新600模型及5001项Registry，以及集合/深度正向与重复/权限等负向回归。
- `runtime-capacity-final-3.log`：7项通过。34个真实签名SDK4实例、3个同时开启的真实setup、同实例重复启用、关闭后新incarnation、publisher撤权后的进程/目录/账本清理。后续增强并发断言的 `runtime-capacity-final-6.log` 定向1项通过，启动日记写入期间重试读取，完整日记/进程身份断言不放宽；已接入正式 `execution-flow.spec.ts`。
- `test-plugin-final-7.log`：独立插件仓74项通过；其中真实MCP延迟15.5秒握手和Host取消到实际fetch及close/drain均通过。`check-plugin-final-8.log`通过，插件完整生产构建见 `build-plugin-final-7.log`；本轮最后只修改两条工具说明，单独重建agent tools并进入新签包。
- 公共Shared SDK使用不可变 `candidate.15`；八包开发签名staging22完成并固定到主仓fixture，`pins-final.json`记录全部原始hash、签名和归档字节重建验证。`staging22-final-1.log`最新包的消息二次编码分页、limit100、TTL3600及未交付消息消费围栏通过。此前 `host-plugin-final-2.log` 的33项通过保留；其10个失败均来自旧SDK3 runtime-capacity测试，已由上面的SDK4真实进程覆盖替换。未将该历史失败组合标为整组通过。
- `check-main-final-5.log`、`build-main-final-4.log`：根check与双端生产构建通过。最终全仓格式、两仓差异检查见本目录的 `format-main-final-3.log` 和 `diff-final.log`。
- 浏览器通过指定CDP `http://172.30.30.11:9223`访问 `https://api.honus.top`；前端9998，最新本地后端使用独立数据库。实际UI从130个模型新增至131并保存，刷新后仍131；1440/390/320px弹窗无水平溢出，添加按钮可用，无旧128上限提示，无pageerror。截图与结构化证据为 `browser/provider-{1440,390,320}.png`、`browser/result.json`。这是Provider设置回归，不等于完整Agent功能或移动真机验收。

首次失败、旧SDK归档、旧签包和浏览器数据均保留，未提交/推送或正式发布。全量Agent重构R6及远程E2E仍按PLAN承接。

## SDK4 续读与调用生命周期收尾（2026-11-07）

继续 main/cfa5bb5b 的未提交重构工作区，主代理独立执行。Node26.13.0、pnpm12.16.1；日志仍归 `/home/honus/nexus-task-artifacts/agent-modular-20261106/final-implementation`。本轮产品变化涉及隔离执行、历史快照和受管 HTTP/SSH 字节通道，没有新增数据库迁移或修改已确认 UI。

| 审核表   | 本轮结果                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | ACP 大结果通过预览游标读回完整内容，不重新执行 prompt；Child 只读操作复核当前权限；插件提前返回仍等待原 Host 调用；长连接释放已关闭响应，取消和同步关闭失败不提前释放写入。                     |
| 职责归属 | 协议 SDK 归独立插件，通用字节 I/O 归 Platform，真实授权和 transport/Operation 生命周期归 Host；旧工具父子表仅作迁移和备份审计。                                                                 |
| 类型归属 | 前端 SDK 握手与消息游标迁到 protocol4；服务注册用动态 Registry/准确 binding；删除无人消费的 frozen-app-execution SDK3 运行夹具，不恢复旧导出。                                                  |
| 完成证据 | 下列专项通过；新增正式 runner 入口覆盖服务目录、HTTP及ACP收尾。staging19 最终组合已通过92项，配置/文件审批回归另通过12项；全量正式 E2E、最终 CDP 和正式插件发布仍未完成，不以局部结果宣称交付。 |

- `protocols-staging18-2.log`：5项通过。大 ACP 返回按每页4096 JSON编码字节真实调用 `tool_result_read`，核对码点游标、完整128KiB文本和hash，`session/prompt`只执行一次。原10秒测试等待不足记录在 `acp-result-continuation-staging18-1.log`，只将该大结果用例等待改为45秒，产品期限不变；独立复验为 `acp-result-continuation-staging18-2.log`。
- `module-runtime-sdk4-2.log`：25项通过，覆盖32个IPC请求、派发前拒绝第33个并恢复容量、八个控制请求、原调用取消/退出、超过旧30秒计时、同步abort重入及多错误保留。首次日志 `module-runtime-sdk4-1.log` 保留7通过/18失败；复现并修复void生命周期成功帧缺value、worker准入缺失、handler提前返回遗漏Host任务。后续新增“首次技术错误后拒绝同次新请求”的断言，已纳入下述staging19最终组合通过。
- `authority-sdk4-1.log`：13项通过，含实际HTTP/OpenSSH/SQLite已完成effect的原dispatch proof、撤权/目标/父状态/批准变化、在途验证和Job事件监控。
- `frontend-sdk4-port-2.log`：5项通过，保留应用后ACK、终态应用中退订、实际MessagePort取消等断言；首次旧游标失败保留 `frontend-sdk4-port-1.log`。
- `readonly-sdk4-3.log`：2项通过。实际Root委派Child经OpenSSH读文件和目录，隐藏effect绑定准确包/实例/目标；撤权、配置/包身份/目标变化、跨Run/跨App等拒绝。旧schema3签名声明只作为显式archive审计，不能作为可执行SDK4包。首次两轮发现旧夹具的外键错误和快照遗漏的名称/版本及必要目标一致性校验，保留 `readonly-sdk4-{1,2}.log`。
- `services-sdk4-1.log`：6项通过，覆盖内部依赖服务与模型工具曝光分离、准确caller/contract/schema、来源和投影对象不可改写权威事实、能力上界及1200项目录分页。旧静态serviceImports/图深度不恢复为产品限制。
- `machine-sdk4-1.log`：10项通过，通用交互字节通道与大输出背压隔离，SFTP/命令/诊断/Docker复用、目标撤权、迟到握手、取消与完整关闭。该组只验证通用Remote通道，官方ACP协议由签名插件HTTP组验证。
- `mcp-http-lifecycle-2.log`：7项通过，真实HTTP头部拒绝/响应溢出/六个请求取消、连续130个响应释放以及response/dispatcher独立清理错误。首次 `mcp-http-lifecycle-1.log` 实际复现已关闭response仍留在连接活跃集合；该日志还保留测试mock导致的递归错误，后者不作为产品缺陷。
- `acp-host-lifecycle-2.log`：6项通过，Host等待迟到批准/原read、取消后不交付字节或批准、独立清理错误、真实Writable回调及MachineModel错误保留。首次 `acp-host-lifecycle-1.log` 复现command.close同步报错后提前释放writer，修复后保持原断言通过。
- 独立仓 `mcp-plugin-lifecycle-1.log` 4项通过，新增SDK协商失败与detach失败均保留、dispose同步异常不丢独立原因；`plugin-check-lifecycle-1.log` 与 `plugin-test-lifecycle-1.log` 全检查及64项测试通过。这些源修改已构建为下述新staging19不可变签名包，旧staging18不用于证明新插件产物。

- `finish-check-lifecycle-1.log`、`finish-build-lifecycle-1.log`：根check与双端生产构建通过，覆盖Native调用首次技术失败后停止新准入、HTTP响应释放及SSH同步关闭仍等待原写入。`plugin-build-lifecycle-1.log`、`plugin-staging19-1.log`完成八个包的新构建与签名；八包fixture及各自provenance固定为`2.0.0-dev.19`，原始文件/hash/签名/归档重建校验不变。fixture说明同步SDK4动态注册职责，不再把SDK3的六包、静态manifest工具数作为当前事实。
- `lifecycle-final-staging19-1.log`：新签包下11组共92项通过，零失败/取消/跳过；包括增强后的module-runtime、authority/readonly/service、MCP HTTP/ACP Host收尾、连接复用、真实MCP/ACP、SDK4独立更新及前端MessagePort。仅这些组完成组合验证，不能代表50组正式Agent入口或全产品E2E通过。
- `tool-regression-staging19-4.log`：7项通过。删除旧静态贡献与RunModelStream消费者，真实签名包目录经App发现后交给两个模型请求编码器；分别核对超过32个定义、合法33000字符历史、128个定义/32个调用的各自边界及溢出拒绝。真实OpenSSH文件写入核对准确父/子Operation、并发同键批准仅消费一次、0600权限、私有正文不出批准摘要、当前工具详情投影、拒绝后不写入、取消/撤权/目标禁用不能复活旧批准。App在收到确定拒绝后可自行选择继续结束，不恢复旧Host强制终止循环。前三轮日志保留测试迁移时错误的标题容量、旧状态名、错误字段路径及旧拒绝结果假设，不作为新产品缺陷。
- `integration-races-staging19-3.log`：5项通过。旧IntegrationService退役后，原准入/收尾安全意图迁往真实DefaultToolResources/PluginService和实例配置owner：同步协议异常仍等Job/Browser/SSH原任务且保留四个错误；关闭只拒绝排队工作、等待已准入任务；真实SQLite队列后会话过期不写配置或回执；commit_unknown后原键恢复已提交内容且不二次修改；并发CAS只提交一个，准确回执跨停用和重启保留。前两轮保留测试disposer应幂等的夹具错误。旧128续接名额、集中Integration CRUD和静态声明不恢复；MCP原续接/Run归属由实际签包协议与MCP组承接，动态发布/失效由Registry组、保留数据/清理围栏由包迁移组承接，全部组仍须完成正式矩阵验收。
- 新增上述两个正式runner组；`missing-dist-imports-staging19.json`扫描为零，说明测试中不再引用缺失的Backend/Shared dist文件，但不证明其余断言或运行行为已全部迁移。其余正式组的实跑结果另行记录。

## SDK4 续读、协作与检查点恢复（2026-11-07）

基于main/cfa5bb5b的未提交重构工作区，由主代理独立继续R6。Node26.13.0、pnpm12.16.1；本轮产物归`/home/honus/nexus-task-artifacts/agent-modular-20261106/final-implementation`。主仓与独立插件仓仍未提交或正式发布，没有更新生产主机，也没有删除用户要求保留的产物。

| 审核表   | 实现与证据                                                                                                                                                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 模型预览保留原调用/hash/码点游标；分页不限制原结果总大小，移除插件offset的旧256KiB上限。实际Shell8MiB结果由预览与续读重建并核对hash，不重跑命令。取消模型等待不再把父任务错误结算为unknown，真实执行/清理未知继续围栏。 |
| 职责归属 | 完整内容归OperationContent；预览和压缩归App插件。RunAppState只校验内容引用、终态回执、代次和CAS；历史读者与来源均限定Root。CollaborationRefusal表达确认回滚的事务拒绝，Job owner独立记录实际执行未知。                  |
| 类型归属 | Shared Run信息、内容页和检查点/历史解码使用原IPC预算，私有App状态不套普通HTTP32KiB上限；Host入口、SDK、独立仓、正式fixture同步。插件工作区override改为实际candidate.10归档，避免仅更新依赖却仍打入旧SDK。               |
| 完成证据 | 下列专项、根check/双端build/format、插件check与62项测试通过。当前只完成这些范围；正式完整E2E、全部旧回归迁移、正式签名发布和最终指定浏览器仍待完成。                                                                    |

- `collaboration-sdk4-5.log`：12项通过，包含父子隔离、准确绑定/派发证明、事实CAS拒绝、依赖取消、审批前取消、模型取消、消息与真实后台Job未知。此前失败的旧账本断言、目录查询和模型失败字段断言已迁移；没有恢复旧工具表或固定阶段。
- `collaboration-shell-sdk4-4.log`：该轮Shell11项全部通过，协作仍有旧失败字段断言，因此整份组合日志不算全绿；协作最终结果使用上一条独立复验。Shell核对8MiB原始stdout、完整捕获结果重建、Unicode分页、后续命令和Job资源；仅大输出场景延长测试等待，不修改产品期限。
- `result-children-registry-sdk4-3.log`：50项通过，涵盖实际SQLite内容、准确来源、当前权限/目标版本、超过2MiB结果的前页与尾页、撤权/跨目标、分块及全量损坏、递归Operation收敛和历史关系迁移。
- `artifact-evidence-sdk4-2.log`：16项通过，保留已就绪产物来源、确认后拒绝、提交未知无假证据、清理归类和批次预检；只同步真实构造器位置。
- `app-ledger-sdk4-3.log`：39项通过。正式旧phase-ledger测试迁移到真实Run/Operation/content/checkpoint DDL、Model与事务，保留确切状态/回执/摘要来源、CAS、封存/归属、过期/关闭/代次围栏、失败Child/Job、迟到完成与加密reasoning断言。新增Root历史分页与Child私有状态隔离、完整Unicode/转义chunk及超过HTTP默认大小的回执页。原Host五阶段/摘要包装设计由App私有状态回归承接，未重新引入旧实现。
- `app-plugin-runtime-candidate10.log`：App运行与预览11项通过，覆盖同一模型请求恢复仅派发一次、准确压缩前缀/完整工具结果组/保留尾部、空及过大摘要不替换原历史、连续两次有用摘要各自绑定来源、未完成历史引用、意图hash不匹配拒绝、标题可选失败与真实未知/存储失败。该组是实际App加内存Host port，不能代替实际HTTP/存储证据。
- `app-sdk4-staging17-1.log`：新签名8包固定到staging17，实际Backend/SDK/隔离插件与OpenSSH9项通过；其中新增长中文/Emoji结果在下一次Root恢复原历史，完整输出、两个Run各一次模型请求均核对。还覆盖无模型App、两个模型协议、真实文件、批准单次消费、审批前取消、同轮写入围栏和停用设置CAS。
- `finish-check-ledger-2.log`、`finish-build-ledger-1.log`、`finish-format-ledger-3.log`：根check、双端生产构建和全仓格式通过。首轮发现括号/声明间距与格式偏移已修正；生成SDK bundle按源构建校验，Prettier仅排除其生成目录，签名fixture继续保持原字节校验。
- `plugin-check-candidate10-4.log`、`plugin-test-candidate10-2.log`：独立仓check通过，插件测试分别27/33/2项，共62项通过；包含实际编译包、发行/组合、工具算法和MCP协议。两个旧测试将新的具名拒绝仍当作成功返回中的failure，改为核对拒绝类别，保留零Host调用和分页容量断言。

首次失败均保留：`app-ledger-sdk4-1.log`复现Root错误取得Child检查点；`app-plugin-runtime-1.log`复现私有状态32KiB拒绝；`app-plugin-runtime-3.log`复现连续摘要复用相同operationKey导致准确请求冲突；`backend-build-ledger-2.log`为Shared目标库不支持String.isWellFormed，改用既有共享Unicode校验。candidate.9是在该失败编译后的导出，未被消费者或签包采用；candidate.10来自随后成功构建。所有旧归档保持不可变。staging17只是开发签名验收包，相关PASS不证明已正式发布或全部新架构验收完成。

## Agent 模块化集成与易用性复核（2026-11-06）

基于 `main/390cfdb5c545617cde2f2be71a63c4f28eed79de` 的未提交工作区，保留前序性能与架构修改。按用户授权采用 sol high/medium 分工，主代理审核边界并通过指定 Windows Chrome 156 CDP（`172.30.30.11:9223`）访问 `https://api.honus.top`；本轮前端为 9998 生产构建 preview，后端为独立 3002，包及模型决策 fixture 为 3003，数据和产物集中 `/home/honus/nexus-task-artifacts/agent-modular-20261106`。没有连接或更新生产数据库；未提交、推送、发布或部署。

| 审核表   | 本轮结论                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能对应 | Run driver、统一工具目录与 schema、App/包组合、独立 UI、完整 SDK、多订阅事件及文件工具包已集成；第二个表单式巡检 App 实际复用同一工具包。第一版其余工具仍为本体默认贡献，不称全部外置。                                  |
| 职责归属 | 执行内核持生命周期、准确派发与结算；Host 持认证、批准、目标校验和资源，插件持应用与工具算法。Root/Child、隐藏单项原语沿持久父子账本收敛，保留原权限与未知结果围栏。                                                      |
| 类型归属 | Shared v2 包/SDK/事件契约同步后端、前端、独立仓与测试；sandbox 唯一取值含 allow-scripts/allow-forms，继续禁止 same-origin、原生表单网络和任意连接。安装流程不保存计划/进度，正式连续迁移保存实际包、绑定及数据迁移围栏。 |
| 完成证据 | 本轮最终根 check、完整构建、独立包构建/签名核对通过；下列有限 CDP 链路已执行。新增正式 E2E 源码已注册并静态通过，但未运行本地或远程完整正式 E2E；不能用历史 Actions PASS 代替。                                          |

实际验收与修正：

- 插件页面多 chunk/CSS 并发复用了管理队列，曾返回 503；资源交付改走独立串行 lane 并追踪取消和关闭，入队及执行后核对原 grant。独立聊天构建补全外部组件的 Tailwind source 扫描及关键 utilities 构建检查。仍为串行资源交付，未测量跨 App 慢读者吞吐，不额外建立调度器。
- iframe 原 sandbox 阻止 JS 表单提交；Shared sandbox 增加 allow-forms，HTTP CSP 继续 form-action none。`browser/forms-csp.json` 证明 JS submit 到达一次，原生表单网络请求为零、触发 form-action 违规，同源父页访问仍拒绝。SDK 仅公开 frontend-v2.mjs，不保留旧 v1 alias。
- 聊天终态同步退订后的晚 ACK 原先关闭整个 UI；客户端应用后复查订阅，Host 严格解码后忽略已退订 id，活动 ACK 仍核对原 pending。`streams/terminal-ack/REVIEW.md` 的真实 port 定向逻辑 5/5 通过，浏览器修后普通聊天与终态后再次发送通过。
- Child 原目录遗漏尚未加载的授权包工具；现继承父 availableDefinitions 授权快照，仍排除 Root 专用及隐藏原语。真实 Root 请求批准后创建 Child，Child 经签名包 read/list、隐藏原语和 loopback OpenSSH 读到 README marker/hash 及目录，父子均完成。`browser/real-tools-sql.json`、`child-relationships.json` 保留实际工具与父子持久关系；模型 fixture 只决定调用，文件结果来自真实 Host/SSH。explore 是角色标签，不等于权限自动降级；只读能力由文件工具 profile 约束。
- 审批预读改用实际 Apps API；摘要补具体任务、命令和目标，可信 Host 确认显示目标名称及 id。最终 UI dev.7/工具 patch3 再次运行真实父子链，`browser/approval-final.json` 记录 Run `cf1b1fd7-b814-403c-8398-5e41f19dfd4d` completed，可信确认前零次 resolve、后一次，且无 pageerror；`approval-dialog-final.png` 保留实际弹窗。初次辅助脚本误用 Approve 按钮文案，按真实 Approve and run 继续同一待审批任务，没有重发该任务。
- 市场执行包 prepare 递增修订后 commit 使用旧修订，已改用实际准备返回值；draining 普通安装不能越过 pending/data_migrated 围栏，保留配置但无 KV 的已卸载包仍可管理清除。`browser/tool-independent-upgrade.json` 证明 tools 2.0.0-dev.3→2.0.1-dev.3 经市场 install-plan 第一次完成，App/UI 包未变，执行修订 3→4。第二个巡检 App 随后通过真实共享工具完成 Run `8431e194-ca89-4dee-bb12-abc892142c35`，见 `inspection-after-tool-upgrade-sql.json` 及对应日志。
- UI 2.0.0-dev.6→dev.7 更新期间 Run `36ea6bff-b7f7-4720-86c7-c5d5af3fe3c0` 保持 running，最终 completed；executionRevision 保持 4，uiRevision 8→9，未发送草稿保留，见 `browser/ui-independent-upgrade-final.json`。本次明确核对新 Thread 已创建，避免此前辅助脚本点击未就绪的 New 按钮而把任务写入旧 Thread。
- 附件通过真实宿主上传并返回 opaque selection key，聊天显示 Files (1) 与文件胶囊，见 `browser/attachment-result.json`。文件输入由浏览器 File/DataTransfer 夹具提供；不是操作系统文件选择器验收。首次辅助脚本错误等待旧列表自动显示刚上传文件，实际上传已成功，关闭选择器后选中结果正常返回。
- 审批模式草稿与历史 Run 冻结模式分开；无效 modelKey 不再让 Send 可点却静默失败，使用当前 selectedModel 判断，保留原选择与草稿并要求显式重选。`browser/checkpoint-final.json` 实际通过关闭/重开 App 保留有效选择，再将 Provider 配置版本 1→2，确认旧选择显示 Choose a model 且 Send 禁用，显式重选后恢复可发送、草稿保留且无 pageerror；对应正式用例已补充。
- `browser/responsive-result.json` 与 chat-1440/390/320.png 核对最终 UI 的正文、会话列表、输入及控件边界；宽屏目标显示文字、窄屏显示图标，无横向溢出。早期截图正文空白来自未等布局/绘制稳定，调整采样先后及两帧等待后正常，没有为此修改产品 CSS 或虚拟列表。只证明指定桌面浏览器的宽度仿真，不代替真实手机软键盘。

最终独立包证据：`packages/provenance/independent-build-ui-dev6-final-result.json`。UI 源快照 `90faad363974c315201ae1d02299c0489ddfc711302fc78c2960a7fe5b27ac30`，167 个源码、176 个构建输入、39 个运行输入与独立 fresh 构建及正式 fixture 一致；独立仓 build/check/8 项逻辑测试和 5 包验签通过。UI dev.6 包 hash `d41f6ab16b1e98e8b240037c839864789ecc95d3a12af833533450a01d8f88a9`，dev.7 为 `b5ceeab9ae38e383d33ddb9535e04b9d944ba1890801bddbd2f355e58d8d5a31`；旧 App/tools3 的 tar 与 release 描述原字节保留，没有覆盖或重签旧版本。

静态命令为根 `pnpm run check`、`pnpm run build`、`pnpm run format:all:check`、`git diff --check`，最终日志使用任务目录下 integration-*-final.log。新增正式用例覆盖 schema/版本、runtime 隔离、共享包、子操作快照、并发 asset、安装迁移与恢复、ACK、审批摘要、实际 iframe 表单/批准及模型 checkpoint，按 D17 留待正式远程运行。历史数据库完整升级/备份恢复、并发撤权/未知效果、长日志控制延迟和资源峰值、第三方真实 Provider 效果及移动真机仍不由本轮有限链路证明。专用目录、数据库、包和运行环境保留至用户通知清理。

## 连接发起期间保留最新选择（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 的未提交工作区，保留前序变更。确认根因是异步的连接配置读取、顺序批量连接和标签预布局没有共用选择次序：旧查询晚返回后调用普通打开，会把刚创建的会话设为当前标签；批量里的后续连接也能覆盖用户的新选择。普通已注册SSH握手完成本身不写activeId，避免把网络耗时误当成唯一根因。

WorkspacePage复用原activationGeneration，查询在读取前捕获，整批连接共享同一代次；单连接、标签切换和打开启动页推进代次，同时清理旧预布局目标。Registry.open显式接收本地activate选项，旧请求继续建立后台连接但不改activeId或关闭较新的启动页。原pageScope撤销、SSH成功/失败恢复、租约与清理保持，不改UI、Shared、后端或数据库。

| 审核表   | 结论                                                                                                             |
| -------- | ---------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 最新选择优先；单连接/批量延迟读取不抢标签；后台握手不关闭新连接页；后台连接仍可切换并执行命令。                  |
| 职责归属 | 页面持选择代次，Registry持注册和activeId，Runtime持SSH生命周期；复用原状态，不新增选择Store或定时器。            |
| 类型归属 | 本地open选项含viewport/activate；真实页面消费者同版迁移，既有无选项直接打开保留默认激活；无跨端协议变更。        |
| 完成证据 | 修复前浏览器实际复现最新标签aria-selected由true变false；修复后桌面/手机6个新增交错场景及既有相关场景验证见下文。 |

Node 26.13.0 / pnpm 12.16.1。原构建的`baseline3.log`保留确定失败：从连接管理进入、暂存第一条配置读取、选择第二条并连通，再释放第一条响应，最新标签被错误取消选中。最初误选ui项目未收集SSH场景；随后首次夹具直接导航未预载连接列表而卡在选择入口，分别保留baseline/baseline2日志，不作为产品复现证据。修正夹具沿真实连接管理入口进入后复现成功。

修复版正式本地runner构建双端，选取workspace-no-session、reconnect-ui、terminal-reset及terminal-session-isolation。第一轮23项通过、两项因批量打开同一连接形成两个同名标签而触发测试定位歧义；实际原标签仍为选中。回归改为在释放延迟请求前捕获真实Workspace ID，断言原实例仍选中且可见，不放宽业务断言；再次运行完整isolation文件8项通过。两轮合计覆盖25个唯一场景，包含桌面与390px手机仿真、真实SSH服务、失败重连、页面返回、后台尺寸、快捷键、批量关闭、重置及会话隔离。不是GitHub Actions或真机运营商切网验收。

根check、双端生产构建、全量格式和diff检查通过；新增测试函数间距按现有ESLint修正，首次日志保留。产物集中`/home/honus/nexus-task-artifacts/terminal-selection-20261106`，含start.diff、baseline3.log、e2e.log、final.log、对应report/results、check.log和format-fixed.log。临时产物保留至用户通知；没有提交、推送、发布或部署。

## 终端异常恢复、尺寸与跨设备审核（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 的未提交工作区，保留全部前序修改。本轮沿 TerminalView、OutputWriter、TypeAhead、Workspace Runtime/Socket、Shared 几何以及后端 PTY/租约恢复审核初连、失败重连、挂起回放、输入输出与消费、历史翻页、尺寸变更、手机/桌面和前后台生命周期。未更改连接协议、未知结果围栏、字号策略或界面样式，无数据库变更；未提交推送、运行 GitHub Actions 或部署生产服务。

修复三类已复现问题：失活/后台视图的迟到 DOM 输入、粘贴和未完成 IME 仍可能发到 SSH，现由输入根节点 capture 守卫阻止，并清空失活 textarea、保留 xterm compositionend 清理和后台 DSR 协议应答；备用缓冲区全屏程序误触发挂起历史加载，现于请求前、返回后及解析队列排空后复查，竞态中暂存的实时输出仍按顺序交还原 writer，解析完成才归还消费信用；恢复完成回调原先直接插入 xterm，可能越过 TypeAhead 中的恢复输出而提前同步尺寸，现通过原 outputWriter.barrier 等待完整队列，并保留 PTY 代次与实例检查。

| 审核表   | 结论                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 后台迟到用户输入拒绝、DSR继续；新IME可输入；全屏滚动不拉历史，返回普通屏后仍可读取；历史缩放与独立xterm直接缩放对照一致；挂起回放结束前不提前发送尺寸。 |
| 职责归属 | 改动位于TerminalView交互/展示owner，复用OutputWriter、TypeAhead、Channel和原清理机制；Runtime/Socket及后端PTY/租约职责不变。                            |
| 类型归属 | 历史暂存只接收decodeOutput后的string，收窄数组并删除冗余二进制解码；不新增Shared字段、重复状态、兼容支路或产品测试接口。                                |
| 完成证据 | 修复前3项受控失败及CDP恢复竞态失败留存；本地正式runner两轮76项、43项通过（包含重叠），指定Windows Chrome CDP最新7项全部通过；静态检查及未验边界见下文。 |

Node 26.13.0 / pnpm 12.16.1。首轮正式runner覆盖 terminal-lifecycle、terminal-ui/session-cache/session-isolation/startup/reset，以及手机 terminal-touch/output-scheduling/suspend-resume/ssh-workspace，共76项通过；恢复屏障修复后重建双端并重跑 lifecycle 与手机 suspend-resume，43项通过。两轮不能相加作为唯一数量。新增7个场景纳入正式spec；最后增强的“历史响应期间暂存输出仍显示且消费回调完整”断言由最新CDP再次执行通过。测试用SerializeAddon只经原E2E浏览器构建入口导出，独立参考xterm对照缩放，不改产品接口。

指定 `http://172.30.30.11:9223` 的 Windows Chrome 156，通过 `https://api.honus.top` 下独立受控测试页加载实际构建的TerminalView/xterm并运行7项专项，均通过且无pageerror；会话传输是受控harness。恢复竞态旧构建在解析屏障释放前发送1次resize，修复后为0，释放后正常恢复正文与窗口尺寸。所有本轮创建的浏览器页已关闭，用户原tab保留。

证据集中 `/home/honus/nexus-task-artifacts/terminal-audit-20261106`：`start.diff` 保存本轮基线；`baseline.log`、`cdp-before-resume.json` 保留失败；`e2e.log`、`e2e-final.log` 和对应report/results保存正式runner结果；`cdp-final.json` 保存最终7项；`check.log`、`format.log` 保存静态检查。双端生产构建、根check、全量格式及diff检查通过。临时产物按用户要求保留至通知清理。

这些结果覆盖真实本地SSH测试服务、浏览器故障注入与移动设备仿真，不代表真实Android/iOS软键盘、运营商切网、休眠恢复或多跳弱网全部通过；相关边界继续保留PLAN，未宣称性能提升数字或消除所有缩放抖动。

## Agent 工具资源复用（2026-11-05，源码与静态）

本轮为 `main/2abcf49b` 基线上的未提交工作区，Node 26.13.0、pnpm 12.16.1。Remote 为每个 Run 创建独占借用的 SSH 池，顺序命令归还后复用，并发按需建连；成功文件资源保留独占 SFTP 供连续文件、项目指引与文件交付复用。Shell/Job、Docker、诊断与 ACP 消费同一作用域；每条命令的 cwd/env 仍独立，ACP 程序与协议会话不跨调用复用。MCP、Browser 和插件沿原缓存/会话 owner，无 UI、Shared 工具参数或数据库变化。

两轮源码审核核对完整消费者、目标/主机信任摘要、握手后的再次校验、并发借用预留、失败/未知退休、断开空闲文件资源派发前替换，以及 Run 与全局关闭。等待取消不丢实际握手，清理失败保留 owner/因果且继续其余收尾；Job、ACP、项目读取和文件交付捕获原作用域，晚回调不新建作用域。原始 Provider 仍实际关闭普通 Workspace/Files 资源。

根 `pnpm run check`、`pnpm run format:all:check`、后端生产构建、`git diff --check` 与新增 Node 场景语法检查通过；Playwright `--list` 确认 execution-flow 的5项场景包含新增资源复用入口。首次静态检查发现新增代码的花括号/函数间距问题，已按原 ESLint/Prettier 修正并完整复查。日志保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105`。

新增 `backend-next-machine-reuse.integration.mjs` 的9项回归进入正式 Agent execution-flow：真实 SSH/SFTP 及 POSIX exec 覆盖握手/通道计数、cwd/env、并发取消、断线、跨 Run 隔离、项目/文件交付；ACP 使用真实协议 Adapter 与受控服务端，Docker/诊断通过技术 Port 的受控输出验证同一 SSH 链；晚握手、清理失败与在途退休使用受控资源。既有文件交付、SFTP 与 ACP 生命周期 fixture 同步新的释放契约，保留原功能断言。**按 D17 未在本地运行行为测试；本轮远程 E2E、真实目标/网络下的时延、吞吐及长时资源占用仍待验，未声明性能数字或行为通过。** 本轮未提交推送、发布镜像或改生产服务，专用产物保留至用户通知。

## 复制移动安全与同类配色扩查（2026-11-05，源码与静态）

基于 `main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区，保留前序文档整理、连接工具栏及配色修改。按本轮授权修复原生 rsync 的 size/mtime 跳过，以及不同已保存连接抵达同服务器时 SFTP 中转的路径重叠；登录并发不改，Docker 镜像更新取消。NativeServerTransfer 增加 `--ignore-times`；Files Model 从实际受信握手公钥生成内部摘要，copyRemoteEntries 对原连接或同密钥连接在首次写入前检查整批规范路径。没有新增探测临时文件，也没有删除原安全 stage 或凭据/known_hosts 暂存；相同密钥只构成保守拒绝依据，物理文件系统身份、不同密钥/共享挂载别名和并发替换的保证边界见 Backend。

配色扩至快捷命令分组、连接标签选择、Agent Provider/MCP/ACP/插件市场及机器突变恢复状态；历史与挂起时间取消额外透明度。普通计数保持中性，快捷命令标题/底色只在非悬停时使用新配色，保留原悬停、选中、焦点、禁用和操作流程。Agent App 现有启停色及审计已有分类色经核对保留。新增私有 FileResource 字段已同步生产构造、五个后端夹具文件及目录复制夹具，无 Shared/数据库变更。

正式跨服务器协议用例增加三项：重复连接的 copy/move 拒绝原位、源父目录链接及递归目标，源字节和目录保持原样；同原连接原位 move 仍可完成；rsync 移动覆盖等大小/时间旧内容后才删除来源。原六条 clipboard/send × rsync/scp/relay 复制路线增加等大小/时间、不同字节的既有目标。目录复制夹具改为不同密钥下的同文本源/目标路径，保留 200 文件内容及任务级父目录检查。SSH 测试服务器的 REALPATH 改为实际解析文件系统链接，避免词法归一掩盖该场景；相关夹具取消、清理和失败开关不变。

Node 26.13.0 / pnpm 12.16.1：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build:backend`、`pnpm run build:frontend` 与 `git diff --check` 全部通过。Playwright `--list` 识别受影响协议文件全部 12 项；仅为用例收集，不表示执行通过。最后的 SSH 夹具修正及文档回填另补 ESLint、语法、格式与 diff 检查。日志集中 `/home/honus/nexus-task-artifacts/copy-safety-and-color-audit-20261105`，按 D17 未运行行为回归、浏览器或远程 E2E，未启动服务、提交、推送或操作远端。深浅主题/手机视觉及真实传输仍在 PLAN 待验。

### 补充浏览器与传输回归授权

用户随后明确要求浏览器验证、增加 E2E 并修复到远程通过。本地复用正式 Playwright 服务和基线，外置配置仅省略不在本批场景中的桌面服务，报告、浏览器下载和临时目录集中在上述任务目录。根 check、全量格式、双端生产构建、E2E 的 vue-tsc（使用任务目录配置）及文档 257 个本地链接均通过；裸 tsc 无法解码 Vue 导入，改用实际 Vue 编译器后通过，不添加源码 shim 或放宽类型。

12 项传输专项全部通过：六条原生/SFTP路线确实覆盖同大小/时间的不同内容，重复连接/源父目录链接/递归目标均在写入前拒绝，源保留；rsync 移动正确覆盖后才删除来源，原取消/失败/链接回退仍通过。另 10 项浏览器检查分轮通过：新增 6 项 light/dark × 1440/390/320px 检查及原 Docker、快捷命令、Provider、插件来源用例补充真实渲染颜色/对比度断言。18 张目录截图经 Chromium CDP 捕获，实际查看深浅手机目录；文字对比度至少 4.5，名称/类型/标签颜色不同且页面无横向溢出。既有目录/表单操作、密钥入口和弹窗关闭均验。自定义主题、真实触屏设备仍不由此证明。

首两轮保留失败：新测试错误假设密钥弹窗有可访问名称且支持 Escape，已按正式旧组件的标题和 Close 按钮定位，未改产品流程。插件来源用例原来等待公网官方目录才渲染本地仓库；浏览器读取现在显式注入网络失败，校验部分目录失败时仍显示受控第三方来源，官方来源不可覆盖的真实后端 400 断言保持。该用例不是官方公网下载/验签成功证据。新增截图/报告及 round1–3 日志均保留，正式远程整轮另记后续结果，不混用本地结论。

### 首轮远程失败与修正

提交 `c7709d80473bd44c61e5184f463a96d0d6fa3ee2` 的 [E2E 42000466180](https://github.com/0honus0/nexus-terminal/actions/runs/42000466180) 中，质量检查、双端构建、Docker smoke 和六个浏览器分片成功；后端一例失败，另一个浏览器分片一例重试通过，flaky 门禁正确拒绝整轮。跨会话旧用例实际将同服务器同目录复制到自身，现改为验证 conflict 且源内容保持；不同服务器同文本路径的成功复制仍由独立夹具覆盖。本地 round4 通过。

Agent App 生命周期旧用例直接等待公网推荐目录，超过 10 秒而重试通过；现先通过真实 API 安装本地签名 Nexus Agent，验证推荐端点准确返回该安装。新增正式 E2E 执行已有真实 HTTP/SQLite 的官方目录契约测试，控制网络 Adapter 返回，保留固定公钥校验、语义版本排序、无兼容推荐和离线已安装读取，并新增未安装且目录离线时明确 503/provider_unavailable。不是公网下载成功证据；本地 round5 两项通过，产品 UI、生产超时和信任政策未改。远程整轮仍待重跑，失败日志及 round4/5 报告留在本轮任务目录。

### 整轮远程验收与收口

修正提交 `08fdd88dbcb18a1edf303826998705c9d5bb55d4` 的 [E2E 42001858049](https://github.com/0honus0/nexus-terminal/actions/runs/42001858049) 全部成功：根质量与格式、双端生产构建、Docker 部署 smoke、Backend 及七个 Browser 分片均通过。正式 Reporter 共 577 条唯一 passed，零失败、重试或场景跳过；Backend 131 项，Browser 1–7 分别 41/46/53/73/65/83/85。耗时估算更新成功，截图更新任务按条件跳过，非测试场景跳过。本轮相对上一完整基线新增 10 项正式 E2E；生产实现提交为 `c7709d80`，远程修正只涉及用例和验证文档，未削弱生产防护或修改已确认 UI。

本地 round4/5 补跑三项通过后，根 check、全量格式、E2E vue-tsc 与 diff 再次通过。远程日志、准确 SHA/jobs JSON 和逐项统计保留为任务目录的 `remote-final-run.log/json`、`remote-final-summary.json`；首轮失败保留 `remote-first-run.log`。自动提交 `94603a33` 只调整 `scripts/e2e/duration-estimates.json`，已核对后快进同步，不将其作为直接被测 SHA。PLAN 清理本轮已验收施工区，自定义主题、真机和三语/身份交错未覆盖项承接待验区。无数据库变更，不需迁移；没有发布镜像、部署或操作生产数据。本地测试服务已退出，产物按要求保留至用户通知清理。

## 管理列表深浅主题信息层级（2026-11-05，源码与静态）

`main/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 当前工作区：基础 primary 采用中性色，原类型徽标和标签因此接近普通文字；部分次级字段又叠加透明度。现由 Foundation uiCatalog.css 提供名称、信息色类型、主题强调色标签和语义状态配色，六个源码文件覆盖连接、代理、通知、Docker 与工作区连接分组；不改全局按钮、布局、动作、Shared 或持久数据。已审宽窄屏标签、分组优先级、主题变量应用链及原状态投影。

Node 26.13.0 / pnpm 12.16.1：`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend`、`git diff --check` 通过；最后调整工作区次级透明度和分组悬停后，另跑受影响 Vue ESLint、Prettier 与前端构建通过。产物集中于 `/home/honus/nexus-task-artifacts/management-colors-20261105`。contrast.mjs/contrast.json 对默认主题的九类文字和明确实色背景做 sRGB 设计计算，浅/深色最低分别 4.80/6.56；不是浏览器像素检测，不代表自定义主题、手机或实际视觉已验。本轮未启动服务、运行浏览器或正式远程 E2E，待验范围保留 PLAN。

## 连接目录操作与密钥管理入口（2026-11-05，源码与静态）

基于 `dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e` 的当前工作区：电脑端将密钥管理、测试全部、连接全部横向排列；760px 及以下保留原两枚竖排操作，密钥管理从更多菜单进入。新入口经 ssh-keys/public 复用原弹窗与读写 owner，按需挂载；页面隐藏或身份变化关闭，原批量 SSH 筛选范围保留。无 Shared、后端或数据库变更。

Node 26.13.0 / pnpm 12.16.1 下，`pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend` 和 `git diff --check` 全部通过。日志位于 `/home/honus/nexus-task-artifacts/connection-toolbar-20261105`，本轮未启动服务或执行浏览器/正式远程 E2E；宽窄屏三语及弹窗交互仍待行为回归，见 PLAN。

## RDP 证书交付前审核与发布（2026-11-05，已通过并发布）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书交付前审核与发布2026-11-05已通过并发布)。

## 配置布局保存冲突（2026-11-05，已通过）

同一页面也可触发：preferences/layout/sidebar/focus共享版本；弹窗打开后保存锁定开关或其它偏好、先flush尺寸任务，原布局保存仍携带打开时版本。无需第二会话或其它用户。修复将弹窗原布局/侧栏内容基线送入Store原队列，只有无关版本变化时使用当前版本，真实内容冲突保留草稿；确定409最多恢复一次，unknown不重放。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#配置布局保存冲突2026-11-05已通过)。

## amd64 dev 发布与交付（2026-11-05）

发布运行 [41987211909](https://github.com/0honus0/nexus-terminal/actions/runs/41987211909) 成功。GHCR 的 dev 与 sha-a7f9aeb79491 同为 `sha256:ceb2172ba6eb1bfb5bcd5ca0be7e28937dde2c4a68091c7787c0e61e23692a3e`，可运行平台为 linux/amd64，OCI revision 为 `a7f9aeb7949106967466460c4a93cf817e02d16d`。生产实例未更新。核验 manifest、发布结果及日志保留在 `rdp-certificate-release-20261105` 任务目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#amd64-dev-发布与交付2026-11-05)。

## RDP 证书确认与认证配置核对（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-证书确认与认证配置核对2026-11-05源码与静态)。

## RDP 当前批次审核与正式 E2E（2026-11-05，已通过）

用户授权审核全部当前本地变更、补充用例、提交推送及修复远程E2E。按H-13保留已确认UI，未扩展产品配置或新增库协议；所有既有输入锚点/文件/音频/浮动工具栏源码、三语、依赖锁及vendor固定补丁已审核。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-当前批次审核与正式-e2e2026-11-05已通过)。

### 首轮远程失败与修正

提交79fbba4d的正式远程41971291558：质量、Docker、runner以及Backend和5个Browser分片成功，Browser3/5各失败一项。新增文件批次取消/重连/AudioContext释放4.4秒通过，真实VNC、DPI及pointer resize/minimize通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程失败与修正)。

### 最终正式远程结果

修复提交2f580434的完整远程[41972562509](https://github.com/0honus0/nexus-terminal/actions/runs/41972562509)最终success，560项一次通过，无失败、重试或测试跳过。首轮失败的桌面RDP综合场景9.6秒、手机RDP场景7.2秒通过，新增文件批次重连/音频context释放4.2秒通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终正式远程结果)。

## Windows RDP 实测、顶部工具栏与清理（2026-11-05）

在独立数据库、指定 Windows 目标及 CDP 中验证连接、常用键盘、双向文本/文件剪贴板、顶部工具栏和触屏仿真。临时启动的 Audiosrv/AudioEndpointBuilder 已恢复原 Stopped/Manual 状态。

- `audio-acceptance.json/log`：真实Windows内存WAV产生非零PCM，32次实际AudioBufferSource.start、44.1kHz立体声、峰值0.36624；原AudioContext时钟运行。暂停期间再播放一段真实声音，start计数不增长，恢复后新声音继续播放；重连时原context为closed、新context为running。排程提前量最高35.41ms，实际块约185.76ms；前者不是网络延迟或端到端声音延迟。Headless浏览器静音，不能证明物理扬声器听感；设备报告延迟也不能代表用户真实硬件。
- `file-acceptance.json`及`upload-acceptance.json/log`：远端2048字节二进制下载逐字节及SHA256一致；浏览器文件选择后在真实Explorer粘贴三文件，131073字节二进制、0字节空文件、33字节中文内容，以及中文/emoji文件名全部核对大小和SHA256。仅本次隔离文件，不宣称目录打包、大文件内存或吞吐已测。
- `toolbar-desktop.json`：4组通过，工具栏移出隐藏、所有原控件同一顶部区域且画面几何不变、Enter/Esc焦点、文件面板超出悬停仍可见及Esc关闭。`window-acceptance.json/log`另4组通过：实际点击锚点偏差小于3px、最小化/恢复不断线、全屏/Esc不断线及恢复浮动工具栏、改宽后仍保持完整高度。原显示区域1062×754，现1062×856，释放102px的上下固定占用。
- `mobile-acceptance.json/log`：390/320px Android UA与真实CDP touch事件仿真通过；顶部展开/桌面点击收起、全部控件无横向溢出，320px文件面板开关及关闭连接通过。三份UI结果pageerror均为空，截图toolbar-desktop-open/hidden、window-desktop及toolbar-mobile-390/320保留。这是浏览器仿真，非原生手机键盘或输入法候选窗口验收。
- `services-restored.log`、`remote-cleanup.log`核对服务原状及远端临时目录删除；`cleanup.json`列出本次和可确认前序临时目录/缓存/工具包/旧trace删除，两个专用Docker镜像及按确切ID匹配的66条本轮构建缓存清理。自建9998/3001/29222及旧43669监听、目标13389测试TCP均已释放，临时数据库/凭据/profile/浏览器二进制已删除；保留产品源码/vendor包、项目node_modules、Node26/pnpm12工具与精简日志。最终磁盘已用16664788992字节（15.52GiB），可用约13.32GiB；与初次约29GiB相比已明显回落，未操作其它项目镜像或用户数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#windows-rdp-实测顶部工具栏与清理2026-11-05)。

## RDP 音频输出（2026-11-05，源码与构建）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-音频输出2026-11-05源码与构建)。

## RDP 输入法定位与文件剪贴板（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdp-输入法定位与文件剪贴板2026-11-05源码与静态)。

## 依赖升级提交与正式远程验收（2026-11-05，完成）

用户授权提交推送并等待本次完整E2E。复核所有4份workflow引用的11种Actions，均与本轮官方release盘点一致；5份清单共121条依赖声明和catalog/overrides已核对。Vue3 draggable、TS6前端别名、SheetJS官方包及IronRDP锁定上游构建保持实际适用来源，不将npm旧latest标签作为降级目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级提交与正式远程验收2026-11-05完成)。

## 依赖、Node 与 Actions 升级（2026-11-05，静态与构建）

工作区为 `main/e79cf838` 的本轮未提交变更。官方 Node release index 确认最新正式稳定版26.13.0 LTS（Lithium），27 alpha未采用；npm metadata确认pnpm12.16.1及升级版本，Actions按各官方最新正式release更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖node-与-actions-升级2026-11-05静态与构建)。

## 聊天 GIF 与图片预览容量（2026-11-05，源码、静态与限定 CDP）

环境为`/home/honus/nexus-terminal`的`main/92e7f996`未提交工作区，Node v22.23.1、pnpm 11.28.10；pnpm来自`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104/tools/node_modules/.bin`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#聊天-gif-与图片预览容量2026-11-05源码静态与限定-cdp)。

## Agent 提醒、会话列表与虚拟历史（2026-11-05，源码、静态与限定 CDP）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-提醒会话列表与虚拟历史2026-11-05源码静态与限定-cdp)。

## 手机后台恢复后的挂起目录同步（2026-11-04，源码与只读排查）

用户要求排查指定实例运行中手机后台返回、重连失败后刷新列表持续加载，并确认原标签为蓝色。只读SSH核对实际Backend为2b0ab3db、17:03:29 UTC启动；没有重启、修改配置/数据库、发起应用登录或接管用户会话。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机后台恢复后的挂起目录同步2026-11-04源码与只读排查)。

## Agent 输入工具栏图标与对齐（2026-11-04，静态检查）

本轮基于main/9a324a75，仅调整AgentAppSurface及唯一NativeInputArtifacts消费者的布局。SSH目标统一使用既有square图标触发器，保留可访问名称、悬停提示和选择面板，删除旧摘要和对应隐藏规则；模型、思考、目标、权限和停止靠左，文件与发送靠右。图标及附件组不收缩，模型名称沿原flex收缩省略。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入工具栏图标与对齐2026-11-04静态检查)。

## Agent 聊天悬浮区与输入工具栏修正（2026-11-04）

本批基于main/b6bd3b25。用户反馈手机Token/上下条状态行下半部分仍遮挡消息，同时要求权限/添加文件具备SSH目标同款边框、手机隐藏目标数量；授权提交推送、处理远程E2E与发布main dev，沿用linux/amd64，不更新生产。本批按D17执行源码/静态与正式远程测试，不启动本地业务环境。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天悬浮区与输入工具栏修正2026-11-04)。

## 终端工具栏响应优化（2026-11-04，浏览器及远程回归通过）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端工具栏响应优化2026-11-04浏览器及远程回归通过)。

## 工作区尺寸自动保存冲突（2026-11-04，限定浏览器回归通过）

只读排查指定远程实例：生产revision为7262e8ac，14:26:26.894及14:26:51.367 UTC的PUT /api/v1/settings/layout返回409（auditId1504/1506），此前及间隔内preferences写入成功。SQLite只读核对presentation记录仍存在、version136；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工作区尺寸自动保存冲突2026-11-04限定浏览器回归通过)。

## 连接编辑清除凭据布局（2026-11-04，静态检查）

基于main/fac0f2ee，ConnectionForm将清除凭据勾选项移到密码输入框右侧，SSH密钥模式放在选择框右侧。源码核对原输入ID、凭据可见条件、清除后禁用、密码留空保留及保存/取消调用链；复用原UiInput/UiCheckbox，输入可收缩，清除项不换行，无新请求或状态owner。USAGE及PLAN同步。用户随后要求审查代码并提交推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接编辑清除凭据布局2026-11-04静态检查)。

## 插件市场更新确认弹窗（2026-11-04，限定浏览器验收通过）

工作区基于main/d81823bb，将PluginManagementSettings顶部候选包确认区移入共用UiModal；安装及两步升级继续使用原契约。用户明确授权“本地两个修改都用浏览器验证下 没问题提交推送”，作为D17的限定例外。证据保留于`/home/honus/nexus-task-artifacts/plugin-market-modal-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#插件市场更新确认弹窗2026-11-04限定浏览器验收通过)。

## Agent 聊天工具状态与悬浮控件（2026-11-04，限定浏览器验收通过）

工作区基于main/c202c152，本轮仅修改前端聊天展示及对应文档；用户随后明确授权提交推送，未发布或部署。证据保留于`/home/honus/nexus-task-artifacts/agent-chat-controls-20261104`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-聊天工具状态与悬浮控件2026-11-04限定浏览器验收通过)。

## 远程数据库维护与镜像更新（2026-11-04，已完成）

用户在镜像发布后明确授权维护远程数据库及更新镜像。目标仍为指定主机的`/home/honus/product/nexus_terminal`，原双容器健康、源码4a3074da，数据库为旧plugin-apps签名；4个Agent Run均completed，29份上下文缺systemPrompt，压缩/检查点/子任务记录均0。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远程数据库维护与镜像更新2026-11-04已完成)。

## Agent 执行补充回归与 amd dev 交付（2026-11-04，已完成）

用户最新授权补充E2E、提交推送plugin与本体，并在完整远程测试通过后发布main的amd dev。宿主从f789446f工作区接续，保留最小化提醒及全部六项执行优化；官方插件d5dd455/v1.0.3已发布，复核main与tag、公开Release一致且插件工作区干净。本轮不更新远程部署、用户数据库或运行本地行为测试。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行补充回归与-amd-dev-交付2026-11-04已完成)。

## Agent 执行与插件扩展（2026-11-04，源码静态及插件发布）

宿主基线main/f789446f及前序未提交最小化提醒；Node v22.23.1、pnpm 11.28.10。本轮按用户“全部修改”、工具接口可破坏性更新、插件更新后发布及同后端格式的授权实施。产物集中 `/tmp/nexus-agent-flow-plugin-implementation-20261104`，全部原目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-执行与插件扩展2026-11-04源码静态及插件发布)。

## Agent 最小化任务提醒（2026-11-04，源码/静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-最小化任务提醒2026-11-04源码静态)。

## 累积变更审核与正式远程 E2E（2026-11-04，已完成）

用户最新要求审核当前全部变更、修复残余并推送解决正式远程E2E。本批从main/ce7c135e及累积50个文件工作区继续，不回退前序修改；保留已有RDP提交，覆盖SSH连接、注销反馈、维护清理、终端响应和Agent可编辑硬限制。仅授权正式远程Actions，本地仍不新增行为/CDP/全量E2E、不操作用户数据库或发布镜像。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#累积变更审核与正式远程-e2e2026-11-04已完成)。

## 终端连接等待优化（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端连接等待优化2026-11-04源码及静态)。

## RDP/VNC 绘制性能验证（2026-11-04）

环境为 Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47 与 SwiftShader/软件 Canvas，未使用硬件 GPU。原产物目录为 `/tmp/nexus-rdp-render-performance-20261104`；下文日志及快照路径均相对该目录，历史路径不保证仍存在。

先比较原生Canvas backbuffer、零复制行视图、只合并新区域与全区域最小面积配对。Canvas方案像素正确，但4K条带CPU中位数7.2→15.9ms，未采用；行视图无稳定收益，只合并新区域无法稳定保留4K分散更新的收益，均未进入产品。最终保留原像素底图，只在超量时合并新增重绘面积最小的一对，扫描最多33个区域的528对，恢复至原32区域预算。

最终108轮：3种分辨率×6场景×3轮×基线/候选交错顺序。每轮54帧，前9帧暖机，统计45帧；每格为3轮每帧CPU耗时中位数的中位数（ms，改前→改后）。CPU口径为同步像素入队/复制加rAF内原生Canvas提交，不包含等待下一帧、RDP解码/传输或完整浏览器合成。

| 更新场景             | 1920×1080 | 2560×1440 | 3840×2160 |
| -------------------- | --------- | --------- | --------- |
| 分散小块，64×48×96   | 4.0→4.1   | 6.5→6.1   | 12.8→6.4  |
| 窗口块，320×180×12   | 3.2→2.9   | 4.0→4.0   | 4.6→4.5   |
| 全宽条带，64行×12    | 3.2→3.1   | 4.7→4.8   | 7.7→7.8   |
| 文字，64×20×1        | 0.1→0.1   | 0.1→0.1   | 0.1→0.1   |
| 640×480内局部小块×96 | 1.7→1.9   | 1.8→2.0   | 2.0→2.0   |
| 高密度小块×384       | 9.0→9.0   | 10.9→11.3 | 19.0→18.4 |

4K分散更新每帧平均提交面积8,081,311→1,396,117像素（减少82.7%），调用1→32次但均在同一rAF完成，CPU中位数减少50%。其它场景改善有限；局部更新与部分密集场景有0.1–0.4ms的耗时上浮，未把这些变化报告为普遍提速。4K高密度更新仍超过16.7ms帧预算；未测真实服务器、网络、解码、硬件GPU或端到端帧率，不能宣称真实RDP速度翻倍或消除逐块刷新。

13项像素/生命周期验证通过：分别对改前和最终模块与原生putImageData逐字节比对部分/重叠/透明/负裁剪、输入立即清零模拟WASM复用、超过32个分散区域及未更新间隙、尺寸重建和同尺寸width/height清空、小数输入原生回退、待绘时关闭及实例方法/属性恢复、RangeError与超过32MiB后的同步直接绘制。另运行已安装noVNC 1.7.0真实Display，确认dirty在backbuffer且flip前不可见、flip后呈现；该项不等同VNC网络或编码性能验证。

根 `pnpm run check`、`pnpm run build:frontend`、`pnpm run format:all:check` 均退出0，日志为本目录check.log/build.log/format.log；最终文档目标Prettier与 `git diff --check` 通过。真实模块与测量快照SHA256均为 `bec03c828988b3c459b48ea1f19007aa60744f65a52a0be2a67dd548c3184153`。本轮未运行全量E2E或远端部署，全部自建浏览器/环回服务由脚本关闭，测试目录与产物保留至用户通知。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#rdpvnc-绘制性能验证2026-11-04)。

### 浏览器性能及像素证据

Node v22.23.1、puppeteer-core 25.16.0、HeadlessChrome 156.0.8078.47，独立环回HTTP服务、CDP和浏览器profile均在上述目录；浏览器实际为SwiftShader/软件Canvas，无硬件GPU。基线是改前真实presenter快照，最终候选由 `benchmark-final.mjs` 直接编译工作区真实模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#浏览器性能及像素证据)。

## 主动退出的错误提示隔离（2026-11-04，源码与静态）

用户反馈正常退出弹“操作失败／个人数据请求失败，请重新读取”。源码确认：useAuthenticatedViewScope的available/activated原先能在认证已撤销后重新建立scope；个人历史/快捷指令的error观察未核对view，通知的重读动作也未绑定原意图；LatestValueSaver失败回调只有error，工作区自动保存及字体回调未核对原permission；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#主动退出的错误提示隔离2026-11-04源码与静态)。

## 清理工作流超期空排队与执行日志（2026-11-05，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#清理工作流超期空排队与执行日志2026-11-05源码与静态)。

## 两包镜像清理保留规则（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#两包镜像清理保留规则2026-11-04)。

## 终端翻页与缩放响应（2026-11-04，源码与静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端翻页与缩放响应2026-11-04源码与静态)。

## 可编辑硬限制与固定门槛清理（2026-11-04，源码审核）

用户要求继续去除可编辑硬限制之外无底层依据的常量上界。沿前序模型请求数修复及当前未提交工作区实施，默认预算、默认硬限制和UI不变，未提交推送、部署或操作数据库。产物集中 `/tmp/nexus-editable-hard-limits-20261104`，保留至用户通知。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#可编辑硬限制与固定门槛清理2026-11-04源码审核)。

## 模型请求数硬限制可调整（2026-11-04，源码审核）

用户希望把硬限制模型请求数设为800，却提示最大400。基线 main/ce7c135e 加前序本地SSH、退出提示、维护与终端响应变更；本批未提交推送。源码确认Shared AGENT_EXECUTION_LIMIT_MAXIMA.maxModelRequests=400被前端硬限制QuantityInput、HTTP codec、ExecutionService与存储行解码共同消费；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#模型请求数硬限制可调整2026-11-04源码审核)。

### 独立 Nexus Agent 1.0.2 提交发布（2026-11-04）

用户要求提交发布此前精简。独立仓库 main `790ccdec91c4c88632d9f90f0378e41d0f9cc4d2` 提交六文件：两份Skill、NexusAgent manifest1.0.2、根版本与README/目录说明；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#独立-nexus-agent-102-提交发布2026-11-04)。

### 设置读取恢复与推荐安装默认授权（2026-11-04，远程回归完成）

用户继续授权只读排查指定 Nexus 主机；本轮 SSH 仅读取 backend 最近3小时/最多5000行 Compose 日志，未修改远端文件、配置、数据库或容器。实际日志66行，范围07:01:09.324Z–07:08:49.789Z，未找到对应设置 GET 失败，execution-settings PUT 为200且 responseFinished=true；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#设置读取恢复与推荐安装默认授权2026-11-04远程回归完成)。

### 本轮 dev 镜像发布（2026-11-04，完成）

[41792924820](https://github.com/0honus0/nexus-terminal/actions/runs/41792924820) 成功发布 main `4a3074da6f8ab7e515a017f949ce03b1d059dc88` 的 linux/amd64 镜像。生产依赖审计成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮-dev-镜像发布2026-11-04完成)。

### Agent 安装与插件仓库布局（2026-11-04，源码及静态）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-安装与插件仓库布局2026-11-04源码及静态)。

### Artifact 总空间统一（2026-10-26）

范围：删除单文件设置及固定16MiB Artifact/图片、8MiB截图业务上限，取消10,000项累计文件准入，读取偏移跟随Shared协议容量；生成/截图/下载预检总剩余空间，最终begin事务保证总配额。文件库增量hash与Range分段下载复用现有入口，无额外UI变更。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#artifact-总空间统一2026-10-26)。

### 文件管理器预读20ms（2026-10-26）

原useFilesystemBrowser的PREFETCH_DELAY_MS由50改为20；FileManager普通目录、“..”鼠标停留及键盘定位共用此入口，后继最新候选补调度也引用同一常量。两轮源码审核核对入口与两处定时器，以及缓存命中、单个预读、最新候选、点击复用、离开/失活/dispose取消和revision围栏，无其它代码改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器预读20ms2026-10-26)。

## WebSocket 周期保活（2026-10-26，源码及静态）

范围：Platform HTTP listener 的既有 channel/raw WebSocket，每25秒以 ws 标准 Ping 保活，浏览器自动 Pong；无 UI、Shared 或业务消息变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#websocket-周期保活2026-10-26源码及静态)。

## 全部本地变更审核与远程回归（2026-10-26，已完成）

用户授权审核、提交全部本地代码并修复远程E2E。两轮分组源码审核覆盖 Agent Run/Step/Tool/Child、预算和模型SDK重试、上下文摘要与标题、批准分页/策略、模型来源、Artifact空间与分块下载、前端流合并/乐观消息/目标记忆、终端生命周期/输入恢复、Workspace附件流控及WS保活；保留已有授权UI变更，本轮不增加UI设计修改。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#全部本地变更审核与远程回归2026-10-26已完成)。

### 首轮远程构建反馈

提交1f21e469推送dev，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40259908812 。质量作业通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮远程构建反馈)。

### 首轮功能失败分类（40259908812）

通过分片4/5/7。产品：备份503（agent_runs approval_mode登记位置与PRAGMA顺序不符）、Custom SDK连接中（trace确认/sdk/common/version.js缺失CORS响应，静态白名单漏新SemVer依赖；改为esbuild单模块交付）、预览刷新点击被透明缩放padding截获（仅修命中，无外观调整）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#首轮功能失败分类40259908812)。

### 第二轮远程反馈（40261572646）

3bb022fd对应 https://github.com/0honus0/nexus-terminal/actions/runs/40261572646 ：质量、Docker构建/启动冒烟及分片1/2/4/5/6/7通过；分片3/8各剩一个旧测试入口。前轮备份503、Custom SDK依赖交付、预览刷新遮挡均已通过真实远程回归；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮远程反馈40261572646)。

### 第三轮远程反馈（40262842979）

e2f66bdf对应 https://github.com/0honus0/nexus-terminal/actions/runs/40262842979 ：质量、Docker及分片1/2/4/5/6/7/8通过；分片3仅完整插件审批出现一次flaky，重试后命令、unknown与上传/下载完整流程均通过，failOnFlakyTests正确阻止假绿。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第三轮远程反馈40262842979)。

### 最终验收：第四轮全绿（40263876745）

代码提交fc5845fd97be449e11bb1b58b03ab2b9150af481，正式工作流 https://github.com/0honus0/nexus-terminal/actions/runs/40263876745 结论success。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最终验收第四轮全绿40263876745)。

## 前端无效CSS清理（2026-10-26，源码及静态）

范围：仅删除无实际消费者的样式，不修改UI效果、模板/脚本或交互。复用已安装的Vue compiler-sfc、PostCSS与selector parser做临时审查（/tmp/nexus-css-audit.cjs），扫描91个样式源、2663条规则并得到126个候选选择器。工具输出不是删除依据；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端无效css清理2026-10-26源码及静态)。

## CSS清理交付、dev amd64与原站点升级（2026-10-26，已完成）

代码0fc60b7b127e699efffe99c89987b39b3a78a9bf推送dev。正式E2E https://github.com/0honus0/nexus-terminal/actions/runs/40265599805 完整success：463通过、0失败/0 flaky，8分片、根质量/格式/build和Docker smoke成功；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#css清理交付dev-amd64与原站点升级2026-10-26已完成)。

### 原部署识别及用户明确的数据处理选择

容器Compose标签定位原部署/home/honus/product/nexus_terminal，原NEXUS_DATA_DIR为./data，公开Origin为https://ssh.honus.top。旧镜像cb693e4c、数据库signature为backend-next-v1-initial-20261023-remote-tool-installer；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原部署识别及用户明确的数据处理选择)。

### 数据和入口验收

远程备份目录/home/honus/product/nexus_terminal/upgrade-20261026T035324Z（0700）：data-env-compose-before-upgrade.tar.gz、nexus-terminal-before-upgrade.db及previous-data完整旧目录；包含实例密钥，保留root权限，不上传仓库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#数据和入口验收)。

### 挂起关闭恢复画面几何修复（2026-10-26）

截图显示恢复后的TUI底部重复提示及空白；源码核对确认快照尺寸缺失、重复PTY resize和checkpoint尺寸排队问题。既有SSH `resizing a suspended fullscreen terminal is ordered after its checkpoint`同步验证baseline尺寸先于快照、live尺寸在快照之后；保留原快照正文断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#挂起关闭恢复画面几何修复2026-10-26)。

### Codex挂起恢复：高延时与滚动区域定向验证（2026-10-26）

用户明确授权api.honus.top的Codex测试及高延时时序排查，本轮限定该链路。使用独立Chrome/CDP与自建测试SSH会话，未接管用户现有终端；初次共享浏览器的恢复定位存在歧义，其结果作废，后续按精确suspend ID隔离。普通静止、执行中排队、75×28窄窗口恢复，以及WS上行700ms/下行900ms（实际往返约1.9秒）均保留输入区背景，未直接稳定复现原截图。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#codex挂起恢复高延时与滚动区域定向验证2026-10-26)。

### 终端逐字符真实回显优化（2026-10-26）

源码沿前端onData→sendConnected→WS terminal.input→requireTerminal→Workspace.write→ssh2 channel及原输出链核对：前端发送/前台输出没有固定防抖；Workspace WS入口仅派发任务，不等待文件操作执行完成，不能把Platform串行消息接收误判为终端等待目录请求完成。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端逐字符真实回显优化2026-10-26)。

### VS Code TypeAhead 移植定向验证（2026-10-26）

本轮沿用户对 api.honus.top 的终端/高延时专项授权，未运行全量本地 E2E、模型请求或修改真实 SSH 文件。复用 VS Code 固定提交 ae11932c6109d3977d78f2fe8937d861e246151d 的 MIT 核心，来源和适配差异见前端 vendor README。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#vs-code-typeahead-移植定向验证2026-10-26)。

### 文件管理器纵向拖动与固定命令栏（2026-10-26）

用户报告api.honus.top连接后文件管理器无法向上拖动。原因是同一纵向Splitpanes中terminal/commandBar/fileManager三项只调整相邻Pane，而commandBar只有38–42px可调整区间；仅打开pushOtherPanes又会遇到库的最大尺寸提前返回、after-pane漏算后续兄弟，以及前侧全部到最小值后重复扣减前序尺寸的问题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器纵向拖动与固定命令栏2026-10-26)。

## Agent 步骤与工具审计移除（2026-10-26）

删除正式 Host/审批卡片及 DEV 页的审计入口，撤销四个专用查询端点和 Shared 审计 DTO。保留步骤/工具状态及内部事件事务，供执行、审批、异常恢复和快照一致性校验。回归改用线程工具列表核对 ACP 和工具终态，继续验证审批 hash、命令预览、真实副作用和取消围栏；插件用例核对审计入口消失及 Run 用量仍可读取，后端 HTTP 用例核对已移除端点 404。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-步骤与工具审计移除2026-10-26)。

### 2026-10-26 自动图片与远程回归修正

- functional-regressions：本地受控 Provider 返回 PNG Base64，模型调用 image_models_list/image_generate，结果只允许文件事实，最终仅回答普通文字。验证审批前无预览、完成后图片实际解码/下载、刷新恢复。无需真实付费图片请求。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-26-自动图片与远程回归修正)。

### ZIP特殊节点与连续拖动补修（2026-10-26）

- 生产只读日志：ssh.honus.top / pve_debian两次压缩在inspectSources非常规文件预检以invalid_input失败；尚未发布本轮ZIP代码，未宣称生产实测通过。 - 原生Info-ZIP实测：普通文件、空目录、FIFO和Unix socket组成的目录，zip退出18，FIFO被忽略、socket报警且添加日志不等于实际入包；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip特殊节点与连续拖动补修2026-10-26)。

### 原生压缩直接递归与限制移除（2026-10-26）

生产只读核对：后端已运行revision `7f8ff3ff9e54594a991e48451baafacb63991125`，最新压缩失败为 `limit_exceeded`，位置 `/dist/modules/remote/files/model/file-resource.js:436`，对应 `scanEntries` 的应用条目预算；不是旧镜像未更新。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#原生压缩直接递归与限制移除2026-10-26)。

## 文件容量清理后续回归

aba02d2f正式Actions 40316497521：质量、构建、Docker及分片1/3/4/5/7/8通过；分片2的mutation fixture使用了重复cwd路径，下载用例仍期待已移除的8任务429；分片6目录force删除把1小时剩余期限传入SSH execute时，被旧5分钟参数检查拒绝，Model因派发状态不明退役文件资源。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件容量清理后续回归)。

### 跨服务器直传优先与中转共用链（2026-10-26）

跨会话剪贴板与发送到服务器共用copyRemoteEntries/RemoteFileModel.copyDirect。正式新增direct-and-relay-transfer六例：两个入口各测源到目标可达/不可达，8MiB单ZIP二进制的中间进度、精确SHA256、实际rsync/sftp方法；夹具记录直传零SFTP READ字节，中转READ字节等于文件大小；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器直传优先与中转共用链2026-10-26)。

### Agent 输入区状态栏整合（2026-10-26，本地静态）

将 Token 统计、上一条／下一条和回到最新消息纳入聊天输入区共同外框。两轮源码复核确认全部事件、显示条件和按钮禁用表达式保留；UiButton 默认 button，不触发表单提交；Token 弹层沿原 portal，宽度测量仍归原 form，状态行进入既有窄屏容器查询。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入区状态栏整合2026-10-26本地静态)。

### 手机 Agent 会话抽屉背景（2026-10-26，本地静态）

窄屏 `agent-hub-window <= 760px` 中的会话侧栏改用主题 header 背景，覆盖玻璃材质的透明混色；桌面、宽度、层级、遮罩及 inert/显隐保持。两轮源码复核覆盖选择器作用范围、CSS layer 优先级和默认深浅主题。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机-agent-会话抽屉背景2026-10-26本地静态)。

### 前端冗余功能门槛（2026-10-26，本地静态）

移除连接创建/导入/导出仅前端500项与本地1MiB上限、附件10项及多选静默截断、公钥确认排队64项拒绝、传输详情5项裁切及目录读取8个在途拒绝。协议分批、逐项严格解码、权限/取消/未知结果保护及缓存LRU保留，UI布局与样式未改。两轮源码复核覆盖导入全批预检/部分成功回执、串行上传首失败停止、信任队列取消、目录去重/失效/真实错误传播、传输滚动容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#前端冗余功能门槛2026-10-26本地静态)。

### 列表记录可达与分页完整性（2026-10-26，本地静态）

传输API删除累计160项协议拒绝，保留逐页严格解码、递增游标及跨页重复ID拒绝；Agent会话搜索沿既有游标串行读取后续页，不再只查首50条，清空搜索/失活/禁用/未决写入停止新页，失败进入原重读围栏。未改模板、样式或布局。两轮源码复核包含刷新/搜索变化、分页期间失活、错误不自动重试、旧结果归原owner，以及其它列表的分页/完整入口。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#列表记录可达与分页完整性2026-10-26本地静态)。

### 跨服务器剪贴板页面实时进度（2026-10-26，本地静态）

`ssh/direct-and-relay-transfer.spec.ts` 新增两个浏览器用例，分别覆盖原生直传和不可达时的SFTP中转：登录、连接两个SSH标签、文件管理器复制、切换目标标签并粘贴、确认凭据交付。传输真实8MiB样本，沿用夹具带宽控制，DOM观察要求至少两个递增的中间百分比与正确字节总量；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器剪贴板页面实时进度2026-10-26本地静态)。

### 本批最终正式验收（2026-10-26）

产品/测试源码`dd7a558b572a4bb510ca70531d95f691967a7604`的[Actions 40347041664](https://github.com/0honus0/nexus-terminal/actions/runs/40347041664)全部成功：质量、生产构建、Docker部署冒烟和8个分片共494项首次通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批最终正式验收2026-10-26)。

### Agent 输入框外侧玻璃底色（2026-10-26，本地静态）

按用户指定doc截图，移除AgentAppSurface输入区footer的ui-glass-chrome材质类，使外侧不再铺满导航玻璃底色、渐变和内高光。两轮源码复核确认只改该footer的一个类，输入框自身边框/焦点反馈、原间距/响应式尺寸、Token与跳转控件、公共玻璃材质定义和其它界面保持。USAGE对应输入区章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框外侧玻璃底色2026-10-26本地静态)。

### 矮状态面板网络读数（2026-10-26，本地静态）

按doc服务器状态截图，沿原max-height:210px分支将网络标题与上下行速率改为左右同排；移除network-reading的0.68em父字号，将数值从0.58em恢复为与紧凑指标一致的0.76em，箭头保留独立字号及两方向间隔。紧凑加载骨架同步单行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮状态面板网络读数2026-10-26本地静态)。

### Agent 输入框上方独立控件（2026-10-26，本地静态）

按用户最新布局要求将Token、回到最新、上一条/下一条状态块移至form之前；只保留各自全局控件，无整条底色或边框。原footer透明表面保留。composer容器声明从form移到既有外层agent-composer-area，使上方控件和输入工具栏继续按相同可用宽度响应式收缩，不依赖整个聊天面板宽度；form测量ref、提交、键盘、详情弹层和导航条件/事件保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-输入框上方独立控件2026-10-26本地静态)。

### Agent 控件与紧凑网络读数交付（2026-10-26，正式远程通过）

产品提交 `7865bfc159b0ca750f80d06f93d01125576c695d` 的正式 [E2E 40355305638](https://github.com/0honus0/nexus-terminal/actions/runs/40355305638) 全绿：质量、格式、生产构建、Docker 部署 smoke 和全…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-控件与紧凑网络读数交付2026-10-26正式远程通过)。

### 文件管理器路径栏垂直对齐（2026-10-26，本地静态）

路径原生输入框使用 flex stretch 跟随栏内高度、清除原生 margin，行高由 1 改为 normal，保留栏高、字体大小及各响应式断点。两轮源码复核确认左侧图标与父层 items-center、输入/导航/历史事件及焦点反馈保持。根 check、前端 build、全量 format:all:check 与 git diff --check 通过；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器路径栏垂直对齐2026-10-26本地静态)。

### 跨服务器安装准备与 SCP 性能（2026-10-26）

根因：amd 缺 rsync，RemoteFileModel 将 auto 强制映射为 rsync，阻断 Native adapter 原有 SCP 候选，退至 SFTP 中转。现在原样传递 auto，复制与发送复用已有远端依赖确认；用户跳过 rsync 安装后，普通文件再检查 SCP，跳过 SCP 后才中转。自动目录在 rsync 不可用时保留 SFTP 链接语义；不为此扫描目录。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#跨服务器安装准备与-scp-性能2026-10-26)。

### 远端工具默认选择、归档依赖与安装全流程（2026-10-26，本地静态）

逐项核对跨服务器粘贴、发送、ZIP/tar.gz/tar.bz2压缩与解压、普通SFTP文件操作、目录下载、服务器状态、Docker和Agent执行。修正ToolService的auto检查提前选择现有SCP、跳过默认rsync安装提示的问题，客户端严格验证预期工具；前后端共用archiveToolRequirements，归档一次只读预检包含压缩器及校验/快照/链接工具，早于写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具默认选择归档依赖与安装全流程2026-10-26本地静态)。

### 图片生成 HTTP 400 内容审核拒绝（2026-10-26）

用户指定 ssh.honus.top 的图片失败已通过宿主只读日志及 SQLite 关联：部署镜像 revision 为 a797ecd2bf7967541e5ee52acfa031fd683d5845，Run `25e2515b-f3bb-4e29-8ac7-c08af21c2cda` 的 image_generate 使用 gpt-image-2.5，约 43 秒后失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#图片生成-http-400-内容审核拒绝2026-10-26)。

### 矮服务器状态面板网络读数间距（2026-10-27）

已读取用户 doc 截图：服务器状态处于矮面板单行模式，网络上下行读数均出现省略号。用户授权缩小左右留白与字体；改动仅在原 `max-height:210px` 容器分支，收紧非趋势内容边距、卡片内距、图标/标签/上下行间隔，并将速率字号结合实际容器宽度计算。正常高度布局、趋势内容留白、速率格式、配色和完整 title/aria-label 保留。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#矮服务器状态面板网络读数间距2026-10-27)。

### 远端工具准备、SCP 进度与图片拒绝诊断正式验收（2026-10-27）

产品/测试提交 `0f174219ca0cdac181035d57a33b42b8ec339732` 的正式 [E2E 40382042043](https://github.com/0honus0/nexus-terminal/actions/runs/40382042043) 全部成功：质量、格式、双端构建、Docker 部署 smoke 与全部 8 分片，共 526 项首次通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#远端工具准备scp-进度与图片拒绝诊断正式验收2026-10-27)。

### Agent 会话列表删除按钮居中（2026-10-27，本地静态）

NativeThreadPanel 列表行为 items-stretch，全局 UiButton 固定高度配 my-1 使右侧按钮靠上；按钮改用 self-center 并移除垂直外边距，按整行居中。全局按钮尺寸/危险色、禁用态、再次点击确认及选择/搜索事件保持，USAGE 对应章节已同步。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-会话列表删除按钮居中2026-10-27本地静态)。

### Agent 工具卡片调用详情（2026-10-27）

本批新增单调用认证 GET，卡片展开后展示完整格式化参数 JSON 与持久失败码对应说明；加载失败仅重读详情，取消/未知不宣称远端回滚。源码两轮核对范围为 user/App/Run/tool 身份、Shared 严格解码、逐字段投影、原列表容量、失败码白名单、页面失活/卸载取消及 revision 晚响应保护；没有 schema 改动。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具卡片调用详情2026-10-27)。

### Agent PHP/Typecho 规划任务与资源错误分类（2026-10-26）

本轮按用户明确要求，只读核对 ssh.honus.top 所在线上指定线程 `4b7dd2b9-bdfc-4064-8c16-e1cd21471938`、Run `8cd50043-c9dc-40f4-ad0a-9dc3abdc3f0c`。原提示要求“先定好计划”：Run completed，12 个模型步骤、15 次只读工具调用，无部署/启停/写入工具；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-phptypecho-规划任务与资源错误分类2026-10-26)。

### 服务器状态卡片左右留白（2026-10-26）

用户授权收紧卡片左右外侧空隙，原 StatusMonitor.css 同步修改指标与加载列表水平 padding，去掉窄栏内容覆盖并同步矮栏骨架。两轮源码核对普通/150px/118px 窄栏、210px/270px 矮栏、趋势与手机覆盖次序；卡片内部间距、纵向尺寸、触控区域和数据逻辑保持。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态卡片左右留白2026-10-26)。

### 文件管理器 `..` 返回行紧凑高度（2026-10-26）

用户授权缩小父目录返回行：只为父行单元格设置更小垂直 padding，移除父行名称原有底部留白；其他文件行、缩放、点击/键盘、20ms 预加载、右键和拖入不变。两轮源码核对全部可见列单元格与 CSS 优先级，父行仍独立于虚拟条目和 spacer，不修改虚拟文件行尺寸。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件管理器--返回行紧凑高度2026-10-26)。

### 工具详情及界面细节本批正式回归（2026-10-27，待远程）

本轮补充既有图片成功/三类拒绝用例，验证持久工具详情、错误 Run 返回 404、展开卡片后的格式化参数与安全失败码，不改变图片预览、下载、内容审核及不重试断言。其余源码静态证据见上述各节。用户授权整批提交推送，完整正式 E2E 成功后发布 dev linux/amd64；不更新生产容器。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#工具详情及界面细节本批正式回归2026-10-27待远程)。

### 手动清理 workflow（2026-10-27，静态待验）

新增 cleanup-history.yml 与维护脚本；仅手动触发，无 schedule/push/release。源码审核两轮核对包/仓库范围、latest/dev 多层 manifest 与证明闭包、渠道移动围栏、历史运行/产物保留、缓存删除、活跃运行与权限失败路径。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-workflow2026-10-27静态待验)。

### Actions 恢复及复制取消竞态（2026-10-27）

手动触发已恢复：40436334225 验证 7810d6ad，检查/格式/构建、Docker smoke 和 6 个分片成功；第 4 分片用例 registered copy progress 首次失败、重试通过，flaky 门禁正确拒绝，不能称全绿。截图与调用日志显示 Cancel 后任务直接消失且没有 unknown Toast。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#actions-恢复及复制取消竞态2026-10-27)。

### 本批正式 E2E 与 dev amd64 交付（2026-10-27，完成）

GitHub Actions 限制已恢复。测试修复提交 `441dcc740660d337b6e7480bbb1f891a90a3079d` 的正式 [E2E 40437638548](https://github.com/0honus0/nexus-terminal/actions/runs/40437638548) 全绿：检查/格式/…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批正式-e2e-与-dev-amd64-交付2026-10-27完成)。

## E2E 依赖拆分与构建复用（2026-10-27）

参考 [Grafana 构建分发](https://github.com/grafana/grafana/blob/main/.github/workflows/pr-e2e-tests.yml)、[Playwright fixtures](https://playwright.dev/docs/test-fixtures)、[项目分组]…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-依赖拆分与构建复用2026-10-27)。

## 最耗时任务优化（2026-10-27，正式全量通过）

上一阶段正式 [40444825177](https://github.com/0honus0/nexus-terminal/actions/runs/40444825177) 在 899d4107 上 526 项首次通过、0 skipped/retry/flaky，完整墙钟 532 秒；原基线 40437638548 为 620 秒。新基线尚不满足用户提速目标。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#最耗时任务优化2026-10-27正式全量通过)。

## E2E 功能目录与剩余前端计时等待（2026-10-27，已验收）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-功能目录与剩余前端计时等待2026-10-27已验收)。

## E2E 复制取消与插件分片（2026-10-27，已验收）

优先处理最新实测39秒复制取消和约119秒Agent插件大文件。复制场景改用测试SSH的真实WRITE gate，取消前确认已有写入进入，前端Clock跨32秒原清理边界后确认原WRITE仍阻塞；明确释放后等待真实pending归零及对应任务WS终态，再保留第二文件不存在断言。gate不会因channel close清掉观测，reset先释放再停止旧SSH并等待真实I/O归零。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-复制取消与插件分片2026-10-27已验收)。

## E2E 构建与容器准备重叠（2026-10-27，已验收）

实测40457002804：准备作业60秒；最慢分片后置的容器初始化28.3秒、依赖链接6.6秒、产物下载4.3秒。原依赖将共享构建与全部容器准备串行。本轮将同一次完整构建移入既有quality作业、先上传产物再执行原根检查和全量格式；镜像准备作业提前结束，让8个测试runner同时准备。作业数量与测试并发不变，不改UI/产品/测试断言/隔离生命周期。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-构建与容器准备重叠2026-10-27已验收)。

## E2E 成功传输进度限速（2026-10-27，已验收）

40459146818的protocol成功原生路线单例约13秒、clipboard-ui五条路线每例约15秒；其中真实8MiB样本的1MiB/s夹具传输本身占数秒。本轮只将成功进度场景的rsync/SCP及UI relay现有限速提高至原生3MiB/s、relay 4MiB/s；原生命令约一秒输出一次，保留多次中间采样窗口，保留SSH读延迟和专门2Mbps/10Mbps等弱网profile；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-成功传输进度限速2026-10-27已验收)。

## 手动清理活跃运行修复验收（2026-10-27）

原40483067327因任意其它未完成Actions全局拒绝而失败。脚本现在保留活跃运行/产物，删除前复查重启；有其它活跃任务时跳过镜像和缓存清理，真实权限与manifest异常仍失败。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理活跃运行修复验收2026-10-27)。

## 快速输入回跳与连续退格（2026-10-27，源码及静态完成）

本地dev的TerminalTypeAhead修正：未完成CSI保留至下包、仅光标显隐/报告的包不触发退格空匹配失败；右边界仅限制前向打印，触边不立即撤回旧预测而由HardBoundary等待真实回显；连续DEL按解析顺序逐字预测，原输入仍只派发一次。原双解析屏障、reset/失活/resize/快照撤销与复杂模式保守策略保持，无UI或协议变更。源码两轮复核完成，未用关闭预测或放宽期限规避。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#快速输入回跳与连续退格2026-10-27源码及静态完成)。

## ZIP 压缩中间进度（2026-10-27，静态完成、行为待验）

根因：取消源目录预扫描后，压缩期间只有 fileCount，没有总数或 percent，原前端按 0% 展示。Native zip 改为 -dc，采集它已有扫描的已处理/剩余条目，Model 逐参数转交，FileService 沿原 transfer.archive 发出 totalFiles/percent；发布验证前不足 100%，成功后才 100%。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#zip-压缩中间进度2026-10-27静态完成行为待验)。

### 传输进度提示统一 Toast（2026-10-27）

浮动进度、隐藏任务及服务器传输详情移除行内警告/错误说明；本地原任务回执补完成警告通知，后台 store 按快照状态/错误变化通知，列表加载和取消/移除失败使用 Toast。两轮源码复核覆盖上传、移动、剪贴板、归档密码重输、后台读取/写入、身份代次及网络错误去重，保留原进度、状态、操作和 CSS。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#传输进度提示统一-toast2026-10-27)。

### 状态趋势真实采样与紧凑刻度（2026-10-27）

用户明确授权启动测试环境并通过 CDP 专项验收，本轮复用已在运行的 3001/9998 环境和 172.30.30.11:9223 中登录 api.honus.top 的浏览器。真实 amd SSH 五类指标 × 1/5/10/30 分钟共 20 组验证窗口跨度、样本在窗内及网络整档刻度；短历史不被压成不可见单点，时间左侧不足部分仍为空。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#状态趋势真实采样与紧凑刻度2026-10-27)。

### 2026-10-27：传输安装偏好、实际工具、TAR 进度与原生文件拖动

新增/扩展远程用例：cross-server-transfer/clipboard-ui 的 SCP/SFTP 跳过安装分支，再次复制不重复弹窗，仍验证协议实际方法、内容摘要；SCP 分支继续模拟后来手动安装，第三次自动重新识别 rsync。保留原字节进度、单调性、直传/中转计数及内容断言。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27传输安装偏好实际工具tar-进度与原生文件拖动)。

### 2026-10-27：趋势静默断采样与安卓前台恢复

前轮趋势修复只处理序号不连续，漏掉“序号连续但时间相隔约 22 分钟”的情况。现在按完整保留历史的实际正向连续间隔下中位数识别明显时间断点（大于两倍），再按所选窗口过滤；不删除旧点、不补造历史、不改变采样频率。既有时间轴 spec 增加真实 SSH/WS 入口注入五个受控采样时间的场景：各范围首个真实时间正确，30 分钟画布保留上下行颜色，但中间无采样区没有两种颜色的连线。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27趋势静默断采样与安卓前台恢复)。

### 2026-10-27：发布前本地正式入口整链专项

用户本轮授权启动测试环境并验证本批修改，随后提交 main、完整远程 E2E 通过后发布 amd64 dev，最后停测试环境。本地使用独立 `/tmp/nexus-release-data-*` 数据目录、3001 正式后端、原9998 Vite 和专用22222 SSH夹具，不覆盖旧实例/生产数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-10-27发布前本地正式入口整链专项)。

### 归档标题移除与隐藏入口百分比（2026-10-28）

归档ProgressCenter终态“移除”移动至任务标题右侧，保留done条件与原remove(task.id)，活动取消/未知副作用处理不变；标题flex-1/min-w-0截断、按钮shrink-0，无局部新样式。WorkspaceSessionSurface对现有progressTasks的已报告进度钳位后等权平均，空列表为0且入口原条件不显示，单任务跟随其百分比；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#归档标题移除与隐藏入口百分比2026-10-28)。

### 项目依赖维护（2026-10-28）

递归outdated初始30项，更新29项直接依赖、catalog、pnpm锁文件及pnpm11.28.9。包括Vue/编译器3.5.44、Vite8.3.5、Monaco0.57.0、Pino10.4.0、Undici8.12.3、MCP2.4.0、OpenAI7.45.0、Playwright1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#项目依赖维护2026-10-28)。

## 直传安全提示记忆与网络读数对齐（2026-10-28）

范围：跨服务器粘贴、“发送到服务器”的凭据确认共用“下次不再提醒”；网络速率等宽半栏内居中。两轮源码审核：第一轮追踪两个入口到公共确认 composable、Feedback store/host 与 browser storage，核对取消、替换弹窗、signal、用户切换及原 generation 保护；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#直传安全提示记忆与网络读数对齐2026-10-28)。

### 本轮授权 CDP 专项验收

用户追加“使用cdp确认下效果”，作为本轮 D17 限定例外。CDP 为 `172.30.30.11:9223`，实际访问 `https://api.honus.top`；原测试服务已停止且页面 502，本轮复用隔离 `/tmp/nexus-release-data-YdlpzU`，启动本地后端3001、Vite9998和真实SSH夹具22222/22225。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本轮授权-cdp-专项验收)。

## 任务操作全部移至标题行（2026-10-28）

本轮按用户补充授权将归档活动状态的“取消／取消中”与终态“移除”统一放到各任务标题最右侧；复制/移动/混合模式底部“取消”也移至对应标题右侧，删除旧底部操作容器。上传和批量取消原已在同排/窗头，保留原入口。第一轮源码审核逐一核对按钮条件、emit类型/ID、取消中文字及禁用；第二轮核对互斥分支、标题min-w-0/flex-1/truncate、按钮shrink-0、所有任务模式与底部容器无残余。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务操作全部移至标题行2026-10-28)。

### 任务标题操作正式远程回归通过

用户授权提交推送并等待E2E。main产品提交 `a726e6c3cc0df8cc5e3e05615e0490f1b15a4587`，正式 [40662321872](https://github.com/0honus0/nexus-terminal/actions/runs/40662321872) success：质量/格式、Dock…

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#任务标题操作正式远程回归通过)。

## nethogs 全接口停顿与退出输入专项（2026-10-30）

用户授权启动测试环境、经 CDP 访问 api.honus.top，并明确测试 SSH。干净 main `09e6c79871bf4e831aa9fbc83a1f931f0fba474b`；本机 Node v22.23.1、pnpm 11.28.9、Playwright 1.64.1。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nethogs-全接口停顿与退出输入专项2026-10-30)。

### 手动重置终端专项（2026-10-30）

用户最后选择只新增手动恢复，不实施通用检测。源码沿SSH标签右键/长按菜单、全局确认、RuntimeSession/Registry和原workspace.close链；三语同步。确认前不关闭，原实例收到明确closed才清理scope并按原标签顺序建立新Shell；后台标签重置保留当前选择。detached/unknown拒绝新建并保留原标签/未知提示，挂起标记禁用入口；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动重置终端专项2026-10-30)。

### SSH 测试主机密钥确认专项（2026-10-30）

终端恢复已按用户要求提交038855a1；本批修复连接测试丢失实际Host Key挑战的问题。沿用独立测试数据库、3001 Backend、9998 Vite及api.honus.top，CDP为172.30.30.11:9223，真实SSH目标为honus.top:9902。Backend按本批源码重新构建后启动；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#ssh-测试主机密钥确认专项2026-10-30)。

### 后台挂起恢复与密码单次保存专项（2026-10-30）

用户授权继续修改并通过CDP验证；沿用 `/tmp/nexus-nethogs-20261030/` 的独立数据库、Backend3001、Vite9998，CDP `172.30.30.11:9223` 访问 `https://api.honus.top`，实际SSH为honus.top:9902。仅操作自建context、临时连接及原PTY变量，无生产配置、容器或系统文件写入；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后台挂起恢复与密码单次保存专项2026-10-30)。

### 普通文本原生查找恢复专项（2026-10-30）

用户明确仅恢复基本文本查找，不回退图片及其它文件预览。沿用 `/tmp/nexus-nethogs-20261030/`、Backend3001/Vite9998，CDP `172.30.30.11:9223` 实际访问 `https://api.honus.top`，自建桌面1440×1000和393×852触屏context连接honus.top:9902；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#普通文本原生查找恢复专项2026-10-30)。

## 复制任务总进度标注专项（2026-10-30）

沿用户指定 `https://api.honus.top` 与 CDP `172.30.30.11:9223`，在自建桌面1440×1000与393×852触屏context加载当前Vite实际ProgressCenter组件，以受控TransferTask模拟三文件累计进度。使用真实Vue/i18n模块和原全局样式，不修改保存配置或远端文件；本轮只验呈现，不称为真实跨服务器传输验收。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#复制任务总进度标注专项2026-10-30)。

## 终端目录等待清行提示与全部本地变更提交（2026-10-30）

用户最终撤销草稿保留方案，要求仅提示清行并提交全部本地改动。Native Shell/Model/Service/Port 的本轮草稿试验已完整撤回至原实现；最终仅 FileManager 消费现有 onQueued.waitingForPrompt，在当前有效视图中显示一次原 feedback 信息提示。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端目录等待清行提示与全部本地变更提交2026-10-30)。

## E2E 连接选项加载失败提示（2026-10-30）

main/96ea73b2 的远程 [41049355889](https://github.com/0honus0/nexus-terminal/actions/runs/41049355889) 只有 browser shard 7 一项失败（同组57通过），其余7个测试分片、质量与Docker smoke通过。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#e2e-连接选项加载失败提示2026-10-30)。

### 2026-11-02：弱网输入回退与删除停顿专项

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#2026-11-02弱网输入回退与删除停顿专项)。

## 安卓普通文本查找呈现专项（2026-11-02）

指定站点api.honus.top的独立CDP context挂载真实FileEditor与内存文档，Android14 UA/touch模拟。修复前英文渐变默认面板证据mobile-search-before._，修复后mobile-search-after._，脚本mobile-search.cjs，均位于 `/tmp/nexus-nethogs-20261030/`。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#安卓普通文本查找呈现专项2026-11-02)。

## 命令历史恢复与 SSH 半关闭专项（2026-11-02）

指定站点CDP使用独立context、真实store/API/Shared和完全拦截的历史接口，不向生产写入。`/tmp/nexus-nethogs-20261030/history-recovery.cjs` 与同名log验证：首次POST已在夹具保存但丢回执；下一次新意图GET→POST→GET、旧POST仅一次；恢复GET失败不发送新POST；普通load成功恢复；读取中撤权不派发；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#命令历史恢复与-ssh-半关闭专项2026-11-02)。

## Agent Shell 等待/执行分离与旧围栏拒绝专项（2026-11-02）

生产仅使用指定SSH和Node只读SQLite查询（readOnly/query_only），没有更新记录、重放原命令、重启或部署。指定临时目录内agent-db-{inventory,details,chain}.jsonl确认同一线程2026-10-29三个Run，目标为fxm/connection 7：首轮完成；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-shell-等待执行分离与旧围栏拒绝专项2026-11-02)。

## Agent 工具故障后总任务结束等待（2026-11-02）

本轮在原专用目录 `/tmp/nexus-nethogs-20261030/` 保留全部夹具、日志和缓存。使用 Node 22.23.1、pnpm 11.28.9；TMPDIR 和 NODE_COMPILE_CACHE 均指向该目录。只运行以下定向回归，不执行本地全量 E2E：

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-工具故障后总任务结束等待2026-11-02)。

## 手机终端自适应底部越界（2026-11-02）

沿用 main beff7a99 的现有未提交工作区、Node 22.23.1/pnpm 11.28.9、原 Vite9998 及专用 `/tmp/nexus-nethogs-20261030/`；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端自适应底部越界2026-11-02)。

## 服务器状态趋势时间轴与加载呈现（2026-11-02）

同一 main beff7a99 未提交工作区、原 Node22/pnpm11 工具、Vite9998 和 `/tmp/nexus-nethogs-20261030/`。指定站点/CDP 的独立 context 挂载真实 StatusMonitor/StatusCharts，提供只读内存样本与控制器，拦截真实 StatusCharts.vue 模块请求以保持加载，释放后加载原模块；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#服务器状态趋势时间轴与加载呈现2026-11-02)。

## 依赖升级与 main dev 发布（2026-11-02，完成）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#依赖升级与-main-dev-发布2026-11-02完成)。

## 手动清理 Actions API 瞬时失败（2026-11-02，完成）

用户要求解决另一条Actions失败。实际为手动清理[41461823321](https://github.com/0honus0/nexus-terminal/actions/runs/41461823321)，job125332537068已解析latest/dev并计划删除旧资源，DELETE artifact13145138530返回GitHub HTTP500；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手动清理-actions-api-瞬时失败2026-11-02完成)。

## 文件拖动悬停导航与右键取消（2026-11-02）

FileManager 的内部原生拖动在目录行和 `..` 行停留2秒进入，导航保留本次原始条目，当前目录空白松手沿原moveTo链派发。右键取消清空拖动源、选择、悬停等待和目标；不更改当前浏览目录，也不派发移动。文档级捕获右键drag/dragover/drop覆盖源节点因导航移除、容器外及快速松手，失活/断线/换通道/卸载清理计时与监听。保留原快速drop、移动过滤、外部上传和UI。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动悬停导航与右键取消2026-11-02)。

## 手机编辑器底栏两行布局（2026-11-02）

用户报告路径及amd服务器名遮挡、换行符太窄，随后要求最多两行且保持紧凑。基线通过指定CDP在390px手机、16px边距的真实FileEditor受控挂载复现：原路径可见宽度仅3.33px；320px时路径0px，scope超出identity范围；换行符被原窄屏规则压至49.59px。原footer强制nowrap，identity与元信息/按钮竞争且overflow裁剪；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机编辑器底栏两行布局2026-11-02)。

## 重置/删除共用确认弹窗布局（2026-11-02）

用户要求优化重置终端、删除等确认弹窗并提供截图。基线为原UiConfirmationPanel：图标占正文左列，默认slot即使仅Vue条件注释也留18px（手机20px）内容padding；同一手机content样式存在重复覆盖。改为标题/图标同行、整行正文，描述字号13px/行高1.75，空content用:empty隐藏；确认按钮区有细分隔和浅底，手机等宽且44px高。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#重置删除共用确认弹窗布局2026-11-02)。

## 手机终端点击键盘跳动与全局确认消费者（2026-11-02）

本轮main/78997c1a及既有未提交拖动/编辑器/确认布局变更之上，用户确认终端普通输入和htop点击均导致软键盘反复跳动，并要求排查后统一全部同类确认弹窗。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#手机终端点击键盘跳动与全局确认消费者2026-11-02)。

## 本批 UI 修复远程 E2E 与发布（2026-11-02，完成）

用户授权推送、修复E2E并发布，08b6b2b58a6d8aa5f121816bd112fb05b800673d已推送main。首轮41484802901质量、Docker及7个测试分片成功，browser 6出现两项首次/重试相同失败：新增拖动多选初始化点击hover-source后，触屏桌面正常单击导航到/hover-source，随后寻找原目录hover-one.txt超时；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本批-ui-修复远程-e2e-与发布2026-11-02完成)。

## 文件拖动父目录反馈与600ms悬停（2026-11-03）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#文件拖动父目录反馈与600ms悬停2026-11-03)。

## 连接表单底部错误 Toast（2026-11-03）

用户明确只迁移底部操作错误区域，测试结果与延迟说明保持。沿原useConnectionForm→useFeedback通知owner：修改连接参数且密码为空使用warning Toast，选项加载/提交校验错误使用error Toast，删除submitError及ConnectionForm内唯一UiInlineNotice；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#连接表单底部错误-toast2026-11-03)。

## 网络趋势上下行标题对齐（2026-11-03）

用户要求当前网络上下行速率与CPU当前值一样放在趋势标题右侧。根因是原network-legend为history-header的第三个单列网格项，在range-tabs之后。将原图例移入history-heading、放到关闭按钮前；原flex图例增加收缩/最小宽度/右对齐与自动左边距，窄栏可在标题右侧区域将两个速率换成两行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势上下行标题对齐2026-11-03)。

## 网络趋势最窄宽度同排与完整标题（2026-11-03）

用户追加要求最窄栏位与手机同样左右同排、左侧网络趋势完整。上版同日after.json的180px记录标题溢出9px、两个速率上边界相差约18px，符合原允许省略/换行设计，本轮依最新要求调整。仅原StatusMonitor增加网络标题行class；该标题不收缩/省略，网络图例改flex:1且不换行，图例自身为inline-size容器，子项字号取原11px/scale与自身6.5cqw的较小值。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络趋势最窄宽度同排与完整标题2026-11-03)。

### 导航切换布局阻塞（2026-11-04）

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#导航切换布局阻塞2026-11-04)。

### 终端标签菜单顺序（2026-11-04）

WorkspaceTabBar仅将原挂起菜单项移到重置之前，原条件、事件、分隔线和关闭项保持。USAGE的SSH会话章节同步顺序；无类型、协议、资源或架构边界变化。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#终端标签菜单顺序2026-11-04)。

### Agent App 卸载目录、数据清除与读取性能（2026-11-04）

复用上一轮隔离Backend3001与Vite9998，CDP http://172.30.30.11:9223 访问 https://api.honus.top，真实签名Full-stack包来自专用本地fixture仓库29092；没有更换生产服务或读写生产库。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-卸载目录数据清除与读取性能2026-11-04)。

### MCP / ACP 工具栏换行与手机同排（2026-11-04）

只修改AppIntegrationSettings的应用选择框尺寸及AppIntegrationEditor的操作组排布/窄屏短文案，未修改基础UiSelect或业务状态/请求。原w-40被基础未分层ui-select的width:100%覆盖，选择框占满一行，将刷新/创建挤到下一行。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#mcp--acp-工具栏换行与手机同排2026-11-04)。

### 移除内置 Agent 与官方插件启用引导（2026-11-04）

按用户最新要求采用没有内置应用的当前设计，不实现旧ID映射、旧数据退役或迁移；删除默认初始化、手工创建App链、默认声明/实例字段与快照内置旁路。初始v1签名为backend-next-v1-initial-20261104-plugin-apps。旧测试库和全部既有目录保留；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#移除内置-agent-与官方插件启用引导2026-11-04)。

### 后端架构偏移与容量同步审计（2026-11-04）

本轮用户授权继续架构审核，合理问题直接修正，并统一双端限制/去除不必要固定限制；保留此前全部未提交变更。仅执行源码、AST/类型静态审核与构建，按PLAN D17未新增或运行行为测试、CDP、本地/远程E2E；前序插件/市场/工具栏专项PASS不算本轮行为验证。不重启服务、不操作生产库、不提交推送。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#后端架构偏移与容量同步审计2026-11-04)。

### Agent App 操作组垂直居中（2026-11-04）

用户报告App列表右侧安全策略配置、禁用和卸载操作组未垂直居中。源码确认AppManagementSettings父行从sm断点使用flex-row/items-center，子操作组的self-end覆盖父行对齐，令整组贴概要底部；本批仅删除该self-end。组件的嵌入与独立入口共用此行；639px及以下原全宽三列grid规则保持，UiButton、图标、启停/卸载确认及清除数据流程不变。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#agent-app-操作组垂直居中2026-11-04)。

### Nexus Agent 插件与工具设计审核（2026-11-04）

本批按PLAN D17仅源码、架构和静态检查，未运行行为测试、CDP、本地/远程E2E或付费模型请求。产物集中 `/tmp/nexus-agent-tools-audit-20261104`；正式插件从独立仓库基线bda89fc修改，现有全部工作区变更、测试服务和产物保留，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#nexus-agent-插件与工具设计审核2026-11-04)。

## 本地文档刷新（2026-11-04）

本批仅整理7份文档：移除 Frontend 与本页误复制的后端架构正文，恢复正确标题与职责；Frontend 重建八节总览并保留前端专项；PLAN 原样保留决定项，退出已完成规划并承接未验清单；纠正旧前端迁移状态、工具审计/认证单调用详情混写、Run 并发与冻结期限、资源目录及部署下载分支。当前源码、规则文档、测试服务和现存数据库未修改，不提交、推送或发布。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#本地文档刷新2026-11-04)。

## 网络切换自动恢复（2026-11-04，源码与静态）

本批产物集中 `/tmp/nexus-network-recovery-20261104`，保留全部前序变更、测试服务与数据，不重启、不提交推送。按 PLAN D17 未新增/运行行为测试、CDP 或 E2E。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#网络切换自动恢复2026-11-04源码与静态)。

## main dev 交付与数据库维护（2026-11-04，已完成）

用户授权提交推送、修复正式远程 E2E、发布 main dev amd64，并更新指定 Nexus 实例及手动维护数据库；另确认删除新版已移除、不再需要的数据。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#main-dev-交付与数据库维护2026-11-04已完成)。

### 第二轮完整通过与发布

修复提交 `fd41a0fe` 的正式远程 [41778130423](https://github.com/0honus0/nexus-terminal/actions/runs/41778130423) 全部success。549场景首次通过，无失败、重试、flaky或跳过：Backend125；Browser1–7分别41/61/53/57/58/94/60（含隔离场景）。

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#第二轮完整通过与发布)。

### 指定主机更新与维护结果

发布 [41778950373](https://github.com/0honus0/nexus-terminal/actions/runs/41778950373) success，包含生产依赖审计与镜像构建/推送；

[完整原始记录](https://github.com/0honus0/nexus-terminal/blob/dc0b3c5f465a927e7a6c7ec44f0800fcbd757a1e/doc/testing/E2E.md#指定主机更新与维护结果)。

## Agent GIF 与模型文件交付（2026-11-05，源码、静态与限定浏览器）

本轮工作区基于 `745beddb308778d6a6ffe5915c9b7eb682d6f15c`，新增真实 GIF Images 响应、file_deliver、artifact_present 及文本自动文件卡；outputArtifactId 是现有工具结果的派生投影，无数据库列或持久数据格式变更，不需要迁移。参考模式固定源码链接见 [当时的Agent文件交付设计](https://github.com/0honus0/nexus-terminal/blob/100291a781a7e6884d5616240ab619802c94d179/doc/architecture/AGENT.md#模型文件交付)，未引入第二套文件库或预览引擎。

环境为 Node 26.13.0 / pnpm 12.16.1；根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build`、`git diff --check` 通过。E2E TypeScript 使用 vue-tsc 和任务独立 tsconfig 检查通过；裸 tsc 不支持已有 Vue 模块入口，已改用项目相同 Vue 检查器，未放宽类型。产物集中于 `/home/honus/nexus-task-artifacts/agent-file-delivery-20261105`，保留参考源码、检查输出及真实两帧 GIF；ffmpeg 帧摘要确认两帧内容不同，此事实不代替浏览器播放验收。

新增正式场景：functional-images 的 PNG/GIF 实际解码、浏览器逐帧截图变化、原字节及刷新恢复；file-delivery 的 320/390/1440px 文本文件预览/下载、展示既有文件不重复写入，SSH GIF/普通/大于采样区文件/空文件、双能力/目标/批准拒绝、链接/目录拒绝、取消与 SFTP 句柄释放。execution-flow 增加后端流式故障入口，覆盖短读/超读/修改时间变化、逐块撤权、消费失败/提前退出、原始读取与资源关闭失败及跨模块错误身份。现有 PNG 与供应商拒绝断言保持。

按用户本轮“浏览器验证”授权执行限定本地浏览器，不复用上一轮 577 项通过；正式远程全组与新增后端流故障专项尚未执行，真实模型工具选择、付费 GIF 支持、网络和介质故障仍有外部依赖。本轮未提交推送、发布或部署，未修改生产数据库。

### 限定浏览器验收与插件权限

使用同一工具链、Playwright 1.64.1 / Chromium 1248，真实前后端生产构建、认证 HTTP/WS、签名测试插件与真实 SSH/SFTP 夹具；图片及聊天模型使用受控 Provider。运行命令为 `pnpm --filter @nexus-terminal/e2e exec playwright test --config=/home/honus/nexus-task-artifacts/agent-file-delivery-20261105/browser.config.ts agent/functional-images.spec.ts agent/file-delivery.spec.ts`。独立配置仅调整产物路径、诊断超时并移除本任务无消费者的桌面服务；未替换被测产品实现。临时文件、数据库、报告、Trace 和截图均归任务目录；SSH 文件夹具沿正式测试入口并在 finally 删除。

首轮 17 项中 8 通过、9 失败：受控模型从 JSON 字符串解析路径时带上末尾引号，且窄屏测试未关闭遮挡的原任务栏；缺权限时强行返回未提供的工具，实际为 `model_response_invalid`，原测试误期望普通 failed。修正夹具并补精确路径与失败码断言；未改产品 UI 或放宽授权。第二轮扩为 19 项，12 通过、7 失败：两个测试从列表误读仅详情提供的失败码；取消采样流还暴露真正的应用故障，导致后继 5 项被原应用关闭拒绝阻断。Remote 公开字节流与 ToolModel 现在分别转换所属安全失败，ArtifactModel 保留源失败、持久化失败和真正清理失败的区别，正常取消不再记作内部故障。已补正式后端采样中断回归源码，其专项尚未执行。

第三轮 19 项全部一次通过。随后错误优先级审核修正 ToolModel 在同一操作 owner 内保留权限复查、消费及持久化的真实故障，正常源流拒绝不能覆盖这些故障，真正清理失败仍独立保留；补充权限存储失败的正式后端回归源码，其专项尚未执行。最终代码重新构建后第四轮 19 项全部一次通过，无失败、重试、flaky 或跳过；JSON Reporter 逐项核对见任务目录 `browser-verification.json`，最终原日志为 `browser-round4.log`、`browser-round4.json`，四轮原日志与失败现场均保留。覆盖 320/390/1440px 文本文件卡/预览边界/原生下载/已有文件展示不重复入库/刷新恢复；SSH GIF、Markdown、256 KiB 二进制、空文件原字节及 hash；缺两项能力之一、未选目标、拒绝审批、目录和符号链接；取消 held SFTP read 后 pending/句柄归零，无成功卡且后继正常重建基线。PNG/GIF Images 均解码、下载和刷新，GIF 用浏览器逐帧截图变化确认动画；供应商三类拒绝保留原断言。最终根 check、后端及 Shared 构建和 E2E vue-tsc 通过，日志分别为 `browser-final-check.log`、`authority-fix-build-final.log`、`browser-e2e-typecheck-final.log`。

只读核对官方插件 [v1.0.3 manifest](https://github.com/0honus0/nexus-agent-plugins/blob/d5dd455e209fffb86433cedb7044c507a0d848b3/plugins/nexus.agent/manifest.json) 与 [agent.json](https://github.com/0honus0/nexus-agent-plugins/blob/d5dd455e209fffb86433cedb7044c507a0d848b3/plugins/nexus.agent/agent.json)：已声明 file.read / artifacts.write / artifacts.read，toolNames 为 null，因此无需修改或重新发布该插件。显式工具白名单的第三方插件需补所需工具名；原授权撤销不自动恢复。本次浏览器消费签名受控插件，不冒充真实模型或官方发布包的运行验收。

### 提交与首轮完整远程回归

用户授权提交、推送和发布版本，沿当前 main / linux/amd64 dev 渠道交付，不更新生产实例。功能提交 `100291a781a7e6884d5616240ab619802c94d179` 已推送；首轮 [E2E 42009569193](https://github.com/0honus0/nexus-terminal/actions/runs/42009569193) 质量、构建与 Docker smoke 通过，但后端新增流故障入口失败，Browser 5 的旧触屏终端重绘测试重试通过而被正式 flaky 门禁拒绝；其余分片通过。本轮没有发布镜像。

后端 16 个子场景中，权限存储故障的断言错误地只检查 error.cause 的 AggregateError；实际 owner 返回顶层 AggregateError，并完整保留原存储故障与读取拒绝。修正为明确检查顶层聚合、两项因果、原存储错误身份、具名读取拒绝和 drain 分类，不改产品实现。触屏 Trace 记录显示从 650px 切回 1180px 后，fill 命中待卸载的手机命令框，而 press 已命中新建的空桌面命令框；测试改为等待目标响应式命令栏挂载再输入，并断言待发送值，保留原 ANSI 清屏、中文残留、背景色和全部视口断言，不添加固定等待或修改 UI。原 SHA、后端日志、Browser 5 首次 Trace/日志及整轮状态均保留在任务目录 `remote-e2e-42009569193.*`、`remote-failure-42009569193-backend/`、`remote-failure-42009569193-browser5/`。修正文件的 ESLint、Prettier、Node 语法及 diff 检查通过，下一轮完整远程验收待执行。

### 第二轮完整通过与 amd64 dev 交付

修正提交 `ed9003d0f8df48d8e6a03611945dace8504b4514` 的完整 [E2E 42010824912](https://github.com/0honus0/nexus-terminal/actions/runs/42010824912) success。逐项解析正式 Reporter：593 条唯一 passed 记录，首次全部通过，无失败、重试、flaky 或场景跳过；11 个 regular/isolated 执行组均 passed。Backend 132 项，Browser 1–7 分别 42/44/60/75/79/90/71 项；质量、双端生产构建、Docker smoke、8 个分片及耗时更新作业全部 success，文档截图按条件跳过。新增后端 16 个子场景包含原字节、短读/超读/修改时间变化、逐块撤权、消费失败/提前退出、原读取/资源清理失败、采样中断与权限存储故障；浏览器文件交付和 GIF 正式场景均通过。原始证据在任务目录 `remote-e2e-42010824912.json`、`remote-e2e-42010824912.log` 和 `remote-verification-42010824912.json`。

CI 后继提交 `62fb68f839f6facb5c25283a2edc0b459c9d8018` 仅修改 `scripts/e2e/duration-estimates.json`，已核对产品与测试完全一致。以该 main 提交启动 [amd64 dev 发布 42011867002](https://github.com/0honus0/nexus-terminal/actions/runs/42011867002)，生产依赖审计、构建与推送全部 success。直接读取 GHCR 核对：`dev` 与 `sha-62fb68f839f6` 同为 `sha256:178381da7fa0230721296668eac5ef57f4152a3a244f7aa9728b93b66f409db7`；实际镜像为 linux/amd64，OCI revision 为 `62fb68f839f6facb5c25283a2edc0b459c9d8018`，version 为 `sha-62fb68f839f6`。发布状态/原日志为任务目录 `publish-42011867002.json`、`publish-42011867002.log`，镜像原始查询与核对摘要为 `image-dev-inspect.txt`、`image-sha-inspect.txt`、`image-config.json`、`publication-verification.json`。本次没有数据库格式变化，无需新增迁移；不部署远程实例，官方插件也无需重新发布。测试目录与首次失败证据保留至用户通知清理。

## E2E 耗时产物下载与重跑（2026-11-05）

原 `8e4765a6` 的 [42031844232](https://github.com/0honus0/nexus-terminal/actions/runs/42031844232) 中594项测试、质量和 Docker smoke 均成功，仅耗时下载失败：官方下载 Action 的内部 ListArtifacts 请求遇到 ECONNRESET。修正为 token/REST 下载、保留 SHA256 校验，并独立解析分片产物 ID，不忽略最终下载失败或缺失产物。

首版 `e6786d85` 的 [42034179288](https://github.com/0honus0/nexus-terminal/actions/runs/42034179288/attempts/1) 完整594项、构建、质量、Docker smoke 和汇总均成功；随后仅重跑汇总的 attempt2 失败，暴露 GitHub 会复制已成功 job 并更改 ID/run_attempt，但沿用原 started_at/completed_at。直接拿复制 job 的 attempt 拼产物名仍会错误寻找并未生成的 attempt2 产物。本轮未将该失败重跑记为成功。

最终 `90bf154544ad086e06571f3f9e000d263934ddff` 让构建等待和耗时汇总复用同一 job-artifacts owner，按当前运行、源 job 实际执行时间、产物创建时间及名称前缀选取不可变 ID；拒绝其它执行周期、重复、过期或缺失产物。构建下载也改用官方 REST 路径。7项逻辑回归覆盖混合真实执行周期、复制成功 job、仅重跑汇总、构建复用、全量重跑拒绝旧构建、缺失/过期/重复和 API 失败；已接入质量作业。使用失败 attempt2 的真实 API 元数据，另确认能选齐8份耗时及原构建。Node26.13.0/pnpm12.16.1 下根 check、全量格式、Node 逻辑回归与 diff 检查通过。

最终 [42035960955 attempt1](https://github.com/0honus0/nexus-terminal/actions/runs/42035960955/attempts/1) 完整通过。逐项核对正式 Reporter：594条唯一 passed，零失败、重试、flaky或场景跳过；Backend132，Browser1–7为42/73/67/63/70/73/74项。质量及其7项逻辑回归、双端生产构建、Docker smoke、8个分片和耗时更新全部success，文档截图按条件跳过。包含此前 `90df431d` 的GIF稳定分组、嵌套 Markdown 图片与下载说明保留，以及 `8e4765a6` 取消按钮移动后的既有操作回归；未将这些场景称为专项视觉验收。

再单独重跑汇总的 [attempt2](https://github.com/0honus0/nexus-terminal/actions/runs/42035960955/attempts/2) 成功；日志确认下载全部8份名称仍为 attempt1 的耗时产物，当前分支已前进时正确跳过旧估算推送。后继 `0c0355a8` 仅为CI耗时更新，已快进同步；没有发布镜像、部署实例、改数据库或更新插件。专项视觉与真实设备边界继续保留在 PLAN。

原始失败、首版完整运行与失败重跑、最终两次成功的日志及元数据集中 `/home/honus/nexus-task-artifacts/e2e-timings-20261105`；逐项摘要为 `final-report-summary.json`，最终原日志为 `final-run-attempt1.log`、`final-updater-attempt2.log`，状态为 `final-run-attempt1.json`、`final-run-attempt2.json`。首次测试方法空行格式错误修正后全量格式通过，修正复制 job 后再次检查通过；证据与测试目录保留至用户通知。

## Agent 工具批次与 Run 连接资源（2026-11-05）

基于本体 `2abcf49b` 的当前工作区；Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1，产物统一保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105`，未部署生产。SSH 串行复用、并发独占传输，SFTP 保留自己的连接；Shell 一次 exec 承载 commands[]，不使用远端临时文件或常驻 Shell。

真实竞争实验使用项目 Ssh2MachineFactory 与 NdjsonAcpAdapter、本机 SSH、全局 512 KiB/s 下行限速（TCP 公平分配），每组 3 次且校验 SHA。2 MiB SFTP 与小 exec 共用传输时小命令 2074–2079ms，独立传输为 152–153ms，两组文件传输均 4.25–4.27s。2 MiB exec stdout 与已启动 ACP 并发时，权限响应共用传输为 4187–4207ms，独立传输为 52–53ms，整组完成仍 4.2–4.4s；因此整批最后返回并不能消除中间审批的等待。原始脚本/JSONL 为 ssh-contention 与 ssh-exec-acp-contention；实验只证明该环境下避免同连接背压，不保证独立带宽、主机 CPU 或跳板性能。

本轮定向执行：`yield-second.log` 8 项通过；`batches-second.log` 的文件 UTF-8/目录分页、批次 patch/search/deliver/present、结果续读及 v1→v3 实际 SQLite 升级通过；Docker 旧夹具失败已修正，`isolated-third.log` 29 项全部通过，覆盖真实 2 MiB exec 与 ACP 权限并发、SSH 生命周期、Browser 会话队列/配置屏障与故障收尾、Docker 批次。保留首轮错误输出，不沿用已替换的共用连接实验结论。

`check-final.log` 根检查通过；`build-e2e-final.log` Shared、双端及测试客户端构建通过。`resources-browser-second.log` 在 1280/390/320px 各验证关闭连接和关闭界面：6 项通过，截图随正式测试产物保留；最小化/取消关闭保留原 resourceId，确认停止后 Run cancelled 且资源移除。首次用例误把审批等待资源要求为 idle，已改为真实 busy 状态，未改产品 UI 绕过断言。

数据库保持 v1 签名不变，独立 v2 转换 Shell Job 结果为 commands[]，v3 转换历史交付/展示结果为 items[]；正常重启执行升级并验证第二次启动不重写，迁移失败回滚由 phase2 场景验证。快照身份改为完整有序迁移链签名，不接受不同链快照。

官方插件 main `7f0498cf14fa50f7a664adf892ef041c62ad7fab` 已通过 [Validate 42074435148](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42074435148)，[打包 42074606017](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42074606017) 成功；下载后验证 catalog SHA/大小、全部文件 hash 与固定发布者 Ed25519 签名。[Nexus Agent 1.0.4](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v1.0.4) 已发布，Full-stack 保持原 1.0.3，SDK 与权限声明不变。

本地完整 Backend 首轮 140 项通过，1 项因 Node 不接受空 --test-name-pattern 参数而启动失败；修正 wrapper 仅在非空时传入参数后，正式相同入口重跑该项通过（local-backend-corrected.log），实际 SQLite 脚本另有 phase2-final.log。Browser 首轮交付审批摘要及 A01 Provider 夹具仍读取旧单项字段，已按 paths[]/items[].value 更新并保留首次失败，后续用当前契约验收。远程 runner 同步增加官方 Docker 29.9.2 CLI，后端分片独占其临时 Actions 主机 socket，实际 Docker 用例不跳过或换成模拟成功。

### 首轮完整回归修正

本体实现提交 `8bff9305e3b9d3a31346c92906d787c565c7314e` 的 [远程 E2E 42076105731](https://github.com/0honus0/nexus-terminal/actions/runs/42076105731) 未通过，原日志与后端诊断产物保留。旧测试仍读取单项 Shell/Job/File 结果，任务提醒未计入命令批次预览序号，现逐项适配并保留退出码、内容 hash、审批/焦点和实际进程退出断言。本地相应六份浏览器文件修正后 32 项通过（local-browser-corrected.log）。ACP 取消实际保留 unknown 工具账本与关闭证据，进程已退出；正式夹具增加显式预期关闭校验并保留原数据库，不忽略清理或存储失败。

远程另发现 ssh2 的 close/destroy 不一定结束忽略 TERM 的远端命令输出流。批次读取改为同时观察命令终态，未知终态解除本地读取监听后，由原机器 owner 退役并等待传输关闭；仍保留原 mutation blocked 和 Job unknown，不重放。新增“输出流永不结束”的确定性回归，原真实 SSH 的 held/blocked 用例不放宽等待期限；yield-final.log 共 9 项通过。CI 先前只安装 Chromium headless shell，Puppeteer 定向测试缺完整 Chromium，runner 改为安装同版本 Chromium 全套。

### 完整远程验收

[E2E 42079275442](https://github.com/0honus0/nexus-terminal/actions/runs/42079275442) 在 `646f1e6db68dd91ef83132faec8b9de0fd49ae94` 完整成功：正式 Reporter 共610条唯一 passed，失败、重试、flaky、场景跳过均为0。Backend141项，Browser1–7分别35/92/76/65/76/61/64项；质量与格式、双端构建、Docker smoke、runner准备及耗时汇总全部成功，仅条件不满足的文档截图作业跳过。原日志、元数据和逐分片/项目统计为 remote-final-run.log、remote-final-run.json、remote-final-summary.json。

本地较新 xrdp 仅在 DEBUG 输出实际 VNC 认证成功，旧夹具计数 INFO 镜像行导致真实认证成功后仍断言超时；`646f1e6d` 改计唯一 canonical DEBUG 行，既适用于本地新版本，也避免 CI 旧版本重复计数。此修正随上述完整远程回归通过。后继 `0fa770a8` 仅更新耗时估算，镜像运行代码与构建输入相对被测 SHA 完全一致。

### 本地完整回归与连续场景

local-browser-final.log 的完整469项运行保留463项通过和6项失败，不能称整轮全绿。该进程启动时仍加载旧桌面夹具，造成桌面3项及手机1项认证计数超时；另外2项 Pad 大输出恢复在读取日志前因保留的 unknown 数据库被误计为第二个活动实例而失败。原数据库、Trace、截图、录像和逐项日志已在服务全部停止后归档至 browser-final-first-181444。

`346def40` 将显式预期 execution_unknown 的数据库移至 backend-data/evidence/，保留原名、数据库和围栏事实；正常活动实例仍只在 backend-* 命名空间，不放宽 suspend 日志唯一实例断言。源码仅改测试夹具，格式、ESLint、Node语法与diff检查通过；产品未知结果和清理失败的处理不变。

随后按正式 `NEXUS_E2E_SUITE=all` 入口连续运行 ssh-acp-settings、rdp-remoteapp-fullscreen、suspend-log-compaction、pad-suspended-output、touch-workflows 五份文件，共22项全部通过（1.5分钟，local-final-corrected.log）。这轮先执行 ACP 取消并留下 evidence 数据库，再执行真实日志压缩、两个112MiB远端输出和原Shell恢复，以及桌面/手机RDP认证、文件批次取消和音频上下文退役；没有单独重置进程来绕过证据目录问题。服务停止后保留当前轮全部产物与原数据库，覆盖先前6项失败；本地全量加修正复测与远程完整一次通过分别记录，不合并成一次本地全绿。

### 最终源码验收与审核结论

包含证据目录修正的 `346def40812b4ef696a82467e403cdf7c326ba31` 已通过 [完整 E2E 42082006188](https://github.com/0honus0/nexus-terminal/actions/runs/42082006188)。正式 Reporter 核对610条唯一通过，失败、重试、flaky和场景跳过均为0；Backend141项，Browser1–7分别39/69/64/68/77/58/94项，质量/格式、构建、Docker smoke及耗时汇总均成功。最终原日志、元数据及统计为 remote-latest-run.log、remote-latest-run.json、remote-latest-summary.json；本地原失败与22项连续复测的对应关系见 local-final-summary.json。后继 `01caa834` 只更新耗时估算。

| 审核表   | 结论与证据                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 批次工具、分页、事件等待、Run资源、10分钟续期、结束排空和手动关闭确认均已接线；本地定向及最终完整610项回归通过。                                                                       |
| 职责归属 | Remote Model持独占传输及技术转换，Tools持Run能力，Runs协调关闭与生命周期；前端复用全局确认组件，未改无关UI。                                                                           |
| 类型归属 | 双端安全视图和关闭协议归Shared；内部应用、存储和技术对象独立定义并白名单转换，全部真实消费者同步。                                                                                     |
| 完成证据 | 根check、完整格式和双端构建通过；SSH/ACP竞争与取消、Browser/Docker、真实SQLite迁移、1280/390/320px关闭流程及完整远程均有对应日志。插件和amd dev镜像已交付，不扩大真实设备/供应商保证。 |

### 镜像交付

[amd dev 发布 42081065621](https://github.com/0honus0/nexus-terminal/actions/runs/42081065621) 成功，源码 `0fa770a821324f16c7c9a62905025a41f592450d`；`ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-0fa770a82132` 指向同一 index：`sha256:ffe28db0e71200d0ea08e0874db54b46d69211e1c281fe65ee7fe608c55d33d9`。从 GHCR 读取并校验 manifest/config 的 SHA-256，实际平台仅 linux/amd64，平台 digest 为 `sha256:ae6063f070cf119b00bb3e46a114bd4c00e2bf73ec33e0cf64653709d70375e8`，OCI revision 与发布源码一致。发布日志、元数据和注册表核验分别为 publish-run.log、publish-run.json、published-image.json；不把后续文档提交称为该镜像源码，未更新生产实例。

发布后的 `346def40` 仅改测试证据目录，另有耗时估算和文档提交；已核对最终源码相对镜像源码的产品包、Dockerfile、锁文件、工具链和发布workflow无变化，镜像包含本次全部运行功能修改。测试目录、失败证据和专用任务目录保留至用户通知清理。

## Agent 手机服务器选择图标（2026-11-05）

按用户授权修正AgentAppSurface目标触发器：原来只按composer宽度超过620px显示文字，现在复用Foundation的useDeviceCapabilities，手机含横屏/宽视口始终只显示服务器图标；电脑宽输入区保留文字与已选数量，窄输入区沿原收缩规则。组件持展示判断，Foundation持设备能力，原popover选择、无障碍名称、授权及Shared/后端契约均不变，无数据库迁移。核对既有目标选择消费者并同步USAGE及前端架构；根check、完整格式和前端生产构建通过，日志为agent-tool-reuse-20261105任务目录下的target-mobile-{check,format,build}.log。此条仅记录源码与静态/构建结果，宽窄输入区专项视觉及真实手机边界仍沿PLAN保留，正式回归由推送后远程E2E执行。

## 前端分级日志完善（2026-11-05）

本轮基于 `main/5580aaec348a1a200fa5f52b360264154df1a238` 的未提交工作区；记录本轮源码与命令，不复用前次远程 E2E 作为验证。继续使用 Pino 与 Shared 日志等级，没有 UI、后端协议、数据库或部署变更。

| 审核项         | 结论                                                                                                                                                       |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 契约与消费者   | Shared 等级唯一；偏好 Store 同步原 Pino 实例。Client、app、Workspace 和 Agent 消费同一 owner，无新日志系统或公开接口。                                     |
| 类型与转换     | HTTP/WS 只投影安全元数据，异常只投影类型/源码位置；查询参数、凭据、正文、自定义异常字段不进入新增日志。                                                    |
| 生命周期与并发 | 请求回调仅结算一次，Axios 通过 WeakMap 关联；WS 单次监听、Agent 原退订/重连及页面级诊断 owner 保持原生命周期。高频输出仅既有 trace，关闭等级不序列化异常。 |
| 失败与恢复     | 正常取消/主动关闭为 debug；网络/重连为 warn，5xx/协议/未捕获异常为 error；等级切换不冒充错误，silent 不输出切换通知。                                      |

- 工具链：Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1，测试服务使用动态隔离的本地环回端口与独立 E2E 基线。
- 静态与构建：根 `pnpm run check`、`pnpm run format:all:check`、`pnpm run build:frontend`、测试专用客户端构建与 `git diff --check` 通过。专项入口同时重新构建 Shared、Backend、Frontend 和测试客户端。
- 初轮 `pnpm test:e2e:remote -- --project=ui frontend-diagnostics.spec.ts`：3 项一次通过（6.0s），包含等级过滤、异常脱敏和关闭时不序列化、Axios/fetch 的状态/取消/网络/格式失败及运行时错误。
- 补齐 WS 后执行 `pnpm test:e2e:remote -- --project=ui frontend-diagnostics.spec.ts system-settings.spec.ts --grep frontend`：5 项全部一次通过（8.7s），无失败、重试或跳过；新增 WS 正常/异常关闭与 silent、关联编号和内容隔离，并回归前后端日志等级独立保存、重载保持和非法等级拒绝。
- 产物保留在 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105/frontend-logging-*.log`；正式测试入口的 `remote` 名称只表示动态端口本地执行，不代表 GitHub Actions。
- 未验：本轮未提交/推送、未运行正式远程完整 E2E，未在生产服务或真实手机弱网/后台现场复现；Agent 与工作区状态日志已静态审核，不能据此声称真实卡死场景全部覆盖。无生产更新。

## Agent SSH 目标入口按宽度响应（2026-11-06）

本轮在上一轮前端日志的未提交工作区上只调整 `AgentAppSurface.vue` 的目标入口显示条件，并同步 USAGE 和 Frontend 架构；不覆盖既有本地修改，没有提交、推送或部署。

- 契约/消费者审核：目标入口的文字、已选数量、下拉箭头和 square 外观共用 `showTargetLabel`，目标选择与权限协议不变。
- 转换审核：去掉 `useDeviceCapabilities/isMobile`，改为 VueUse 的页面 `min-width:768px` 与既有输入区 `>620px` 条件；复用既有响应分界，不引入设备/UA/触控类型判断。
- 生命周期审核：媒体查询由 VueUse 随组件作用域释放；继续复用输入区测量，无新监听 owner、定时器或持久状态。
- 风险审核：窄屏保留图标、标题、可访问名称和完整选择弹层；桌面页面收窄与手机 UA 的宽页面均按实际空间响应。
- 静态：根 `pnpm run check`、`pnpm run format:all:check`、`git diff --check` 通过；限定回归入口重新完成 Shared、Backend、Frontend 生产构建与测试客户端构建。
- 浏览器：沿用正式夹具和已有 `configuration-hints.spec.ts` 的真实目标选择/批选/权限场景，任务目录中的临时配置增加验收 hook；1 项一次通过（9.9s），无重试或跳过。验收桌面 UA 1440px 有文字、390px 仅图标、恢复宽度重新展开，以及手机 UA 在 1440/390px 下分别展开/收起。截图已目视核对。
- 产物：`/home/honus/nexus-task-artifacts/agent-target-width-20261106/` 保留临时配置、hook、日志及四张截图；代码检查日志在上一任务目录 `agent-target-width-check.log`。未向产品加入测试入口或永久新增低影响样式测试。
- 边界：本轮为本地 Chromium 受控验收；未运行正式远程完整 E2E，真实手机软键盘、横竖屏与其它语言仍沿 PLAN 的真机专项记录。

## Agent Host 工具按需发现（2026-11-06）

基于 main `5580aaec348a1a200fa5f52b360264154df1a238` 的未提交工作区实施，保留既有前端日志与目标入口宽度修改；没有提交、推送、发布或更新生产环境。无 Shared/HTTP/数据库结构变化，不需要迁移。

采用 [Vercel AI SDK toolSearch](https://github.com/vercel/ai/blob/6737c7721b10ce489e21efff43a4acf9c8ca7f04/packages/ai/src/tool-search/prepare-tool-search.ts) 的常驻搜索、当前执行持有发现集合、下一轮提供 schema 模式。其公开工厂必须绑定 SDK 的生成循环，非独立检索接口；本项目沿用原 Run/治理/账本，不复制 SDK 私有执行器。检索使用 Fuse.js 7.5.0 的关键词包含匹配，中文分词复用 Intl.Segmenter；不自行评分、不增加五条之类的结果限制。另核对 DeepAgents 原生搜索的模型/端点资格和 Goose 的目录/详情分离。GitHub 元数据已确认 AI SDK、DeepAgents、Goose、Fuse 均超过 H-14 的 500 Star 要求；确切 SHA、源码和元数据在任务产物 reference 目录。

| 审核表         | 已审源码/消费者及结论                                                                                                                                                                                                                                                                                                           |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型与消费者   | tools/model/tool-types、tool-input/definitions、ToolRemoteModel 排除新 targetless 分支、ToolService、RunExecutionOwner、受控 Provider 与 execution-flow 正式入口。availableDefinitions 与当轮 definitions 分离；原 RunModelStream 投影、requestHash、预算和当轮提案白名单仍消费同一份实际声明；无业务类型泄入 Shared/Platform。 |
| 依赖与转换     | tool-catalog-rules 是 live 权限/目标/插件过滤与检索的唯一 owner。Root/Child 原始工具上界在过滤前保留；结果只投影 name/summary，不复制 schema；无 search 权限或被 App 工具白名单排除时直接提供完整授权目录。Fuse/Intl 只执行纯检索，无网络、模型选择请求或新增技术资源。                                                         |
| 生命周期与失败 | Run 内局部 Set，无跨 Run/Child 共享、定时器或重启恢复。搜索复用原读工具账本，complete 和最终 verify 后才发布效果；整批成功及取消/期限检查后按目录顺序合并，下轮再次按当前授权过滤。同轮未加载提案保持原拒绝/unknown 围栏；提交后确认失败、批次失败及取消均不推进下一次模型派发。                                                |
| 验证与风险     | root check、完整 format:all:check、git diff --check、Shared/Backend/Frontend 与 E2E 客户端构建通过。下列本地正式 runner 回归通过；真实模型选词/发现成功率、prompt cache 和计费收益未测，GitHub Actions 全量未运行。                                                                                                             |

执行环境为 Node 26.13.0、pnpm 12.16.1、Playwright 1.64.1。`test:e2e:remote` 本轮仍是动态端口的本地正式 runner，不代表 GitHub Actions：

- 双协议专项在 `backend-next-agent-tool-loading.integration.mjs`：两种协议各 10 个场景，加父用例共 22 项。覆盖精确名/中文关键词、无匹配、schema 下一轮加载与复用、fresh Run 隔离、同轮拒绝、无 SSH 目标、撤权后的目录/执行拦截、插件白名单、显式完整目录、Child 独立与继承上界、取消后的禁止续轮。通过 `agent/execution-flow.spec.ts` 执行。
- `pnpm test:e2e:remote -- --project=agent execution-flow.spec.ts plugin/native-run.spec.ts file-delivery.spec.ts functional-images.spec.ts functional-memory.spec.ts functional-regressions.spec.ts plugin/browser-lifecycle.spec.ts plugin/subagent-lifecycle.spec.ts --output=/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/e2e-results`：**51 项一次通过，4.7m**。覆盖真实 SSH/Browser/SQLite 执行、资源关闭、图片/GIF 与文件交付、原生插件、Child、取消、审批及宽窄聊天界面。
- 补充 `NEXUS_E2E_SUITE=backend pnpm test:e2e:remote -- --project=agent execution-flow.spec.ts --grep 'lazy tool discovery|MCP negotiation|ACP execution' --output=/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/protocol-results`：**3 项一次通过，21.3s**，包含 22 项发现专项重跑及原 MCP 协商/调用、ACP 真实 SSH/入口继承/内层审批链。
- 新增专项初轮暴露 Responses 夹具 added 状态错误，以及同轮未加载提案的终态预期不符；修正为真实协议的 in_progress 和原有 model_response_invalid/unknown 断言，未放宽产品提案校验。后续专项与上述扩展回归全部通过。

实际受控 Provider 收到的 tools 数组测量（同 App 全授权、有选中 SSH、无自定义插件工具）：

| 协议             | 首轮工具数/JSON bytes | 显式完整目录工具数/JSON bytes | 工具定义 JSON 降幅 |
| ---------------- | --------------------- | ----------------------------- | ------------------ |
| Chat Completions | 11 / 8695             | 64 / 42786                    | 79.68%             |
| Responses        | 11 / 8717             | 64 / 42914                    | 79.69%             |

上述是实际编码后的工具定义 JSON，**不等于整体请求 token、账单或延迟同比下降**；实际集合取决于授权和目标，搜索本身也占模型轮次与工具额度。无额外 selector 模型请求。源码、自审、检查/构建日志、三轮专项日志、51 项日志、wire-measurements.json 及参考源码保留在 `/home/honus/nexus-task-artifacts/tool-loading-implementation-20261106/`。真实模型、自然到期及所有未知提交/介质故障交错仍按 PLAN 待验边界推进。

## 诊断、宽度按钮与工具加载补充 E2E（2026-11-06）

基于 `main/5aa6e40a4b4ee7be6a5134c3646e6bf76bb1b07b` 的三组本地功能变更补齐永久覆盖。工具加载新增双协议下的重叠并发搜索/重复加载去重与稳定排序、非法参数失败账本后的有效重试，以及显式插件白名单包含搜索时的目录隔离；每协议 13 个子场景，加父场景共 28 项 Node 测试，由正式 execution-flow 承载。签名 Nexus Agent 浏览器场景进一步核对只读搜索先完成，两个已审批写工具在下一模型步骤完成。

目标按钮以 Desktop Chrome / Pixel 7 的 UA 分别验证 1440→390→320→1440px，窄屏仅图标、宽屏文字和计数恢复，选中目标持续且授权不改变。诊断四项浏览器用例进入正式 UI 分组，覆盖级别动态过滤、脱敏、HTTP 分类关联、运行时错误和 WebSocket 关闭。未增加产品 UI 或数据库变更。

Node 26.13.0 / pnpm 12.16.1：`pnpm check`、`pnpm build`、E2E 测试客户端构建、`pnpm format:all:check` 和 `git diff --check` 通过；Playwright 收集 618 项 / 145 文件。按照 D17，本阶段尚未本地执行新增行为用例，远程整轮结果后续追加。完整源码审核确认目录授权唯一投影、加载只在整批完成及取消/到期检查后生效、Root/Child 各自 Run 生命周期、插件无搜索时的完整已授权目录，以及诊断无载荷/异常正文记录。产物集中 `/home/honus/nexus-task-artifacts/e2e-tool-loading-20261106`，保留至用户通知清理。

### 首轮远程：目录颜色取样时机

`5b96f9692c86b8929c2f31782f88423d817bdcb3` 的 [E2E 42142314918](https://github.com/0honus0/nexus-terminal/actions/runs/42142314918) 首个失败为 Browser 3 的 dark/390px 管理目录用例：通知名称前景已为深色主题的 `(227,226,237)`，卡片背景仍在原 `140ms background-color` 过渡中，截图呈中间灰色，单次即时取样为 3.7175，重试通过。flaky 门禁正确拒绝，未把重试通过计作验收。首次日志、Trace、截图和视频保留在本轮产物目录的 `remote-first-browser3.log` 与 `first-browser3/`。

取色辅助函数现在沿元素及背景祖先等待浏览器实际运行/待启动的 CSS 过渡完成，再使用原 canvas 合成算法和 4.5 下限；未禁用动画、改主题或降低对比度要求。此修正属于测试取样同步，产品源码保持本次提交状态；其它分片完成后核对完整首轮结果，修正 SHA 的整轮另行记录。

首轮最终质量、Docker smoke、Backend 及 Browser 1/2/5/6/7 成功；Browser 4 的既有 SSH 重连场景在真实重连、视口和命令输出均成功后，等待日志超时。诊断实现将连接成功从 debug 提到 info，旧测试仅收集 debug/log，漏收了成功记录；现收集 info 并明确断言失败为 level 20、成功为 level 30，仍验证原目标、重连阶段和密码不外泄。其它 debug 日志消费者已核对，无同类等级变化。首轮完整失败输出保留 `remote-first-failed.log`，job/SHA 保留 `remote-first-run.json`。目录场景另在每次打开页面后断言目标主题已生效，再等待实际过渡完成，避免取到初始主题。

### 整轮远程通过与收口

修正提交 `a5491eabad5fb911c94c2169add5299778999241` 的 [E2E 42143687430](https://github.com/0honus0/nexus-terminal/actions/runs/42143687430) 全部成功：质量与格式、双端生产构建、Docker smoke、Backend 和七个 Browser 分片通过，耗时汇总更新成功；文档截图作业按条件跳过，非测试场景跳过。Reporter 共 618 条唯一 passed，零失败、重试、flaky、重复或场景跳过；Backend 144，Browser 1–7 为 50/57/66/81/61/96/63。相对上一完整基线新增8项正式 E2E（工具加载/MCP/ACP入口3项、目标UA增加1项、诊断4项），工具加载入口另承载双协议28项真实后端 Node 测试，签名插件保留实际授权和后续模型步骤账本断言。

源码与消费者、边界/结构和容量四表已完成审核，无待修缺口；根 check、全仓格式、生产及测试客户端构建通过，本轮 E2E vue-tsc 和54条本地文档文件链接检查也通过。首轮修正仅同步真实日志级别和取样时机，保留原功能/对比度断言与当前 UI。完整运行记录为本轮目录的 `remote-final-run.json/log`、逐项核对为 `remote-final-run.summary.json`，8份实际耗时产物在 `final-timings/`，首次失败证据继续保留。

远程自动提交 `225618e9` 仅修改耗时估算，已审核并快进同步；本次收口只更新文档，不将元数据或文档提交描述为直接被测 SHA。PLAN 清除已验施工区，真实模型效果、弱网/后台现场、手机软键盘与其它既有故障交错仍保留原待验范围。无数据库变更，无发布镜像或生产部署，专用产物按用户要求保留至通知清理。

## Fastify 迁移完整性与框架能力复核（2026-11-06）

本轮按用户要求审核后端完整 HTTP 流程与可复用框架能力，未修改产品代码、安装依赖或提交推送。旧 router/context/JSON 调度的运行时消费者已移除，七模块普通 HTTP 通过同一 Fastify 路由安装入口；Service/Model 未引入 Fastify。原生 Node listener 与 `ws` 仍承接稳定端口、在线恢复代次及 WS 业务生命周期，不能视为遗留路由器，也不能直接用 `app.close()` 取代维护排空。

| 审核项               | 结论与后续                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 实际遗漏：raw 响应头 | `suspend-http.ts` 日志导出仅写 Content-Disposition/Content-Type；`plugin-intent-http.ts` 文件下载及 `file-download-http.ts` 的 416 分支缺少 nosniff。Fastify 全局 `reply.header()` 不会在 hijack 后自动写入 raw。实际挂起日志路由搭配 service stub 的真实 HTTP 请求得到 200，但无 no-store/nosniff；需要补齐并测真实响应头。Nginx 的 nosniff 不能证明后端自身已覆盖，也不补日志的 no-store。                                        |
| 原生发送与编码       | 多处预先 JSON.stringify/encodeAgentJson 计算预算，再 reply.send 对象，发生重复序列化；可用原生 serializer/onSend 在单次编码后检查实际字节，保留 Shared 预算与业务错误投影。简单 Buffer/Readable 可改原生 send；带凭据撤销、最后字节授权和业务交付确认的流仍保留 owner。                                                                                                                                                             |
| hooks 与模块边界     | http-bindings 包装十类 hooks 并适配 callback/Promise，Operations 另外用多个 WeakMap 记录请求阶段。可用 encapsulated plugins、decorateRequest 和 route config 收敛结构；Fastify response 完成不代表异步 handler/审计/补偿结束，真实任务排空不能删。                                                                                                                                                                                  |
| schema 与文档        | 当前未给真实路由安装 schema/validatorCompiler/serializerCompiler。Shared codec 仍承担严格校验，不是完全无校验；统一 schema 后可利用框架验证、响应序列化及 OpenAPI。不得单独抄一份后端 schema，响应 schema 也不代替授权和业务 mapper。                                                                                                                                                                                               |
| 上传解析             | http-body 先缓冲整个请求，再伪造 IncomingMessage 交给 Formidable，并收集各 part；连接导入还自行解析 JSON。`@fastify/multipart` 的流式 parts 可去掉中间整包和伪请求。保留授权先于读取、总字节预算、各 part 限制、秘密清零及取消；插件的 fileSize/parts 不等于整个 multipart 总预算，route.bodyLimit 不能代替该检查。不使用自动落临时文件的 saveRequestFiles 或默认整包附加 body 模式。                                               |
| 原生取消存在版本问题 | Node 26.13.0 + Fastify 5.12.8，设置 handlerTimeout=100ms、handler 等待 150ms；GET 得 503，而正常 JSON POST 在请求体读完时 raw close（complete=true、aborted=false）误触发 signal，并清除 timer，最终仍得 200。源码 route.js/request.js 监听 IncomingMessage close，reply.hijack 还会移除监听。本项目未启用这两项能力，不构成已上线业务超时失效；不能直接用其替换现有取消逻辑。未来接入还须补 FST_ERR_HANDLER_TIMEOUT 安全错误映射。 |
| 日志与安全策略       | request.id/genReqId、onResponse 等可统一技术关联与耗时；现有 Pino 安全白名单和业务审计保留，不能直接打开默认请求日志暴露 URL/凭据。CORS/JWT/session 插件不能替代同源校验、持久会话撤销、事务内授权和来源封禁。前端 Nginx 已开 gzip，暂无再加全局后端压缩的依据。                                                                                                                                                                    |

本地诊断脚本与 JSON 结果保存在 `/home/honus/nexus-task-artifacts/http-fastify-20261106/http-capability-audit.{mjs,json}`；真实 listener + 实际 suspend 路由使用现有 dist，service stub 只提供固定日志字节，不访问数据库、远程主机或真实会话。取消探针直接使用安装的 Fastify，未使用 inject 模拟连接。该脚本报告现状，不是通过的产品回归测试。本轮未重新执行上一节的全量验收。

官方插件选型通过 GitHub 仓库 API 和 README 核对（2026-11-06 查询，Star 会变化）：

| 插件                                                                                                                                                                                                                                                                                      | Star                        | 结论                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| [@fastify/multipart](https://github.com/fastify/fastify-multipart)                                                                                                                                                                                                                        | 539                         | 满足 H-14，优先候选；明确选择支持 Fastify 5 的版本，采用 parts 流式消费和显式限制。                                                              |
| [@fastify/swagger](https://github.com/fastify/fastify-swagger)                                                                                                                                                                                                                            | 1101                        | 满足 H-14；README 声明 >=9.x 支持 Fastify 5。先建立 Shared schema 来源，再注册插件汇总实际路由，不能直接生成准确的现有 codec 契约。              |
| [@fastify/cookie](https://github.com/fastify/fastify-cookie)                                                                                                                                                                                                                              | 300                         | 功能能替代手拼 Cookie；当前不满足 H-14。若以后采用仍须保留同名重复 Cookie 拒绝和凭据撤销，不以普通字典解析覆盖这些语义。                         |
| [swagger-ui](https://github.com/fastify/fastify-swagger-ui)、[helmet](https://github.com/fastify/fastify-helmet)、[compress](https://github.com/fastify/fastify-compress)、[websocket](https://github.com/fastify/fastify-websocket)、[static](https://github.com/fastify/fastify-static) | 192 / 464 / 230 / 467 / 499 | 当前均低于 H-14 门槛，不引入。即使将来满足，也须核对既有 Nginx 压缩/安全头、插件 sandbox、受权资源读取和 WS 维护生命周期，不能为插件数量而替换。 |

## Fastify HTTP 整体迁移（2026-11-06）

基于 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的未提交工作区；Node 26.13.0、pnpm 12.16.1、Fastify 5.12.8。基础框架与 Remote/System 由主代理迁移，Access/Agent/Preferences/Targets/Operations 由 Sol 子代理分工，主代理统一审核与验收。保持 UI、Shared DTO、业务权限和数据结构，无数据库迁移；普通 JSON 的读取时机改由框架负责，使用说明与 API 已同步。专用证据目录为 `/home/honus/nexus-task-artifacts/http-fastify-20261106`，保留至用户通知清理。

**功能对应审核**

| 功能与真实消费者                    | 最终实现与结论                                                                                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 七模块 HTTP 与 Bootstrap            | 各 `interfaces/http` 直接使用 Fastify `url/handler/request/reply/bodyLimit`；删除旧 router、HttpRouteContext 和 JSON 调度，无双轨。                                                  |
| Access 会话、因素与 Remote 资源交付 | 响应真实 finish 且最终成功状态才确认交付；异步 onSend 失败后撤销凭据、释放 Shell/Files/桌面票据，原 owner 保留清理失败。                                                             |
| 上传、下载、插件资源与背景图片      | rawBody 独立 parser scope 保留原始流；显式 HEAD、Range、multipart 和插件通配路径校验保留。背景首字节前读取失败可返回安全 JSON，部分交付失败结束原传输。                              |
| 审计、身份与安全失败                | 来源准入先行，审计登记原身份，再在解析前拒绝未认证写入；onResponse 按最终状态记录，包括解析拒绝、401 和失败响应钩子。审计失败不改写业务响应；技术兜底不泄漏异常正文或未确认 Cookie。 |
| 备份恢复与 WebSocket                | 稳定 listener 保留，维护排空真实 handler/hooks/传输后替换完整 Fastify 实例；旧恢复响应退出后关闭旧实例。WS 继续使用现有 ws 协议与授权。                                              |

**职责归属审核**

| owner           | 核对结果                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform HTTP   | `http-bindings` 持 Fastify 和请求任务；`http-server/http-lifecycle` 持 listener、WS 与维护代次，断连不代替真实任务结束。                                |
| 模块 interfaces | 严格解码、白名单投影、原始流与交付确认仍由各模块持有；Fastify 类型未进入 Service、Model、storage 或 Shared。                                            |
| Operations      | `operation-observer` 保留原请求、身份与实际 handler 完成，`AuditEventOwner` 追踪发布及拒绝因果；System maintenance 路由不进入该请求观察，避免等待自身。 |
| 测试夹具        | 迁移种子在应用完整关闭后写入；每轮唯一 NEXUS_E2E_DATA_ROOT 由父配置传给 workers/后端，保留恰好一个实例的断言，不扫描历史目录。                          |

**类型归属审核**

| 契约                            | 核对结果                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| HttpRoute/HttpRequest/HttpReply | Platform 仅约定 Fastify 泛型；Body 为 unknown，查询保留 URLSearchParams 重复值，不保留旧 context 适配。 |
| Shared 与内部应用类型           | 请求/响应 codec 与模块 mapper 原 owner 保留；无新增跨层 DTO、数据库表示或兼容分支。                     |
| 路由 hooks 与 raw 流            | 框架声明需要的断言限于 Platform 技术边界；模块直接消费原生 hooks，上传预算与取消仍归原业务 owner。      |

**完成证据**

| 范围                 | 命令、结果与边界                                                                                                                                                                                                                                        |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心 HTTP 失败与维护 | `node --test --test-concurrency=1 --test-timeout=60000` 执行 fastify/resource-delivery/access-delivery/backup 四个文件，52/52 通过，无跳过或取消；`reviewed-http.tap`。                                                                                 |
| 正式后端组           | `NEXUS_E2E_SUITE=backend pnpm test:e2e:remote -- --timeout=120000 --retries=0`，146/146 通过，6.4 分钟；`e2e-backend-final.log`、独立 report/results/durations。                                                                                        |
| 最终补充浏览器与接口 | 13 个指定 spec 共 53/53 通过（44 项浏览器、9 项接口），无重试，2.5 分钟；`e2e-browser.log` 与独立 report/results。覆盖登录、连接/密钥管理、备份 UI、审计、插件 SDK/仓库、GIF/文件交付和上传；最终未认证请求审计 hook 调整在此重新构建后验证。           |
| 静态与构建           | 最终根 `pnpm run check` 通过（`check-delivery.log`），补充回归入口重新完成双端生产构建和 E2E clients 构建（`e2e-browser.log`）；`pnpm run format:all:check` 通过（`format-delivery.log`），`git diff --check` 通过；最后仅改文档并复查受影响 Markdown。 |
| 未验范围             | 尚未提交推送，未触发本轮 GitHub Actions、全部浏览器分片或 Docker smoke；不替代真实手机、外网及生产升级验收。                                                                                                                                            |

补充真实浏览器远程桌面专项 `specs/remote-desktop/rdp-remoteapp-fullscreen.spec.ts` 5/5 通过，无重试，26.2 秒；证据 `e2e-desktop.log` 和独立 report/results。覆盖 RDP 设置、剪贴板、全屏、120 DPI、窗口交互、重连时文件批次/音频资源清理，以及 VNC 连接、输入、剪贴板与窗口交互。该正式流程通过不替代独立旧 VNC 夹具失败的根因定位。

首轮正式后端组为 143/146：Agent 文件迁移测试在活跃数据库上准备旧数据导致锁冲突；RDP 用户夹具和挂起日志夹具发现历史实例目录。均保留首次日志 `e2e-backend.log`，修复离线种子与运行目录隔离后完整重跑通过。旧工具图片发现、批量文件参数、Job 故障注入、Passkey 数据库路径及备份表数等消费者同步当前契约；既有有效断言保留。初始全目录 Node 探测包含未更新的独立夹具和缺少正式 runner 配置的测试，其失败日志 `backend-regression.log` 不属于通过证据；正式后端通过不能宣称所有独立 Node 测试均通过。

独立 Node 探测的剩余失败已按证据分组：`machine-admission`、`authority-monitor` 使用旧 execute/单命令 Job 契约；`integration-races` 缺插件安装表和当前 drain mock；`public-boundary` 漏既有 lastConnectedAt；Files 名额场景仍断言已移除的 8/16/64 固定上限，部分资源夹具按旧单资源关闭计数或未注入清理失败便期待 unknown。桌面证书测试缺数据库参数、旧 RDP 夹具未走现有证书确认；ENOSPC worker 在用户命名空间执行本机 Node 路径被拒绝，未触发故障场景。独立 VNC 浏览器握手、server-transfers 未进入预期 mock 和旧前端测试页定位仍未归因，不概括为已通过或全部环境问题；相关业务 Service/Model 本轮未改，继续作为独立测试维护项保留。

## Fastify 原生能力重设计（2026-11-06）

沿用 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的迁移工作区，Node 26.13.0、pnpm 12.16.1、Fastify 5.12.8。按用户要求替换可由框架承担的旧设计；Shared 对外协议没有变化，前端真实入口继续使用原契约，无需兼容分支、UI 或数据库变更。实现由原 Sol 分工继续，主代理统一补审和验收；最后两项独立复核因上游 503 未完成，不作为独立审核通过证据。

**功能对应审核**

| 功能与消费者                | 最终实现与结论                                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 连接、主题、背景与备份导入  | `@fastify/multipart@10.1.7` 的 parts 流替换整包缓冲与 Formidable；仅在上传路由 scope 安装。文本字段也按字节读取，保留畸形 UTF-8 拒绝及秘密清零，无上传临时文件。 |
| 七模块 JSON 响应            | 原生 serializer 单次编码并检查实际字节，保留 preSerialization 对象观察；路由 errorHandler 保留安全错误、写入未知、凭据撤销与 RPC envelope。                      |
| 日志、主题与 Agent 文件下载 | 普通 Buffer/Readable 交给原生 send；Artifact 与 Plugin Intent 共用流交付 owner，最后权限及长度检查前保留末字节。复杂远程/备份传输的业务收尾继续由原 owner 负责。 |
| 审计与请求结束              | 六个 WeakMap 合并成单一请求状态，删除重复完成 resolver；按真实 handler Promise 与传输完成共同收口，保留解析失败、断连后执行及维护排空。                          |

**职责归属审核**

| owner                 | 审核结论                                                                                                                                                         |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Platform HTTP         | 持原生路由 scope、multipart 技术解析和总字节预算；JSON 与 multipart 预算独立。hijack 安全错误清除尚未发送的 raw headers，避免旧 Content-Length/下载头污染 JSON。 |
| 模块 interfaces       | 保留白名单投影、Shared 预算与业务错误分类；serializer 失败走原生错误通道，不能依赖 handler try/catch。                                                           |
| 业务资源与 Operations | 继续负责授权、取消、未知写入和真实任务排空；响应结束不等于后台任务停止。框架 signal/timeout 的已证实 POST 问题不通过删除 owner 规避。                            |

**类型归属审核**

| 契约                      | 审核结论                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| Shared 请求与响应         | 仍为唯一对外契约；无复制 schema、旧协议分支或新增存储表示。                                          |
| Fastify 及 multipart 类型 | 留在 Platform 和 HTTP interfaces，未进入 Service/Model；路由 config 显式携带 multipart 封装预算。    |
| Agent 响应与流交付        | 具名内部 helper 统一 serializer/errorHandler 与授权交付；HTTP 状态和工具 RPC envelope 保持各自契约。 |

**调用链审核**

| 调用链                                          | 核对重点与结果                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 浏览器导入 → parser → 模块                      | 来源/身份准入先于读取；JSON bodyLimit 与 multipart 声明量/实际量分别核对；未结束 boundary 的 part 超限及时结束，错误交付后关闭原连接。 |
| 应用结果 → preSerialization → serializer → send | 只编码一次，预算覆盖变换后的对象；写入后编码失败按 operation_unknown，Access 未交付凭据撤销。                                          |
| Artifact/插件源 → Readable → HTTP               | 等待响应与源清理；最后字节不早于最终权限检查，失败保留因果与取消，不虚报完整下载。                                                     |
| 请求 → Operations → handler/response → 维护     | 解析失败可审计，断连后的异步 handler 仍计入排空；保持恢复代次及稳定 listener，不等待自身维护请求。                                     |

**最终验证**

证据均在 `/home/honus/nexus-task-artifacts/http-fastify-20261106`，保留到用户通知清理。

| 范围             | 结果与证据                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 核心 HTTP 专项   | 8 文件 91/91 通过，`native-capabilities-accepted.log`；multipart/backup 补充组 31/31 通过，`native-multipart-backup-final.log`。两组有重叠。                                                                                                                                |
| 正式本地组合回归 | 正式 runner 执行 backend-specs 全量与 11 个相关浏览器 spec，`--timeout=120000 --retries=0`；177/177 通过，8.1 分钟，包含后端 146 项及相关浏览器 31 项。`native-e2e-final.log`、`native-e2e-final-report/`、`native-e2e-final-results/`、`native-e2e-final-durations.json`。 |
| 静态与构建       | 最终源码根 check 通过，`native-check-delivery.log`；全量 ESLint/格式通过，`native-format-check.log`；最终正式 runner 重新完成双端生产和 E2E clients 构建。文档收口另验格式与 diff。                                                                                         |
| 未验范围         | 未提交推送或触发本轮 GitHub Actions；未运行全部浏览器分片或 Docker smoke，不替代真实手机、外网及生产升级。前轮记录中的独立旧夹具债务继续保留。                                                                                                                              |

首轮正式后端 145/146：新增 Fastify wrapper 的测试夹具缺少真实平台 await-reply 桥，改真实 listener 后又发现 Node 26 fetch 不支持覆盖 Host、原生 DELETE 测试缺 Content-Length；现使用真实 listener 与明确请求头的 Node HTTP 客户端，保留全部功能断言。Multipart 首次失败暴露提前 destroy 原请求导致正常备份拒绝响应被截断，以及未发送最终 boundary 时 part 超限无法退出；已改为安全响应后关闭连接并消费 limit/truncated 状态，继续清零已读秘密。首次失败日志与后续专项日志均保留，不以最终通过覆盖失败证据。

原生 `request.signal` / `handlerTimeout` 的版本问题沿用前节真实探针证据，未接入项目。仅安装符合 H-14 且支持 Fastify 5 的 multipart 插件；Shared schema/OpenAPI 留作独立后续任务。本轮测试服务已退出，日志归集至 `native-e2e-final-logs/`，未删除专用产物或操作生产环境。

## Fastify 插件替换与维护复核（2026-11-06）

基于 `main/48d6f557f0995273f98a29be673a0ff44f546fbc` 的未提交迁移工作区继续；用户明确将 H-14 门槛改为 Star 不低于 200，并要求仍在维护、问题修复及时，已更新唯一规则 owner。Node 26.13.0、pnpm 12.16.1。以下 Stars 和维护事实为本轮 GitHub API 核验快照，不将 Stars 或官方组织身份当作质量保证。

| 候选                                                        | Stars | 维护与适配结论                                                                                                                                                                                                                                                |
| ----------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Cookie](https://github.com/fastify/fastify-cookie)         | 300   | 采用 11.1.5；10 月 27 日发布修正自定义编码。HTTP 用原生解析钩子，WS 用已注册实例的 parseCookie；不用存在初始化缺陷的独立导出。                                                                                                                                |
| [Helmet](https://github.com/fastify/fastify-helmet)         | 464   | 采用 13.2.0；10 月 13 日发布全局 nonce 继承修复，相关 PR 两天合并。沿现有策略配置，不引入其他默认响应头。                                                                                                                                                     |
| [Multipart](https://github.com/fastify/fastify-multipart)   | 539   | 保留前轮已采用的 10.1.7；仓库 11 月 5 日仍有维护活动，parts 的真实边界回归继续覆盖。                                                                                                                                                                          |
| [WebSocket](https://github.com/fastify/fastify-websocket)   | 467   | 11.3.7 于 11 月 4 日发布自定义 preClose 的 upgrade listener 清理修复；核对源码后保留现有 ws。插件绑定 Fastify 实例的 upgrade/close 生命周期，而本项目稳定 listener 跨代存活，旧恢复响应可晚退出；替换仍需重写同一维护协调，不能删除现有代次、授权及业务排空。 |
| [Static](https://github.com/fastify/fastify-static)         | 499   | 11 月 4 日连续修复目录/多 root 预压缩回退。前端静态资源由 Nginx 承担；插件资源经过授权内容 owner，不直接公开文件系统 root，不重复安装。                                                                                                                       |
| [Compress](https://github.com/fastify/fastify-compress)     | 230   | 10 月 27 日发布 9.3.0；现有 Nginx 已有 gzip、预压缩、Vary 和代理压缩配置，不在 Node 重复压缩。                                                                                                                                                                |
| [CORS](https://github.com/fastify/fastify-cors)             | 496   | 11 月 5 日发布 11.4.1，修复 Vary token；CORS 不能代替 Host/Origin/Fetch Metadata 的来源准入。公开 SDK 的固定星号响应无需预检路由和通用 CORS 状态机，保留原声明。                                                                                              |
| [Rate Limit](https://github.com/fastify/fastify-rate-limit) | 604   | 11 月 2 日发布 11.2.2，修复管线请求计数快照；现有登录策略按认证失败在 SQLite 原子累计、持久封禁并通知，不是按 HTTP 请求数限流，不用通用插件改变规则。                                                                                                         |
| [Swagger](https://github.com/fastify/fastify-swagger)       | 1101  | 11 月 1 日仍发布 schema 引用修复；插件不能从现有严格 codec 生成等价 schema。须先完成 Shared 单一 schema 来源，保留既有独立任务，不维护平行协议定义。                                                                                                          |
| [Swagger UI](https://github.com/fastify/fastify-swagger-ui) | 192   | 虽仍维护，但低于本轮明确门槛，不采用。                                                                                                                                                                                                                        |

维护证据保存在 `github-audit.json`、`maintenance-audit.json`、`adopted-fix-evidence.json` 和 `additional-candidates.json`。Cookie [PR 374](https://github.com/fastify/fastify-cookie/pull/374)/[377](https://github.com/fastify/fastify-cookie/pull/377) 的非安全编码修复分别经过约 57/33 天合并，不能宣称所有问题都能在数天修复；[issue 383](https://github.com/fastify/fastify-cookie/issues/383) 的独立导出初始化问题已有修复 PR、尚未进入采用版本。本轮依据已发布版本在实际使用路径的修复与回归选型，未修复路径明确不使用；没有本地补丁或私有 API 绕过。Helmet [PR 324](https://github.com/fastify/fastify-helmet/pull/324) 为 10 月 11 日提出、13 日合并。未来升级仍按 H-14 重审缺陷和发布，不承诺供应商修复时限。

**功能对应审核**

| 功能与消费者                       | 最终实现                                                                                                                                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP/WS 会话读取                   | 插件解析一次，Platform 绑定请求事实并统一拒绝重复名称和原有超量 Cookie；HTTP 原生 cookies 与原始请求认证消费者一致，不对不透明 token 做 URI 解码。WS 在授权前通过当前代已注册实例解析。             |
| 登录、2FA、Passkey、退出与改密     | 删除手拼 Cookie 属性；Access 的唯一策略 helper 调用实例 serializeCookie，保持 Path、HttpOnly、SameSite、Secure 及原有效期。直接设置响应头使既有错误通道可移除凭据，不引入插件 pending cookie 队列。 |
| Plugin、SDK、HTML 主题、背景与下载 | Helmet 持有安全头生成；模块保留 CSP/CORP/Referrer 策略，普通流与 hijack 都读取同一 raw 响应头。删除模块各处重复 nosniff；技术兜底绕过插件时仍清头并写最小安全错误。                                 |

**职责归属审核**

| owner               | 结论                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------- |
| Platform HTTP       | 注册 Cookie/Helmet，维护源验证、解析事实、重复拒绝与代次；不把插件 request/reply 传入应用或 Shared。       |
| Access interfaces   | Cookie 属性属于认证策略，序列化属于插件；真实 finish、失败撤销和未知结果仍由 deliverAccessResult 追踪。    |
| 内容模块 interfaces | Helmet 的 route options/调用归资源出口；授权、字节预算、源确认和收尾留原 owner，没有通用静态文件路径绕过。 |

**类型归属审核**

| 契约             | 结论                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Fastify 插件类型 | 仅在 HTTP 技术边界使用。Cookie 类型暂漏 parseOptions.decode，用具名推断配置同时保留标准 encode，不加 any、断言或上游补丁。 |
| Shared/前端      | 对外请求、响应、身份和 UI 均不变；既有前端直接消费，通过浏览器真实流程验证，无兼容层或数据库迁移。                         |

**调用链审核**

| 调用链                                  | 核对重点                                                                                                             |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 来源 → Cookie → 审计/应用准入 → handler | Cookie 在应用身份读取前初始化；重复项不能被 first-wins 解析误认证，审计与 HTTP/WS 看到同一事实；旧请求继续绑定原值。 |
| 颁发凭据 → 序列化 → finish/错误         | 不使用延迟 cookie 队列，错误移除 Set-Cookie 后不能重发；Passkey 超限、断连、onSend 失败仍撤销原凭据。                |
| 原生/原始下载 → Helmet → 真实传输       | 保留原 CSP directives，禁用原本不存在的 HSTS/X-Frame/COEP/COOP 默认项；技术错误移除旧下载元数据后保留 nosniff。      |
| 在线恢复 → 新实例插件 → HTTP/WS         | 新实例先注册插件再开放；旧实例等待原请求退出。新增跨恢复 HTTP/WS Cookie 场景，未改变稳定 listener 和业务排空。       |

**验证记录**

专用产物：`/home/honus/nexus-task-artifacts/http-plugins-20261106`，保留至用户通知清理。核心 8 文件 94/94 通过（`http-regression-final.log`）；其中新增实际 Cookie/WS/恢复、Cookie 安全交付及真实内容路由的 Helmet 政策检查，已由既有正式 fastify-transport wrapper 收集。首次 91 项专项有一个 Agent 独立夹具未注册 Cookie/绑定解析事实，未执行预期业务写入；同步该夹具后保留原未知写入断言并完整重跑，首次证据为 `http-regression-first.log`。两个独立 serializer 夹具均安装真实插件，不用生产兼容分支绕过。

根 check 通过（`check.log`）；初次构建发现插件配置类型和 Helmet boolean 声明不一致，按实际公开 API 修正后生产后端构建通过（`build-backend-second.log`）。初次全量格式检查仅发现更新后的 HUMAN 表格格式，已修正。最终全量 ESLint/格式通过（`format-final.log`），文档收口另核对格式与 `git diff --check`。正式本地 runner 重新构建双端与 E2E clients，执行完整 backend-specs 与 11 个相关浏览器 spec，`--timeout=120000 --retries=0` 共 **177/177 通过**；日志为 `e2e-combined.log`，报告、结果、耗时及逐项日志分别为 `e2e-report/`、`e2e-results/`、`e2e-durations.json`、`e2e-logs/`。这些组与 94 项专项有覆盖交集，不相加为唯一场景数。覆盖认证、Cookie 交付、备份恢复、插件 iframe、主题/背景、文件交付、HTTP/WS 撤销及 SSH/弱网场景；USAGE 的认证、插件、外观与下载说明已核对，本轮不改正常产品行为。

本轮测试服务已退出，专用产物继续保留。尚未提交推送、触发本轮 GitHub Actions、执行全部浏览器分片或 Docker smoke；不替代真实手机、外网及生产升级验证，前轮独立旧夹具债务继续保留。

### 官方应用插件兼容性补审

用户继续要求核对应用插件是否需要同步变更。检查现有插件工作区 `/home/honus/nexus-task-artifacts/agent-tool-reuse-20261105/nexus-agent-plugins`，本地与远程 main 均为 `7f0498cf14fa50f7a664adf892ef041c62ad7fab`，工作区干净；Nexus Agent 1.0.4、Full-stack 1.0.3 均使用 SDK "1"。本轮 HTTP 内部迁移没有修改 Shared 插件协议、宿主 SDK、能力基础值或 Agent contribution，故无需改插件清单、权限或版本。

Nexus Agent 没有前后端入口，toolNames=null 按宿主当前授权目录发现工具；Full-stack 通过 `/sdk/frontend-v1.mjs` 与 MessagePort 调用 host.appInfo/storage，后端只使用原隔离 SDK/IPC，不依赖 HTTP 框架或直接读取 Cookie。其 plugin_tool_call 白名单、context.read/plugin.invoke 声明及上下文/工具请求形状仍匹配当前宿主。两个真实 manifest/agent.json 已经当前 Shared decoder 校验，Full-stack 实际使用的四类 SDK 请求形状也通过；插件仓库 lint、格式及 check 全部通过，未修改源码或重新发布。

补跑正式 `agent/plugin/custom-surface.spec.ts`，1/1 通过，无重试：覆盖隔离 iframe/SDK 握手、前后端 AppStorage、文件/子进程权限拒绝和跨 App 数据隔离。该浏览器场景使用仓库签名受控夹具，不冒充官方发布包的完整安装验收；官方源码另按上述调用链及 Shared 契约核对。日志、报告及 contracts.log 保存在 `/home/honus/nexus-task-artifacts/http-plugins-20261106/app-review`；服务已退出，产物保留至用户通知。本轮未提交推送或发布。

### 提交前复核与交付授权（2026-11-06）

复核稳定 listener 的异步代次替换、来源/会话准入顺序、真实 handler 排空、multipart 超限及秘密清零、下载末字节授权、凭据失败撤销和原生 serializer 错误出口，未发现新的阻断问题；四份审核表结论保持有效。确认无旧 HttpRouteContext、http-router、Formidable 或整包 multipart 解码消费者。`git diff --check` 通过，生产依赖 `pnpm audit --prod --audit-level=high` 返回无已知漏洞。证据目录为 `/home/honus/nexus-task-artifacts/http-release-20261106`。

用户已授权提交推送、修复远程完整 E2E 至通过、发布 linux/amd64 dev 镜像；不更新生产主机。此处记录交付开始状态，不将尚未执行的远程验证或发布写为完成。

## Fastify 迁移远程验收与 amd dev 发布（2026-11-06）

提交前审核后推送 `c15862cec37f5e25a5f63dc1908174c6d6ec525d`。[E2E 42161301186](https://github.com/0honus0/nexus-terminal/actions/runs/42161301186) 首轮完整通过：双端生产构建、质量与格式检查、runner 更新、8 个测试分片及 Docker smoke 均 success，无需失败修复或重跑。质量作业另含 7 项产物复用逻辑测试。文档截图更新按触发条件跳过，不属于场景跳过。

| 分组        |                         首次通过 |
| ----------- | -------------------------------: |
| Backend     |                              146 |
| Browser 1–7 | 39 / 75 / 72 / 69 / 78 / 82 / 59 |
| 合计        |                              620 |

核对正式 Reporter 的 620 条唯一结果，全部 passed，失败、重试、flaky 和场景跳过均为 0。新增 HTTP 契约专项由正式 backend 分片执行。原独立旧夹具、真机与外部供应商待验仍保留在 PLAN，不以本轮结果宣称未执行专项均通过。

本地已快进同步 CI 提交 `620c0828e444e7fc5b4876713cecd9d1618e2967`，仅修改 `scripts/e2e/duration-estimates.json`；运行源码与被测提交一致。远程日志、作业状态、Reporter 统计与各分片 timings 保存于 `/home/honus/nexus-task-artifacts/http-release-20261106`。

[发布 42162441122](https://github.com/0honus0/nexus-terminal/actions/runs/42162441122) 成功，输入为 `channel=dev`、`architecture=amd`，源提交 `620c0828e444e7fc5b4876713cecd9d1618e2967`。直接读取 GHCR 核对 `ghcr.io/0honus0/nexus-terminal:dev` 与 `sha-620c0828e444` 指向同一摘要 `sha256:333bf9ede35afa56b1cc1c35769364844fb54ff5ef521d414256c7fb9313525f`；运行平台为 `linux/amd64`，OCI revision 与源提交一致。另一个 `unknown/unknown` manifest 是构建证明，不是额外运行平台。发布日志和 registry manifest/config 保存在同一证据目录。

本轮无需数据库迁移，未更新生产主机、未发布 latest。应用插件契约兼容，官方插件仓库无变更，不重复发布插件。交付后的文档提交只刷新验收与计划，不改变被测或发布源码。

## 登录布局与 Passkey 命名：首轮边界核对（2026-11-06）

本轮首轮本地 19 项回归中 17 项通过，两个深浅主题布局场景在 390×400 失败。精确测量主按钮 top=348.125、height=52、bottom=400.125：短屏 46px 规则被主按钮高优先级选择器覆盖；Playwright 的最小滚动还留下 0.125px 的像素舍入。修复统一通过 `--auth-control-height` 控制输入框、密码登录、Passkey 按钮高度；测试明确滚动居中并执行真实点击可达性预检，保留完整可视边界及等高断言，不放宽断言容差。首次日志/trace 与随后诊断保留在 `/home/honus/nexus-task-artifacts/auth-oidc-passkey-20261106`，修复后 `layout-fixed.log` 3/3通过，包含深浅主题六视口和真实Passkey流程。

## OIDC、登录布局与 Passkey（2026-11-06）

基线 main `37808319`，Node 26.13.0 / pnpm 12.16.1；本轮未提交工作区。证据集中于 `/home/honus/nexus-task-artifacts/auth-oidc-passkey-20261106`，不代表远程生产配置验收。

选型核实：[openid-client](https://github.com/panva/openid-client) 2440 stars、MIT、6.8.9（2026-11-02），issue903 当天修复并发布；[Fastify OAuth2](https://github.com/fastify/fastify-oauth2) 319 stars、8.3.2（2026-10-19安全修复），偏 OAuth 流程，完整 OIDC 验证选择前者。使用库的非否认检查显式验证 ID Token 数字签名，不只依赖 TLS。

[Pocket ID](https://github.com/pocket-id/pocket-id) 10064 stars、v2.19.2，名称目录固定在主仓库 commit `23d7968ccdcbe2343d2e025187f226ded9aa10ea`，407项名称并保留 BSD-2-Clause 授权；未直接依赖2026-11-03已宣布弃用、计划置空 JSON 的 passkeydeveloper 远程目录，也未引入低于200 stars的小 fork。维护脚本 `scripts/maintenance/update-passkey-authenticators.mjs` 以明确commit更新静态快照。

390×400 初测控件底边为400.125px，发现短屏按钮高度受到更高优先级样式覆盖，另有最小滚动舍入。控件统一使用高度变量，测试居中滚动后保留严格边界和真实命中断言；`layout-fixed.log` 3/3通过，含两主题×六尺寸及真实Passkey流程。

OIDC 首轮真实协议测试暴露正常认证拒绝进入审计后台失败收口，按既有Access边界修复；测试IdP的Basic认证还需按OAuth规范解码表单转义，此项修正在夹具，不改变协议库。`oidc-protocol4.log` 十二项通过。组合浏览器首轮33项通过、2项失败：新接口使用自定义serializer时缺少JSON Content-Type，浏览器严格解码拒绝；已补明确Content-Type，`oidc-browser2.log` 双视口完整OIDC登录、解绑、重新绑定2/2通过。

`oidc-storage.log` 四项通过：v3→v4保留账号与旧迁移记录、重复启动及外键/完整性；过期/密码变化/强制Passkey；取消与来源封禁；提交确认丢失后的已知会话撤销。测试使用真实SQLite，外部协议在此专项为受控Port；数字签名验证由协议E2E覆盖。

最终组合 `final-e2e.log` 37/37通过，涵盖既有认证、Passkey自动命名、布局及OIDC。最后审核发现消费回调后、授权码交换期间退出无法阻止迟到登录：流程改为持久 `consumed` 认领，最终事务再次核对记录和期限，退出/新流程/配置变化均可撤销在途流程。修复后 `claim-e2e.log` 17/17通过（14项协议、3项浏览器），`claim-storage.log` 4/4通过；这些测试组有交集，不累计为唯一场景数量。全部新场景已进入正式E2E目录，HTTP场景加入backend分片清单。

真实Pocket ID安装、真实手机键盘、真实磁盘故障不由本地签名夹具或注入故障代替。截图位于同目录 `claim-screenshots`，包括390×400登录和桌面OIDC配置；已人工查看。数据库新增独立v4迁移，启动自动执行，旧迁移不改动；本轮未提交、推送、发布或操作生产。

### 功能对应表

| 功能与真实消费者        | 实际入口及实现                                                                   | 差异与当前状态                                                                           |
| ----------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Pocket ID / OIDC 新接入 | Access OIDC 八个 HTTP 入口、Auth API、Security OidcPanel、LoginPage/CallbackPage | 显式绑定已有管理员；三种客户端认证；14 项协议与 3 项浏览器流程通过，含表单保存和禁用退出 |
| Passkey 默认名称        | NativeWebauthn 已验证 AAGUID → FactorModel → 现有 passkey 列表                   | Pocket ID 静态名称，无联网、信任变更或旧数据回填；四种验证器与手动改名回归通过           |
| 登录布局                | LoginView + login-layout.spec.ts                                                 | 保留原主题；统一控件高度、短屏滚动；深浅六视口与 390×400 严格边界通过                    |
| 退出与配置撤销          | access-http、OidcService/Model、SqliteOidcStorage                                | 退出撤销当前在途流程，最终事务复查持久认领；配置变更撤销 OIDC 会话                       |

### 职责归属表

| 关键流程            | owner 与调用链                                                           | 审核结论                                                                                              |
| ------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| OIDC 协议与外部网络 | Platform security OpenidClient → openid-client                           | 不自行实现 JWT/OAuth；强制签名、PKCE/nonce/state；禁止远程 HTTP 与网络重定向，响应受既有认证预算约束  |
| 身份绑定与配置      | Service 密码证明 → Model 应用判断 → SQLite 同事务事实与写入              | issuer+sub，不使用邮箱；CAS、原会话/密码版本、来源与强制 Passkey 复查；更换身份配置不沿用旧密钥       |
| 颁发与交付          | Model.complete → deliverAccessResult                                     | 持久认领只允许一次交换；最终事务复查撤销；提交确认丢失撤销已知 bearer；绑定提交不能冒充可回滚         |
| 前端读写与资源      | use-oidc-settings、browser-oidc、CallbackPage                            | generation/AbortController、未知写入刷新围栏；当前 OIDC 会话被撤销后导航登录；秘密不留 sessionStorage |
| 迁移与备份          | Access OIDC SQLite schema → migrations → Bootstrap v4；backup-exclusions | 不改 v1–v3；认证三表排除业务快照；4 项真实存储回归通过                                                |

### 类型归属表

| 类型/边界                              | 唯一 owner 与转换                                   | 审核结论                                                                  |
| -------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------- |
| 客户端认证取值、Cookie/回调、完整 HTTP | Shared access/oidc values/http/http-codec           | 双端与测试消费；未知字段拒绝；changed 响应也归 Shared                     |
| 应用配置、流程、回调与状态             | 双端 Auth/Access 各自 model/oidc-types              | 表示与用途不同；HTTP/API 明确白名单映射；不向 Shared 泄漏后端秘密         |
| SQLite 记录、事务事实与命令            | Access oidc/storage                                 | Adapter 不引用应用类型，Model 显式转换与事务判断                          |
| 库配置与技术错误                       | Platform security/oidc-port、adapters/openid-client | 库对象/Token 不越界；未知验证错误报不可用，不伪造通过；验证器名称只为显示 |

### 完成证据表

| 项目      | 当前证据                                                                                                                              | 限定范围                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| 源码/架构 | 四表完整链路复核，Backend/Frontend/Shared 八节设计及 API/USAGE/DEPLOYMENT 已同步                                                      | 按 H-04–H-08、H-21、E-02.5、E-05.3、E-07.5/E-07.6、E-10.3、E-14.4 核对 |
| 静态/构建 | 双端生产构建 `verified-build.log`，最后认领修复后后端构建 `claim-build2.log`；根检查 `claim-check.log`、格式 `claim-format-check.log` | 本地工作区，不代表远程 CI                                              |
| 逻辑回归  | 完整相关组合37/37；最后OIDC专项17/17、真实存储4/4；390×400专项3/3                                                                     | 分组存在交集，不累计；签名协议和浏览器是真实执行，介质失败为注入       |
| 实机/发布 | Chromium、本地签名IdP、真实SQLite；证据统一保留                                                                                       | 真实Pocket ID、手机键盘与介质故障待验；本轮未提交/推送/发布            |

## 终端重连入口与失败提示（2026-11-06）

本轮基于已有 OIDC 未提交工作区继续修改，未提交/推送/发布。证据统一保留于 `/home/honus/nexus-task-artifacts/terminal-reconnect-20261106`，Node 26.13.0 / pnpm 12.16.1；使用正式前端生产构建、真实后端与测试 SSH，浏览器为 Chromium 桌面及移动模拟，不代替真实手机软键盘。

源码发现两个直接原因：重连按键只挂在 xterm 隐藏输入框，原测试主动聚焦该框后才按键；蓝色挂起标签同样显示提示，却调用直接排除 markedForSuspend 的普通 reconnectNow。错误提示还将 statusMessage 原始安全码写进终端，重复失败会堆积并混入展示快照。

### 功能对应表

| 功能     | 真实消费者                                                       | 结论                                                                              |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 显式重试 | TerminalView 恢复卡片/UiButton/容器键盘                          | 无隐藏输入框焦点也能点击或聚焦容器按Enter；快捷键、Tab不误重试；重试按键不发给SSH |
| 失败说明 | WorkspaceRuntimeSession → WorkspaceLayoutRenderer → TerminalView | 按具名错误分类本地化，给出检查事项，不显示原异常正文，不写终端日志                |
| 挂起恢复 | WorkspacePage → 原目录/Registry恢复                              | 原标签去重、保留接管确认；按钮恢复后原Shell变量保留，没有新增SSH连接              |
| 移动交互 | 按钮/轻点/现有输入与选择                                         | 重连不主动聚焦软键盘；320×400卡片与按钮可见可点击，正常触摸和粘贴回归通过         |

### 职责归属表

| 流程           | owner                  | 审核结论                                                                    |
| -------------- | ---------------------- | --------------------------------------------------------------------------- |
| 输入与呈现     | TerminalView           | 只发布意图；活动/可见/只读检查，不新增全局键盘监听，不替代连接状态          |
| 连接失败与重连 | RuntimeSession         | 原连接Promise、退避、未知结果围栏不变，记录安全失败类别                     |
| 挂起恢复       | WorkspacePage/Registry | 原目录、身份/实例复查及接管确认；重复点击不并发打开确认；退出后晚反馈不回填 |

### 类型归属表

| 边界         | 唯一owner                             | 审核结论                                                           |
| ------------ | ------------------------------------- | ------------------------------------------------------------------ |
| 服务端安全码 | Shared remote/workspace/values        | 沿用现有有限值，无新协议或迁移                                     |
| 本地连接失败 | workspace/model/workspace-error-types | 具名异常转有限分类，presentation出口供Page消费，不靠错误字符串推断 |
| 终端展示     | TerminalView props/interaction        | 文案由装配层转换，终端不深层依赖Workspace                          |

### 完成证据表

| 项目       | 证据                                                                 | 边界                                                                                 |
| ---------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 静态/构建  | final-check.log、final-build.log、format-check.log、git diff --check | 根类型/ESLint、前端生产构建、全仓格式检查                                            |
| 浏览器/SSH | final-e2e.log：7/7，38.1秒                                           | 桌面/移动初次失败、重试成功、挂起恢复保留Shell、恢复中输入丢弃、触摸取消、剪贴板粘贴 |
| 视觉       | final-screenshots：桌面、390×844、320×400；已人工查看                | 移动为模拟设备，真实输入法仍待验                                                     |
| 交付       | USAGE与Frontend架构已同步                                            | 无新数据库迁移；未提交、推送或操作生产                                               |

首轮 `e2e.log` 3/3与 `mobile-e2e.log` 4/4，最后组合重新验证7/7；分组重复，不累计成14项。审核覆盖H-04–H-07、H-09/H-13、E-05/E-07、E-10/E-14.4；此前OIDC变更及测试证据保留。

## Agent 完整命令日志与空间等待（2026-11-06）

基线 `main/37808319` 的未提交工作区；保留前轮 OIDC/Passkey 和终端重连变更。本轮取消 Shell 完整文本日志的总量限制，32 KiB 只作内联预览，按 Job 保存 UTF-8 数据与索引。Node 26.13.0 / pnpm 12.16.1；证据根目录 `/home/honus/nexus-task-artifacts/agent-output-20261106`，未提交、推送、发布或操作生产。参考 Pi 的完整文件/有限展示设计，源码固定版本及调研保存在 research。

### 契约审核表

| 边界     | Owner 与消费者                                                            | 结论                                                                                               |
| -------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 命令输出 | CommandPort → CommandModel → Remote public/mapper → ToolRemoteModel → Job | 全部输出异步交付并传递取消信号；两个流串行保存，保留命令序号/流；预览独立                          |
| 日志读取 | ToolJobService → ToolJobModel → TextLogStore                              | 既有 Job/user/App/Run/目标版本授权；UTF-8 游标和 JSON 预算；unknown 只允许读取证据，不解除执行围栏 |
| 等待状态 | Shared AgentResourceSessionView/codec → WS mapper → Native mapper/资源卡  | waitingOutputJobs 显式映射；沿既有关闭确认和任务取消，不创建第二个执行状态机                       |
| 模型发现 | shell_execute / shell_job_control Host 声明                               | 完成结果首先给 jobId/outputRead，低预览预算仍可看到续读入口；权限与工具输入不变，无插件包变更      |

### 容量审核表

| 项目       | 规则与证据                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| 完整日志   | 不设单任务总量配额；真实 OpenSSH 8 MiB 和后续 stdout/stderr 完整保存；小日志也归同一持久 owner                  |
| 内存       | 每个 SSH 流最多一个已交付 chunk 等待，保存串行；另有 ssh2 自身窗口/Readable 缓冲，不承诺连接总内存仅为预览大小  |
| 模型与续读 | 32 KiB 原内联预览；输出数组原 4 KiB JSON 预算、批量结果原 256 KiB 预算；中文/emoji/BOM/控制字符均按实际编码处理 |
| 物理空间   | ENOSPC/EDQUOT 等待后重试原文件范围；部分写入不重复，最终 sync 迟到空间失败也等待；取消和原 Run 期限不延长       |

### 生命周期审核表

| 阶段          | 结论                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------- |
| 创建与派发    | 原 Job 持久准入后创建日志；dispatched 提交及原授权复查后执行一次 SSH；无新数据库结构或迁移                |
| 正常/失败结束 | 成功先刷盘、关闭日志再结算；失败/取消保留已确认前缀；日志关闭真实完成前 Job 仍活动，晚清理失败保留因果    |
| 读取与保留    | 活跃写入/读取保护；Run 结束不删除，文件随数据卷保留；恢复不重放命令，缺失日志明确 available=false         |
| 回收          | Service 决定 owner 不存在才回收；Model 转换、SQL Adapter 查权威存在；周期及启动扫描，单项失败仍处理其余项 |
| 备份边界      | 当前 JSON 应用备份保存任务和预览，不包含 tool-logs 完整文件；完整迁移需要保留数据卷中的该目录             |

### 完成证据表

| 检查             | 证据及范围                                                                                                                                                     |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 类型/ESLint      | close-check.log：根 check 通过，含 Backend、Shared 和 Frontend                                                                                                 |
| 构建             | close-build.log：最终 Backend/Shared；review-build.log：双端生产构建，后续前端源码未改变                                                                       |
| 命令与故障       | verified-e2e.log：5 个正式后端场景通过；后继 preview-e2e.log 通过低预览预算引用；close-e2e.log：收尾变更涉及的权限、完整日志、真实 SSH 三场景再次通过，40.8 秒 |
| 完整日志内部场景 | 正式 runner 包含 Native 文件分页/重启/读写保护、部分写入和空间恢复、取消、unknown/错身份/错版本、Job 等待状态、迟到 sync 故障、实际关闭前保留活动状态          |
| 并发             | 真实 SSH 协议下暂停日志接收时，ACP 审批经独立连接继续；保存回调未形成无界队列                                                                                  |
| 浏览器           | browser-verified-e2e.log：3/3，19.8 秒；1280/390/320 像素资源卡、隐藏/恢复、关闭确认及取消保持；本地模拟手机不代替真机                                         |

初次故障证据保留：旧权限监测夹具的单命令结果和新夹具的 Storage.change 签名已修正；并行启动浏览器与后端遇到测试专用 22225 端口冲突，改串行复测。最初用 ssh2 测试 peer 验证 8 MiB 时，其转发未处理背压及双流写队列收尾，无法证明完整交付；该场景改用实际 OpenSSH，保留相同容量/完整性断言并通过，未放宽产品结束校验。真实介质耗尽、掉电、长时间吞吐和手机实际等待提示按 PLAN 保留；本地专项不冒充远程全量 CI。

最终格式证据：`format-check.log` 全仓 ESLint/Prettier 通过，`diff-check.log` 为空；HISTORY 收口另经 Prettier 与 diff 检查。三个宽度的关闭确认截图位于 browser-verified-report，另已查看前次 320×844 同一界面的截图。

## 前端样式与组件职责重构（2026-11-06）

基线为 `main/37808319` 加本轮开始时已有工作区；OIDC/Passkey、终端恢复、Agent 完整日志等前序未提交改动完整保留。本轮按用户要求由三个 `gpt-6.1-sol/high` 子代理分工实施，主代理复核；无提交、推送、发布或生产数据改动。适用 H-04–H-09/H-12/H-13、E-02/E-03.4/E-09/E-10.1/E-10.3/E-10.4、C-01–C-04。Node 26.13.0 / pnpm 12.16.1，环境入口为 `dependencies-upgrade-20261105/runtime/env.sh`。

证据根目录 `/home/honus/nexus-task-artifacts/frontend-style-refactor-20261106` 保存开始时的 status/diff、完整 frontend src 压缩基线、隔离测试数据库、截图、计算样式、命令和检查日志；基础 CSS 的 AST 迁移证据另在 `/home/honus/nexus-task-artifacts/frontend-style-foundation-20261106/ast-proof.json`。专用测试前端 9998、后端 3001，通过 `https://api.honus.top` 与用户指定 CDP `http://172.30.30.11:9223` 访问；未使用远程生产数据库，测试凭据仅在任务目录权限 0600 文件中。

### 功能对应

| 原功能/消费者                                                            | 最终实现与差异                                                                 | 结论                                                      |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------------------- |
| global.css → uiGen2/uiCatalog → 全部基础组件                             | Foundation 拆为十个职责 CSS；App 显式装配，删除旧入口                          | 492 条原规则保留，未改变 CSS layer、有效覆盖和正常 UI     |
| AppUpdatePrompt、NotificationHost、代理/通知目录工具栏                   | 样式归 App、Feedback、对应 feature；Header 与 Toast 的位置关系归 App shell     | Foundation 不再认识上层业务 DOM                           |
| Docker、命令历史、WorkspaceConnectionList 空态                           | 原深层选择器定制改为 UiEmptyState 公开 CSS 变量，含 dense/compact 与容器条件   | 默认 fallback 和调用方原值保持，实际组件 CDP 对照通过     |
| Login、Workspace 搜索字号                                                | 复用 UiInput 原有 `--ui-control-font-size`，保留 14/16px 和 0.7rem             | 去除内部 input class 覆盖，不改断点                       |
| FileEditor spinner、QuickCommands 图标、ArtifactPicker 与 Workspace 空态 | 删除重复 13px、重复 currentColor!important，以及三条因 scoped 隔离不匹配的规则 | 动态 class、第三方生成 DOM 和必要媒体规则保留             |
| App、Agent、连接编辑/批量/列表、发送文件与进度弹窗                       | 删除 shared/capabilities；通过现有 feature public 获取原 Pinia/launcher owner  | 不新增状态、请求、缓存或资源；同步独立 targets 测试消费者 |
| AgentConfigPopover → UiPopover                                           | `panelMarkerAttribute` 接一个 data 属性名称，由 Agent 提供原标记               | 原 Portal DOM、焦点和 Escape 语义保持                     |

### 职责归属

| 关键职责                                   | 最终 owner / 证据                                                             | 结论                                                        |
| ------------------------------------------ | ----------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 通用材料/控件/浮层/可访问性/确认/目录/设置 | `foundation/ui/styles/*` 与原组件                                             | 十类真实职责，不按文件行数机械拆分                          |
| 应用及业务样式装配                         | `app/styles/global.css`、shell/update-prompt；Feedback 和两个 feature styles  | Foundation 无上层 CSS import；通知定位选择器权重保持        |
| 控件可定制外观                             | UiEmptyState fallback、UiInput/Spinner 既有变量                               | 业务在实例根 class 赋值，无新万能组件                       |
| 认证、查询和更新权威                       | 原 feature Store/composable/remoteDesktopLauncher                             | reset 注册、KeepAlive、scope、晚返回与未知写入围栏保持      |
| 外部覆写与无效样式审核                     | 全前端 deep/UI 选择器盘点；ArtifactPicker 真实 SFC 编译 scope 与 CDP 属性核对 | 不将一次 Coverage 未命中或动态 class 静态无命中当作删除依据 |

### 类型归属

| 类型/契约                                           | 唯一 owner / 消费者                                             | 核对                                                                   |
| --------------------------------------------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------- |
| ConnectionSummary、Tag/Proxy/SSH Key 与认证应用对象 | 原 feature model/public → 实际消费者                            | 不经 shared 重导出，不复制类型                                         |
| RuntimeFeatureCapabilities                          | 删除定义、注入与全部消费者；删除无消费者 terminal.loadView      | packages/tests 无旧入口残留；前后静态运行时 import 图均无循环          |
| UiPopover 面板标记                                  | UiPopover 的 `data-${string}` prop，AgentConfigPopover 唯一消费 | Foundation 不包含 Agent 专属属性名                                     |
| CSS 实例定制                                        | Foundation UiEmptyState 及既有 UiInput/Spinner 变量             | 31 条声明加原值 fallback；新增 display:block/margin-top:0 为原计算默认 |
| HTTP/WS、Shared、存储                               | 本轮未改变                                                      | 无数据库迁移、协议或权限变化                                           |

### 完成证据

| 项目                 | 源码/架构                                                                                 | 静态                                      | 浏览器/逻辑与限制                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CSS owner 迁移       | AST 保留 492 条规则/490 个 selector+at-rule 上下文、1863 条声明原样；同 selector 顺序一致 | 定向 PostCSS、Prettier 与 diff 检查通过   | 独立复核 231 组跨 selector 顺序候选，实际元素/权重无新增覆盖冲突                                                                                                 |
| 桌面/窄屏视觉        | 1440/390/320px × 深浅主题；六页面、真实空态组件、登录、连接表单、Toast、确认框            | 根 check 与前端生产 build 通过            | 原始基线 66 组计算样式一致；一个旋转 spinner 的瞬时 rect 有差异，样式未变。63 张截图逐像素一致，其余三张仅 5–36 像素差异，最大约 0.0019%，已结合相同计算样式复核 |
| 更新提示             | 使用真实 AppUpdatePrompt，通过原反应式状态显示                                            | CSS 声明与布局保留                        | 六组实际弹窗对比旧基础 CSS 与新样式计算值一致；旧 CSS 覆盖对照属于受控样式验证，不冒充重构前整页快照                                                             |
| 管理列表与连接表单   | 正式 runner，生产前端/真实后端/SSH 夹具                                                   | 正式构建通过                              | `e2e.log`：8 项通过，含深浅主题三宽管理配色、代理目录失败下表单可用、真实 SSH 测试并创建连接                                                                     |
| 能力与 Portal 消费者 | 原 feature public 与 Agent 面板标记                                                       | 最终构建产物                              | `consumer-e2e.log`：7 项通过，覆盖 Desktop/Pixel UA 的 Agent 目标选择与权限保持、四项批量编辑（含部分失败、目录失败、窄屏）及代理密码保留/替换/清除              |
| 全仓格式             | 全部新/修改 CSS、Vue、TS 与文档                                                           | `format-all.log` 与 `diff-check.log` 通过 | 无新增自定义源码文本门禁，无新测试依赖                                                                                                                           |

首轮浮层复测与正式测试构建并行，Shared dist 重建触发 Vite 热重载，导致白屏/计数不足及一次超时；原日志保留，未修改产品或放宽断言。稳定后 `after-stable-overlays.log` 与 `stable-overlay-comparison.json` 逐项对照通过。首次标为 update 的脚本未真正触发只读状态渲染，不计作更新提示验收，已用 `update-proof` 单独补验。`pixel-comparison.json`、`before/after/after-stable` 与 `update-proof/comparison.json` 是最终视觉证据。

USAGE 的目录、确认/Toast、登录、工作区及 Agent 操作说明已核对仍符合当前行为，本次纯内部重构不添加产品文案。未宣称全仓所有 CSS 都已证明无效或全部清理；保留确有用途的业务布局、动态 class、第三方 DOM 适配与无障碍规则。真实手机软键盘、自定义主题及完整远程 E2E 不由本轮桌面 CDP 视口模拟代替，后续范围仍由 PLAN 管理。

## 前端模块边界与活动视图复核（2026-11-06）

本轮基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 及原有未提交工作区，保留 OIDC、终端恢复、Agent 完整日志与前一轮样式重构。专用目录 `/home/honus/nexus-task-artifacts/frontend-modules-20261106` 保存开始时完整 diff、状态和 frontend/src archive。上一轮38个前端文件与66组证据复核未发现回归；本轮非 bug 不修改正常外观，不提交推送、部署或触碰生产数据。

### 功能对应

| 功能           | 变更与不变量                                                                                    | 验证                                                         |
| -------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 基础 UI        | 删除无消费者 Tooltip、ManagementCard、management 操作布局、Pagination density；现有分页外观保持 | 全消费者扫描、类型/构建                                      |
| 文件列宽       | 独立交互 owner；隐藏/断线/取消/失焦停止，不派发晚保存；原400/560断点和宽度保持                  | CDP前后、正式取消及恢复保存                                  |
| 文件预览       | 真实active贯通全部消费者与延迟focus；隐藏不拦Ctrl+F/Escape，保留缓存搜索                        | CDP、正式隐藏/重开/读取计数                                  |
| 文件编辑       | actions绑定修订、授权和视图；共享session各视图持独立关闭能力，晚确认不丢新草稿                  | 7组真实组件before/after、25项确认生命周期检查                |
| 窗口与手势     | resize取消不提交；远桌收敛到可见视口；外观失焦停止拖动；Workspace切会话取消5个resize            | CDP、真实双SSH会话正式回归；远桌正式组随新增贴边功能继续验收 |
| Agent/Provider | 按钮尺寸归组件变量；Provider展示卡片分离，父持API/草稿/弹窗；清理经证明死CSS                    | 128组按钮矩阵、18组sidebar、11组Provider边界和事件           |
| 导航           | App router认证后预加载Workspace，移除Connections反向Runtime依赖                                 | 全调用链及正式SSH连接导航                                    |

### 职责与类型归属

| 审核表     | 结论                                                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 职责       | App拥有导航；Workspace传真实active及取消本视图手势；columns/actions拥有交互；原session仍持读写/草稿；Provider子卡片仅展示/发事件        |
| 类型       | 编辑session/关闭能力唯一归file-editor/model；组件props/events在本功能；Foundation取消API不含业务；Shared、数据库和迁移无变化            |
| 资源与并发 | pointerup提交，取消仅释放；确认绑定原实例和修订，A失活不借B继续确认；无handler拒绝丢弃；隐藏预览不新读、不迟聚焦；已派发读写仍沿原owner |

### 完成证据

Node26.13.0/pnpm12.16.1 根 `pnpm run check`、`pnpm run format:all:check` 通过，正式runner已完成双端生产构建；`check.log`、`format.log`、`e2e.log`保留完整记录。正式Playwright本地隔离端口/独立数据根18项通过，覆盖Provider、外观自定义、文件各格式预览、隐藏缓存快捷键、列宽取消/恢复和真实双会话五个resize取消。它是仓库正式用例的本地执行，不冒称GitHub远程全量已通过。

指定CDP `172.30.30.11:9223` / `api.honus.top` 真实组件前后：列宽隐藏后body恢复且无提交、隐藏Markdown不再阻止Ctrl+F、远桌1440×900初始几何不变，390×400从y=-229/h858修复为y16/h368。三张正常截图逐像素一致，见`normal-comparison.json`。Provider11场景DOM/计算样式一致、5组PNG字节一致，复制/测试弹窗/删除确认及禁用事件均通过（没有真实模型调用）。Agent128组深浅/交叉容器矩阵共512个按钮快照一致，sidebar18组一致。`foundation/comparison.json`及`sidebar-comparison.json`保存结果。

`tests/frontend/workspace-session.integration.mjs` 原codec10、Workspace21+producer10、编辑/预览22、Registry17与新增25确认生命周期检查通过；这部分为真实Vue/受控端口专项，不代替真实远端写入故障。CDP编辑器7组保留4个旧确认缺陷及3组正常对照，见`editor/*final*`。根主代理及独立Sol复核发现的共享确认借用、Workspace五手势失活问题均已补齐再验。

首轮Agent快照受到容器未结算、主题过渡及鼠标残留:hover影响；原始失败保留，之后在同一挂载组件原位替换归档旧/新scoped CSS、等待布局并关闭过渡、移开鼠标，128组完全一致，不通过改产品外观或放宽断言消除差异。宽窄全页初扫在并行开发及CDP页面切换期间存在加载中空白采样，未据此宣称通过。停止并行修改后串行置前、等待真实main可见再采样，Dashboard/连接/代理/通知/设置/Workspace各1440、390、320px共18组通过，无横向溢出或pageerror，见page-scan-stable/results.json；这是当前隔离数据与主题下的覆盖，不代表所有自定义主题和数据组合。真实手机软键盘、系统输入法和自定义主题组合仍不由桌面CDP代替。隔离服务及证据按用户要求保留至通知删除。

## Windows 恢复入口与 Termix 绘制对照（2026-11-06）

本轮追加任务：RDP 最小化恢复按钮左右贴边半隐藏；排查 Windows 应用最小化时分块更新。所有文件归 `/home/honus/nexus-task-artifacts/frontend-modules-20261106/{rdp-edge,rdp-render,viewport-scrollbar}`，不提交推送或部署生产。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | RDP恢复按钮贴最近左右侧，hover/键盘/拖动显露、触摸可见半边恢复；VNC保留完整按钮。分块问题通过原方案和Termix真实引擎同Windows对照定位，未宣称完全消除 |
| 职责归属 | Modal只持锚点、dock、可见viewport；Foundation持pointer机制。渲染仍归现有adapter/SDK，Backend保持透明桥；未增加凑帧timer、改解码器或降画质            |
| 类型归属 | 仅Modal局部坐标/有限dock状态，无Shared、数据库、连接参数或迁移                                                                                       |
| 完成证据 | CDP/真实headless及正式E2E逐轮记录见下；真实协议和Windows截图另见rdp-render/stable-analysis.md，不能以受控窗口代替实机性能                            |

恢复按钮初次CDP覆盖左右25px、hover/keyboard50px、跨侧拖动后不误恢复、窄屏与可信touch；正式E2E进一步发现真实滚动条边界：root的clientWidth和visualViewport.width均390，但scrollbar-gutter:stable使根矩形只有382，旧按钮只有0.84交叉比例，RDP实际仅露17px。修复取根实际宽度/client范围与visualViewport交集，并观察根尺寸变化；有效范围不变不取消手势。复验RDP anchor x332、比例1、可见25px；VNC完整50px；不触发window resize而仅切gutter时仍自动更新，无sizeChange或pageerror。大视口原x184正常几何保持。

首次正式组前2项通过后在测试控制栏揭示竞态停住；trace证明小视口恢复后旧鼠标触发pointerleave，header刚可见又隐藏。用例在恢复视口前移开鼠标，保留全部功能断言。第二轮4项通过、2项按上述0.84真实越界失败；原日志、截图及trace保留，未以放宽可见比例换绿。最终轮重建前后端并执行同文件全部6项通过（含可信触屏tap），见rdp-e2e-final.log；未放宽ratio=1断言。与前端18项共24项正式本地用例通过。最后根check、全仓format:all:check、git diff --check通过，GitHub远程全量未触发。

### 实机绘制定位

使用用户此前授权的同一Windows目标，浏览器实际建立RDP。首次指定CDP浏览器本身就在目标Windows内，出现递归桌面；该记录仅用于确认位图编码，不作性能结论。正式对照改用本机Linux headless浏览器，Nexus/Termix请求32/Termix请求16顺序连接（避免同账户互踢），均1062×856。打开一份空白Notepad，最大化后每方案3次最小化/恢复，同一Chrome/code-server背景；核验15张截图操作均成功。结束关闭本次空白窗口，没有在Windows创建文件。

Termix对照为插件1.3.1、固定提交`1b7242358efb7b105b017e2f24ca2a451d8348c4`的真实EngineSession/EngineCore/RdpClient/Display和原预编译WASM，标准guacamole-common-js1.5.0及Termix同款同步flush补丁；不是完整Termix应用部署。隔离server仅绑定127.0.0.1动态端口，凭据从0600文件读入内存，不放URL或日志。主仓`6b060594`的此时默认方案为服务端Worker解码后PNG/JPEG+Guacamole sync，而不是默认guacd/FreeRDP或H.264。

三组实际收到的均为主要64×64的压缩16bpp位图，均无SurfaceCommands、RFX或frame markers；Termix请求32并未在此目标激活32bpp/RFX，不能据此修改Nexus默认值。Nexus三次最小化首次→最后位图收到为71→181、33→225、25→77ms，真实paint最后为180.3、224.5、76.4ms；每次native putImageData总耗时1.2、1.7、0.7ms，未观测到≥50ms长任务。第二次末尾仅2块65字节，主体早于该尾部完成。Termix两组也有2–3批桌面图像和渐进sync，不证明整次动画原子呈现。

详细三组表及恢复数据在`stable-analysis.json/md`；Termix最后sync是到达时刻，不等于最终paint，不能与Nexus原生paint作排名。Nexus经api.honus.top而Termix经loopback并在server Worker解码，两边捕获有开销、无随机交错、样本仅每组3次；这些证据支持分批在前端绘制前已存在，不区分Windows产帧与网络分批，也不证明所有分辨率/网络/GPU场景。

固定与当前上游Web SessionBuilder均无公开正常模式色深、完整帧回调或RDPGFX开关；legacyGraphics虽然请求32却同时禁codec，不是通用加速。上游FrameEnd PR #1189已关闭未合并，作者最终说明未达到预期，不能作为现成修复。当前没有证据支持修改应用渲染链；保留立即协议转发和原rAF提交，未加入会延迟输入与画面的猜测等待。完全消除该目标渐进更新仍依赖后续协商/SDK能力验证，不写成已修复。

本轮收口：原9998/3001隔离测试环境与全部证据保留；Termix对照服务和专用headless浏览器在连接关闭后按已记录PID核实归属并停止，未删除用户要求保留的文件，见rdp-render/process-cleanup.json。凭据文件保持0600；没有在生产数据库执行迁移、提交推送或发布。主代理与独立Sol最后复核实例关闭、五手势失活与可见viewport边界，未发现新问题。

## 前端最终缺口与 UI 复审（2026-11-06）

基于 `main/378083190cba468ed69dad892c0810b33e9f2edd` 及原未提交工作区，保留前序功能。本轮证据位于 `/home/honus/nexus-task-artifacts/frontend-final-audit-20261106`，`frontend-start.diff` 记录追加审核前的前端状态；测试环境为前端9998、`api.honus.top`、指定Windows Chrome156 CDP。非 bug 不改变正常UI，未提交推送、发布或部署。

### 功能对应

| 功能           | 实证问题与修复                                                                                                                      | 不变量                                                                  |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 拖动与进度窗口 | 取消/失焦/隐藏/卸载原会调用onEnd；失活窗口仍显示并采样。基础拖动区分提交与取消，同步全部5个消费者，真实active控制Teleport及速度计时 | 正常pointerup和显式stop仍提交；取消保留内存位置但不保存；原传输继续     |
| 多文档快捷键   | 两个共享编辑器一次Alt+右原跳两个标签；Ctrl+F及加载态Escape可作用于另一预览。按通用文档根标记和当前焦点选择唯一实例                  | 保留单视图及无文档焦点的首个可用处理；不改原搜索、session和加载取消流程 |
| 基础下拉       | 矮屏时区panel原高329px、顶部y=-85px，首项在屏外不可选。消费Reka可用高度并扣除现有边框与padding                                      | 保留正常320px列表上限、密度及样式；首尾滚动可达                         |
| 传输目录同步   | 正式回归复现切页后复制完成，但原视图回调失效使列表一直旧；将完成后只读刷新绑定原存活会话，同步上传、移动及归档                      | 旧视图不再发提示或新写入，不重放传输                                    |
| 恢复按钮键盘   | 拖动取消或松手无click后首次Enter原被didDrag吞掉；仅抑制detail>0的指针click                                                          | Enter/空格首次恢复，迟到指针click仍不误触                               |
| 无效样式       | 删除 `.ui-select__value[data-placeholder]`：唯一真实span不设置该属性，第三方状态在trigger上                                         | 不将未命中的动态CSS当作无效规则；无正常视觉变化                         |

### 职责归属

| owner                 | 当前边界                                                                                                             |
| --------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Foundation            | 只持指针手势、选择状态释放及基础下拉可用高度；取消不调用业务onEnd                                                    |
| Transfers / Workspace | 窗口实际active、位置持久化及速度采样归各窗口；Workspace装配宿主状态，不改变传输资源生命周期                          |
| shared/focus          | `ownsDocumentKeyboardEvent` 为纯DOM判断，只认识 `data-document-keyboard-scope`，无feature私有选择器、Store或全局监听 |
| 文件功能              | FileEditor、PreviewSearchBar、FilePreview加载态在自身监听里核对active/可见性/KeepAlive/defaultPrevented及文档归属    |

### 类型归属

新增取消能力沿原Foundation交互返回值；进度active沿feature受控props；焦点helper仅接HTMLElement/KeyboardEvent并返回boolean。三个文档组件显式声明通用根标记，所有5个拖动消费者同步取消调用。目录完成回调复核原session生命周期；注销/关闭同步释放browser与adapter，dispose/generation阻止晚读取回填，断线由原重连刷新补齐；独立只读复核未发现重复派发或把旧结果写入新会话的路径。没有Shared协议、数据库或迁移变更，无兼容桥和第二份业务状态。

### 完成证据

Node26.13.0/pnpm12.16.1：根 `pnpm run check`、`pnpm run format:all:check` 和 `git diff --check` 已通过，日志为 `check.log`、`format-check.log`。首轮正式生产构建通过，43项端到端42通过、1失败，见 `e2e.log`：新增进度生命周期用例的手势断言全部通过，但最终目录未显示已完成的复制。后端原任务3535d2d6-f8d0-4e43-a8f6-03c52c9ffe5f已记录MUTATION_COMPLETED；原页面permission在切会话/页后失效使刷新被跳过。已修源码并保留失败trace、截图与原断言。最终 `e2e-final.log`：双端生产构建和50项正式本地隔离E2E全部通过（3.7分钟），含原失败场景、新增上传/归档离页后无需手动刷新、RDP/VNC键盘恢复、进度取消/隐藏、系统矮屏下拉及文件编辑/预览。最新根检查与全仓格式分别为 `check-final.log`、`format-check-final.log`，均通过；`source-sha256.json` 记录本轮关键源码和测试指纹。此结果为正式仓库用例的本地执行，不代表GitHub远程全量。

- `gestures/before.json` → `after.json`：四种取消及卸载不再触发onEnd，晚move/up无效，正常松手/显式stop共2次提交。`consumers-after.json` 为真实Center/Display的20组位置、localStorage、active/KeepAlive/后台、采样计时和正常提交核对，pageerror为空；实组件测试不等同于真实手机后台。
- `gestures/keyboard-restore-before.json` → `keyboard-restore-after.json`：两owner×三种拖动结束方式共6组键盘首次激活修复；6组可信mouse/pen/touch正常恢复，无pageerror。真实键盘click同样是PointerEvent，但detail=0，不能按事件类猜测鼠标；正式RDP/VNC与进度用例同步覆盖。
- `keyboard/before.json` → `after.json`，`loading-before.log` → `integration-final.log`：13项实组件浏览器检查通过，覆盖共享/独立编辑器、active=false、已处理事件、事件target/activeElement、无焦点fallback、搜索与加载取消归属。对应仓库入口 `tests/frontend/document-keyboard.integration.mjs`；正式SSH用例同步补左右标签导航。
- `select/before-cases.json` → `after-cases.json`：3种density、fitLongest两态、4种视口/位置共24组，16组越界降至0组。390×400和320×240真实时区首尾均可点击；1440正常列表仍320px，截图0像素差，见 `verification.json`。

只读UI建议尚未实施：手机设置分类条隐藏滚动条，可增加边缘滚动提示；紧凑按钮可评估保持视觉尺寸的触控热区；被省略的长模型ID/连接名称可提供触屏可用的完整查看方式。源码依据分别为SettingsPage、AgentConfigPopover/PreviewSearchBar及ProviderCatalogCard/UiSelect，实测见 `select/optional-ui-measurements.json`。不据此改动当前已确认设计；完整GitHub回归及真实手机输入法仍不由本轮桌面视口测试代替。

## RDP 音画评估、工具栏与移动 UI（2026-11-06）

用户授权悬浮工具栏重排与前轮移动UI建议，并补充实测声音晚于画面及FreeRDP替换评估。本轮保留原未提交工作区，未提交推送、发布、部署或迁移数据库。全部证据归 `/home/honus/nexus-task-artifacts/rdp-audio-toolbar-ui-20261106`，工具链Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 非全屏RDP尺寸→重连→文件剪贴板→全屏→最小化→关闭，真实DOM与Tab顺序一致；手机设置分类显示实际溢出方向，预览搜索两行且操作可达，长模型ID展开后可选择全文，配置按钮增高。正常桌面密度、VNC和全屏行为保留  |
| 职责归属 | 远桌Modal局部复用已有VueUse模板；设置Page持导航和实际scroll状态；控件调整归原feature；基础UiSearchInput仅在自有清除按钮开启时隐藏重复原生取消图标。音频保持现有Adapter/SDK，不增加猜测缓冲或自造协议 |
| 类型归属 | 原props及局部DOM/几何状态，无Shared或数据库契约修改；音频JS能力没有假增timestamp/播放反馈字段                                                                                                        |
| 完成证据 | 最终双端生产构建、32项正式本地E2E、根check、全仓格式及diff检查通过；CDP三语/深浅/宽窄与触控交互如下。实际物理音画同步未修复，FreeRDP只有文档/源码评估                                                |

### 浏览器与正式回归

Windows Chrome156通过指定CDP、独立page访问api.honus.top/9998，页面完成后关闭。`toolbar/after.json`覆盖7组RDP/VNC宽窄mouse/touch，VNC三组几何与before一致，无pageerror；截图使用受控失败连接，仅证明布局，不代替连接成功。正式RDP用例实际连接隔离目标，验证11个Tab停靠点（含数字步进按钮）、320/390可达性、剪贴板、全屏、重连音频释放和VNC回归。

`settings/final/results.json`含三语×深浅×320/390/1440共18组，无pageerror；`desktop-comparison-final.json`六张桌面图0像素变化。`controls/assertions.json`、`interactions.json`与`search-clear.json`覆盖真实深浅主题320/390/1440及三种coarse触控组合，搜索上一/下一、清除保留面板、关闭面板、编辑/刷新原owner、长模型ID完整选择和无横向溢出。预览搜索操作为44×44，Agent配置仅增高到44px、保持原横向紧凑宽度，不宣称全部按钮44×44；前期主题注入有误的图片不作为最终主题证据，使用baseline/final组。

首轮`e2e.log`为30通过、2失败，首次trace/截图保留：新增Provider用例只登录了独立request，浏览器仍在登录页，已为page.request补登录；设置页新增箭头留白叠加原8px间距，Linux字体下320px英文Data Management分类略宽于滚动区。去掉重复间距，箭头使用原空隙；保留原完整可见断言，不以省略文字换绿。最终`e2e-final.log`重新构建双端，5个spec共32项全部通过（1.7分钟）；`check-final.log`根检查、`format-check-final.log`全仓格式及`git diff --check`通过。GitHub远程全量未触发，真实手机键盘与物理设备仍另验。

### 音频与FreeRDP评估边界

用户确认声音偏晚。当前Web扩展丢弃RDPSND timestamp且没有播放延迟回传；底层收到wave即确认，图形也没有共同呈现时间戳。历史2026-11-05 Windows授权测试每声道8192采样、44.1kHz，即185.760ms声音块，应用排程ahead最多35.410ms；当时base/output latency为42.667/128ms。这些不是本次用户物理音画差，也不能简单相加作为端到端延迟。新静音CDP探测仅核对浏览器API，不能证明强制采样率或numeric latency更快。报告及固定源码见`audio/assessment.md`、`provenance.json`；未修改音频产品代码、SDK或Windows策略。

FreeRDP是原生库，不能直接替换当前浏览器WASM。可复用方案为guacd/FreeRDP服务端解码、Guacamole协议及guacamole-common-js前端，需适配已有鉴权/撤权、证书人工确认和指纹、目标与代理、尺寸/输入/音频/文件以及进程生命周期。Guacamole1.6.0官方文档公开GFX和RemoteApp等能力，但是否改善视频、分块和服务器负载仍需同目标实测；文件驱动器重定向不冒充当前文件剪贴板。

关键源码区别：FreeRDP原生RDPSND有设备播放时延反馈，而固定Guacamole1.6.0的`rdpsnd.c`安装自己的通道，`rdpsnd-messages.c`写入/flush浏览器音频后用原timestamp确认，不直接继承原生反馈优势。不能声称换guacd就解决声音晚。对比源码、官方页面和仓库活动元数据存于`audio/freerdp-comparison/assessment.md`及同目录。此前Termix对照使用IronRDP插件，不是FreeRDP性能测试。没有新依赖、引擎切换或性能提升倍数结论。

## 设置布局与加载优化（2026-11-06）

本轮按用户授权审核八个设置分类与Agent子分类的布局和加载，保留已有未提交功能，不提交推送、部署或修改数据库。证据归 `/home/honus/nexus-task-artifacts/settings-optimization-20261106`；`start.diff`保存追加前的工作区状态，Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 实现与边界                                                                                                                                                               |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 功能对应 | 路由入口只登记实际分类，不先挂载隐藏工作区；诊断/恢复首次展开才挂载，收起撤销active、再开读取。分组标题按内容宽度与操作组换行，短标题仍同排，不再挤成窄列                |
| 职责归属 | SettingsPage持visited和维护展开；Security只装配安全功能，IP面板独立；各feature public提供原面板loader；Agent按分类拆异步入口；通用标题/动作排版归Foundation settings.css |
| 类型归属 | 仅原组件props/events及局部布尔状态，安全面板移除混合section分支并同步唯一消费者；无Shared/协议/数据库迁移、额外缓存或依赖                                                |
| 完成证据 | 根check、全仓格式、生产构建、diff检查通过；正式本地27个唯一场景覆盖通过，首次失败和精确补跑如下；CDP布局、请求和构建块大小分别记录，不冒称实机加载提速倍数               |

### 性能与布局证据

指定Windows Chrome156 CDP通过独立页面访问api.honus.top/9998，结束关闭自建页面；语言与主题只改页面内存，不保存用户设置。`before/results.json`→`final/results.json`覆盖8分类及3个Agent子分类×320/390/1440共33组；`locales/results.json`再覆盖8分类×中文/日文×深浅主题×3宽度共96组。最终无pageerror或控件横向越界；中文短标题仍保持同排，英文长标题与动作按内容换行。320px英文TOTP标题原只剩12px，标题栏颜色原55px，完整可读性由正式用例同时核对最多两行、文字不溢出和动作不重叠。未改变配色、实际设置或保存流程。

`request-comparison.json`记录同环境冷页面API请求数量：关于19→14、外观19→14、系统24→19、安全22→17、IP控制21→16、Agent24→19、数据21→14；工作区自身仍19次。省掉隐藏工作区的一次配置和完整presentation四端点查询，数据额外省去折叠诊断与突变目录查询。全局认证、主题和Agent宿主请求继续正常执行。数字是已记录开发环境请求计数，不是物理弱网或总体延迟测量。

`bundle-before.json`→`bundle-after.json`记录生产构建未压缩单块大小：SettingsPage40302→20718字节，AgentSettingsPanel221341→91426字节；安全、IP、备份、诊断/恢复及Agent扩展、浏览器运行时、安全网络、集成/市场/预算改为独立按需加载。整体代码仍存在，不能把入口单块变化写成整个页面传输或加载时间同比减少。现有已访问表单实例、完整presentation读取、CAS与未知写入围栏保留，没有通过使用过期快照减少请求。

### 回归与收口

新增`settings-loading.spec.ts`验证直接入口无隐藏工作区/配置查询、维护区首开/收起/重开、系统和工作区独立草稿在分类间保留且不写入、安全/外观标题及动作宽窄可达。首轮`e2e.log`双端构建通过，27项中26通过、1失败；新用例打开维护区后用宽泛summary定位关闭，误匹配内部两个折叠项。只将定位改为外层直接summary，保留请求、重开和布局断言；原trace/截图保留。`e2e-final.log`重新构建后该spec3项全部通过，覆盖共27个唯一场景；其余组包括备份实际导入导出、CAPTCHA、IP白黑名单、OIDC登录/配置/撤销、偏好保存和真实读取失败、Agent预算/硬限制/ACP与插件诊断。

`check.log`、`format-check.log`及最终文档/测试定向检查通过。首次CDP全分类脚本在appearance可见性等待超时，原日志保留于before.log；独立probe无页面错误且显示正确，重跑完整before和两轮after均完成，未据此推测或修改产品失败逻辑。截图和API探针不替代真机输入法、真实弱网或GitHub全量；本轮未触发远程CI。规则、USAGE、架构与PLAN已同步，测试环境和产物保留至用户通知清理。

## IronRDP 应用排队与隐藏绘制优化（2026-11-06）

用户决定保留IronRDP、不采用guacd。本轮基于main `378083190cba468ed69dad892c0810b33e9f2edd` 的既有未提交工作区追加两项优化，未提交推送、发布、部署或改数据库。证据归 `/home/honus/nexus-task-artifacts/ironrdp-optimization-20261106`，含修改前`start.diff`、Adapter备份及首次失败产物；工具链Node26.13.0/pnpm12.16.1。

### 四表审核

| 审核表   | 结论与边界                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 隐藏/最小化/未挂载Canvas保留最新像素但免提交，恢复时一次显示积累变化；音频不再按设备输出延迟额外保留应用积压，正常连续排程、RDPSND尾音与暂停丢弃保留 |
| 职责归属 | 可见性观察、rAF及底图归rdp-frame-presenter；PCM实时排队归rdp-audio-output；仍复用原SDK、Web Audio和Canvas，没有协议实现、新依赖或服务端进程          |
| 类型归属 | Adapter内部布尔状态及原PCM回调契约；无Shared/API/数据库变化。测试专用入口与RDPSND交付替身仅由E2E构建引入，不在产品提供测试钩子                       |
| 完成证据 | 双端生产构建、14项本地正式E2E、指定Windows CDP三项受控检查、根check与最终格式/diff检查通过。没有物理音画差、CPU/GPU百分比或端到端性能倍数结论        |

### 对照与回归

`baseline.log`在产品修改前运行新增两项检查，两项均按预期失败：隐藏画布收到12批像素仍有12次native putImageData；受控AudioContext时钟下，以历史Windows实际8192采样/44.1kHz块及42.667/128ms设备延迟构造三块突发，第三块被排在350.519ms之后。此为可重复的应用排队问题，不是用户设备声音晚的端到端测量。

修改后`e2e.log`重新构建双端与测试客户端，14项全部通过（32.1秒）。其中新增3项验证隐藏期间0次提交、恢复1次、最终像素与源内存复用、同值尺寸重置、页面可见性、关闭晚回调、初始未挂载与直接绘制/分配失败回退顺序；音频使用真实Web Audio Buffer/Source、受控时钟及RDPSND交付替身，正常35.410ms提前排程连续、close不截尾、暂停忽略PCM、积压时停止两块旧声音并立即安排最新块、关闭不接受晚到块。其余11项使用真实xrdp/TigerVNC及后端，覆盖证书信任/撤销/取消、票据归属/期限、连接/剪贴板、尺寸/DPI/全屏、手机恢复、VNC与重连音频释放。

最后源码复核补充IntersectionObserver阈值边界：threshold=0在画布刚碰到视口时可以报告isIntersecting=true、面积0，继续移入时不一定再次通知。因此直接消费isIntersecting，不额外按正面积过滤。`e2e-final.log`补充边缘用例时2项通过、1项失败：测试以innerWidth定位边缘，实际IntersectionObserver视口因稳定滚动条留白比innerWidth窄8px，所谓移入后仍处于可视区域外。`edge-probe.log`保存真实rootBounds与坐标；用例改为读取浏览器报告的rootBounds.right，保持像素断言。`e2e-edge.log`重新构建并验证三项通过，最终CDP也使用该版本。

`cdp-results.json`通过指定 `172.30.30.11:9223` 的Windows Chrome，在 `api.honus.top` 同源自建页面复用上述三个受控场景，全部通过、无pageerror。测试模块由page级路由提供，不改服务器文件、用户页或设置；完成后关闭自建页。这与真实xrdp连接证据分开，不冒充本轮真实Windows播放或物理声音测量。

`check.log`根检查通过；首次`format.log`发现新增测试声明间距8处，自动格式修正后`format-final.log`通过。未更改正常UI、150ms动态尺寸防抖、鼠标输入调度、初始化/证书准入或上游SDK。冷启动预加载只有串行路径观察，没有可归因的性能对照，本轮不引入额外准备入口。超32MiB底图及不支持路径仍直接绘制，不宣称这些情况也停止隐藏提交；协议处理与解码继续，不能把减少Canvas提交视为消除全部后台开销。真实网络波动可能更早丢弃旧音频，符合用户授权的实时优先；上游分块、时间戳缺失、音频设备延迟及渐进绘制仍按PLAN能力边界推进。

## 本轮功能提交与远程 E2E 修复（2026-11-06）

本轮提交并推送 `9853e87d96e5f75467527490b18950cae1441cb0`，包括 OIDC/Passkey、Agent 完整日志、前端 CSS/模块重构、设置加载、IronRDP 和终端恢复/连接选择修复。该提交前根 check、全仓格式及 diff 检查通过；此前本地专项分别见本页对应记录。统一交付证据归 `/home/honus/nexus-task-artifacts/remote-e2e-delivery-20261106`，保留至用户通知清理。本轮仅提交、推送与 E2E，不发布镜像或更新生产主机。

### 首轮失败与修复

[首轮 42218925378](https://github.com/0honus0/nexus-terminal/actions/runs/42218925378) 在上述 SHA 完整运行，质量、双端构建、Docker smoke 和七个浏览器分片全部成功；后端有三项失败且重试仍失败，整轮为 failure。原作业日志和完整诊断包分别留在 `first-backend.log` 与 `first-backend-artifact/`，不以局部重跑掩盖首次失败。

| 审核表   | 结论与边界                                                                                                                                    |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 只同步测试夹具，保留实际文件交付、UTF-8 分页、迁移回滚/重启和资源关闭断言；USAGE 原说明仍符合产品，无 UI 或产品行为改变                       |
| 职责归属 | 迁移链与 SQL 仍归原 Bootstrap/Adapter；测试恢复真实旧表结构，产品不增加重复 CREATE 兼容；资源 mock 实现真实 Job 读取能力                      |
| 类型归属 | SQLite 正式版本断言补充 v4；资源替身新增 waitingOutputCount 并验证 0→1→0 的等待状态投影；无 Shared/业务类型变化                               |
| 完成证据 | 本地正式 Playwright 动态端口入口的三个原失败场景全部通过，日志 `local-three.log`；修复提交 cd0c10f3 的最终远程 678 项一次通过，见下方整轮核对 |

具体根因：存储用例仍预期 `[1,2,3]`，未同步新增 v4；文件用例删除 v2 之后的迁移记录但保留 v4 的 OIDC 三表，导致启动重执行 DDL；资源用例的 Job mock 缺少 waitingOutputCount，读取会话状态时抛 TypeError。修复后用实际 v1 表结构重新执行连续迁移，保留旧内容转换及第二次启动不变的断言；存储测试仍覆盖有序安装、失败事务回滚和恢复。

本地命令为 `NEXUS_E2E_SUITE=backend node scripts/e2e/run-remote.mjs -- --project=agent specs/agent/execution-flow.spec.ts --grep 'file batches|ordered SQLite migrations|resource expiration'`，隔离数据及 TMPDIR 位于本轮任务目录，重新构建 Shared/Backend 后 3 项全部一次通过（19.3 秒）。实际 Node 子场景覆盖文件 11 项、资源 5 项与完整存储脚本，不将子项重复累计为正式唯一 E2E 数量。

### 最终整轮核对与交付

修复提交 `cd0c10f39acb8269226c40bacfd6c7948948df15` 已推送 main；其提交前根 `pnpm run check`、`pnpm run format:all:check` 和 diff 检查通过，日志为 `fix-check.log`、`fix-format.log`。本地正式入口同时重新构建 Shared/Backend；原首轮远程质量作业已完成双端生产构建，本次完整远程也重新构建双端，不复用首轮失败的测试结果。

[最终 E2E 42220871118](https://github.com/0honus0/nexus-terminal/actions/runs/42220871118) 在该修复 SHA 全部成功：质量、runner、Docker smoke、后端和七个浏览器分片及耗时更新均 success，文档截图按条件跳过。`final-run.log` 经正式 Reporter 逐条统计为 678 条记录、678 个唯一场景、全部 passed，无失败、重试、flaky 或场景跳过；其中 Backend 166，Browser 1–7 为 58/58/59/82/72/92/91。三个原失败场景均首次通过；首轮 failure 保留，不用最终成功改写原始结果。

工作流自动推送 `c6bee350`，仅更新 `scripts/e2e/duration-estimates.json`，已审核并快进同步。本轮最终只同步验收基线与实施计划，不改变已验证源码；当前 OIDC 迁移 v4 已被正式迁移及重启场景覆盖。真实 Pocket ID、手机输入法、运营商弱网、介质故障和物理音画性能仍按 PLAN 单列，不由受控 E2E 代替。未发布镜像、未更新生产主机，测试证据与环境继续保留至用户通知。

## Main amd64 dev 发布（2026-11-06）

用户在完整远程 E2E 通过后授权发布 main dev。核对 main 为 `024d608ac2de29d3991a0005e9215156ce52f646`，与被测 `cd0c10f3` 之间仅有验收文档和测试耗时更新；工作区干净，沿用 amd64 架构。通过现有 `publish-ghcr.yml`，以 main、channel=dev、architecture=amd 触发 [42222715508](https://github.com/0honus0/nexus-terminal/actions/runs/42222715508)，准备、生产依赖审计和镜像构建推送全部 success。

| 审核表   | 结果                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| 功能对应 | 发布已通过 678 项完整 E2E 的应用代码；不改变产品或 UI，不更新生产主机                                        |
| 职责归属 | 现有发布 workflow 构建并推送 GHCR；本地仅读取 manifest/config 核对结果，不拉取完整镜像                       |
| 类型归属 | 无代码或协议变化；镜像含原有 OIDC v4 连续迁移，由实例升级启动时自动执行                                      |
| 完成证据 | 工作流 success，dev 与源码标签摘要相同，OCI revision 和 linux/amd64 平台均匹配；日志和元数据位于下述任务目录 |

`ghcr.io/0honus0/nexus-terminal:dev` 与 `ghcr.io/0honus0/nexus-terminal:sha-024d608ac2de` 的 OCI index digest 均为 `sha256:aa9166d34b872f62477d5ee9c85c8e28727940da75eeeed5fc2dd1116b4d98c6`；amd64 平台 manifest 为 `sha256:2a09c505e9823305ff495554f07bb268c9becf12c6f6b521d55a9457c97a645d`。实际 config 的 revision 为完整源码 SHA，version 为 `sha-024d608ac2de`，OS/architecture 为 linux/amd64；证明 manifest 的 unknown/unknown 不代表另一个执行平台。

证据归 `/home/honus/nexus-task-artifacts/main-dev-publish-20261106`，包括源码差异清单、完整工作流日志、最终状态、两个标签 manifest 与实际 config；保留至用户通知。发布后只更新本节、当前验收入口和迁移链摘要，格式与 diff 检查后提交，不将后续文档 SHA 误写为镜像来源；未创建 Release、未变更 latest、未更新远程容器或数据库。

## RDP 平板与手机工具栏（2026-11-06）

本地 `390cfdb5` 上的未提交工作区专项，Agent 中间迁移仍暂停。使用 Node 26.13.0、pnpm 12.16.1、指定 Windows Chrome CDP `172.30.30.11:9223`，访问 `api.honus.top`，前端9998直接加载当前源码，复用隔离3002 Backend及已授权的真实 Windows RDP 目标。产物集中 `/home/honus/nexus-task-artifacts/rdp-toolbar-touch-20261106`，凭据不写入证据。

- 原因：820px桌面UA触屏下工具栏高约139.75px，长触控说明和flex-wrap共同挤成多行；恢复按钮的任意pointermove被标记为拖动，实际1px偏移吞掉恢复click。拖动后还观察到浏览器只派发pointerup而缺少合成click。
- 修复：实际窗口宽度决定单行/紧凑呈现，尺寸和触控复用UiPopover，状态和文件入口紧凑显示；完成的touch/pen轻点直接恢复，12px容差与现有长按一致，真正拖动与取消不恢复。尺寸change时才应用完整值，避免逐字编辑触发布局切换后丢失焦点。
- `review-final2.log` / `review-results.json`：真实RDP、820/390/320px各自48px单行、零溢出；尺寸/触控/文件面板可用，直触与触控板切换，1/4px触摸偏移、真实拖动到另一侧不误恢复、下一次轻点恢复通过。后续尺寸提交调整另由桌面专项验收。
- `desktop-review.log` / `desktop-results.json`：1440px真实桌面连接，紧凑尺寸输入1064与宽窗口逐字输入1200均保留焦点，提交后应用；原11项Tab顺序、鼠标拖动/恢复和原生浏览器全屏进出通过。
- 用户要求加快交付后，停止重复截图及额外多语言/主题矩阵复跑；`review-acceptance.log`只记录该轮已完成的820px，不作为全矩阵通过。已有完整三宽度专项与最终尺寸提交专项分别保留，不清除失败及中止证据。
- `eslint-final.log`、`e2e-list.log`：受影响源码与正式用例ESLint通过；Playwright发现6项RDP/VNC用例，新覆盖保持真实输入及原连接/全屏功能断言。`git diff --check`通过。
- `frontend-build-final.log`：前端构建在vue-tsc阶段被Agent的PluginRepositorySettings与plugin-market-rules共4处manifest字段缺口阻断；本轮RDP/基础手势无类型错误。未修补暂停的Agent代码，未运行正式全量构建/E2E，不沿用历史PASS。

限定浏览器证据不代替真机iPad/Android、VNC真实传输与Workspace真实文件任务回归；后续入口保留在PLAN。源码仅涉及前端，无数据库迁移；测试资源保留至用户通知，本轮未提交推送发布。

## 文件预览底栏（2026-11-06）

在现有未提交工作区修复FilePreviewDialog强制窄屏换行及搜索/编辑/刷新分别覆盖宽高的问题，PreviewToolbarButton统一基础按钮尺寸；保留原搜索、刷新和编辑事件，不涉及数据库。

指定CDP访问api.honus.top的本地9998源码环境，挂载真实MarkdownPreview与真实预览session，输入来自内存Markdown夹具，未读取或修改远端文件。320/390/820px容器回归全部通过：三个按钮分别统一44/44/32px、路径与按钮垂直居中同排、底栏零横向溢出；搜索命中2条、关闭恢复底栏，3次编辑事件与3次刷新读取均收到。样例长路径的可见宽度分别约94/164/559px，完整路径保留title。结果位于`/home/honus/nexus-task-artifacts/file-preview-footer-20261106/{review-final.log,results.json}`，首次脚本定位错误保留原日志。

定向ESLint、Prettier和diff检查通过；前端vue-tsc仍被此前Agent中间迁移字段缺口阻断，不称全仓通过或正式E2E通过。未运行远端文件传输/持久化回归；产物保留至用户要求清理，未提交推送发布。

## 非 Agent 重构修复独立提交（2026-11-06）

从 main/390cfdb5 的混合工作区拆分；独立 worktree 位于 `/home/honus/nexus-task-artifacts/non-agent-fixes-20261106/worktree`。原工作区 Agent 插件架构和 SDK 中间变更继续保留，不进入本批。`scope-audit.json` 逐文件记录取舍，包含已跟踪与新增文件；不单按 Agent 路径过滤，索引、Provider 轻量准入及状态一致性查询属于原性能任务。

| 审核表   | 结果                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------- |
| 功能对应 | RDP 单行工具栏/触屏恢复、预览路径与等大按钮、语言按需加载、文件拖动和进度位置职责整理、历史保留、审计通知与诊断 |
| 职责归属 | UI 延续原 owner；构建聚合语言；数据库事务/索引留 Adapter，统计留 Platform；插件新执行架构和 SDK 不带入          |
| 类型归属 | 诊断唯一 Shared Zod Mini schema 与前后端消费者同步，字段与单位严格校验；原 Run WS 协议不变                      |
| 完成证据 | 本地构建/静态/格式检查通过；正式浏览器入口 8 项、数据库专项 12 项通过；当前提交远程整轮仍待验                   |

Node 26.13.0/pnpm 12.16.1；`build.log` 与 `browser.log` 包含 Shared、Backend、Frontend 和测试客户端生产构建，`check.log` 为根 check，`format.log` 为 format:all:check。正式动态隔离端口入口覆盖语言按需/并发切换、RDP 设置/剪贴板/全屏/缩放/触屏轻点和拖动恢复、VNC 恢复、窄屏真实文件预览底栏/搜索/编辑/刷新，8 项一次通过。`targeted-storage.log` 为 performance、phase2、oidc 三份脚本共12项：迁移4→10、重复启动、索引计划、通知回滚/恢复、组合事务拒绝与迟到参与、历史保留、诊断路由/严格解码及 Provider 版本校验全部通过。

额外运行全部 storage 脚本的 `storage-tests.log` 为124项、78通过/46失败，未视为本批验收通过：integration-races 的旧表与清理替身、public-boundary 缺少已有 lastConnectedAt 字段、snapshot-crash 的根目录注册夹具不匹配，以及本机命名空间内执行 Node 被拒绝。保留原始失败，不跳过或改成成功；适用逻辑使用上述专项及后续正式完整远程 E2E 核对。实机 iPad/Android、物理音画与介质性能仍不由受控回归代替。无镜像发布或生产部署。

## 非 Agent 修复远程失败收敛（2026-11-06）

首次完整远程 [42303771316](https://github.com/0honus0/nexus-terminal/actions/runs/42303771316) 对应 f3ef8671：质量、runner及Browser1/5/6/7通过，Browser2/3/4、Backend与Docker smoke失败，未作为通过证据。原日志保留在non-agent-fixes-20261106。

根因与修复：手机RDP仍定位旧常驻模式按钮，改从Touch弹层进入并保留持久化/不重连断言；Markdown预览沿旧28px断言，更新为本轮已确认44px等宽高；异步语言启动可能错过window.load，PWA同时处理已加载文档，原场景延迟语言包到load之后覆盖竞态；v1数据迁移夹具只删除版本记录未删除后增结构，补齐5–10还原；Docker生产类型检查的音频测试入口跨目录引用未复制的测试源码，测试adapter移到frontend/build，仍仅E2E配置打包。

本地 `e2e-fix-browser.log` 的正式动态隔离入口3项一次通过，包含异步load竞态、手机Markdown真实编辑/SFTP保存和RDP模式/重连；`e2e-fix-backend.log` 的文件专项12项通过，无skip；`e2e-fix-check.log` 根check通过。构建包含双端与E2E客户端；未在本地重新构建Docker镜像，待远程smoke核对。后续完整远程仍待验，不修改产品布局或跳过失败功能。

最终远程 [42306606716](https://github.com/0honus0/nexus-terminal/actions/runs/42306606716) 对应 `379af20af947196f8f92d1c4cd346187c10d18d5`，完整680项一次通过：Backend167，Browser1–7分别47/52/90/81/66/92/85。质量与Docker smoke成功，耗时更新成功，截图任务按条件跳过；Reporter无场景skip、retry、flaky或失败。`final-*.log`及`e2e-reporter-audit.json`保存原日志和逐项去重统计。后继`9fd223a3`仅为自动耗时更新。原工作区已三方同步11个修复路径、保留661个其它修改/未跟踪路径；Agent文件专项已使用独立legacy adapter夹具，保留其新实现，没有恢复本轮已修旧式schema回退。

## 非 Agent main amd64 dev 发布（2026-11-06）

[发布42307601610](https://github.com/0honus0/nexus-terminal/actions/runs/42307601610)成功，来源`9fd223a38c675c5fb4097e649b7edda00895158d`，与完整680项E2E的379af20a仅差耗时估算。`ghcr.io/0honus0/nexus-terminal:dev`与`sha-9fd223a38c67`均为`sha256:8eca2327e9d597875ef3525c780b85a9a738e086e782d1a048bc5c7514dd271f`；linux/amd64平台manifest为`sha256:d6596123615d4a531026395bf76e260420050200e7bc2a62e0ae5752819cdaa8`。OCI revision与来源匹配，生产依赖审计无已知漏洞。证据在non-agent-fixes-20261106/publication；只读manifest/config，未拉取完整镜像、未更新远程生产服务。Agent重构继续本地推进，本镜像不含中间源码。

## iPhone Chrome 终端空格输入（2026-11-07）

用户报告苹果手机Chrome普通空格无法输入，未补充其它输入框位置。实际排查TerminalView→xterm→onData→原TerminalChannel，应用没有trim或空格快捷键拦截；xterm6.0.0的229按键计时器可能早于textarea变更，而原input处理又跳过同一按键周期的composed事件。参考上游[问题5835](https://github.com/xtermjs/xterm.js/issues/5835)、[PR5836](https://github.com/xtermjs/xterm.js/pull/5836)和[问题6078](https://github.com/xtermjs/xterm.js/issues/6078)；5836检索时仍未合并，不宣称正式上游已修复。

既有依赖补丁保留原渲染修复，新增229周期共用基线：input/keyup/原计时器互相去重，按完整码点交付变化后缀及对应退格，compositionstart/普通按键清理旧周期；失焦、禁用输入和销毁终端同时清除基线及计时器。内部接口、源码与ESM/UMD产物同步，pnpm锁文件固定新补丁哈希。TerminalView和UI未改，无数据库变更。

证据归`/home/honus/nexus-task-artifacts/ios-terminal-space-20261107`，Node26.13.0/pnpm12.16.1，main/9fd223a3混合工作区；Agent重构内容保留，未提交推送发布。

- 指定CDP`172.30.30.11:9223`、`https://api.honus.top`测试环境，Windows Chrome156。`baseline.json`记录timer先于input的空格漏发，`fixed.json`与`umd.json`记录修复后两种产物均只发送一个空格。
- `component-regression-final.log`和JSON：直接执行正式terminal-lifecycle源码中8项新增场景，以Vite模块加载真实TerminalView，包含四种事件顺序下各三个连续空格、中文标点/emoji后缀替换与删除、中文composition/无keydown emoji/非composed事件/真实桌面键盘去重、离开终端后的迟到输入、失焦/禁用输入后再返回的旧基线清理。全部通过，无pageerror；该定向CDP运行未启动正式E2E后端夹具，不称正式整轮E2E或iPhone真机验收。
- `check.log`根check、`build-frontend.log`前端生产构建、`test-lint.log`专项ESLint通过。`install-frozen.log`离线冻结安装通过，`patch-verification.json`核对全部9份修改后的依赖文件与候选逐字节一致；格式和diff检查通过。

手机真机输入法、其它普通输入框、正式远程E2E与发布仍未验证；桌面CDP事件回放不能代替iPhone物理键盘/输入法组合。测试现场保留至用户通知清理。

## Agent SDK4 最终收尾回归（2026-11-07）

本轮基于独立插件仓 `0bf6cbb019a98cfecff9d194c5d4fa2dc1325c80`，Agent 2.0.1 与其余七包的正式 Actions 签名产物验证。插件 [Validate 42388106829](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42388106829) 与 [Agent 签包 42388935062](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42388935062) 成功；发布仍待完整本体验收，不把 draft 当作市场已更新。App 的16项单测及八包行为测试已通过，签名包逐文件hash、Ed25519与原始tar摘要均已核对。

本地 Node26.13.0 / pnpm12.16.1、短TMPDIR隔离回归，证据集中于 `final-implementation/delivery-20261107`：

- `backend-owner-settlement-final.log`：44项通过，包含三种真实SQLite提交确认丢失和原receipt/执行围栏保留。
- `owners-backup-final-fourth.log`：54项全部通过，无skip/cancel，覆盖真实SSH传输故障、后台Job、未受信主机、旧目标批准、权限监控排空、跨实例备份/真实秘密与插件原包恢复、multipart大文件拒绝。
- `owners-backup-browser-final-third.log`中的真实签名sandbox/MessagePort/WS组：14个子场景全部通过，含33个请求、9个独立订阅、晚事件与consumer关闭；该组合其它失败已在上述第四轮修复，不能将第三轮整组称通过。
- `browser-acp-denied-final.log`：真实浏览器拒绝ACP内层权限后，精确响应交付、远端进程退出及无越权写入通过。

本轮修复订阅回调误继承HTTP临时SQLite准入、提交确认丢失后Run永远running、协议关闭覆盖在途权限核对故障、旧目标批准仍可同意，以及快照表列顺序遗漏。普通HTTP拒绝在大上传尚未完成时采用正常写端关闭，避免提前reset吞掉安全拒绝响应。通用Operation和真实Job/资源围栏替代旧工具表断言，不恢复旧运行协议。

首次全目录Node探测889项包含173失败与8取消，并非通过；其中构建并发污染、专用环境依赖和旧夹具问题分别保留日志，后续仅在冻结dist后执行定向回归。正式远程矩阵、指定CDP最终验收和镜像发布在本节后续补齐，不继承旧680项基线。

### SDK4 首轮远程启动与标题回归收敛

`f1d52d4b` 的 [E2E 42390286200](https://github.com/0honus0/nexus-terminal/actions/runs/42390286200) 质量、双端构建与 Docker smoke 通过；全部测试分片因重建签包摘要不匹配在启动时失败，未运行的场景不能记为通过。固定 tar 的文件/目录权限，避免 CI 检出 umask 改变原包字节；本地八包重建 SHA-256 均与原官方签包一致。隔离 runner 同步正式 iframe 测试的新名称，保持未知副作用场景的独立后端生命周期。

指定 CDP 的正式签包聊天发现自动标题写入被工具列表投影误解码，造成内部失败并关闭插件准入。Operation Adapter 将 App 标题及私有存储回执排除在工具投影之外，原持久账本、原授权和真实工具/效果仍保留；真实 SQLite 34项通过，新增自动标题后读取工具列表、重新打开聊天及插件列表的正式浏览器场景。该修复没有变更 UI 或数据库结构；USAGE 的自动标题、聊天恢复和工具调用说明仍适用。后续完整远程矩阵和最终 CDP 结果继续补齐。

第二轮 [E2E 42391065220](https://github.com/0honus0/nexus-terminal/actions/runs/42391065220) 的质量与 Docker smoke 通过，但签包摘要仍在测试启动时失败。下载 Bookworm 的 GNU tar1.34 在本机复现精确相同的错误摘要，逐头核对为 ustar 的零设备号字段编码与官方打包环境 GNU tar1.35 不同；runner 使用已核对 Debian 源码 SHA-256 的1.35构建，不改签包或放宽摘要断言。

指定CDP在`api.honus.top:443`、本地9998生产前端预览和正式签名包上通过聊天、High默认推理、1440/390/320px无横向溢出、宽屏SSH文字/窄屏图标及刷新后重开聊天恢复。`cdp-final/acceptance.json`、截图与原失败日志保留；无pageerror。此前根check重建Shared期间影响运行中Vite的失败不算产品验收，最终改用冻结生产前端产物完成同一场景。

第三轮runner缺少XZ解压工具，补齐构建依赖后，[E2E 42391577489](https://github.com/0honus0/nexus-terminal/actions/runs/42391577489) 的runner、质量与Docker smoke均通过，原签包摘要问题已消除。测试分片随后发现共享构建产物遗漏`backend/dist-plugin-sdk/backend-v4.mjs`，自定义签名夹具无法启动；上传清单和预构建检查同步补齐。该轮未执行的场景仍不算通过，完整验收继续使用新提交。

### SDK4 第六轮远程失败收敛与最终本地回归

[E2E 42396361014](https://github.com/0honus0/nexus-terminal/actions/runs/42396361014) 验证 `f134948bd02c07eb5f6cce6ad06e404eb90f4581`：质量、构建、Docker smoke 和 Browser3/4/5/6 通过；Browser1/2/7 及 Backend1 失败，整轮未通过。原始日志保留在上述 delivery 目录的 `remote-sixth-*`。后端协议/生命周期组实测12分39秒，原15分钟全局期限在后续SSH回归前中断；仅后端整轮期限调整至30分钟，单项期限不变。

产品修复正常下载取消误报 owner 故障、包升级/卸载围栏内旧跨App附件授权仍可读取，以及持久附件列表写死2KiB的错误限制。正式后端矩阵新增对应流、意图、生命周期、退休故障和未知私有数据写入回归；SDK4原始效果保留，不恢复旧activate接口。测试夹具同步派发前schema拒绝的真实发现记录、仓库显式信任与Origin、当前Run模型历史范围、iframe内会话定位、原审批响应读取和独立UI新版本。

- `lifecycle-intent-final.log`：54/54通过，无skip/cancel，含60附件超过旧2KiB后的回执、重读及真实字节下载。
- `owner-sdk4-final.log`：4/4通过；`version-visibility-second.log`：独立版本可见性通过。
- `browser-continuation.log`：42项中38通过，另外4项首次失败已修复；`browser-continuation-final.log` 最终5/5通过，包括两种委派期限、两项布局持久化和真实原生Surface审批。已有通过组覆盖A07、首次启用、会话切换及双标签草稿。
- 根check、后端build和全仓格式通过，证据分别为 `check-continuation.log`、`backend-build-final-fences.log`、`format-all-final-fences.log`。提交前另执行 `check-final-push.log`。

本地专项不代替完整远程矩阵；新提交的完整E2E、逐项Reporter核对及正式发布继续推进。独立插件仓当前 `550e4e0b4d873dcaedac54fd37f4e34208d5f91f`，最终固定Agent2.0.2/UI2.0.1、MCP/ACP服务4.0.0、四个工具包2.0.0，发布仍为draft。

### SDK4 第七轮手机重连夹具时序

[E2E 42398286023](https://github.com/0honus0/nexus-terminal/actions/runs/42398286023) 验证 `dc8907000cdd5f4afa1f09876fe7521a601d8ddb`。Browser4的手机显式重连场景首次失败、重试通过，本轮不能作为发布通过证据；质量、构建、Docker smoke及其它已结束浏览器分片通过，后端结果另行补齐。首次trace、截图、录像及完整日志归 `delivery-20261107/publication/e2e-seventh-browser4-diagnostics`。

首次失败现场显示“Failed to mark session for suspend: operation_unknown”：测试在数据库刚保存挂起记录后立即切断WebSocket，浏览器尚未应用原成功回执，正确保留未知操作围栏。该场景要测的是已成功标记会话的显式重连，因此补充等待标签蓝色状态，即浏览器已应用挂起回执，然后才注入断线；不修改产品UI、不改变未知效果处理、不增加睡眠或放宽断言。原有无新SSH登录、仅一次resume和环境变量保留断言全部保持。

`mobile-reconnect-final.log` 连续5次全部通过（18.9秒），受影响文件ESLint、Prettier及diff检查通过；该专项不代替下一轮完整远程矩阵。

第七轮最终Reporter覆盖全部738项，无遗漏：737项最终通过，权限监控1项失败，手机重连另有1项flaky，因此整轮失败。Backend213项中212通过；其余六个浏览器分片均一次通过。权限故障夹具只阻塞第一次治理查询，之后并发最终校验成功，可在监控失败前正常确认命令并释放机器锁；这与“持续存储故障”预期不一致。改为故障释放点前所有相关查询持续失败，保留真实进程退出、原owner等待、unknown账本及机器锁证据断言。`monitor-final-outage.log` ACP/Job两项通过，无skip/cancel。

最终CDP环境另经真实包更新入口升级至Agent2.0.2/UI2.0.1，MCP/ACP4.0.0及四工具包2.0.0保持；`cdp-release-candidate/installed-packages.json`记录版本与原包摘要，`acceptance.json`记录1440/390/320px聊天、High默认思考、SSH文字/图标、刷新恢复与零pageerror，全部通过。此前CDP验收为Agent2.0.1/UI2.0.0，不将旧结果当作最终签包验收。

## SDK4 完整验收与发布（2026-11-07）

最终完整远程[E2E42399935928](https://github.com/0honus0/nexus-terminal/actions/runs/42399935928)验证`13017e0d1e7b76bed184208048e6224c83fc15d3`，正式矩阵738项全部一次通过：Backend213；Browser1–7分别49/56/103/69/74/88/86。质量检查、双端生产构建、Docker smoke、八个测试分片及耗时汇总均成功。8份timing产物已下载；正式Reporter的738个唯一开始/结束记录与`playwright --list --reporter=json`清单逐项匹配，无失败、重试、flaky、场景跳过、遗漏或多余用例。文档截图任务按条件跳过，不是测试跳过。

证据归`/home/honus/nexus-task-artifacts/agent-modular-20261106/final-implementation/delivery-20261107`（下称delivery）：`publication/e2e-42399935928/{run.json,reporter-summary.json,*.log}`、`e2e-eighth-final-summary.txt`、`expected-tests.json`与8个timing归档。`publication/verify-e2e.py 42399935928 --require-green`可重复只读核对。此前前七轮、手机重连flaky、权限持续故障夹具及本地首次失败保留，不覆盖为通过。全目录独立Node探测889项中173失败/8取消仍不算通过；本节738仅指完整正式矩阵。

### 官方插件发布

插件仓`550e4e0b4d873dcaedac54fd37f4e34208d5f91f`的[Validate42394503906](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42394503906)成功：82项插件测试与16项仓库测试全部通过。8个产品包各有独立可执行测试入口，统一CI与包发布均接入。

已发布[v2.0.0](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v2.0.0)、[v2.0.1](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v2.0.1)和最新[v2.0.2](https://github.com/0honus0/nexus-agent-plugins/releases/tag/v2.0.2)。最新组合为Agent2.0.2、ChatUI2.0.1、MCP/ACP服务4.0.0、四个工具包2.0.0；初始版本保留不可变产物，未重写签包。公开latest/catalog原始字节与候选完全一致，全部11个包版本逐文件hash、Ed25519签名和原tar摘要验证；11个公开tar实际下载字节数与摘要均匹配。本地真实Host官方目录可读取Agent2.0.2并标记compatible。

对应`publication/{plugin-validation.log,final-package-verification.json,public-plugin-verification.json,live-host-official-catalog.json}`及原始catalog/发布说明保留。最终CDP通过真实prepare-update/update安装Agent2.0.2/UI2.0.1后验收，准确8包版本/hash在`cdp-release-candidate/installed-packages.json`；1440/390/320px聊天、High默认思考、SSH宽屏文字/窄屏图标和刷新恢复通过，无横向溢出或pageerror。截图和`acceptance.json`保留；早先Agent2.0.1/UI2.0.0验收不冒充最终包证据。

集中收口同时完成MCP/ACP快捷入口到插件实例设置的对接；凭据保留/清除、独立实例、App压缩配置及SSH审批取消纳入回归。迁移59删除无消费者的Host压缩偏好，迁移60保存有限操作故障诊断；SQL仍归Adapter，业务仅消费当前数据。公开Shared SDK归档使用4.0.2，不覆盖已生成的4.0.1；包与实际消费者同步固定。

### main amd64 dev 镜像

[发布42401471984](https://github.com/0honus0/nexus-terminal/actions/runs/42401471984)成功，来源`f984034c6b672e0ff51ce5acd41d03667b5b9748`。相对被测13017e0d只增加CI自动更新的`scripts/e2e/duration-estimates.json`；后续文档收口不改变被测或发布源码。生产依赖审计及构建推送成功。

`ghcr.io/0honus0/nexus-terminal:dev`与`sha-f984034c6b67`同为`sha256:5f1ca18c460041c4888d677d83d53021d26b37e40091629c967affdb6978f27d`。唯一产品平台linux/amd64的manifest为`sha256:ccae91b2c5ac3d611e7f71b987d5bfcde39188358168bd25233ff7e90c824880`，config为`sha256:fd6eb0e95d0ef01b4426f5d6db10f6d40ac97a46afc4f35cd5311a7f9940c3c7`。只读GHCR核对真实manifest/config字节摘要、平台和OCI revision/source，未拉取完整镜像。`publication/image-publish-run.json`、`image-verification.json`及日志保留。本轮不更新生产主机。

### 审核与保留边界

| 审核表   | 本轮结果                                                                                                                                            |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 完整正式738矩阵、八包独立测试与指定CDP已完成；保留全部主要功能、当前UI和安全断言，不以跳过或重试换绿。                                              |
| 职责归属 | App持完整调度，UI/工具/MCP/ACP归独立插件；Host持真实权限、受管I/O、Operation/Run、持久事实与关闭，发布来自各自正式仓库。                            |
| 类型归属 | Shared/SDK4唯一协议；正式生产者、消费者、SDK归档、签名包、fixture与发布脚本同步，无旧运行兼容。                                                     |
| 完成证据 | 两仓实现已提交推送，插件正式公开；正式E2E与amd64 dev发布均成功，准确摘要/版本已核对。真实模型、手机真机、介质故障、负载与物理音画等范围保留在PLAN。 |

按用户授权已清理本轮可重建测试Docker资源、351个可重建测试实例、旧staging、重复浏览器与缓存；原`space-cleanup-20261107.json`记录当时29G降至22G，后续构建仍会重新占用，不能当作当前占用。发布期间另清理旧pnpm与Node编译缓存共约0.88GB，见`publication/cache-cleanup.json`。无关immortalwrt/imagebuilder镜像、业务数据、源码、数据库、最终staging及所有首次失败/未知效果证据保留，最终CDP环境按原授权保留至用户通知。不把已确认可重建缓存与未知副作用现场一起删除。

## SDK4 架构与旧用例复审（2026-11-07）

范围为 `9fd223a3` 至 SDK4 交付后的本体与独立官方插件仓。按文件建立变更清单、静态引用图和声明消费者索引，区分公开 SDK、运行装配、测试、迁移、历史快照与不可变签名包；对 Registry、App driver、Run/Operation、前后端 SDK、设置/流桥和资源关闭链重点阅读。文件级静态扫描不等于全部文件逐行人工验证，也不能代替并发与真实设备验收。审核产物位于 `/home/honus/nexus-task-artifacts/agent-sdk4-review-20261107`。

| 审核表   | 结论与处理                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | App 保留模型循环、标题、压缩与恢复；工具、MCP/ACP 和 ChatUI 均在独立插件仓。Host 保留权限、受管 I/O、Operation、存储与生命周期。没有把业务循环搬回 Host。                              |
| 职责归属 | 删除未装配消费者的旧集中集成 CRUD、固定阶段执行/审批写入接口、无消费 helper、空循环和空类型文件；保留迁移 SQL、历史严格解码、快照注册及未知效果证据。没有数据库结构变更。              |
| 类型归属 | 删除 Shared 的旧集中 MCP/ACP HTTP 契约和未导出的配置草稿；当前连接配置与插件 RPC 继续使用 Shared 的唯一定义。设置 Surface 保留具名拒绝码，未知提交仍维持围栏；补齐三语 Host 操作名称。 |
| 完成证据 | 本轮静态、专项、正式远程矩阵与发布结果分别回填；本节不复用上轮通过结论作为本轮结果。                                                                                                   |

旧测试按行为迁移，不能依据文件名或没有被正式矩阵引用就删除：

| 原覆盖                                | 当前处理与替代入口                                                                                                                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK3 包安装、签名/CSP 与五阶段运行    | 删除 SDK3 整体夹具；签名篡改、不可变安装、准确 stage CAS、CSP/MIME、旧 SDK 拒绝、撤权与重启由 `backend-next-plugin-package-security` 的 SDK4 签名包覆盖；运行由 SDK4/updates/owner-faults 等现有组覆盖。 |
| 旧 backend intents 与轮询激活竞态     | 移除已不存在的后端入口及轮询组；保留当前 RPC races 的实际流与授权竞态；意图、Artifact 流和 I/O 未知围栏由当前 intents/artifact-streams 等组覆盖。                                                        |
| 插件进程生命周期、SIGKILL、旧恢复证据 | 保留并迁移 lifecycle 到真实 SDK4 App；验证只激活一次、关闭后旧上下文不能写、重启及准确原实例确认，不能改成仅检查静态 API。                                                                               |
| 集中协议配置容量、聊天附件与名称      | 改为当前 connector codec 和准确附件元数据；保留大参数、NUL/跨 App/重复选择拒绝与三语显示断言。                                                                                                           |
| 浏览器 sandbox 与设置失败             | 现有真实 iframe/MessagePort sandbox 及新增 Host bridge 拒绝码回归纳入 `agent/plugin/sdk-sandbox.spec.ts`；包安全、生命周期、RPC races、仓库故障及前端 codec/summary 纳入正式 execution-flow。            |
| Shell 目标版本变化                    | 旧夹具在拒绝后无限重复模型提案，不适用于当前可恢复工具失败。改为消费拒绝后总结，同时严格断言原操作 `failed/version_conflict`、没有 Job、无文件效果；没有放宽派发权限。                                   |
| 完整备份恢复                          | 同步迁移60新增的诊断表数量，保留完整跨实例行、文件、真实 SSH/Provider 凭据恢复断言。                                                                                                                     |

初次全目录探测与 Shared 重建重叠，部分模块读取失败，且启动清单含随后删除的旧文件；保留原 TAP，不计为通过。Shell 和备份分别保留首次失败及后续回归，不能将夹具预期变化误报为产品修复。已停止的测试目录归档并逐文件校验字节后压缩保留，未删除未知证据或原 CDP 验收现场。

本轮本地检查：根 `pnpm run check`、完整 `format:all:check`、双端构建及 `git diff --check` 通过；最终专项共110项通过，无失败、取消或跳过，覆盖当前包安全、进程生命周期、真实流竞态、仓库取消、Shell、容量、迁移/快照及前端 MessagePort/codec/名称。完整备份组另有19项通过，与前述专项交集不相加。正式远程矩阵和新镜像仍待本轮运行结束后记录。

补充盘点保留并迁移三份实际宿主设置回归（execution/provider/registry）：当前预算字段、能力来源、独立标签、凭据输入、FormField 的 label/for 关联和条件恢复按钮按真实 owner 更新；未知写入不重放、原 CAS、三语消息及撤销后迟到返回断言保留。异步动作按实际写入次数与空闲状态同步，不借已有 Toast 判断新动作结束。三份接入正式浏览器 sandbox/Host 回归入口，独立 SDK MessagePort 六项仍保留在正式执行链。

扩展 storage 目录探测共287项：279项首次通过，2项因深临时路径超过 Chromium Unix socket 上限、5项因 user namespace 无法穿过私有主目录失败，均用正确环境单独重跑通过；公开 targets 边界的旧字段预期补入当前只读 `lastConnectedAt`，保留秘密隔离与白名单精确断言。ENOSPC使用可访问的隔离路径及同版本 Node，五项真实有限文件系统回归通过，不跳过、不改变产品代码。原失败日志保留，不能将首次整组写成全部通过。

宿主设置与公开边界最终组合 `inventory-repairs-final.tap` 四项全部通过；六轮旧 Provider 夹具定位保留，最后补齐当前 UI 所需凭据并等待真实目录匹配完成，未放宽模型来源/秘密/CAS/未知写入等断言。`frontend-repairs-3.tap` execution已通过、`frontend-repairs-2.tap` registry已通过；以最终组合为本批结论。设计文档的目录表同步实际Service/Model/Adapter与前端host布局，移除尚待搬迁的旧目标路径表述。

最终 `check-closeout.log` 根检查、`format-closeout.log` 全仓格式及 `host-browser-wrapper.log` 双端生产构建通过；正式浏览器入口五项全部通过（29.6秒），覆盖真实签名 sandbox、Host bridge和三份设置回归。正式清单已生成749项，待最终提交的完整远程矩阵通过后发布。

## 旧 Agent 数据删除与 SDK4 收口（2026-11-08）

用户选择清空旧Agent历史并允许破坏性更新。追加迁移61（附件文件删除意图）、62（旧运行及执行表）、63（旧App/插件档案）；已发布1–60的SQL、签名和执行记录不改写。删除旧运行家族、引用旧代码依赖的运行与关联记忆，不转换旧执行状态。SDK4历史、配置、当前未知效果围栏与非Agent账户保留；当前仍使用的input_text保留。移除旧行解码、快照注册、集中集成及固定模型步骤类型；历史迁移实际依赖的SQL/helper继续保留。

清理前完整[E2E42406049103](https://github.com/0honus0/nexus-terminal/actions/runs/42406049103)验证bed7cd0a共749项，一次全部通过，无失败、重试、flaky、场景跳过或遗漏。原[发布42444183561](https://github.com/0honus0/nexus-terminal/actions/runs/42444183561)因追加清理已取消，不作为本轮发布证据。

附件真实文件由Artifact owner启动清理，先持久登记删除意图；一项删除失败仍处理其它文件，失败项重启重试，队列引用活Artifact或无效ID时拒绝删除，队列未收敛拒绝快照。不会因数据库行已删除而遗留无人追踪文件。

本地迁移/存储组cleanup-storage-final.tap共51项通过；新增迁移最终八项覆盖v60升级、重复启动、真实DROP/插件删除后故障回滚、当前完整快照校验与行往返、旧SDK拒绝、真实附件故障重试、当前Provider占用及旧代码依赖/来源记忆删除。最后补入活Artifact误入队列拒绝与旧子运行整组关系清理断言，最终cleanup-family-final.tap八项全部通过。双端构建cleanup-build-final.log与根检查cleanup-check-final.log通过。首轮完整格式检查缺一处函数空行，已纠正并保留cleanup-format-final.log。早期容量测试旧decoder/index、Provider空模型fixture等首次失败与后续修复均保留在同任务目录，不算首次全部通过。

运行/更新/生命周期、只读子Run与完整跨实例备份的cleanup-runtime-final.tap共45项通过（包含备份子场景，不另行相加）。活Artifact断言首次直接比较SQLite无原型行与普通对象而失败，改为严格比对ID集合，保留原失败记录；完整格式又发现原容量用例残留排版，已纠正。最终远程750项矩阵与发布结果见下文；本节不以旧749项通过代替新SHA。产物均位于/home/honus/nexus-task-artifacts/agent-sdk4-review-20261107，原CDP现场及失败证据继续保留。

追加消费者扫描发现两处正式测试残留：context preference用例直接升级到最新后仍要求已授权删除的旧Run保留；Job故障用例与fixture仍查询旧工具表。前者先验证32/59至v60的原始事实和设置转换，再验证61–63清除旧App/历史，保留Provider与全局设置；后者改为检查真实Operation不存在accepted/dispatched残留，移除旧p_工具名分支和废弃table白名单。cleanup-context-first.tap保留首次失败，cleanup-consumers-final.tap的12项全部通过。

原[E2E42446129564](https://github.com/0honus0/nexus-terminal/actions/runs/42446129564)因上述用例修正主动取消，不计为完整通过。补齐无安装记录的旧App定义清理：只删除引用旧包或缺少准确包ledger且已无App使用的定义，保留仍使用或有SDK4来源的定义；该SQL在当时尚未发布的迁移63中。新增fixture同时覆盖此类旧App以及完整当前快照。后续从新提交重跑完整矩阵，原失败及取消证据均保留。

完整[E2E42446441838](https://github.com/0honus0/nexus-terminal/actions/runs/42446441838)验证19d26dcd：质量、Docker smoke与七个Browser分片成功，530项浏览器记录逐项核对；全矩阵750项中749通过，唯一失败的App phase ledger wrapper重试仍失败，不能算通过。原因是底层run-app-storage-fixture仍写retired来源，旧断言仍要求解码成功；本轮严格解码已拒绝该结构。夹具改为当前SDK4来源，保留全部41项检查点/回执/历史隔离/子效果/模型推理断言，将旧断言改为损坏来源拒绝派发且原检查点字节不被修改；cleanup-ledger-corrected.tap共41项通过。生产源码没有因此修改或放宽。

后续[E2E42448031357](https://github.com/0honus0/nexus-terminal/actions/runs/42448031357)验证4fc39adb，Browser 1的无token CAPTCHA用例首次失败、重试通过，后端随后因新提交触发并发取消，该轮不能作为全绿验收。首次trace记录点击坐标y=476.21；定位后真实hCaptcha iframe异步插入，占据y=401.22–477.22，点击实际落在iframe且焦点进入验证码，表单没有提交。用例增加真实iframe内未勾选checkbox就绪断言后再点击；保留无token不发送凭据、唯一提示与文案断言，不用sleep、强制派发、重试点击或修改产品UI换绿。首次trace、截图、录像与日志保存在本轮e2e-42448031357目录，新SHA完整矩阵结果见下文。

最终消费者补扫的cleanup-upgrade-closeout.tap共32项通过，包含最新迁移、无安装旧App定义、精确快照和完整备份；cleanup-check-consumers.log及cleanup-format-consumers.log通过。前述不同组合存在交集，不将总数相加作唯一场景数。最终完整750项结果见下文，不以此前530项替代新提交验收。

最终[E2E42448869600](https://github.com/0honus0/nexus-terminal/actions/runs/42448869600)验证545b2e474058cdcd6b7c6fb3b5f406bde6c0345c：Backend 220项、Browser 530项，共750项全部首次通过；质量、双端构建、Docker smoke、八个分片和耗时汇总成功。e2e-final-42448869600.log及Reporter清单逐项核对750个唯一场景，零失败、重试、flaky、跳过或遗漏。CAPTCHA用例仅修正真实控件异步加载的同步条件，产品代码与UI没有因此改动；captcha-sync-check.log、captcha-sync-format.log及git diff --check通过。

[发布42450721459](https://github.com/0honus0/nexus-terminal/actions/runs/42450721459)成功，来源`0cb0c252e13540517802a369dacc845f2258b389`。相对被测545b2e47只增加CI自动更新的`scripts/e2e/duration-estimates.json`；生产依赖审计与镜像构建推送成功。`ghcr.io/0honus0/nexus-terminal:dev`与`sha-0cb0c252e135`同为`sha256:c39e574678c3139a0cf71b0fea9863efa2c72cf68a3357c7cde28b8c18b54fa1`。唯一产品平台linux/amd64的manifest为`sha256:d4af10db9a17eda469a3cce43debd845844efae2c3296b1f742ea76e8e1230e6`，config为`sha256:1d81fa766798593d4308a4323d4d0dbcd019b73e94424b14b69243a48c1c7239`；只读验证真实字节摘要、平台与OCI revision/source，未拉取完整镜像。证据在本轮delivery-20261108/publication的image-publish-run.json、image-verification.json及日志。

最终代码、迁移、正式消费者及文档已同步，源码与架构边界审核已完成。官方插件源码550e4e0b的Validate42394503906与v2.0.2发布再次只读确认；本批没有公开SDK或插件实现变更，不重复发布插件。当前SDK4与非Agent数据保留，旧Agent历史按用户授权在升级迁移时清除；正常UI不变。首次失败、取消记录和指定CDP现场均保留，未部署生产；真实设备、模型效果及介质/负载等未验边界仍按PLAN维护。

## 测试重构分模块实测（2026-11-08）

本体基线`9788baa2`及插件仓`31173d70`上的未提交工作区，Node26.13.0/pnpm12.16.1；原生完整报告集中`/home/honus/nexus-task-artifacts/testing-restructure-20261108`。每次生产修复保留修前失败，修后仅声明实际选定范围。

| 范围                     | 实际结果与原生证据                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 新快速层首批             | `fast-after-peer.log`：24文件80项，3.68秒，含Shared、Registry、HTTP client、状态/组件及真实Workspace WS；后续新增模块需最终再跑。                                                                                                                                                                                                                                                                |
| 插件仓新入口             | `plugins-complete.log`：108项、无取消/跳过，3.09秒；`plugins-check-after.log`完整lint/格式/类型检查通过。旧框架命名/入口已按包归位，完整候选Host互操作尚未接通。                                                                                                                                                                                                                                 |
| 监控生命周期             | `status-before`保留启动失败后不能重试的失败；`status-after-2`：3文件7项，0.64秒。虚拟时钟验证30秒宽限及迟到启动，真实WS验证原绑定、失败停止与显式重试。                                                                                                                                                                                                                                          |
| 传输状态与操作           | `server-transfers`保留原API/Store断言；`transfer-mutations-before`复现取消期间移除被吞；`transfer-mutations-after`：2文件3项，1.06秒，含认证重置后的禁止派发。                                                                                                                                                                                                                                   |
| Settings Surface错误矩阵 | `host-bridge`：4项、1.04秒，真实生产bridge/MessagePort与MSW HTTP，保留原键和unknown围栏；浏览器iframe隔离仍由signed sandbox专项负责。                                                                                                                                                                                                                                                            |
| 当前Backend签包安全      | `backend-build.log`完成当前源码构建，`package-security.xml`：8项，3.21秒，覆盖验签、篡改、归档、不可变版本、资产授权与撤销。后续归档代码变更需要重建并重新运行。                                                                                                                                                                                                                                 |
| 归档限制/容器            | `package-container-before`保留无依据路径/元数据门槛及嵌套压缩失败，`package-container-after`：5项、约0.22秒，保留调用方预算、完整容器计量和路径安全。                                                                                                                                                                                                                                            |
| Host设置编辑器           | `settings-editors-worker-2`：执行与Provider两文件2项共4.10秒，保留真实HTTP/SQLite、CAS/凭据意图、模型发现与SSE、未知写入/身份围栏及组件断言。后端在独立Node Worker；此前同进程jsdom污染SDK的失败保留，不改生产安全策略。Registry组件`registry-editor-after`1项2.01秒，真实HTTP另归`current-registry-package.xml`。                                                                               |
| 文档快捷键               | `document-keyboard-2`：1项、13个独有断言，1.29秒；jsdom仅供可见表面和事件归属，真实几何、原生快捷键与编辑器引擎仍由文件浏览器用例负责。                                                                                                                                                                                                                                                          |
| 前端SDK请求与流          | `sdk-port-2`：6项、0.25秒；取消前后、乱序48请求、16独立订阅、应用后ACK及终态退订保留，源码直接测试不重复esbuild。签包与真实MessagePort隔离另有原生专项。                                                                                                                                                                                                                                         |
| 挂起目录与面板           | `suspended-catalog-final`：Shared及组件两文件4项，1.26秒；原35余项API/状态/WS/KeepAlive确认、注销和日志取消断言保留，目录只受完整编码预算约束。                                                                                                                                                                                                                                                  |
| 工作区挂起协议           | `workspace-suspend-first`：Shared与真实WS两文件2项，2.06秒；保留全部ACK、身份/基线、租约、历史、未知提交和producer断言，不启动Chromium。                                                                                                                                                                                                                                                         |
| 服务器概览               | `overview-after`：3文件3项，2.80秒，含原18组Shared向量、实际HTTP授权/采样/注销和全部controller/语言断言。`overview-worker-before`复现空闲worker额外等待200ms，已删除该人为间隔；并发调度、完整目标与取消围栏保留。                                                                                                                                                                               |
| 文件真实I/O              | `workspace-files-second`：1项6.54秒，保留所有上传/冲突、三种归档、密码ZIP、跨工作区复制、下载Range/HEAD/ZIP、搜索/元数据、编码编辑和关闭断言，以及14组独立磁盘/ZIP核验。首次失败发现APIRequestContext会把畸形JSON自动转成字符串，夹具现按原字节派发；未改产品错误契约。                                                                                                                          |
| 工作区与编辑器状态       | `workspace-session-first`：4文件4项1.51秒；真实WS状态/Registry与全部producer断言、Shared向量、文档/预览迟到读写、逐视图确认及KeepAlive/注销取消全部保留。                                                                                                                                                                                                                                        |
| 真实SSH工作区            | `workspace-ssh-first`：两文件2项6.26秒，普通PTY重连与挂起/接管均保留原断言，包括同PID、目录、离线输出、实际尺寸、NXW1历史及真实关闭。独立Node应用/SQLite＋HTTP/WS＋OpenSSH，不用Chromium；自然离线输出时序保持。                                                                                                                                                                                 |
| RDP证书真实探测          | `certificate-service-startup.xml`：1项1.06秒，实际xrdp、3次证书一致性、取消、独立进程正常退出和服务正常关闭；正式用例复用既有桌面集成服务，不再由Playwright包装。                                                                                                                                                                                                                                |
| 早期快速层               | `fast-current`：40文件117项全部通过，4.72秒；此为早期迁移基线。                                                                                                                                                                                                                                                                                                                                  |
| 桌面应用owner            | `desktop-owner`：3项、0.34秒；真实Service/Model和受控技术peer，使用Vitest时钟验证原15/30秒期限前1ms与到期、晚完成、清理及准入。无真实网络，原真实票据过期专项仍保留。                                                                                                                                                                                                                            |
| 模型失败归因             | `model-failure-before/after`：40层cause复现原6层门槛导致结构化故障、DNS/TLS/超时误分类；去掉固定层数并以已访问集合停止环。5项修后通过，0.26秒。                                                                                                                                                                                                                                                  |
| 较早切片快速层           | `fast-current-slice`：56文件139项通过，6.95秒；包含Pinia4、桌面协议/客户端/控制器/剪贴板及监控设置矩阵。                                                                                                                                                                                                                                                                                         |
| 较早切片前端真实集成     | `frontend-integration-current-slice`：9文件9项通过，20.42秒；实际HTTP/SQLite、普通/挂起/文件SSH、Docker观测及设置/重启全部通过，含框架准备与收尾。                                                                                                                                                                                                                                               |
| SSH/Docker观测           | `observation-ssh-after`：1项17.98秒，真实同主机身份回退/缓存/采样、Docker列表/标签/统计与四动作及独立Daemon移除确认。原即时停采断言与已确认30秒宽限不符；保留宽限内真实采样，并在销毁后验证原3.5秒停止交付，精确宽限边界仍归虚拟时钟用例。                                                                                                                                                       |
| 桌面低层拆分             | `desktop-split-msw`：4文件8项，0.668秒，原8个严格协议向量、5组客户端回执/流损坏与未知结果、5个控制器代次断言及2个剪贴板断言全部保留；原生触摸/画布/实际RDP/VNC与Modal仍待归位。                                                                                                                                                                                                                  |
| 监控配置与重启           | `monitoring-split-attached`：4文件4项3.70秒；原9组Shared向量、22个控制器断言、21个三入口DOM/Toast/语言断言和真实CAS/无关政策保持/SQLite重启全部保留。夹具真实登录后显式接入认证生命周期；旧广域fetch替身不再向无关偏好/日志请求返回错误配置结构。                                                                                                                                                |
| 原生图表与销毁回归       | `status-chart-browser`/`status-chart-diagnostic`首次复现vue-chartjs销毁后排队更新访问空画布；`status-chart-fixed`：1项0.953秒（正文153ms），真实Canvas保留时间戳、零值和非零尺寸、正常销毁且零pageerror。npm最新版5.3.4及当日上游main仍有问题，ESM/CJS补丁只在更新前复核原实例，退役条件见DEPLOYMENT。                                                                                           |
| 新协议服务位置           | `model-repository-services-after.xml`：3项0.645秒，实际模型鉴权/模型目录/SSE、重建签包/目录/下载摘要、部署/重置和全部正常信号退出；初次模型探测缺失夹具必需参数的422保留，不放宽模型端契约。                                                                                                                                                                                                     |
| 通知状态与组件           | `notifications-after`：4文件6项4.95秒，保留三通道秘密存在性/keep/clear、原CAS、真实已提交但回执丢失、早恢复围栏、排队取消、Webhook投递与分页、表单/Toast/三语及身份缓存清空。首次组件失败为夹具误用登录API结果，已改用真实AuthStore。                                                                                                                                                            |
| 通知真实协议             | `notifications-native-first.xml`：22项2.49秒，实际HTTP/Telegram/SMTP、重启、凭据与未知投递/关闭通过；未改产品投递期限或重试政策。                                                                                                                                                                                                                                                                |
| 外观状态与故障           | `appearance-first`保留早恢复覆盖快照/草稿和取消后继续派发读取的生产失败；`appearance-buffered-fixed`：两文件5项7.91秒，实际HTTP/SQLite、默认值/预览/主题与Unicode空HTML/CAS、丢回执与显式恢复、异常协议和身份重置通过。夹具首次错误使用Request URL、把空200变成无正文均已修正；不是产品HTML数据错误。                                                                                            |
| 外观冲突组件             | `appearance-components`：1项3.55秒，实际面板保留脏草稿及原CAS，拒绝覆盖后由全局已注册重新读取源核对并丢弃旧草稿；普通冲突矩阵不留在浏览器层重复。                                                                                                                                                                                                                                                |
| 外观后端协议             | `appearance-native-first.xml`：20项2.55秒，真实外观/背景字节、媒体拒绝、HTML/主题库、事务引用与二次重启通过。                                                                                                                                                                                                                                                                                    |
| 当前签包安全复验         | `package-security-current.xml`：8项2.86秒，当前成品签包/篡改/资产授权与撤销通过；不是全部旧原生后端通过证据。                                                                                                                                                                                                                                                                                    |
| 恢复声明与故障矩阵       | `mutation-recovery-complete`：4文件6项4.26秒，22条真实Adapter声明、20+2分页、原CAS/独立释放、真实提交丢回执与一次写、早读围栏、私有字段/错身份拒绝、三语与重置取消均保留。独立Node Worker在原应用完全关闭后读SQLite核对单份证据；首次生产故障与夹具URL失败保留。                                                                                                                                 |
| 外观/恢复原生浏览器      | `frontend-new-ui-current`：4项15.69秒（含官方服务准备/关闭），外观设置与实际文件/字节、正常证据/独立解除及实际后端重启、原生Canvas时间戳与零值全过。正文分别1.325/6.409/3.153/0.165秒；异常输入矩阵下沉，页面错误检查保留。                                                                                                                                                                      |
| 共享HTTP夹具后复验       | `fast-current-recovery`：58文件142项5.86秒；`frontend-integration-recovery-current`：18文件23项20.83秒，覆盖当前所有前端集成，含真实SSH/Docker/文件与设置恢复。系统管理新迁移随后另测，以上不是最终全量结果。                                                                                                                                                                                    |
| 系统管理分层             | `system-management-first`：5文件7项3.82秒，输入不派发/不读文件、实际响应流取消、秘密草稿清理、错误密码反馈、真实恢复提交丢回执且仅一次、全局unknown跨身份及真实重启、8模块诊断及坏协议均通过。前端Worker夹具缓冲边界仍适用。                                                                                                                                                                     |
| 系统正常浏览器           | `system-management-browser-current`：1项7.6秒（正文2.969秒），实际下载完整加密文件、原生multipart恢复、全局inert及显式重载/保留会话通过。首轮漏开高级折叠入口的测试失败保留，按当前UI修正步骤。                                                                                                                                                                                                  |
| 跨实例备份原生           | `backup-native-current.xml`：19项9.05秒，实际秘密重加密/SSH/模型/Artifact、撤权/取消、重启和恢复后初始化失败收敛通过。首次固定103张表断言与现有102张表不符；改为真实解密档案的表集合/关键资源核对并验证回执，不放宽为非零。                                                                                                                                                                      |
| 认证/安全分层            | `auth-split-current`：8文件8项4.43秒，保留原73组子断言的负责侧部分；密码/TOTP与Cookie、实际CAS/凭据意图/黑名单、组件生命周期/导航、协议失败及不重放均通过。首轮缺直接Router依赖、重复peer注入实例与过时控件入口的失败保留；修复测试装配与步骤，不改UI。                                                                                                                                          |
| 原生Passkey浏览器        | `passkey-client-browser-first`：1项8.3秒（正文2.161秒），真实WebAuthn虚拟认证器签名、注册/命名/登录/移除、29天以上HttpOnly Cookie与实际设置面板注册/删除通过；不是模拟凭据成功。                                                                                                                                                                                                                 |
| 认证完成后共用夹具复验   | `fast-auth-reviewed`：64文件150项7.79秒；`frontend-integration-auth-reviewed`：25文件30项24.10秒，当前Shared/逻辑/组件及前端真实HTTP/SSH/Docker等通过，监控页面新迁移随后单测。`check-auth-current.log`根检查通过；后续新增用例仍须复查。                                                                                                                                                        |
| Dashboard缺测与零值      | `dashboard-projection-first`：1项8.64秒，真实页面/控制器/HTTP其余消费者、正式codec和mapper保留，仅远端生产者受控；三个仪表缺测显示破折号、实际零显示0%，刷新时间虚拟推进。                                                                                                                                                                                                                       |
| 工作区正常监控浏览器     | `workspace-monitoring-browser-first`：1项19.9秒（正文15.241秒），正式成品与独立OpenSSH、至少三次真实1秒采样及≥800ms间隔、CPU组件、缓存同checkedAt和5秒自然TTL、短暂切页仍采样/同一会话恢复通过，零页面错误。旧立即停采预期已过时；30秒宽限精确边界仍归session逻辑测试，不修改产品期限。                                                                                                          |
| 认证响应交付拆层         | `access-delivery-logic-first`：3项0.129秒，原send/close/late_issue失败聚合、原凭据撤销和全部监听释放断言直接调用源码；真实Fastify onSend失败及六类HTTP断连仍由原生协议层负责。                                                                                                                                                                                                                   |
| 认证竞态/交付/因子确认   | `access-native-current.xml`：3文件19项14.07秒，实际密码派生/并发撤销/封禁、响应断连后SQLite撤销，以及真实已提交/确认丢失/撤销失败因果均通过。未知提交和撤销证据即使测试通过也保留；确认收敛的成功现场才清理，失败不删除。该时点自然过期尚未复验，后续真实五分钟证据见自然认证到期条目；主Access综合的后续实测单列，不以此结果覆盖。                                                              |
| 个人数据与审计分层       | `personal-split-first`：8文件11项8.16秒，原App脚本28组API断言迁到收藏/历史/快捷命令/展示/审计owner。保留102条路径和命令历史、51条快捷命令全页、真实CAS/触碰/级联标签/使用次数、已提交但回执丢失、早读不能解除unknown、排队取消不派发及旧协议拒绝；受控HTTP夹具仍不证明原生流取消。App页面/SSH剩余入口继续待迁/待验。                                                                             |
| 个人展示早恢复回归       | `presentation-early-recovery-before`保留真实故障：较早排队读取将snapshot从修订0换成1，尽管自己报refresh_required；原失败也会被覆盖。`presentation-early-recovery-after`：8文件11项8.20秒，现先复核故障修订再发布，保持原快照和unknown因果，之后明确恢复读取到实际提交的修订1。                                                                                                                   |
| 目标管理集合接口         | `targets-collections-cookie`：1文件1项0.571秒（测试正文0.412秒），原代理/密钥/标签/主机密钥/连接十组数量、完整JSON与最大有效转义集合断言保留，直接源码路由和Fastify inject执行。首轮暴露旧夹具未装Cookie插件/正式绑定钩子，导致500；现补齐实际插件与绑定，身份仍是明确的模块窄替身，不声称真实认证或外层Origin/传输通过。该时点剩余Targets页面与真实SSH脚本待迁，后续完成证据见下列Targets条目。 |
| 中途合并回归             | `fast-continuation`：66文件154项7.02秒；`integration-continuation`：前端集成与后端HTTP共35文件48项30.53秒。这是新增Targets拆分前的工作区，后续新增用例另行合并复验。                                                                                                                                                                                                                             |
| 主Access安全复验         | `access-security-current/report.xml`：17项7.645秒，实际TOTP故障/单次消费、转发源/封禁、CAPTCHA真实编码/拒绝、原生Chromium Passkey签名及供应商故障、提交确认未知/撤销失败和实际HTTP中断全部通过。现场含未知事实，即使PASS也保留SQLite；该时点自然到期未复验，后续证据见自然认证到期条目。                                                                                                         |
| 标签与主机信任面板       | `target-panels-locale`：2文件2项4.03秒，保留原28+18组断言：真实CAS/原子关联、部分创建/回执丢失/只读恢复、选择保持/晚返回、信任身份/确认取消/KeepAlive、三语。首轮失效定位和未加载语言包的夹具问题保留，按现有控件修正，不改UI。                                                                                                                                                                  |
| 连接与通用Target快速层   | `connections-script-first`：5项0.150秒；`connection-protocol-first`：6项0.644秒；`target-protocol-dialog-first`：2文件10项0.664秒。原IPv6/引号/秘密/范围/无副作用、错误身份/修订/私有字段/时间/HTTP状态、实际Response流取消/派发前取消及对话框替换断言下沉；另加正向结构基线，防止所有响应都被拒仍误报通过。                                                                                     |
| 历史命令排队取消         | `history-cancellation-current`：1项2.91秒。保留实际读取后撤销排队写入的not_dispatched与零POST，另核对真实数据库只含原记录及实际clear；首轮误将API数组当页对象的测试错误保留。                                                                                                                                                                                                                    |
| 目标凭据与引用           | `target-secrets-first`：1项3.12秒，原11组CRUD/精确空格/保留与清除/CAS/引用保护及删除读回通过，并新增正常重启后的实际加密存储核对。只在测试Worker安装时传明确密钥，生产装配与默认随机密钥不变。                                                                                                                                                                                                   |
| Target面板故障           | `target-recovery-panels-first`：1项3.90秒，原12组确认取消、真实提交丢回执/只读恢复、过早列表不覆盖写入、密钥选择保持、KeepAlive停止后未知围栏、秘密草稿清理与三语全部保留。                                                                                                                                                                                                                      |
| 连接事务与真实SSH        | `connection-lifecycle-ssh-first`：2文件2项3.25秒，原10组原子凭据/标签创建、CAS、克隆、回滚、凭据回执丢失不重放；另3组未知信任挑战、保存/未保存配置均完成真实OpenSSH握手，并核对未保存测试不创建记录。新例显式关闭应用后再关闭sshd；剩余UI脚本不再启动无关SSH服务。                                                                                                                               |

| Targets合并复验 | `fast-targets-final`：70文件175项7.31秒；`integration-targets-final`：前端集成与后端HTTP共42文件55项40.76秒。`check-targets-final.log`与`formatcheck-targets-current.log`通过；673项浏览器发现、324旧来源映射与diff通过。随后新增的注销/批量/表单与原生文件用例另列，不将这些数字当最终全量。 |
| Targets批量与注销 | `target-panels-final-current`：5文件5项6.42秒，包含实际注销/非空缓存及晚列表围栏、批量真实提交后回执丢失只写首条/恢复前不重放、正常串行写/加标签/确认删除/取消、正式列表与树及三语。首轮的过时appendTag、未读列表就克隆、排序假设和未打开更多菜单定位失败均保留，修测试不补旧接口、不改UI。 |
| Targets正常表单 | `target-forms-first`：连接与代理2文件2项3.82秒；`key-form-first`：1项3.42秒。保留原子凭据/编辑CAS/脚本和地址范围导入/标签缓存，以及密钥替换时保留密码短语和显式清除的真实SQLite密文核对。合并复验另加强代理双提交实际只有一次POST。 |
| Targets原生文件与下载 | `targets-native-browser-receipts`：2项9.14秒（正文2.779/1.754秒），真实产品页面/原生chooser、UTF-8与大小拒绝零POST、合法文件创建、JSON部分成功顺序及实际持久化、完整配置下载且无凭据通过，零pageerror。首轮误给HTTP回执添加不存在index的失败保留；当前HTTP数组顺序、真实ID与当前失败提示分别核对，不恢复已删除的旧编号DOM。旧Targets自行启动Vite/Chromium入口在全部替代通过后移除。 |
| 自然认证到期 | `access-natural-current/report.xml`：1项通过、零跳过/取消/失败，完整303.174秒、正文4.450秒。保留真实五分钟，实际TOTP设置读取后到期、待确认TOTP提交前到期、Passkey签名后提交前到期均拒绝，未增会话/未改counter。SQLite及收尾证据保留，不以局部测试替代自然期限。 |
| App单侧生命周期 | `audit-settings-refined`：设置CAS、审计KeepAlive、审计毫秒时间共3文件3项3.81秒；`authentication-replacement-first`：认证owner事件顺序1项0.155秒。实际409保留脏草稿/只读恢复，旧审计读取撤销且等待原Promise后不能覆盖新数据；Dashboard旧审计已移除，时间断言归当前AuditLogRow。 |
| App正式浏览器 | `app-lifecycle-browser-history-current/report.json`：1项8.470秒（正文3.297秒），真实SSH/同一session与单socket、切页晚metadata零连接/命令零旧历史、正常历史201及实际Pinia缓存、审计搜索、接管确认跨路由撤销、同tick同用户身份替换清缓存/原session确认关闭，零pageerror。`app-lifecycle-browser-first`另复验正式设置正常流程，共3项15.276秒。全部替代成立后移除旧App隐藏浏览器入口，原源码快照与首次失败保留。 |

| 正式文件页面 | `workspace-files-browser-folder-current/report.json`：1项17.163秒（正文12.490秒），原17组真实OpenSSH/SFTP、创建/Monaco编辑/Markdown预览、原生上传/完整下载、重命名/复制/剪切、实际ZIP压解、删除确认/切页撤销、晚chooser/Clipboard零上传、同PTY挂起恢复与文件独立恢复、晚PASSWORD_REQUIRED不弹旧提示全部保留，零pageerror。首轮旧编辑器遮罩/大小写/菜单类名/目录双击假设失败均保留；测试改用当前可见弹窗、menuitem及单击目录，不修改UI。全部替代通过后删除旧文件页面隐藏浏览器入口。 |
| 远桌输入资源清理 | `desktop-input-current`：1文件1项0.755秒（正文27ms），实际RDP/VNC适配器各5次创建/切模式/关闭，全部input/blur监听与ResizeObserver断开。仅ResizeObserver和无像素Canvas采用窄DOM替身，未连接协议、不证明实际布局绘制；jsdom缺观察器的首次失败保留。该时点其余两份远桌旧入口仍pending，后续完整替代见下列条目。 |

| 桌面阶段快速合并 | `fast-desktop-stage`：75文件181项7.92秒；`check-desktop-stage.log`和`formatcheck-desktop-stage.log`通过。这是后续受控桌面进程夹具修改前的阶段检查。 |
| App阶段合并回归 | `fast-app-final`：72文件177项7.56秒；`integration-app-final`：前端集成与后端HTTP共49文件62项43.04秒，全部通过。这是新增本轮桌面组件/证书用例之前的工作区，不代表最终全量。 |
| 远桌Modal组件 | `desktop-modal-first`：2文件2项1.66秒，除适配器资源清理外，真实Modal与Controller验证成功前零通知、成功后仅对应目标ID、三语已加载文案、身份disposal移除原展示、keydown退订；peer替身不证明真实协议或像素。 |
| 远桌正式浏览器 | `desktop-workspace-browser-final/report.json`：3项17.9秒，零失败/跳过/flaky。真实VNC/RDP画面与连接数、尺寸保存门控/900×700/最小化/原生全屏同socket、远端指针与二进制发送、实际Clipboard及CDP拒绝、软键盘/组合输入仅一次、显式新ticket重连、关闭与正常logout实际排空；另原生Touch两模式掩码/取消/退出零晚事件。原两份前端旧入口已在逐项替代通过后移除。 |
| VNC触摸缺陷修复 | 首轮实际Canvas合成mouseup被noVNC停止传播，其window代理收不到释放，捕获层一直遮挡按钮；轻点buttons也错误为0。现按实际按键更新掩码，VNC仅在原Canvas持有捕获时把mouseup交库的window代理，实际轻点后及拖动cancel后捕获释放。首次失败、未公开模块导入构建失败及旧RDP菜单/全屏状态未稳定/Clipboard未换焦点/工具栏覆盖软键盘的测试定位失败均保留；不强制点击、不删除捕获层、不改变UI。RDP原生WebSocket观察复用现有helper，避免CDP漏报二进制发送。 |
| 桌面证书分层 | `desktop-certificates-split-current`：3文件7项通过、完整0.280秒，含原owner3项与新证书逻辑/存储4项。真实SQLite CAS、事务内身份撤销和准入回滚、commit_unknown/rollback_failed、证书轮转/失配/过期、16个取消探测保留容量到真实技术结束与零晚票据。首轮源码SQLite Worker定位不到worker.js保留，存储改用同批真实Backend成品，逻辑直接源码；旧原生证书入口移除。 |

| 原生桌面协议与故障 | `desktop-native-websocket-current/report.xml`：25项（24子场景），零失败/取消/跳过，完整12.073秒、正文10.661秒。实际VNC/RDP像素与键鼠、空用户名二进制、匿名/Origin/Host/cookie/协议拒绝、metadata时点、票据单次及竞抢、配置/凭据/删除失效、16活跃与第17拒绝后容量回收、错误密码、服务停止/恢复和日志秘密检查全部保留。采用同一受控服务脚本，独立端口/目录/X display，真实浏览器SDK延迟到需要时才加载；不再构建/运行桌面Docker，旧静态镜像资源已移除。原首失败与取消保留；旧WebSocket子类导致noVNC检查不到原生通道属性，改为Proxy观察原生对象；原30秒盲等改为实际失败立即退出，产品期限未改。后续关闭共享Promise强化后的协议合并另验。 |

| 桌面授权与自然票据期限 | `desktop-native-authority-tickets-current/report.xml`：7项（含2父项），零失败/取消/跳过，完整77.516秒。实际配置变更轮询16.895秒、真实注销轮询15.202秒，双协议重启失效1.390秒；1024票据满容量及1025拒绝6.339秒，真实30秒到期拒绝旧票据并可新建连接32.117秒。未修改产品时序。 |
| 桌面收尾最终复验 | `desktop-native-termination-current/report.xml`：25项全过，完整11.853秒、正文10.474秒；`desktop-workspace-browser-service-final/report.json`：3项17.211秒，零失败/跳过/flaky。`desktop-native-final`保留首次父超时：模拟销毁浏览器context后，页面不能再向Node回报WebSocket关闭；现等待context真实关闭后完成夹具异常断开通知，服务端TCP仍单独核对排空。独立服务关闭共享Promise、进程close和日志流排空均参与通过判据。 |
| MCP输入矩阵归包 | 插件仓`mcp-plugin-final.xml`：2文件42项全过，0.314秒。3方法完整request-id map、3×6状态map归一、原11项畸形嵌套请求拒绝均经过实际官方SDK；保留正常续接、不隐式重放、超大完整输入/结果、取消及关闭失败因果。删除被新矩阵完整替代的旧5形状重复测试。`mcp-rpc-logic-current`：Shared 1文件2项0.231秒，正常读取/伪造身份与旧单体方法拒绝。 |
| MCP真实Host代表链路 | `mcp-host-current/report.xml`：3项20.819秒全过，实际5次Agent任务（3种正常map、1次状态map、1次畸形map投影），保留真实签包安装、HTTP受管传输、独立批准和Run终态。原32次完整任务中的普通SDK输入排列由上述插件用例替代；迁移索引记录跨仓owner。完整Agent跨仓入口尚未完成，当前代表测试仍在本体，不将此视为完整互操作迁移完成。 |

| 正式终端失败与重试 | `terminal-recovery-browser-observer-current/report.json`：1项7.746秒，正文2.199秒，零失败/跳过/flaky。真实TCP失败、两次打开/失败/按钮及Enter重连/关闭；保留一个原xterm、重试不增Observer、关闭回到原Observer基线及所有WS/TCP实际退出、安全文案与零runtime boundary。旧脚本引用已删除测试页，且旧“失败即销毁”预期与现有保留恢复入口冲突，现按当前正式UI验证并移除旧入口；首次注入脚本私有字段被Playwright编译为外部helper缺失保留，改闭包WeakMap，未改产品UI。 |
| 文件与ACP资源单侧逻辑 | `file-acp-logic-first`：2文件13项0.266秒。源码直接验证晚机器/SFTP交付、取消、实际同步/异步双失败、关闭共享Promise、健康资源独立性，以及受管ACP取消中的晚permission/read/writer和全部清理因果；真实协议不在这层宣称通过。旧两个native入口替代后移除。 |
| 文件队列与独立传输SQLite | `file-storage-owner-current`：2文件21项0.702秒。真实SQLite突变账本、事务排队、身份/指纹/Workspace撤销、取消/晚收尾、关闭失败unknown围栏、混合任务与不提前获取资源通过。首次21项中9失败保留，根因是旧64会话/16任务限制已被生产移除、下载已使用独立资源；现验证超过旧门槛仍准入、同身份围栏不释放、专属下载与Workspace分别关闭。不是恢复旧配额或删除未知断言；两个旧native入口替代后移除，所有SQLite现场保留。 |

根check曾与Backend构建并发重建Shared导致中间声明缺失，该次失败保留，必须按顺序重跑；它不证明业务缺陷。旧前端自行启动Chromium入口已全部完成替代并移除；只搬目录的其余后端文件、完整Agent流程归属、剩余包装及8runner调度仍待收口。本批真实集成曾被Vitest默认5秒预算中断，首次失败保留；现沿用原浏览器套件120秒单例测试预算并注册框架收尾，不改产品期限。当前未触发远程Actions、未提交或发布，不引用历史758项为本轮通过。

磁盘清理保留旧失败和未知现场：已核对无活跃持有的旧测试目录先归档、GNU tar逐字节比较并记录SHA256，再移除展开副本。归档及清单见`cleanup/archives.jsonl`；原`/tmp/nxt1107`位于tmpfs，其归档仍在`/tmp/nxt1107-retained-archives`并由任务目录链接，不能当作磁盘释放。根分区本轮已用从约29G降到约25G，可用约4.3G，尚未降到用户记忆中的20G；仅删除明确可重建缓存及测试桌面Docker资源，无关镜像、当前CDP环境和业务数据保留。

本轮继续复审（同一未提交工作区，以下结果不替代最终全量门禁）：

| 范围                  | 实际结果与原生证据                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 机器/归档拆层         | `machine-archive-split-first`：4文件7项0.239秒，SQLite突变原子准入、长命令预算与握手预算分别核对；取消握手的晚资源、全部清理因果、在途借用隔离及归档信号直接测试生产源码。`machine-reuse-protocol-current/report.xml`：7项8.457秒，真实SSH/SFTP复用、并发大输出与交互过程互不串联背压、撤权/信任变化、Run排空保留。                                                                                                                                                                                   |
| Browser/插件owner拆层 | `browser-plugin-logic-first`：2文件4项0.329秒，实例/修订隔离、独立会话、退役排空和同步协议失败后的全部资源收尾。真实CDP保留7项，`browser-cdp-short-socket-current/report.xml`：1.024秒，无失败/取消/跳过。首轮Chromium临时目录过深超出Unix socket长度失败保留；明确短TMPDIR后通过。真实配置SQL排队撤权、提交未知且不重放、CAS与禁用/重启3项分别2.411/2.074/2.125秒，见`browser-config-native-split-current/report.xml`；该原报告还含上述CDP环境失败，不能将整份报告报全过。                           |
| HTTP持续流并发缺陷    | `safe-http-stream-concurrency-first`复现固定4连接池阻塞第5/6请求；移除无依据固定池数，改Undici按需连接。原DNS/来源/凭据隔离和响应字节预算保留；`safe-http-pool-current/report.xml`：8项0.493秒，6个持续响应未结束时第7独立请求可用，全部真实socket排空及响应/dispatcher清理失败因果均过。此技术测试归Platform Network，移除旧MCP专属路径。                                                                                                                                                            |
| 文件写入旧入口复审    | `files-write-logic-first`：3文件6项0.481秒，满容量UTF-8/转义JSON/Unicode、SFTP未派发/拒绝/未知以及晚资源清理。旧8资源配额拒绝改为独立资源继续准入；不恢复已删除政策。原HTTP/SQLite写入链拆成`file-mutations.native.test.mjs`，保留字节/权限/独占创建/竞态/坏UTF-8/取消/未知效果；补实际编码Model，拒绝删除按现有具名403 forbidden校验。修正前依赖缺失与旧503预期的失败保留；`file-mutations-http-owned-current/report.xml`：1项0.382秒通过，框架关闭同时核对HTTP与文件owner，再关SQLite，现场不删除。 |
| 更新后快速合并        | `fast-machine-browser-current`：83文件206项8.21秒全过，包含新增MCP、文件/ACP和机器/Browser拆层；后加文件写入6项另见上行，不把206项报告当作212项合并结果。                                                                                                                                                                                                                                                                                                                                             |
| Playwright发现与分片  | `playwright-discovery-stable.json`：165文件681个测试条目，每个文件唯一project，终端恢复仅在terminal。修复`terminal/`正则命中仓库名导致全套重复，以及旧固定项目清单遗漏新目录；分片直接使用Playwright原生JSON发现，`playwright-shard-plan-native-current.log`计划成功。Shared构建与发现并发造成的缺文件失败单独保留，后续严格先构建/检查、再发现与执行。这是发现证据，不是681项执行通过。                                                                                                              |
| 当前静态与清理        | `check-discovery-current.log`根检查通过（发生在后加文件拆层前）；`formatcheck-followup-current.log`全格式通过（后续变更需再验）。插件`plugin-lint-current.log`及`plugin-format-current.log`通过。只删除7份可重建Vite缓存，约475MiB；清单`cleanup-vite-cache-followup.json`，原日志/SQLite/截图及未知现场保留。                                                                                                                                                                                        |

| Targets白名单与持久层 | `targets-split-current/reports/vitest.json`：4文件4项通过，报告首启至末项结束4.443秒，包含真实App/SQLite启动；纯投影和Access错误codec不再启动数据库。其余两项保留真实SQLite隔离、同文件锁、CAS、导入部分结果/回滚、秘密安全出口和重启，替代通过后移除旧两个入口。 |
| 终端传输与关闭 | `session-release-logic-first`：1文件2项0.163秒，保留共享关闭失败、鉴权/已释放结果；`terminal-ws-native-first/report.xml`：5项0.240秒，真实WS队列、最终顺序和EOF消费ACK。`ssh-close-protocol-first/report.xml`：5个真实SSH子场景（含父共6项），完整6.960秒，直连/HTTP/SOCKS5/跳板半关闭与健康关闭，清理失败全部聚合；旧会话目录关闭入口移到Platform SSH。`real-ssh-cases-first/report.xml`：3子场景（含父共4项）完整2.433秒，真实PTY尾字节/ACK后EOF、异常断连、实际hostVerifier及凭据错误分类，零失败/取消/跳过。 |
| 混合phase2按owner拆分 | `phase2-owners-first`：5文件5项2.60秒，连续生产迁移/重复启动/失败回滚/旧原型拒绝、凭据密文/机器指纹/图回滚/克隆/标签关联版本、并发登录失败与精确封禁边界、SSH拒绝RDP字段分别归SQLite/Targets/Access/Shared。`run-intents-first/report.xml`：1项2.218秒，真实已派发模型请求后准入、幂等/内容冲突/活跃冲突、取消CAS/重放、用户隔离与事件分页，且仅派发一次模型请求。原备份目录phase2整份脚本替代后移除，未删独有断言。 |
| 按需受控服务首验 | `services-none-first/report.json`：正式终端恢复1项5.193秒，`services/0/timings.json`为空，确认不启动任何外部服务。`services-mixed-first/report.json`的8项业务全过，但worker SSH收尾失败，整组失败；`services-cleanup-trace-current`两项业务通过但SSH收尾仍失败，均保留原日志和计时，不作为绿色验收。已确认交互Bash等待stdin忽略TERM及夹具连接归属不全；修复后`services-http-owner-final/report.json`两项完整30.893秒，包含实际Agent/CDP/部署/文件交付及SSH连接，全部服务exit0且SSH关闭13.712ms，零全局错误/跳过/flaky。桌面业务在首轮混合组已过，当前SSH修复不改桌面脚本。 |
| HTTP完成等待复用 | `http-response-owner-current`：1文件4项0.152秒，监听/框架共享同一响应Promise，finish/close/aborted/原socket关闭后全部监听回到基线；同批Backend重新构建后，上述两项浏览器定向开启trace-warnings全过，原ServerResponse MaxListeners告警不再出现；`http-transport-owner-current/report.xml`37项真实HTTP/流/维护/审计/拒绝/取消通过，完整0.443秒。首次报告暴露Vitest把Platform HTTP内的logic同时算入HTTP project，修正各层只发现直属测试文件后唯一发现，不把首次8项重复结果当作8个独立场景。 |

| 测试夹具自身回归 | `controlled-service-contract-first`：1项0.311秒，真实子进程按需/重复ensure复用/共享close/正常exit0/启动失败非零及日志保留。`backend-fixture-evidence-first/report.xml`：1项2.407秒，真实Backend进程验证匿名保留拒绝、鉴权保留、重置后原SQLite存在、后续正常基线移除且失败库仍在、正常关停。不是用模拟状态证明现场保留。 |
| 本批快速合并 | `fast-service-owner-current`：93文件223项10.43秒，含本批新增文件写入/终端关闭/Targets纯逻辑/Access/HTTP完成owner及tooling；不含真实SQLite/原生/浏览器全量，未替代完整门禁。 |

本批补充证据（产物根同上）：

| 模块                   | 范围与实际结果                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 上批静态收口           | `check-service-owner-final.log`与`formatcheck-service-owner-final.log`均通过，diff通过；发生在以下新增模块前。                                                                                                                                                                                                                                                                                                                                                               |
| 准确候选跨仓互操作基础 | 插件仓`tests/interoperability/agent/candidate.native.test.mjs`首轮`plugin-host-interop-first/report.xml`：3项9.825秒通过，无跳过或清理失败。两种模型协议均实际安装八份准确候选签包、发现工具、审批、真实SSH非零命令及Unicode/stdout/stderr持久结果；另验证静默流前缀、取消关闭原transport与不重放。不是八包全部运行逻辑或浏览器验收。`combination.json`记录双仓源码指纹、Host编译摘要、SDK及包hash；准备/执行/关闭各自保留。首报文件后缀随后统一为native，最终基线需另复验。 |
| 跨仓准备成本           | `plugin-build-host-current.log`构建10.424秒；`plugin-host-candidates-first.log`签包3.591秒，均未藏入测试外耗时。初次尝试本机不存在的`/usr/bin/time`未启动构建，改用Bash内置time，原失败日志保留。`pinned-installer-first/report.xml`确认既有签包安装/Run意图1项2.183秒。                                                                                                                                                                                                     |
| 审计生命周期           | `audit-lifecycle-first`：1文件3项0.142秒；65个请求、257个待发布事件均完整追踪至关闭，独立记录/通知/清理失败保留。`audit-lifecycle-old-cap-current`复放原门槛，2失败/1通过，0.140秒，证实回归能暴露旧拒绝；产品源码随后恢复修复版。删除的只是独立请求/发布数量门槛，SQLite与审计保留政策不变。                                                                                                                                                                                |
| 通知真实协议/现场      | `notification-lifecycle-first/report.xml`：21个子场景，含父共22项2.473秒；真实HTTP、Telegram、SMTP、秘密keep/clear、认证、CAS、重启、分页、fanout、取消后unknown及不重放均保留。setup577ms/execute820ms/drain3ms。用框架收尾聚合失败，不再成功后删除目录，数据库及timings保留在所属运行根。                                                                                                                                                                                  |

Webhook秘密契约已下沉到真实原生HTTP/SQLite/投递层：`webhook-owner-first/report.xml`10个原独有场景完整保留，含父共11项2.667秒；所有拒绝均核对持久原值和真实原凭据投递，增加创建拒绝零派发及keep后重启。替代通过后移除原Playwright HTTP文件及调度/耗时条目，正常通知页面流程仍保留在浏览器。当前快速合并`fast-agent-audit-current`94文件226项11.50秒全过；准确候选最终入口`plugin-host-interop-current/report.xml`3项14.225秒全过，该次与快速层/HTTP同时运行，不能用并发资源竞争结果和首次独跑9.825秒直接推导退化或提速。

上述跨仓入口为新增基础能力，完整旧Agent流程迁移、插件CI对不可变Host产物的门禁仍未完成；现有插件`pnpm test`执行包内/仓库/模板测试，`pnpm test:interop`单独要求真实Host与候选路径，`pnpm test:all`执行两层。不能以局部3项宣称完整Agent已从本体移除或全仓通过。

本轮模型与审计后续复核：

- `model-outcomes-first/report.xml`：17个实际OpenAI SDK/TCP场景，含父共18项0.327秒。完整15种HTTP拒绝/未知及允许重试次数、断线不重放、429恢复均验证；复用一个受控HTTP端，不启动App/SQLite/SSH。
- `agent-flow-outcomes-first/report.xml`：15个真实Host子场景，含父共17项35.532秒全过。保留双Provider指令/Skill摘要、准确Skill读取、401/429/503持久结果与重启、429恢复仅一个model账本、Unicode前缀、取消/中断及原隔离RPC/审批/撤权/已确认效果。下沉12组重复完整App装配；没有用低层测试替代这些跨边界断言。首轮35.532秒仍包含真实安装/SSH/收尾，不宣称整组只需0.327秒。
- 审计最终逻辑`audit-lifecycle-final`4项0.126秒通过，补上停止接纳后拒绝publication在关闭结果中可见；旧HTTP测试里的固定256拒绝已移到新owner并更新为实际停机拒绝。`http-audit-owner-final/report.xml`36项0.429秒通过，少1项来自owner下沉，不是漏跑。
- `fast-audit-final`94文件227项8.76秒；插件普通包/仓库/模板`plugin-native-host-current/report.xml`130项2.668秒全部通过。两仓`check-agent-audit-current.log`/`plugin-check-host-current.log`通过；随后新增的Webhook与模型原生文件另做发现/格式检查。删除耗时表中已不存在的execution-flow/mutation-capacity条目，原历史证据不变。

来源与认证模块：`mutation-source-first/report.xml`10子场景，含父11项1.795秒全过，真实App/Access/SQLite验证Origin/Fetch Metadata/Host的9种输入和完整偏好值/version原子性；另保留注销后畸形JSON先认证401及匿名失败审计、连接列表不变。夹具可显式发送原始来源headers，真正缺省Origin与Metadata，不用空字符串冒充。通过后移除`mutation-origin.spec.ts`、`fastify-transport.spec.ts`并更新分片与索引；浏览器实际Cookie/WS/页面流程不受替代。

本批最终检查：`check-access-owners-final.log`、`formatcheck-access-owners-final.log`及双仓diff均通过；`discovery-access-owners-final`验证324来源映射和2个外部插件owner存在，Playwright发现162文件661条目、零发现错误。发现数量减少来自已迁移的3份接口文件，不代表削减独有断言；其余浏览器仍待逐项审核和全量执行。该轮没有新建Docker容器，原失败/数据库/签包现场保留在任务根，未提交推送或发布。

本轮后续 HTTP/真实协议下沉的证据另存 `/dev/shm/nexus-testing-20261108/`，使用同一 Node 26.13.0/pnpm 12.16.1 和当前未提交工作区：

- `oidc-http-first/reports/vitest.json`：14项8.78秒；`totp-http-current/reports/vitest.json`：1项2.39秒。保留真实签名IdP、PKCE/JWT/client-auth矩阵、Cookie与撤销竞态；浏览器继续验证实际登录与设置。
- `target-import-http-first/reports/vitest.json`：真实SSH凭据/JSON/multipart导入1项2.56秒。纯接口旧入口在替代通过后移除。
- `plugin-images-first/report.xml`：准确候选签包的6项图片互操作4.704秒；Host独立文件交付安全测试 `artifact-delivery-first/report.xml` 1项1.915秒。正常图片流程归插件仓，Host仍验证签名夹具App的归属、Range、HTML inline拒绝、CAS和清除。
- `ssh-protocol-host-header`：终端背压与目录4项通过；`binary-read-poll-budget/reports/vitest.json`：SFTP读取8项21.54秒，含真实3秒延迟OPEN/READ、取消、超额准入、增长文件及断线晚句柄释放。首轮暴露夹具Host头、Vitest轮询默认值与浏览器不同，已按实际部署来源和原10秒观察预算对齐，未改产品时限。
- `ssh-files-transfers-batch`：24项中21项通过，58.03秒；真实搜索延迟、两万余项目录、70层树、65来源、多任务、下载和稀疏TAR断言保留。首次失败为迁移遗漏的fixture参数和Unix socket路径过长；`archive-short-runtime`补验两个TAR进度场景通过，归档特殊文件路径拼写另经`ssh-upload-batch`通过。
- `ssh-upload-batch`：15项中13项通过，22.28秒；准备目录三场景、全部6项归档与小文件上传通过。上传剩余两个夹具旧调用已修，`ssh-download-upload-current`中5项上传全部通过。
- `download-ownership-raw-current/reports/vitest.json`：4项17.45秒全过，覆盖票据绑定来源/Range、精确ZIP、停止下游读取及9个延迟OPEN取消回收。显式复用原loopback代理信任；原生HTTP保留Host，未放宽来源校验。
- `workspace-identity-revocation/reports/vitest.json`：2项9.56秒，改密与注销真实撤销已建立WS和旧Cookie。
- `controlled-peer-isolation-corrected/report.xml`：1项2.282秒，两个真实SSH/SFTP实例并行、文件/端口隔离、offline/online重用端口、并发close共享结果及另一实例继续可用。受控文件使用任务TMPDIR中的短路径，日志保留runtime根索引；应用与socket先排空、SSH进程最后关闭。

上述为逐模块证据，首次失败均保留。最新类型检查 `types-lifecycle-corrected.log` 通过；根检查/格式、浏览器发现与最终完整门禁尚需针对最终工作区统一执行。当前仍未提交推送，不把分批通过视作完整重构完成。

## Agent插件化已完成阶段与审核快照（2026-11-08归档）

以下从PLAN移入，只对应原记录版本；当前源码与新测试门禁见E2E，不继承历史指令或PASS。

## D30：集中验收、每包测试与双仓发布（2026-11-07）

用户明确授权完成本轮Agent/SDK/插件重构的全部验收，补齐每个插件的测试部分，提交推送两仓，修复全部正式E2E后发布插件与本体main amd64 dev；不自动更新生产主机。D19的未授权发布说明由本次授权取代，其余范围与不保留旧运行兼容、现有UI、正式迁移、完整数据及资源关闭要求继续执行。主代理独立完成，不启动子代理。保留既有现场与首次失败证据；已明确授权清理的可重建测试Docker与缓存按清单处理。

| 审核表   | 结论与证据                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 八包均有独立行为测试，82项插件与16项仓库测试通过；正式矩阵738项全部一次通过，无失败、重试、flaky、跳过或遗漏；最终签包CDP宽窄屏及刷新恢复通过。                                  |
| 职责归属 | 插件仓完成独立包算法/协议/UI测试与发布；本体完成Host、SDK、正式E2E、真实安装/更新和浏览器验收。运行、授权、账本及资源关闭仍归Host。                                              |
| 类型归属 | Shared/SDK4是唯一协议owner；正式fixture、发布/安装/运行/前端消费者同步，无旧运行兼容。公开目录及全部11个不可变版本的签名、文件hash、归档摘要已核对。                             |
| 完成证据 | E2E42399935928验证13017e0d；插件v2.0.2已发布；main amd64 dev42401471984来源f984034c（仅增加耗时估算），镜像摘要/平台/revision已核对。完整证据见[最新基线](E2E.md#当前验收基线)。 |

## D31：SDK4交付后逐文件复审与清理（2026-11-07）

用户授权复审本轮重构、纠正架构偏移、清除无消费者文件与过时用例，同步文档后推送、完整远程E2E通过并发布main amd64 dev。主代理独立执行，保持UI与现有功能、安全断言；该轮保留旧迁移与历史证据；随后D32明确授权删除旧SDK历史，已发布迁移仍不改写。

| 审核表   | 范围与完成判据                                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 以9fd223a3→当前main及独立插件仓为文件清单，区分源码、不可变签包、迁移/审计和测试；旧用例须核对真实行为是否保留或已被新组合覆盖后才删除。                                                                                                                        |
| 职责归属 | 核对App/工具/服务/UI插件与Host边界，实际装配、调用/关闭链和跨模块依赖；清理无运行/构建/测试消费者的遗留实现。                                                                                                                                                   |
| 类型归属 | 核对Shared、SDK、内部Model/storage/Platform、公开出口及双端消费者；禁止旧协议回退、跨层透传和本体硬编码插件策略。                                                                                                                                               |
| 完成证据 | 源码复核、清理和文档已完成；110项专项、19项备份、当前宿主设置/公开边界4项及纠正环境后的Browser 9项/ENOSPC 5项通过。清理前bed7cd0a完整749项远程E2E通过；原发布因D32追加清理取消，最终交付已由D32收口，见[本轮记录](HISTORY.md#sdk4-架构与旧用例复审2026-11-07)。 |

产物集中`/home/honus/nexus-task-artifacts/agent-sdk4-review-20261107`；原验收现场与失败证据保留，不以本轮清理删除未知副作用证据。

## D32：删除旧 Agent 数据与兼容结构（2026-11-08）

用户明确选择第2项，允许清空旧Agent历史，不做旧结构转换或运行兼容。D31保留旧历史的范围约束由本项取代；已发布迁移链及非Agent数据保持。主代理独立实施，完成新SHA完整远程E2E后发布main amd64 dev，不部署生产。

| 审核表   | 范围与判据                                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 删除SDK1–3档案、旧五阶段Run/工具/审批/集成表及旧快照解码；SDK4插件、聊天、审批、子Run、配置与备份恢复功能保留，UI不变。                                                                                                                                                                                        |
| 职责归属 | 删除SQL由Agent SQLite Adapter持有，正式迁移顺序编排；当前包/资源生命周期与权限仍归原Host owner。                                                                                                                                                                                                               |
| 类型归属 | Run来源只接受SDK4插件结构，移除retired/archivedChild与历史decoder；核对迁移私有依赖，已发布迁移保持可执行。                                                                                                                                                                                                    |
| 完成证据 | 双端构建、根检查通过；迁移/存储51项、运行/更新/生命周期/只读子Run/备份45项通过。新增迁移最终八项通过，覆盖活Artifact围栏及旧子运行整组清理；545b2e47完整750项远程E2E首次全绿，发布42450721459成功；amd64 dev摘要与源码已核对，未部署生产，详见[本轮记录](HISTORY.md#旧-agent-数据删除与-sdk4-收口2026-11-08)。 |

## D33：插件CDP配置、市场移动布局与本地化（2026-11-08）

用户要求CDP配置跟随浏览器插件、优化设置内插件市场的手机布局，插件描述跟随本体语言。本批主代理独立实现；保持市场以外既有UI，插件设置沿用现有Surface与语言环境，工具调用、目标权限和真实关闭继续归Host。不新增无依据容量或工具门槛，SQL变更追加迁移，不修改已发布1–63。

| 审核表   | 实施范围与判据                                                                                                                                                                                                                                                                            |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | Browser工具包贡献实例设置，移除本体独立CDP设置；市场在320/390px无横向溢出且操作分组清晰；官方及第三方描述通过统一目录元数据随语言切换。                                                                                                                                                   |
| 职责归属 | 插件持端点配置schema和设置UI；Host从真实调用实例取得配置并复核修订、权限、资源归属，旧全局配置通过正式迁移处理。市场只做本地化投影，不按官方包ID补文案。                                                                                                                                  |
| 类型归属 | 目录本地化契约归Shared，边界逐字段转换；现有SDK环境已传locale，只有真实缺口才新增SDK能力。                                                                                                                                                                                                |
| 完成证据 | 源码审核、双仓检查/构建/格式、迁移/快照11项、真实CDP/文件19项、本地市场/设置7项已过；Browser2.1.1与最新目录已发，指定CDP三语宽窄及设置保存/零pageerror通过；871a0516完整756项远程E2E一次全绿，42462199531发布main amd64 dev，摘要/平台/源码已核对。产物归agent-plugin-settings-20261108。 |

## D34：Agent设置归属复审（2026-11-08）

用户要求逐项审核Agent设置，将插件业务选项迁入对应插件并移除本体入口。主代理独立实施，沿用已有主题与插件设置Surface。Provider/模型凭据、权限、执行总预算、并发和真实资源保留仍归Host；移除独立MCP/ACP设置页，记忆召回条数/字节偏好迁入Agent工具插件，不保留Host运行兼容或重复上限。迁移65一次性转换已有官方未配置实例的实际偏好，并清除全局、App覆盖、冻结运行与硬限确认中的旧字段。召回超过单帧容量时分批重新校验并完整汇总，不能把传输分页变成总量限制。

| 审核表   | 范围与判据                                                                                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 全量设置入口及实际消费者盘点；MCP/ACP统一从已安装插件设置进入；记忆召回偏好可按App/实例保存并实际生效；原权限、预算和失败恢复保留。                                                                                                                                                                                                                     |
| 职责归属 | 插件持召回排序、条数与JSON总字节预算及设置UI；Host持已发布/未过期/来源核验、准确版本、传输容量与真实资源，不解释插件业务偏好。                                                                                                                                                                                                                          |
| 类型归属 | 移除Shared及双端执行/治理中的召回偏好字段；现有memory.retrieve保留调用方请求数与单帧容量事实，独立插件和实际消费者同步，不新增同义协议。                                                                                                                                                                                                                |
| 完成证据 | 源码归属审核、双仓check/build/格式、每包独立测试、迁移/重启/回滚、跨帧召回、设置及备份浏览器回归通过；Agent工具2.1.0和14项公开目录已发布；指定CDP三语宽窄设置保存、无溢出和零pageerror通过。21e36a7b完整远程758项一次全绿，42467733089已发布main amd64 dev并核对镜像摘要、平台和源码；产物归agent-settings-ownership-20261108，保留既有环境和首次失败。 |

### 功能对应审核表

| 主要功能                              | 当前owner与验收范围                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 聊天/图片、思考等级、上下文/标题/压缩 | nexus.agent完整循环与nexus.ui.chat；原请求恢复、摘要/尾组、标题/私有状态、宽窄屏聊天及刷新恢复已回归。                   |
| 模型工具、发现与详情加载              | 四个工具包注册→目录→准确绑定→Operation；按需发现、真实I/O、完整结果续读、产物来源及权限回归通过。                        |
| 运行、子Agent、日志、文件             | 通用Run/Operation/内容与真实子效果；旧账本断言迁移，取消/未知/确认丢失与父子收敛纳入正式矩阵。                           |
| MCP/ACP与共享服务                     | 独立服务包持官方协议SDK；Host持可信传输、权限与资源；真实HTTP/SSH、续接、内层批准/取消与排空通过。                       |
| 设置、选择、授权与市场                | 人工/Agent共用实例配置owner；停用读取、CAS/幂等、安装升级卸载、保留数据/清理、独立App/UI更新已回归；正式目录已公开验证。 |
| UI/事件、历史/提醒/资源               | 独立UI与通用Surface；MessagePort/WS、历史/会话切换及关闭已回归，移动真机与其它故障组合仍按下方待验表推进。               |
| 无模型App与多实例                     | 无模型ACP App、多实例Registry及隔离回归通过；多角色仅为确定性扩展判据，不交付酒馆产品。                                  |

### 职责归属审核表

| 判断/资源                         | 唯一 owner                                         | 必须核对的调用链                                                                                                       |
| --------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 应用循环、模型/工具选择、结束意图 | App 后端插件                                       | run(ctx)→受管调用→真实回执→展示/检查点；无本体默认循环                                                                 |
| 包、选择、依赖与注册              | packages/composition/registry                      | 验签→逻辑实例→原子注册；依赖不会自动曝光全部工具                                                                       |
| 实际权限、批准与预算              | Host governance/真实领域 owner                     | 原 principal/父上界→事务消费批准与派发→每次敏感 I/O 复核                                                               |
| 运行状态、操作与真实效果          | runs/operations                                    | 调用结果和效果证据分开，父完成等待关联资源，无两套事实账本                                                             |
| 配置与秘密                        | settings 用例 + 连接/SecretBox owner               | 两入口同一校验/CAS/schema 修订；保存与生效分开                                                                         |
| 连接/协议/资源                    | Host I/O owner + 服务插件协议 owner                | execution-owned session、当前调用授权、准确回调及真实关闭                                                              |
| 界面与安全交互                    | Surface/App UI + Host 可信入口                     | purpose 限权；失败仍可管理，UI 更新不取消无关后台 Run                                                                  |
| callable 与字节通道收尾           | 隔离 adapter、Platform 通道和 Host transport owner | handler 结束仍等待原调用；关闭报错不跳过真实 writer；协议 SDK 清理错误与原失败聚合；成功关闭的 HTTP 响应从活跃集合移除 |
| 历史与摘要恢复                    | RunAppState存储 + App私有状态/压缩策略             | 读取与来源均限定Root；Host只校验封存内容与回执，App固定准确请求/来源/尾组；不再使用旧Host摘要包装证明                  |

### 类型归属审核表

| 类型/事实                                | 唯一 owner                                               | 转换与消费者                                                                                   |
| ---------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 包协议/Registry/Binding/Surface envelope | Shared agent/plugins                                     | 包/IPC/HTTP/MessagePort 严格解码，Backend/Frontend 白名单 mapper                               |
| 插件业务 contract、schema 与说明         | 提供插件的公开纯契约/签名资产；动态内容注明来源          | 绑定时固定 schema digest，调用/结果校验；不进入 Host 功能大联合                                |
| Run/Operation 安全协议                   | Shared agent/runs、agent/operations                      | 内部 model 与 storage 独立；HTTP/WS/SDK/测试同步                                               |
| 配置 envelope、schema 修订、CAS          | Shared 协议 + settings/model/storage                     | UI/Agent 只转换真实身份和意图，同一配置用例消费                                                |
| Host 领域能力与秘密/技术对象             | 对应模块 public、model、storage、Platform                | Model 显式转换；插件只得授权引用，不传 cookie/句柄/存储行                                      |
| 服务调用与字节流错误                     | Shared RPC envelope、独立插件 SDK、Platform/应用具名错误 | MCP/ACP 客户端归插件；Host 的安全错误与内部 cause 分离；历史关系只作审计，不恢复 SDK3 运行接口 |
| 分块页/检查点/历史预算                   | Shared plugins/content、run-context与values              | Host入口和SDK按现有IPC预算解码；私有持久状态不套HTTP控制响应预算；完整内容由原owner校验hash    |

### 完成证据审核表

| 项目           | 当前结论与证据                                                                                                              |
| -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 本体与SDK4     | 根check、双端build、全仓format通过；正式远程质量、构建、Docker smoke及八分片成功，738条Reporter与测试清单完全匹配。         |
| 独立插件       | main/550e4e0b，Validate42394503906的98项通过；Agent2.0.2/UI2.0.1、MCP/ACP4.0.0、四工具包2.0.0全部已发布。                   |
| 最终浏览器     | 指定CDP经真实prepare-update/update安装准确版本；1440/390/320px聊天、High默认思考、SSH文字/图标、刷新恢复与零pageerror通过。 |
| 签名与交付     | 公开latest目录、全部11个版本的签名/文件hash/归档摘要与真实Host读取通过；dev与sha-f984034c6b67同摘要且OCI revision匹配。     |
| 首次失败与证据 | 前七轮及本地首次失败均保留；不放宽断言、不跳过场景。正式矩阵之外的独立Node旧夹具和实机/性能范围不混作通过。                 |

## 测试重构远程首轮收敛（2026-11-08）

本体`8a320314b06ae8b11be990679aa5b027a50c6295`的[首轮42518923481](https://github.com/0honus0/nexus-terminal/actions/runs/42518923481)质量、Runner准备和Docker部署smoke成功，8个测试分片失败。首次日志分别保留在任务运行根的`remote-shard1.log`至`remote-shard8.log`，分片7完整诊断为`remote7.zip`。不把后续定向通过合并称首轮成功。

| 失败原因                                                                                    | 修复及验证边界                                                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 容器workspace别名与真实`/__w`路径不同，Git拒绝插件组合源码身份检查                          | 仅登记本体和插件checkout的canonical safe.directory，不开放通配信任；新门禁继续验证                                                                                                                              |
| 容器PID1不回收孤儿，`kill(pid,0)`把已退出僵尸当作存活                                       | Alpine实测无init时原进程为Z、加init后`/proc`条目消失；测试容器加init，保留原PTY退出断言                                                                                                                         |
| 容器缺SYS_PTRACE，无法读取OpenSSH子进程的fd                                                 | Alpine以切换用户的真实fd实测，无能力无法readlink，增加后得到真实路径；统一实际句柄观测并规范化路径，包含已unlink但仍打开的句柄                                                                                  |
| 私有有限tmpfs被容器mount/user namespace权限阻止                                             | 仅第1分片授予SYS_ADMIN及关闭对应AppArmor限制，root使用独立mount namespace；本地三组权限实测证明缺省unshare拒绝、仅SYS_ADMIN仍被AppArmor拒绝、限定能力与解除该限制后可实际挂载8MiB tmpfs；五项真实ENOSPC断言保留 |
| 受控SSH的Shell在输出目的通道结束后仍手动write stderr，触发ERR_STREAM_WRITE_AFTER_END        | 使用Node pipe持有背压及目的端结束自动退订；`controlled-ssh-repair`4项通过，5.63秒                                                                                                                               |
| 监控导航完成后才读取响应正文，偶发Chromium正文句柄失效                                      | 响应匹配时立即消费JSON；`monitoring-response-final`1项通过，18.37秒，全部采样/缓存/单session断言保留                                                                                                            |
| 实际归档收尾超过3秒，Workspace正常closing被周期操作授权扫描误判撤权，提前1008关闭而丢失回执 | Interface区分正在关闭的原attachment与操作权；期间仍通过真实Access复验Cookie，其他操作继续拒绝。新增原生正常关闭/注销期间关闭两项回归；自然扫描期限与产品关闭预算未改                                            |

`remote-native-repairs`首次定向24项中23通过、1失败，24.22秒；失败为新增回归误以为closing期间ping仍可用，实际安全行为应拒绝not_found，已纠正测试预期。归档/复制/上传和五种真实磁盘满场景全部通过，不据此声称远程同基线已通过。`close-response-final`新增两项正常关闭/撤销回归全部通过，8.31秒；后续完整结论与耗时回填当前测试入口。

插件`9c1681e438bf01cc726f1cdefa5f2e078e55ec8e`[首轮Validate42518843555](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42518843555)选到旧Host成功成品，缺新tests workspace而在Playwright启动前失败。新Host门禁成功后须绑定准确run ID重新验证，不能将其归因于插件业务通过或失败。

## 测试重构远程第二轮收敛（2026-11-08）

本体`e587ff7e84e8cc32d0c6e609b002bd49edc7a769`的[第二轮42521021428](https://github.com/0honus0/nexus-terminal/actions/runs/42521021428)已完整结束：质量、Runner与Docker smoke通过；分片2/3/4/5成功，1/6/7/8失败。8分片原生协议、第1分片真实有限文件系统故障、Docker协议和模块均已通过；逐分片读取原始JUnit与Playwright JSON，插件互操作54项、插件浏览器70项全部通过，无skip/flaky/失败；汇总存于`remote-second-plugin-layer-summary.json`，不能将这些局部成功合并称整轮通过。运行从20:36:51至20:52:45 UTC，约15分54秒，未达到3–5分钟目标；第7分片原生组包含自然五分钟认证到期，计时不能只看其warmup之后的testcase正文。

| 原因                                                                                                              | 修复与本地结果                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SDK只允许上一页消费完成后接收下一页，服务端实际支持多页在途；慢回调期间收到下一页会提前关闭连接，退订于是提前返回 | SDK沿接收游标与修订验证后续页，回调仍串行，ACK在实际消费后发出；退订排空正在处理的回调，撤下排队页。新增顺序ACK、退订排空与重复游标拒绝3项逻辑回归；`sdk-queue-guard-final`9项通过，0.365秒。重建实际Backend交付SDK后，`sdk-browser-built-final`原浏览器完整场景连续5次全部通过，27.25秒，无skip/flaky；此前误用旧构建的4/5通过仍保留，不当作新实现结果 |
| Node pipe在ssh2先结束stderr、延后触发channel close的间隙仍可写入，分片6浏览器worker和分片7背压模块收尾退出1       | 受控服务在每次转发前检查真实目标可写状态，保留drain背压；关闭解除转发并继续排空子进程stdout/stderr、关闭stdin、等待原child close。`ssh-output-guard-repaired`背压/目录4项通过，5.41秒；`ssh-output-native-both-final`真实Shell/exec双路大输出期间关闭通道、隔离与并发收尾通过，2.91秒                                                                   |
| 监控第二次采样仍丢失Chromium response body句柄，首轮提前json读取不能完全解决                                      | Playwright route.fetch读取真实服务端字节并原样fulfill，再观察交付采样；不伪造数据。`monitoring-bytes-final`1项通过，18.53秒；自然缓存到期、采样间隔、单会话与UI断言全部保留                                                                                                                                                                             |
| 模块失败要等长原生/浏览器组全部完成才拿到夹具栈                                                                   | 模块步骤失败后立即用官方upload-artifact保留Vitest报告、SSH日志和计时，后继测试仍完整执行；原最终诊断产物继续保留                                                                                                                                                                                                                                        |

本地新增关闭回归使用有界状态观测，使负面失败也能进入finally释放真实completion gate，不变更产品扫描期限；`ssh-lifecycle-final`3项通过，10.88秒。首次缺少报告父目录的ENOENT与Playwright命令参数错误均保留为执行错误；修正命令后的结果分别记录，不算产品失败或通过。两轮远程zip、日志和本地失败均保留在任务证据根。新完整门禁及插件独立Validate仍待完成。

`browser-remaining-final`监控、手机文件预览与Pad挂起输出10项全部通过，92.11秒，无worker收尾错误、skip/flaky或重试；`check-queue-final.log`、`sdk-backend-build-final.log`与`format-queue-final.log`通过。

## 测试重构远程第三轮收敛（2026-11-08）

本体`313dc83fe7e47d1e47f60987db34d7099149a188`的[第三轮42523103326](https://github.com/0honus0/nexus-terminal/actions/runs/42523103326)在21:02:01–21:17:43 UTC完整结束，约15分42秒。质量、Runner、Docker smoke和7个测试分片成功，仅第6分片有1项浏览器flaky；首次失败与重试保留，整轮仍判失败。前轮SDK连续页、受控SSH关闭输出和监控响应读取问题未再出现。

`file-manager-resize.spec.ts`在点击第一标签后立即读取全局活动surface，偶发捕获尚未完成Vue切换的第二会话ID；首次trace证明第一会话编辑器已经打开，但断言等待第二会话位置。改从目标标签既有`data-session-id`读取稳定身份，并等待对应surface激活；保留文件打开、切换取消拖动、迟到pointerup不写尺寸和偏好等全部断言，无新增sleep、产品UI或期限变更。`resize-identity-repeat`原场景连续5次通过，35.34秒，无skip/flaky或重试。此前`resize-identity-final`未能启动webServer，未执行任何场景，单独保留为启动错误。

`check-resize-identity-final.log`和受影响Prettier、diff检查通过。第三轮精确作业结果、日志与第6分片首次trace保留在任务证据根；新的全量门禁与插件独立Validate仍待完成，定向5次成功不能代替完整通过。

## 测试重构远程第四轮收敛（2026-11-08）

本体`4caaa05d100d5dfbaec36c20b8c24711a78bc99a`的[第四轮42524550150](https://github.com/0honus0/nexus-terminal/actions/runs/42524550150)在21:18:40–21:33:22 UTC完整结束，约14分42秒。质量、Runner、Docker smoke和7分片成功，第5分片有1项flaky；第3轮会话身份竞态未再出现。首次失败为App工作区生命周期测试读取审计响应时，Chromium正文句柄已失效；服务端成功回执与重试通过不能覆盖首次失败。诊断归`remote-fourth5.log`与`remote-fourth5.zip`。

审计过滤改为Playwright route.fetch仅转发原请求一次，先严格解码真实字节，再原样fulfill并核对原业务断言；不重放副作用。`audit-receipt-repaired`原场景连续5次通过，22.49秒。按实际TypeScript类型复核浏览器正文读取点，另将连接导入的唯一同类迟读改为原回执字节观测；其它候选为Node fetch、APIRequestContext或已经使用route.fetch，并非Chromium响应句柄。`native-file-receipt-final`两项通过，7.32秒，保留部分成功回执、唯一写入与完整导出断言。

另发现5组不同describe下同名用例共用镜像日志文件；Reporter文件名加入Playwright唯一ID摘要，重试继续独立保存。`log-identity-repaired`两项通过，0.115秒；`log-identity-browser-repaired`真实SDK浏览器1项通过，7.6秒，并核对实际落盘文件；`fast-log-identity`全量快速层111文件272项通过，9.46秒，使用Vitest默认worker配置，与此前双worker26.41秒不作为同条件性能对比。完整check和格式通过；缺失报告父目录、定向路径错误与首次spacing检查失败均独立保留，未计为产品测试结果。

新完整门禁与插件独立Validate仍待完成；首次失败、未知效果及未覆盖实机/负载边界保持原判据，不把分批结果或重试合并称全绿。

## 测试重构远程第五轮收敛（2026-11-08）

本体`52b94c06deec9cf3cd8d31aacd6f32b457dfd56e`的[第五轮42525888579](https://github.com/0honus0/nexus-terminal/actions/runs/42525888579)质量、Runner、Docker smoke与八个测试分片全部成功，但最后耗时汇总失败，整轮仍判失败。逐一下载八片原始报告，确认模块236项、Docker模块1项、原生848项、真实文件系统故障5项、Docker原生9项、本体浏览器430项、插件互操作54项及插件浏览器70项全部一次通过，无skip/flaky、重试或重复；该结论只覆盖测试层，不能代替完整门禁。质量作业本体快速层111文件272项通过，19.34秒；插件5项Vitest和125项Node测试通过。

汇总脚本仍只枚举`.spec.ts`，因此将真实发现的`specs/agent-host/sandbox-sdk.spec.mjs`拒为未知文件。枚举同步支持两种正式后缀，未知文件检查保持严格；新增真实CLI回归运行原脚本字节，验证两种后缀、普通测试排除、过时估算移除及未知回执拒绝且不改文件。`duration-cli-final`1项通过，0.176秒；`fast-duration-final`完整快速层112文件273项通过，12.64秒。第五轮原始报告与首次汇总日志保留在任务运行根；仍需修复后完整门禁和准确Host成品的插件独立Validate。

## 测试重构第六轮与最终复审（2026-11-08）

本体`eb98a10ced91d6aeb66632cab0ff4368aa4b683d`的[第六轮42527569681](https://github.com/0honus0/nexus-terminal/actions/runs/42527569681)完整成功，包含质量、Docker smoke、八分片和耗时汇总。八片原始报告核对模块236项、原生848项、真实文件系统故障5项、Docker模块1项及原生9项、本体浏览器430项、插件互操作54项及浏览器70项全部一次通过，无skip/flaky、重试、遗漏或跨片重复；16份组合回执的Host、插件`9c1681e4`源码、SDK和八个准确签包相同。质量快速层112文件273项通过，31.12秒；插件5项Vitest、125项Node测试通过。CI随后仅自动更新耗时估算至`f13a38ac66377d2278b8a69708418f8a93ea521d`。

整轮墙钟926秒（15分26秒），未达3–5分钟目标。关键路径第7分片模块44秒、原生426秒（含自然五分钟认证到期）、本体浏览器228秒、插件互操作9秒、插件浏览器103秒，另有环境准备与汇总；不缩短真实期限或故障条件。冷/热缓存同基线比较、CPU分钟及峰值RSS尚未完成，不能据多轮不同SHA宣称完成性能对照。

最终复审继续发现正常`status.stop`回执失败分支：真实远端可能已经停止，前端却在再次激活时复用旧`started`Promise，不发送新`status.start`。`status-stop-first`逻辑回归5/6、`status-stop-real-first`真实WS回归1/2复现，首次失败保留。开始与停止回执失败共用待核对状态，先确认旧订阅停止，再开始新订阅；失败继续保留原owner，旧generation不覆盖新状态。`status-stop-repaired`两文件8项通过，0.591秒；`fast-status-stop-final`完整快速层112文件275项通过，13.32秒。保持原30秒显示宽限与UI，真实WS测试仅虚拟推进前端宽限，不改产品期限或真实认证/SSH时序。

第六轮成功后触发的[插件Validate42528962604](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42528962604)已通过构建、检查、独立包和互操作，运行到浏览器时因Host新增上述修复而主动取消，不能计为成功。旧基线重复长浏览器不再继续；新Host完整门禁成功后须绑定新成品重新完成独立Validate。准确日志、报告和待验范围继续保留。

正常停止回执修复的根check、全仓格式、Frontend构建与测试客户端构建通过；`status-stop-browser-final`实际成品监控流程1项通过，18.5秒，保留自然缓存到期、单连接和短页面切换断言。恢复专项不新增浏览器错误矩阵，失效回执组合由逻辑与真实WS层覆盖。

## 测试重构设计依据（2026-11-08归档）

以下是重构开始时的原始测量，不能当作当前测试入口或性能基线。

基于本体`9788baa2`、插件仓`31173d70`及[远程42465732392](https://github.com/0honus0/nexus-terminal/actions/runs/42465732392)：

| 事实                                                                                                  | 影响                                                         | 本方案处理                                                                   |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 正式矩阵758项，Backend223、Browser535；另有129份后端、37份前端独立integration文件，部分未进入正式矩阵 | 正式清单与全目录并不等价，旧用例可能失效或无人执行           | 逐文件盘点、功能场景映射、框架发现核对，禁止直接将全目录glob当作新的全绿基线 |
| Backend测试约24分15秒，其中75个`execution-flow`包装测试共19分10秒                                     | 最慢工作集中在一个不可分片文件，且Playwright再次启动Node测试 | Node测试直接执行；按真实职责拆分，下沉重复业务矩阵                           |
| MCP契约输入组合执行32次完整Agent任务                                                                  | 校验协议结构也经过建应用、装包、模型、审批与收尾             | 参数矩阵归协议插件，宿主测受管传输与安全边界，组合层保留代表性链路           |
| Backend本来就主要直接访问HTTP/WS                                                                      | 仅把测试改成“直接请求接口”不能解决重复全栈装配               | 增加函数、真实SQLite、模块HTTP注入和前端组件层                               |
| 固定1个Backend、7个Browser runner；最新Backend Job25分07秒，Browser Job约6分24秒至8分50秒             | 浏览器完成后，其余机器闲置等待Backend                        | 按资源类别与实测工作量分配同一runner预算，不固定1:7                          |
| 包装用例触发外层应用重置，而内部夹具又创建独立应用；成功子测试输出大多不保留                          | 重复准备，慢在启动、安装还是执行难以分辨                     | 每个测试只有一个环境owner，分阶段计时并保留原生报告                          |
| 部分前端Node脚本自行启动Vite与Chromium；插件CI先完整build，test又build工具，八包递归串行              | 非浏览器逻辑承担浏览器成本，构建重复，独立包无法高效并行     | 组件逻辑使用Vitest，真实浏览器由Playwright管理，构建产物只生成一次           |

旧低耗时轮Backend约6分16秒，与最新轮按标题比较，新增测试约9分27秒，原有相同测试约多8分32秒。不能将全部增长归于覆盖增加；15分到24分阶段的具体运行变慢还缺内部阶段计时，不将云runner性能或某一产品修改定为已证实根因。

## Agent 重构决定原文（2026-11-08归档）

以下完整保留D19–D29决定及先后替代关系，满足决定不丢失的追溯要求。只作历史；当前SDK4架构、主代理独立收尾、用户后续授权及清理要求优先，不继续执行旧子代理/SDK3/暂停或未授权状态。

- **D19**：2026-11-06 Agent 模块化与插件市场由用户授权进入实施，覆盖 [Agent 重构](../architecture/AGENT_REFACTOR.md) 的核心扩展接口、本体、官方插件仓库及事件通信。用户要求主代理负责边界审核、集成和验收，sol high 承担核心/协议/生命周期，sol medium 承担市场和测试适配。既有工作区修改保留，迁移中间允许编译不完整；接口与真实消费者完成后统一校验，不以旧证据代替本轮验收。本轮未新增提交、推送或发布授权。

- **D20**：Agent 安装流程按用户最新要求不持久化计划、进度和操作结果；失败后重新准备并安装，仅保存实际包、App 绑定和必要资源围栏，复用已成功项并避免重复创建 App。
- **D21**：第一版允许精简功能但模块边界必须完整。集中验收聊天 App、独立 UI、真实文件工具包及最简巡检 App 的复用；保留权限、生命周期、事件通信、安装升级卸载和多 Agent 父子收敛。其余工具经统一接口继续作为本体默认实现，不继续扩大独立包数量或新增复杂编排功能。
- **D22**：按用户最新要求，模块化同时审核已经完成的流程，以可用、易用和清晰边界为判据；旧设计不合理时直接修正，不要求原样搬迁。界面沿用现有主题、基础组件与风格，必要交互调整限定在本轮 Agent 范围，不另起视觉体系。
- **D23**：用户随后要求全部完成重构并将全部工具插件化，明确启用全部 11 个子代理。D21 的本体默认工具保留仅属于前一切片，本批取消该保留：当前 65 项模型工具归 remote/browser/integrations/agent 四个独立包；Host 只提供 typed 受管领域能力，不暴露旧模型工具。模型定义、参数适配与纯搜索/分页/组合算法归包；批量突变的整组预检、资源围栏、批准和未知效果收敛归 Host，不为搬代码拆散安全边界。无旧协议运行兼容；UI 保持现有风格。测试产物仍集中原任务目录的 all-tools 子目录，保留前轮证据。
- **D24**：用户进一步要求保留全部主要功能并先完成源码重构，再集中测试；D21 的精简范围和默认业务留本体安排不再适用。ChatUI、App 执行策略和全部工具以 `0honus0/nexus-agent-plugins` 为正式源码仓库，不以本体快照同步作为日常开发方式。App 的聊天/图片、上下文组织、自动压缩、显式 checkpoint、标题及工具曝光策略迁入包；Skill 搜索和 Memory 召回算法迁入工具包。本体保留可信宿主、唯一受管执行循环、账本与公开 SDK。新契约统一 manifest/SDK 3，不留旧运行回退；现有 UI 风格及思考等级、历史、文件、审批、多 Agent 等主要功能保留。所有主要功能源码接通前不继续行为验收、签包或全量检查；此前证据只证明当时切片，最终重新构建、签名并固定测试包。
- **D25**：按用户最新要求，不保留独立 `packages/plugin-frontend-sdk` 包；浏览器运行实现放在 `frontend/src/features/agent/plugins/sdk`，前后端插件功能均归各自的 `agent/plugins`。Shared 持有公开契约，前端构建公开 URL 模块，后端交付产物；独立插件仓只消费这些公开接口。其余模块清理延后到全部重构功能完成后，不因文件数量或单次引用搜索删除可信宿主能力。

- **D26**：按用户新增的插件化后设置适配要求，Provider、模型目录、真实执行/容量限制、能力授权与可信服务连接继续由 Host 管理；MCP/ACP 可新建与使用的类型取实际 App 签名执行组合的能力声明，不按官方 App 名或当前 grant 推断。所有已安装 App 保留连接清理入口，无声明的旧连接仍可读取、停用和删除。无执行消费者的 `contextProfile` 全链移除；`contextCompactionMode` 保留为 App 执行插件解释的偏好。插件业务选项归自己的 UI；不虚构 manifest 设置贡献或通用 schema/SDK。
- **D27**：用户随后明确批准服务插件设计，要求功能执行逻辑也由插件提供、插件之间可共享能力，并将相关设置迁入各插件，在已安装插件列表通过设置按钮打开。MCP/出站 ACP 的协议客户端、会话与协议算法进入独立服务包，不以继续调用本体完整业务实现的薄包装代替；Host 保留可信权限、凭据、受管 HTTP/SSH 传输、账本和资源收敛。服务声明、依赖、准确版本绑定和调用复用现有签名包与隔离 RPC；纯服务 App 不伪造模型配置或第二套 Run。设置页面由插件贡献，Host 只挂载并管理可信配置权限；多 App 使用同包仍隔离配置和凭据，系统级模型、安全与资源设置保持宿主归属。D26 的临时集中功能设置入口在新入口接通后移除。当前 SDK 3 尚未发布，整批同步契约及消费者，不保留旧运行兼容；既有签包及回归只作为其对应切片的证据。

- **D28**：用户要求先重新设计架构、更新文档并提供示意图，暂停继续实现。新设计以 App 完整调度、作用域动态注册、用户选择插件能力、前后端隔离 Surface 和共用配置 owner 为准；不兼容旧 Agent 设计。D24 的本体固定模型循环/五阶段、D26 的集中功能设置、D27-C1 的 model/service Run 硬模式与静态服务装配不再作为实施约束。Run 固定 App 实现及其代码依赖，能力目录按当前选择动态发现，每次操作固定准确实现与 schema/配置修订。前后端保持各自 agent/plugins 的一致归属，不新增独立前端 SDK 包。全部子代理停止产品写入，只做设计复核；保留两仓中间源码和既有证据，不回滚、不清理，不继续签包或构建中间迁移。当前交付为文档，后续代码实施须在用户继续指令后按新设计推进。

- **D29**：2026-11-06用户授权先完成当前远程E2E并发布main amd64 dev，再由主代理独立完成AGENT_REFACTOR全部本体、前后端SDK和官方插件重构；不再启用子代理。第一阶段已完成680项远程验收及42307601610发布。后续先完成全部主要功能代码和源码审核，再集中静态/构建/行为测试、发布新版插件并验收本地9998/api.honus.top环境；旧五阶段、静态服务装配和集中协议设置不再沿用。允许破坏性更新，保留现有UI风格和全部主要功能，SDK/manifest新协议同批闭合，不保留旧运行兼容。所有产物归原任务目录final-implementation，未授权清理。

## 测试重构最终验收与独立插件分片（2026-11-08）

本体测试提交`ccd612d953ac725a04f087817493fdc5be332ae3`的[第七轮42529604782](https://github.com/0honus0/nexus-terminal/actions/runs/42529604782)完整成功：质量、Docker smoke、八分片、耗时汇总均成功。原始Reporter逐项核对模块236个叶case、原生协议848、真实ENOSPC5、Docker模块1及原生9、本体浏览器430、插件互操作54、插件浏览器70，均一次通过，无测试skip/flaky、重试、重复或遗漏。按条件关闭的文档截图作业不是测试场景跳过。16份组合记录一致，插件源码固定`9c1681e438bf01cc726f1cdefa5f2e078e55ec8e`，Host成品、SDK和八签包精确一致。快速112文件275项，31.72秒；插件Vitest5项，Node125（含3父测试组，JUnit为122个叶case）。

整轮969秒（16分9秒），质量281秒，Docker smoke118秒。关键路径第7分片模块47秒、原生429秒、本体浏览器246秒、插件互操作12秒、插件浏览器117秒；原生保留真实五分钟认证到期。该结果不代表3–5分钟目标达成，冷/热同基线对照、CPU分钟及峰值RSS仍未完成。CI随后仅自动更新耗时估算至`6c96a5306f64383580703f80b2f95532f3fc708a`。

[独立插件42530975702](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42530975702)已通过构建、静态、包与真实互操作，但70项浏览器串行继承Host分片的900秒总预算，69项通过、1项未运行，suite及teardown均超时；不是完整通过，也没有浏览器断言失败。首次日志、原始JSON及失败环境产物完整保留。未简单增大总期限，而是改为质量作业构建/签包一次、八分片恢复准确源码和签包，通过Node及Playwright原生分片执行；保留全部场景与断言。使用既有Host runner镜像及依赖指纹回退，分片不重建/重签，开发私钥不分发。

插件提交`0ef2c76c7f35dc892e38fdb9510cc1059146534a`的[独立Validate42533036672](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42533036672)质量及八分片全部成功，绑定第七轮Host准确SHA与不可变成品。原始JUnit核对包122个叶case及3父组、Vitest5项、互操作54叶case和浏览器70项，全部一次通过，无重试、跳过、flaky或遗漏；17份组合记录逐字段一致，源码指纹与当前插件提交相符，Host构建及SDK与第七轮一致。独立候选重新使用开发签名，包hash/发布者与本体CI原候选不同是预期，同一轮各片完全一致。相对9c1681e4只改CI及测试说明，正式运行包与SDK未变，未重复发布不可变正式版本。

独立门禁墙钟353秒（5分53秒），包含质量、八片准备/测试/关闭及产物上传，不能替代本体整轮墙钟。签包产物路径与私钥排除已核验；本地插件完整check、受影响Prettier、diff及actionlint1.7.12通过。统计以原始报告口径为准：Node的父test会表现为JUnit testsuite，不能将Node总计与叶testcase数直接混用。

最终四表：

| 审核表   | 源码及执行结论                                                                                                                                                                                      |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 326旧来源、86展开场景及38资产均有替代owner，55处外仓目标实际存在；正常UI保留Playwright，异常按真实owner下沉，全部新门禁报告核对完成。                                                               |
| 职责归属 | 本体持通用Host安全、存储、生命周期及SDK；插件持App调度、模型工具、服务协议和聊天业务；fixture持受控服务，Actions提供runner。构建/签包唯一生成，分片只消费同批成品。                                 |
| 类型归属 | Shared与生产类型owner未改变；HTTP/WS/IPC/iframe仍按真实边界解码转换。测试double按契约检查，准确候选经普通签名/安装/授权，不新增生产测试旁路。                                                       |
| 完成证据 | 本地静态/构建、逐模块实测、Host完整门禁与独立插件完整门禁均通过。最终生产状态监控回执修复含逻辑和真实WS反例，8项0.591秒及成品浏览器18.5秒。3–5分钟、冷/热、真机/真实模型/介质和负载边界明确未完成。 |

证据根`/home/honus/nexus-task-artifacts/testing-restructure-20261108`，`delivery/`保留最终摘要与组合，`cleanup/archives.jsonl`登记完整tar比较和SHA256。用户授权后，已结束的测试数据库、临时SSH/浏览器目录及报告展开副本先归档校验再移除；活动9998前端、正式源码/工具链、无关镜像和业务数据保留。镜像发布另行记录，不部署生产。

## 测试重构最终本地分组快照（2026-11-08）

以下保留收口前的本地分组记录，属于各自运行，不替代已通过的最终两仓完整门禁。路径通过归档索引追溯。

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

最终本体`check-final-layout.log`、`build-final-layout.log`和`formatcheck-final-docs.log`通过，插件check/格式、5项Vitest与125项Node测试通过；本体浏览器430项、插件70项发现无错误。仍待同基线远程全量和冷/热耗时回填。3–5分钟是同等8个测试runner下的优化目标，当前未证明达成；自然五分钟认证到期、两分钟SSH空闲和真实弱网/排空不为目标缩短。

## 测试重构 main amd64 dev 发布（2026-11-08）

[发布42534310922](https://github.com/0honus0/nexus-terminal/actions/runs/42534310922)成功，来源`b527057ce80629627412a212e437f509cee97866`；相对完整被测Host提交`ccd612d953ac725a04f087817493fdc5be332ae3`仅有CI自动耗时估算及文档/测试README修改，逐路径已核对，无产品行为变化。插件9c1681e4到0ef2c76c仅有独立CI及测试README变化，运行包与SDK未改；独立门禁仍绑定准确新插件源码与第七轮Host成品完成。

`ghcr.io/0honus0/nexus-terminal:dev`与`sha-b527057ce806`索引摘要均为`sha256:05f9dd3ae7b49482447fc691aa1ca493f61d89d521d90ace6cf1bd48b6f7fc6f`；唯一产品平台linux/amd64，平台manifest为`sha256:8f23c0eda15bb9ca3a9e6406991567ff81fd7cc166f1a7517ba1bdd5f9bd42be`，config为`sha256:dc5107ab6a91d1fbfec316b52d63e3033726e335d6ff737113b99d71fcac56e9`。实际读取并核对各层摘要、OCI revision/source；未下载镜像层或更新生产。发布前两仓工作区与远程同步；最终发布记录补充只修改文档，不重跑已通过的行为门禁。

最终清理索引1334条归档均存在且没有未完成partial；本轮597份归档经过完整tar比较及SHA256登记。测试源码目录的`.tmp`、`test-results`和`playwright-report`展开产物已移除，Docker无测试容器，本轮Alpine镜像已删除；活动9998预览、既有插件验收服务、正式源码/依赖及无关镜像保留。临时/tmp与RAM展开产物已释放。精简摘要、准确组合、发布manifest/config和源码差异核对保留在任务目录`delivery/`，归档索引在`cleanup/archives.jsonl`。

## 虚拟时钟与分层 CI 性能修复（2026-11-09）

以下为最终冷/热门禁前的实施与首次失败记录；各定向回归只证明对应范围，不合并为完整通过。最终结果另列于本节后续验收记录。

当前追加阶段：两仓扫描全部长短等待，认证期限、Workspace空闲、挂起/归档租约、桌面票据和插件IPC等待逐项审核并虚拟化；实际I/O与进程排空不冒充可快进的状态。冷轮42539769830保留所有产物；SDK更新隔离暴露配置替换与新Run启动竞态，原DB和日志确认新调用复用到已退休的启动结果；修正启动收口，并补原清理成功/未知两条确定性回归。新源码完成后重新固定冷/热对照，不混用先前SHA结果。

workflow环境同步按分层架构收口：移除旧runner定义/输入、Docker smoke无用浏览器依赖和环境不符回退；成功Host发布不可变runner环境身份，插件沿用同一digest。按H-22.1覆盖全部长短可替代等待，静态/模块本地实测后重新执行完整冷/热门禁。

本轮本地收口：根check、Backend/SDK构建、完整格式、actionlint及shell语法通过；快速层114文件286项12.05秒，插件启动与更新31项14.53秒，认证/桌面时钟4项11.40秒，WS排序6项2.80秒，真实SSH与两分钟空闲2项6.45秒，真实Docker观察1项13.26秒。受影响浏览器183项首轮182过、1处拖拽RAF未完成；修正后该项11.1秒通过，保留首轮trace。归档/挂起租约及真实传输回归通过；旧上传用例实际只detach，现通过正式workspace.close关闭owner后等待真实迟到数据拒绝。首次本地漏带浏览器环境与未建立产物根的失败记录保留；统一框架配置现在负责创建产物根。原生启动construction继续保留到原shutdown完成，unknown不会因启动promise结束被后续调用绕过，成功/unknown及晚到调用均有回归。最后一轮补扫将输入准入改为Vitest虚拟时钟，WS队列直接等待动态追踪任务；挂起恢复等待真实close回执，不再把2秒未关闭当作成功。19项定向测试全部通过，26.39秒；插件环境选择复用实际job执行周期，支持只重跑失败作业而不读错attempt。用户追加决定：质量检查全部成功后才启动八个runner，产物直接定位下载，删除旧构建轮询及入口；插件发包按同SHA完整Validate结果准入，移除旧单作业检查。调度变更后的首轮42545151501完成但未通过：三个Puppeteer专项仍使用完整Chromium路径，而新环境只装headless shell；改用Playwright公开launch选择已装浏览器后接真实Puppeteer/CDP，14项本地19.16秒通过。归档取消结算在CI负载下11.1秒，旧helper的10秒期限先关闭现场；整场景框架signal现在统一控制真实阶段等待，保留未知围栏和文件断言。逐项复核该轮模块实际235/236通过；Workspace快进在50秒触发真实ssh2保活失败。夹具保留应用启动时安装的实际文件回收器为虚拟定时器，之后建立的SSH保活使用真实时间，原两分钟空闲和全部文件操作断言保持；本地1项2.81秒通过。首次报告、trace及日志全部保留，重新执行完整门禁。当前仍有新两仓完整冷/热门禁、资源报告与amd64 dev发布待验。

后续完整冷轮`42547218636`模块236、Docker模块1、原生ENOSPC5/Docker9及插件全部通过；本体浏览器429/430，原生协议846/851。SSH错误密码ZIP用例首先收到普通归档拒绝并转unknown，随后四项被围栏/缺失文件阻断。旧夹具finally删除了该native临时目录，原加密包与数据库不可回取；首失报告/完整日志保留。新增固定ZipCrypto头校验碰撞向量复现`unzip`错误密码返回2而非82的路径，按加密状态映射为密码验证失败，非加密损坏仍保留普通拒绝；原生新向量与完整真实OpenSSH旅程共11项4.94秒通过。夹具改归任务产物根，保留真实现场；不清除unknown围栏换绿。终端resize的24次布局变化逐次等待真实ResizeObserver回执，每步推进16ms虚拟时钟，debounce由暂停时钟明确驱动，不再靠CI物理帧间隔；实际SSH输出仍用正常绘制时钟消费，断言不变。最终浏览器专项1项5.5秒、浏览器资源与归档16项19.42秒全部通过；保留开发时暂停时钟的中断/绘制未恢复首失。上述两组修复完成后重新固定最终源码执行完整冷/热门禁。

### 性能阶段四表

| 功能对应                         | 入口与实现                                                                | 差异与状态                                                    |
| -------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 模块、原生、浏览器及插件全部场景 | `e2e.yml`调用框架原生命令，新增薄shell装配                                | 调度及首次失败修复已完成，断言与期限保留；待最终完整门禁      |
| 虚拟时钟、竞态与环境身份         | 框架clock/实际WS屏障、PluginRuntimeService、fixtures/runner与两仓workflow | 本地通过，保持UI与产品期限；完整门禁待验                      |
| ZIP密码验证与终端连续缩放        | NativeArchiveCommands＋固定原生命令向量；Playwright clock＋逐帧布局回执   | 精确拒绝加密验证失败；全部输入/输出及resize断言保留，本地通过 |
| 冷/热对照                        | 两仓workflow dispatch选择依赖缓存；固定准确产物与runner                   | 不复用测试结果；待完整门禁                                    |

| 职责归属   | owner/调用链                                                                                                          | 生命周期                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| 两条测试链 | `scripts/e2e/run-test-shard.sh`，Node/Vitest/Playwright持有发现、分片及隔离                                           | 等待两链全部结束，任一失败阻断；取消同时通知原进程组 |
| 归档结果   | NativeArchiveCommands判断CLI/加密验证结果 → FileArchiveModel转ArchiveRejection → FileArchive清理 → mutation queue结算 | 沿既有具名拒绝传播，真实未知仍保留围栏               |
| 测量       | `scripts/e2e/measure-command.sh`消费GNU time，workflow归档报告                                                        | 记录原exit code，不覆盖失败；峰值口径显式标记        |

| 类型归属            | owner与消费者                                                                     | 边界                                    |
| ------------------- | --------------------------------------------------------------------------------- | --------------------------------------- |
| 归档状态/密码拒绝   | Platform NativeArchiveOperationOutcome、Remote ArchiveRejection和既有Shared错误码 | 复用既有转换，无新类型/字段或数据库变更 |
| CI测量JSON/环境快照 | 测试脚本私有；人工报告消费者                                                      | 不进入Shared/产品契约，不涉及数据库     |

| 完成证据                   | 当前状态                                                                                   | 待完成                 |
| -------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| 调用链、端口和目录隔离复核 | 独立数据/随机端口与浏览器串行已核对；并发试点25项均过；调度成功/失败/取消与信号回执4项通过 | 完整两仓门禁与资源报告 |
| 产品行为与UI               | 审批整秒投影及ZIP密码验证已同步USAGE；无UI变更                                             | 最终diff复审           |

性能首轮`42535891061`失败，首次报告/trace/数据库原样保留：3组Node容器把多个独立场景共用文件总期限，负载增加后后段被父测试取消；协议调度另叠加10秒读取上限；本体浏览器继承了只应归插件互操作的候选环境。已将原有60/90/120秒预算放回各独立场景，协议组合直接消费场景截止signal，本体浏览器清除候选环境且新增隔离断言；不改产品时序、业务断言或真实故障条件。独立插件本轮`42536162788`完整通过，364秒；该轮固定旧Host作缓存预热，不冒称与后续新Host同基线。

性能阶段本地检查：`pnpm check`、`pnpm format:all:check`与actionlint通过；快速层113文件279项，11.44秒。新增CI回归4项0.745秒；插件`pnpm check`通过。首轮失败修正后，调度4项、原生37项（两批38.08/62.55秒）及受影响浏览器3项（16.54秒）通过，根check/完整格式通过。保留本地误并行Shared重建导致夹具加载失败的原记录，不计通过；顺序浏览器回归为新目录独立执行。完整门禁、同源码冷/热和发布仍在执行，以上不作为远程PASS。

冷缓存首轮`42537513726`完整保留，质量、Docker smoke、本体430项和插件70项浏览器均一次通过，五个分片成功，三项失败正在修复：审批毫秒时间投影为整秒后，同秒合法事件被Shared严格不等式误拒；大文件分页仍叠加10秒等待；挂起checkpoint夹具的shell回显/提示符未真实排空。审批协议按实际整秒精度核对，毫秒授权仍在原事务严格判断；同批增加真实mapper→codec及非法状态回归。大文件等待消费框架场景signal，三秒Run期限以无模型App直接验证真实SSH，保留四秒远端独立完成和unknown围栏；挂起测试使用真实PTY及静默前台reader建立输出屏障。产品UI及任务期限不变，本地快速层114文件286项全部通过，9.94秒；挂起3项与审批首批6项共5.84秒，新增第7项由快速层覆盖；独立真实SSH期限用例1项、进程墙钟8.04秒通过，大文件组已通过50.2秒。最终静态与完整远程验证继续执行。

证据根为`/home/honus/nexus-task-artifacts/testing-restructure-20261108`，最终摘要在`delivery/`，首次失败/数据库/未知结果的归档在`cleanup/archives.jsonl`登记。用户要求先完成测试再清理和文档收口；主代理独立执行，不启动子代理。

后续完整冷轮`42549700937`质量、Docker smoke、本体浏览器430及插件54/70均通过；模块234/236，原生852/853。两个签包HTTP场景迁入Vitest后继承5秒默认期限，在CI实际5.12/5.00秒中断，恢复原浏览器场景120秒框架预算，产品期限与断言不变。挂起租约场景在resumeAck后尚未等待独立SFTP就绪便推进42秒，上传准入收到not_found；生产链确认SFTP初始化是异步且有独立期限。夹具增加真实filesystem.ready/error屏障，随后续租和快进；原完整字节、拒绝、接管和同PTY断言不变。本地租约1项2.35秒、HTTP3项6.44秒全部通过；该轮终端连续resize及ZIP新向量均远程通过。旧传输夹具finally删除了native原目录，原租约DB未能回取；完整日志、原生报告及两片诊断ZIP均保留。统一传输夹具现将目录放入任务产物根，仅排空真实资源，保留现场待校验归档，避免再次丢失首次失败证据。本轮无生产代码、UI、Shared或数据库变更。

### 同基线冷轮与配置启动竞态（2026-11-09）

本体`9c60ad71744048d304611f5baf92315dd6573aea`冷轮[42551650171](https://github.com/0honus0/nexus-terminal/actions/runs/42551650171)所有功能测试通过：快速114文件287项、模块236、Docker模块1、原生853、ENOSPC5、Docker原生9、本体浏览器430、插件互操作54/浏览器70，插件Vitest5、Node125（122叶case与3父组），无失败、skip、retry或flaky。质量02:39:10Z结束，八片02:39:12Z启动。墙钟869秒，已测命令CPU73.048分钟，最大单进程RSS2108172KiB，最大容器cgroup峰值7337013248B；RSS与cgroup口径不同，未达3–5分钟。16份组合报告的Host成品、SDK和签包一致，但第5片的Host源码聚合指纹与其余七片不同；只有聚合值不能恢复文件差异，因此此轮不计为组合验收通过。

同本体及插件`7c5ed3e07d9f9016b201664a73a8e0d0a4b7b36f`热轮[42552975763](https://github.com/0honus0/nexus-terminal/actions/runs/42552975763)质量02:53:21Z结束、八片02:53:23Z启动；原生852/853，SDK4独立provider带活动协议session的更新场景失败。原日志显示配置写入与Run并发时，旧instance在activate完成前被直接关闭，construction未标记shutdown；Run继承旧activation拒绝，脚本Provider断言应有工具未出现在真实catalog，Run记录为model_network_failed。第5片源码指纹仍不同，不能将两项问题混为同一原因。原生日志、报告、188226029字节失败artifact和四份sdk4-update数据库已完整保留于本轮证据，未删除现场。

修补在变更通知入口将确属原owner的construction一并退休，已替换的generation仍仅绑定原owner收尾；首发与后续加入者统一等待清理，成功后重读当前配置启动，未知清理不新建。两条原定向用例现在触发实际变更订阅，核对原/加入/迟到调用共享成功或unknown、最后未知故障保留到关闭；修复前两条均确定失败，未靠重试。第一次修补回归还验证到listener的unknown会主动停止准入，故新请求返回provider_unavailable，而原在途请求和最终close保留operation_unknown及原cleanup cause；断言按这一真实语义完善，首次报告保留。最终Backend/SDK构建及根check通过；Module runtime与真实SDK4更新31项全部通过，进程墙钟12.34秒、CPU17.06秒、最大单进程RSS496876KiB。首轮文档格式检查定位PLAN/HISTORY排版，格式修正后复查；远程最终冷/热仍待验。

插件`65ed8c9`仅扩展测试组合报告及README：同时保存参与聚合的全部文件/hash，未改变哈希算法、来源范围、SDK或正式运行包。格式、diff及实际候选加载验证通过；不能用这个变更推断旧指纹差异无害，后续完整轮仍须定位并修复实际owner。独立插件冷轮[42552975559](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42552975559)功能通过，因Host组合待核对不作为最终联合PASS。

## 秒级慢例排序与定向优化（2026-11-09）

按完整冷轮 [42554962530](https://github.com/0honus0/nexus-terminal/actions/runs/42554962530) 的原始逐用例时间降序处理，Host `0d38587876c6d4332f564ff57379ac107e92b0ca`、插件 `65ed8c9`、8 个测试 runner、依赖缓存冷；镜像固定 `sha256:6d7b805779a0d6d8afaedd2f3a78900ae6623a5b6ce89b1d51b636a789272e41`。所有作业成功，原始报告核对模块236、Docker模块1、原生853、ENOSPC5、Docker原生9、本体浏览器430、插件互操作54、插件浏览器70，无遗漏、skip或retry。合计1658条报告记录，909条超过1秒（原排序脚本漏读Docker模块1条，已纠正）；父组和叶case不能相加解释为独立功能数。完整降序JSON/CSV归 `/dev/shm/nexus-performance-20261109-optimization/ranked-cases.*`，原始远程资料归 `/dev/shm/nexus-performance-ci-20261108/run-42554962530`。

该轮墙钟910秒、已测命令CPU69.093分钟、最大单进程RSS2091680KiB、最大容器cgroup峰值7264514048B；不能混为整轮RSS。16份组合报告暴露第5片的成功截图写入源码 `tests/e2e/.tmp`；已定位唯一差异，改为 `testInfo.outputPath`，不排除任何源码来源。虽然功能作业成功，此轮仍不计为严格源码组合通过；修补与最终两仓完整门禁分别记录。

本地环境 Node26.13.0、pnpm12.16.1；同环境定向实测如下。远程冷轮用于排序，不与本地测量计算提升比例。统一证据根 `/dev/shm/nexus-performance-20261109-optimization`，各组原始报告、数据库、首失败、真实协议日志和计时记录保留。

| 降序对应模块                 | 修改与保留判据                                                                                                 | 本地实测与证据目录                                                                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 子任务Browser生命周期        | 首条UI启动保留；重复矩阵通过真实App接口启动，仍覆盖审批、版本冲突、Root/Child取消及实际CDP context回收         | 同例35.646→18.335秒；`plugin-top-before`、`plugin-subagent-protocol-after`                                                                                                      |
| 安装与完整Run                | 减少宿主审批结果的poll退避，保留实际签包、模型、文件、Shell与取消                                              | 同例28.250→23.370秒；`plugin-top-before`、`plugin-top-after`                                                                                                                    |
| Browser根Run生命周期         | 保留第一条真实UI及六种创建/取消/批准边界；余下启动走真实App接口                                                | 同例25.198→12.204秒；`plugin-ranked-regressions`、`plugin-browser-lifecycle-after`                                                                                              |
| 下载/搜索/上传准备等性能矩阵 | 每条件默认一次，额外重复采样由 `NEXUS_TEST_PROFILE_SAMPLES` 指定；原带宽、延迟、每条件数据、完整哈希与故障保留 | 下载/搜索/准备12项CLI104.94→44.31秒；其余4文件与状态12项26.54秒；`network-before/after`、`native-regressions`                                                                   |
| 大目录/深路径                | 保留20,005项、70层、65源与完整真实ZIP/删除；仅夹具写入批处理，真实传输未缩减                                   | 7项约29秒；大目录11.422→11.104秒，深树10.026→10.104秒，没有宣称显著改善；分阶段准备0.125、列表0.293、ZIP校验3.415、删除6.576秒；`capacity-review-before`、`capacity-sftp-after` |
| Agent原生插件装配            | Shell/files/Browser/MCP/ACP各显式最小工具组合、关闭无消费者UI包，tool_search实际owner仍安装                    | Shell11项27.52秒，Files与Browser19计数40.28秒；`agent-shell-minimal-fixed`、`agent-files-browser-minimal`                                                                       |
| MCP Host契约                 | 三种方法同一真实Run batch，仍逐项验证Continuation/完整SDK输入；外部每方法请求恰好一次                          | 最终3项18.08秒；`mcp-final`                                                                                                                                                     |
| 挂起所有权                   | 修复对已关闭socket请求等20秒而误把超时当拒绝的测试；明确旧socket收到撤权原因、generation、1008及关闭消息       | 首例20.904→0.900秒，连公共helper回归共5项4.71秒；`suspend-ownership-review`、`suspend-ownership-after`                                                                          |
| 记忆与Skill分页              | 生产Service逐项累计双重JSON转义字节，避免每加入一项重编码整页；原容量/游标/最大前缀不变                        | 真实10001记忆9.803→1.079秒，组10.85→2.10秒；`memory-before/after`；3快速回归含精确容量、额外一字节、完整续读                                                                    |
| Agent通知                    | 浏览器所属8秒自动隐藏timer使用Playwright clock，真实审批、焦点、状态与320/390/1280px检查保留                   | 桌面16.204→7.788秒，三宽度CLI25.56秒；`plugin-notices-before/after`                                                                                                             |
| Desktop授权轮询              | Node框架推进实际授权interval；真实TCP、撤权与重启保留                                                          | 组36.15→5.85秒，最终5.96秒；`desktop-before/after/final`                                                                                                                        |
| suspend prepare到期          | 仅虚拟Date推进期限，真实SSH、满窗口、背压及同PID保留                                                           | 组20.03→4.93秒，4项通过；`suspend-before/after`                                                                                                                                 |
| ACP大结果                    | 保留131072字节、首段4096与完整码点游标/hash，后续完整读取页65536                                               | 同例13.379→5.962秒；`native-regressions`                                                                                                                                        |
| HTTP鉴权夹具                 | 不再登录没有消费者的management cookie jar；真实APIRequestContext仍独立登录                                     | 含认证/撤权/logout/OIDC的9文件29项26.46秒；`http-fixture-regressions`                                                                                                           |
| 列表性能重复采样             | 1000/5000/10000数据、排序oracle、迟到刷新/多次点击全部保留，仅相同条件重复采样参数化                           | 浏览器3例CLI19.0→12.3秒；`browser-profiles-before/after`                                                                                                                        |
| 状态采样                     | Vitest模拟所属Date/timer，三份真实SSH采样及interval前一毫秒断言保留；页面缓存到期推进双端owner clock           | 模块7283→1327ms，最终1330ms；页面9.2秒；`status-before/after`、`browser-regressions`                                                                                            |
| 偏好服务准入/关闭            | 移除五服务无依据8/16在途门槛；Configuration仍串行，关闭排空已接纳队列                                          | 5个33并发/关闭回归旧代码全失败，修复21ms通过；`preferences-admission-before/after`                                                                                              |
| SFTP Adapter重复预算         | 移除调用方预算之上的固定10000项/2MiB门槛；仍校验正safe integer、实际条目/字节与关闭handle                      | 新回归旧代码确定失败，修复后4项通过；10001项、超过2MiB真实编码及两种调用方超额拒绝/3次close均验证；`sftp-budget-before`、`capacity-sftp-after`                                  |
| 偏好大关联装配               | 保留1001次真实HTTP持久创建，夹具批次并发并按ID集合验证                                                         | 首例3147→2660ms；8文件20项14.96秒；`preferences-http-after`                                                                                                                     |

生产修改归原Service/Adapter，无SQL、Shared、SDK、数据库或UI变更；USAGE及Backend同步。跨服真实8MiB和限速、重复取消重连8循环、Pad真实112MiB超过保留历史等继续保留，不能以减量、提高带宽或移除实际生命周期来换时间。大目录分阶段实测证明主要成本来自真实远端删除与ZIP，不能用夹具准备提速冒称产品提升。原始降序清单尚未全部逐项复审，每片2分钟和整轮3–5分钟目标均未达。

最小装配首轮漏装tool_search的agent工具包，原Shell8失败/2取消完整保留于 `agent-minimal-composition`，加回真实owner后11项通过；catalog新增fixture首轮形状错误亦保留。静态结果和新完整远程验收后续补充，不能以这些定向通过替代整轮PASS。插件仅测试源码变化，没有新正式运行包或SDK版本，不重复发布相同不可变包。插件浏览器使用Playwright原生逐case分片，70例发现无漏重（9/9/9/9/9/9/8/8），实际分片耗时待新轮。

本体浏览器原有耗时产物新增降序 `cases`，保留完整titlePath/project/id、每次retry的状态与时间；同标题不同组和首次失败的时间不被覆盖。原文件级 `specs`估算仍使用最终通过结果。2项reporter回归通过，既有日志隔离/首次失败证据断言保留。

本轮收口静态：根 `pnpm run check`、Backend/双端SDK重建、完整 `format:all:check`、插件 `pnpm check`、diff与文档链接通过。快速层117文件297项全部通过，CLI9.97秒；首次 `fast-final` 的4项工具用例因本机缺少 `/usr/bin/time` 失败，使用现有 `NEXUS_TEST_TIME_COMMAND` 指定GNU time后通过，未改代码或放宽断言，原失败目录保留。正式远程冷/热完整门禁仍待执行，不将本地定向结果记为远程验收。

## 秒级慢例第二批优化（2026-11-09）

最新完整冷轮[42560694495](https://github.com/0honus0/nexus-terminal/actions/runs/42560694495)绑定Host `b9640fcab6abcaf0bdf1e76186ca3a4b12c381a3`和插件`e7a430e`。质量、Docker smoke和7片成功，第5片的MCP Host批量契约失败；16份源码组合一致。原始报告1658条、956条超过1秒，层数与前轮一致；这些是报告记录，不能解释为独立产品功能总数。第1片627秒，其余约391–489秒，性能目标仍未达到。

失败的Run为`1709573b-df76-4ac8-8c18-898f25d49410`；完整第5片日志、178MB首次失败artifact、三份数据库与时间线保留在`/dev/shm/nexus-performance-ci-20261108/run-42560694495`。原90秒框架期限内，helper额外10秒中止了尚在完成的MCP prompt；改为原用例的signal统一管理，不延长原期限。本地3项CLI14.294秒通过。原绿色基线保持不变，本轮待新的完整门禁。

完整降序列表为该证据目录的`ranked-cases-complete.json/csv`。旧轮42554962530重新统计为1658/909，纠正漏读Docker模块；最新为1658/956。旧报告尚不包含质量快速层完整逐case机器记录，本批CI补Host fast Vitest JSON和插件Node JUnit，保留原全部测试glob及Vitest用例。插件质量的fast/native分别计时，资源统计只读取根层metrics，不把嵌套Vitest报告误当资源指标。

下表为同一本地环境的逐模块实测，不能用远程慢例与本地时间计算提升比例。根为`/dev/shm/nexus-performance-20261109-optimization`；原始报告、首失败、数据库和协议日志保留。CLI表示整组墙钟，叶case总和另行标明。

| 模块           | 保留判据与修改                                                                                                     | 本地时间与证据                                                                                                                                        |
| -------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| MCP Host契约   | 原框架signal统一等待，3种真实SDK方法、请求ID/续接及每方法一次派发不变                                              | 3项14.294秒；`mcp-framework-deadline`                                                                                                                 |
| 原生故障8文件  | 文件/Shell/Child仅remote＋agent，ACP仅integrations＋agent＋acp，无消费者UI关闭；原审批、故障账本和排空保留         | Node34计数、JUnit32叶case；CLI56.042→44.214秒，叶case总和82.762→62.895秒；`native-fault-setup-before/after`                                           |
| 读取失败4例    | 等真实client GET失败诊断后，页面推进9999ms无提示、再1ms有提示；布局/可用性不变                                     | Connections tags11.555→1.356、Workspace tags11.218→0.894、SSH keys10.916→1.020、Notification11.222→1.056秒；CLI48.4→7.6秒；`read-grace-before/after`  |
| 终端resume     | 两次真实失败按2/4/8秒推进页面退避，再真实恢复；输出与继续输入保留                                                  | 单例16.401→2.053秒；`terminal-upload-waits-after`                                                                                                     |
| 手机上传       | 15秒WRITE延迟改已有屏障；2个8MiB、布局、取消和远端无残余保持                                                       | 单例19.809→5.316秒；与resume组CLI11.3秒；`terminal-upload-waits-after`                                                                                |
| 状态布局       | 14种尺寸/缩放、每种4趋势范围及真实点击全部保留；同一DOM评估合并边界读取                                            | 单例16.042→14.193、CLI19.4→17.4秒；`status-layout-before/after`                                                                                       |
| 进度布局7例    | 3秒WRITE/压缩延迟改已有屏障，确认held WRITE/活跃压缩进程后才释放；真实完成、视图退休、恢复及手势取消不变           | CLI42.2→28.0秒；gesture单例6.294→6.424秒，未声称每项都提速；`progress-layout-gates-before/after`                                                      |
| 插件完整Run    | 首条真实UI和取消后恢复保留；其它算法/Skill/batch通过真实App接口，独立operation ID，最小插件组合                    | 23.727→20.588→16.506秒；`plugin-ranked-second`                                                                                                        |
| 插件文件/图片  | 真实文件、96层/101文件/32769字符、symlink、GIF字节、刷新恢复、取消与句柄收尾不变；组合最小化，去helper前重复reload | 文件/图片最终20项CLI2.1分钟通过；`plugin-images-delivery-final`，其它7项84.995秒；`plugin-ranked-modules`                                             |
| 子任务/Browser | 两条首次UI与全部矩阵保留，最小root组合                                                                             | 18.131→15.678、11.260→10.277秒，整组34.1→30.6秒；`plugin-browser-lifecycle-before/after`                                                              |
| 其余插件准备   | 纯聊天仅agent，SSH remote＋agent；会话文件交接、6宽度动作及物理进程清理保留                                        | 19项CLI2.1分钟通过；抽样A05 11.504→8.883、A01 7.272→5.894、recorded JSON8.323→7.033、桌面连接关闭6.837→5.999秒；`plugin-remaining-setup-before/after` |
| ACP协议装配    | 仅去无消费者chat UI，真实SSH ACP、Child继承、内层独立权限及收尾均保留                                              | Node7计数（6叶case），CLI22.224→20.697秒；`acp-composition-before/after`                                                                              |
| 验证码请求观测 | 4处原2秒“未请求”观测推进页面clock，真实token/到期/服务拒绝/最终成功与三宽度截图不变；不再catch任意等待/点击错误    | 3项CLI16.9→9.9秒；`captcha-observation-before/fixed`；首次`after`误用pauseAt当前时间而回退，现场保留，改为runFor自然推进后通过                        |
| 文件预览       | 900ms READ延迟改真实READ屏障，加载布局断言和后续编辑/保存/格式预览保留                                             | 15.835→15.086秒；`preview-drag-review-before/after`                                                                                                   |
| 多级拖动导航   | 页面clock验证每级599ms不跳、600ms跳；多源、父目录、右键取消和真实移动不变                                          | 11.015→6.117秒；`preview-drag-review-before/after`                                                                                                    |

Send Files进度例实测9.181秒，无人为传输延迟；两真实目标（一个离线）、完整目录选择及任务清理保留，未为提速删步骤。真实传输、弱网、Pad112MiB及重复取消8循环继续按原规模。956条秒级记录及301个文件尚未全部逐项复审；不能将已测批次称为全部完成。

本批均为测试/CI和文档修改，无生产运行包、Shared、SDK、SQL或UI变更；原产品说明核对仍适用，不重复发布相同不可变插件包。格式检查发现一处函数声明缺空行，已修；最终Host快速层117文件297项10.91秒、完整应用构建22.01秒通过；插件check22.25秒及浏览器发现/类型检查6.70秒通过（70项17文件）。两仓准确提交的完整cold/warm门禁仍待验。

### 质量作业去重与工具缓存

用户要求先完成高收益优化，低收益逐例调整暂缓。上述失败轮的质量作业共4分46秒：安装约13秒、Host构建40秒、插件构建签包21秒、根检查与快速层88秒、全仓格式/ESLint57秒、插件检查与包测试45秒，其余为检出和上传。作业名虽为Checks and format，实际同时负责生成八个分片消费的准确应用及候选包。

根check和format统一扫描原完整ESLint范围，按内容复用官方缓存；Prettier保持原全仓范围并启用内容缓存。前端build/check共享vue-tsc原生增量文件；插件ChatUI同样消除build/check的重复类型分析。CI使用官方actions/cache恢复/保存工具缓存，cold关闭恢复，成功后仍保存以供同SHA的warm对照；测试通过状态、数据库与成品不进入该缓存。

本地原format44.67秒，首次内容缓存28.64秒，真正warm5.77秒，全通过；前端增量首次15.02秒、warm5.98秒。根check44.25→38.29秒，但旧轮曾并发运行一次独立前端检查，因此不能用作严格同条件提升比例。该独立检查恰遇Shared声明重建而失败，现场保留，不记作产品缺陷；后续消费者检查与重建顺序执行。另一次warm格式检查正确拒绝尚未格式化的新文档；不带cache的Prettier写入会删除默认缓存，解释了再次测得28.23秒，稳定缓存后再测为5.77秒。依据已核对当前Prettier CLI实现，不能把失败或重建缓存的耗时当作稳定warm收益。

插件最终完整build8.32秒、fast及原生包测试2.87秒全部通过（Vitest5项、Node125计数，含3个父组）；workflow通过actionlint。原始测量归`quality-duplicate-before/after/final`、`quality-build-final`及`plugin-quality-cache-final`。以上为本地证据，远程收益必须以同一Host/插件SHA及runner digest的完整冷/热轮判断，不预报五分钟已解决。

## 慢例收尾与workflow合并（2026-11-09）

完整冷轮[42566733791](https://github.com/0honus0/nexus-terminal/actions/runs/42566733791)绑定Host `826dece95390452b54ab35378d066c64fe4ffbaa`及插件`89cf3e0`，质量、共享环境、Docker smoke及7片成功，第1片终端恢复页面时钟首次失败、重试通过仍按失败门禁。原MCP问题已在第5片通过。质量作业4分11秒，上一轮4分46秒；安装10.28、应用构建38.91、根check50.99、fast32.98、format37.03秒；插件build14.02、check25.16及浏览器类型11.98秒。冷轮差异不是同源码热缓存收益证据。

新完整排序含质量层，共2083条记录、925条超过1秒；旧1658/956仅含分片。全部attempt保留。原始zip、降序JSON/CSV、质量指标与首次失败根为`/dev/shm/nexus-performance-ci-20261108/run-42566733791`。

剪贴板skip-rsync原例每次8MiB均人为限制1MiB/s。首轮保留原速、至少两个不同UI百分比、方法、完整字节及SHA；后续记住选择/安装后发现仍传完整8MiB，仅取消重复传输的人为限速。本地同例34.906→18.314秒通过。提高首轮速率的尝试曾使direct进度观察失败，已撤回并保留`clipboard-native-progress-after`，不能作为成功收益；最终证据`clipboard-native-progress-fixed`。

Playwright原`pauseAt(new Date())`将控制进程当前时间送往浏览器时可能已过期，远程报Cannot fast-forward to the past。统一helper先`setFixedTime`冻结wall time，再`pauseAt`同一时间，最后`setSystemTime`恢复Date随虚拟计时推进；不增加任意未来余量，不推进业务计时器。8个真实消费者同步。`clock-race-fixed`7项通过，`clock-race-repeat`两个场景各3轮、共6项通过（CLI24.2秒）。本轮定向证据均在`/dev/shm/nexus-performance-20261109-optimization`。

workflow合并相邻质量构建/检查、质量报告上传、分片成品解析与准备步骤；timings直接消费已有test-layers报告，删除每片重复上传；耗时汇总与可选截图更新共用最终作业和一次受源码版本保护的提交。所有原检查与8分片覆盖保留，质量/共享环境/Docker并行关系保持。减少Action调用与重复runner准备，不将普通步骤减少等同于已实测的墙钟收益。完整远程同源码cold/warm及插件独立门禁仍待验。

合并计数：本体质量15→11步，每片15→12步，job定义6→5；插件独立质量23→15步，每片12→10步。普通运行原截图job已条件跳过，实际节省独立runner仅在截图刷新轮发生；重复上传/Action调用减少适用于普通轮。本地首轮快速层因原测试工具目录缺失、GNU time不可用失败，保留`workflow-fast.log`；在明确任务目录恢复匹配Node/pnpm/GNU time后，297项全部通过（CLI10.00秒）。不是产品失败，不改源码规避环境要求。

用户最新决定为本批完成后推送发布，耗时优化先停止；后续不再扩展慢例修改或额外cold/warm性能对照。保留当前目标未达及未测边界，仅完成必要远程完整验收和amd64 dev发布。

提交前复审确认：页面时钟由Playwright持有，传输限速只在非弱网专项的重复分支解除；测试覆盖与产品期限不变。根check、297项fast、全仓格式、完整应用及浏览器客户端构建通过（最终本地墙钟10.51/28.92/20.23秒分别为fast/format/build），两仓actionlint及diff检查通过。产物解析9项覆盖部分重跑、失败/过期/重复来源和API失败。两仓仅测试/CI及文档变化，SQL、运行时包与产品UI不变。

用户确认`browser-evidence.test.mjs`打印的首次失败/重试是预期单测fixture，要求保留，不作修改。另要求减少WebServer刷屏：沿用原Playwright进程组与健康检查，以POSIX exec重定向完整双流至唯一`webserver/{backend,frontend}/run-*/output.log`，复用本体及插件已有报告上传。无应用logger/等级、测试场景或产品变化；2项新契约本地133ms通过，验证完整双流、特殊路径无shell展开、再次运行不覆盖、0/7退出码和SIGTERM传播。当前性能验收轮在日志追加之前启动，只能证明其准确提交；最终门禁须包含新日志配置。

WebServer之外的分片输出仍包含Node/Vitest及插件后台日志，用户追加要求精简整个分片步骤。沿用原测量脚本，分片设置`NEXUS_TEST_LOG_DIR`后将每阶段完整双流追加至`logs/<phase>.log`，控制台显示开始/结果/耗时/路径；两仓原上传增加该目录，不增加Action或改变报告器与测试断言。默认测量路径不变，质量层预期模拟失败继续可见。既有并发/失败继续执行/实际信号排空4项契约新增双流完整且不刷屏断言，原JSON退出码/资源与进程实际终止检查保留。

完整轮42570505478的Finalize test reports已成功计算112个spec、更新14项；当时手动触发未自动回写，只上传不可变artifact13653436738。核对run SHA、成功状态、artifact SHA256、完整spec键及14项差异后纳入本批。用户随后明确要求手动触发也回写，最终作业条件已统一为push/手动成功均可提交，PR仅提案；仍拒绝分支已前进时写入旧估算。

## 测试性能收尾验收与发布（2026-11-09）

push与手动workflow_dispatch完整通过后均自动回写耗时估算，不依赖截图刷新；PR仅保留提案。上一成功轮42570505478的14项估算已纳入本批，最终手动轮42572220179实际提交`ca29a62f8b43fb7a176b3cb12b205729866a39c5`，更新19项估算。提交前复查远程分支仍为被测SHA，避免旧结果覆盖新提交；仅请求截图时合并提交截图。

本批功能与测试/CI优化已收尾，用户要求耗时优化先停止，不再追加慢例改造或额外cold/warm性能对照。[本体完整E2E42572220179](https://github.com/0honus0/nexus-terminal/actions/runs/42572220179)验证`e93d0cbb32499801203491ee3f20be130302a876`和插件`3e3e9c554815e218240c4f78280796efd4bf0d3a`：质量、Docker部署smoke、8片及合并后的报告汇总全部成功。机器报告逐项核对模块236、Docker模块1、原生协议853、有限文件系统5、Docker原生9、本体浏览器430、插件互操作54及插件浏览器70，均一次通过，无skip/retry/flaky。质量快速层118文件299项，插件Vitest5项、Node原生122个叶case（含父组的Node计数125）全部通过。不同层不相加作为产品功能总数。

[插件独立Validate42573490361](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42573490361)验证相同插件源码`3e3e9c554815e218240c4f78280796efd4bf0d3a`，绑定上述成功Host的准确源码、不可变成品和相同runner digest，质量及8片全部成功。互操作54、浏览器70、包测试122及fast5全部一次通过。组合记录本体17份、插件独立17份分别核对源码、Host成品、SDK及8签包摘要一致；开发候选签名不当作正式签包发布。

本体作业墙钟11分41秒，质量3分12秒，8片含各自准备/排空为5分50秒–8分3秒；插件独立墙钟5分33秒。最终轮使用warm依赖/工具缓存，源码不同于前一冷轮，不能当作同源码冷热收益对照。每片2分钟及整轮3–5分钟目标仍未达到；按用户决定不再展开低收益调整。真实协议、数据规模、弱网、授权/审批/取消、数据库与资源关闭断言保留。

本体质量15→11步，每片15→12步，job定义6→5；插件独立质量23→15步，每片12→10步。报告合并保留准确artifact ID与来源job周期、部分重跑/失效/歧义拒绝和失败诊断。普通轮原截图job本就跳过，不夸大为每轮少启动一个runner。WebServer完整双流随报告上传：本体32份、插件独立16份非空服务日志及44/16份完整阶段日志已核对，保留应用日志等级与进程组/健康检查；控制台不再重复打印这些服务日志。报告器单测的模拟失败日志按用户要求保留。

前一轮https://github.com/0honus0/nexus-terminal/actions/runs/42569553078在追加WebServer日志需求后被最终轮取代并取消，质量、Docker及第4片已成功，不冒称完整通过。更早的MCP和页面时钟首次失败、本地进度速率尝试失败及缺GNU time的环境失败均保留原证据。

| 审核表   | 最终结论                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 原正常/异常矩阵、完整数据及真实协议不减，未改产品UI、产品期限或用户可配置政策。                               |
| 职责归属 | 框架持有时钟与分片，受控服务持有真实故障屏障；Playwright仍持有WebServer进程组/健康/退出，日志仅改变出口。     |
| 类型归属 | 无生产Shared、SDK、SQL或数据库变更；脚本/配置与实际两仓消费者同步，新增2项日志shell契约。                     |
| 完成证据 | 本地check、118文件299项fast、全仓格式、构建及actionlint通过；两仓最终完整远程机器报告、组合和镜像身份均核对。 |

[main amd64 dev发布42574293384](https://github.com/0honus0/nexus-terminal/actions/runs/42574293384)成功，来源`ca29a62f8b43fb7a176b3cb12b205729866a39c5`。`dev`与`sha-ca29a62f8b43`摘要均为`sha256:36b8882590f13bd40b2e03b4c9404566e1178f3ac87edc62aa59be3d10b8fc9f`；只读核对产品平台linux/amd64、manifest/config摘要及OCI revision/source，未下载镜像层或部署生产。发布提交相对被测版本仅包含本次成功门禁自动回写的耗时估算，已逐文件复核；运行包源码与SDK未变，不重发相同不可变插件版本；插件市场正式组合继续为catalog-20261108-3。随后文档收口提交不改变运行源码。

本轮可读证据根`/dev/shm/nexus-performance-ci-20261108`包含两仓最终原始zip、逐项审核JSON、作业元数据与发布manifest/config；本地证据根`/dev/shm/nexus-performance-20261109-optimization`保留首次失败、定向回归及预检产物。源码仓不保留生成报告。

## 测试重构全仓维护复核（2026-11-09）

本轮按用户要求复核整个测试体系，包含两仓发现/入口、workflow、runner、产物与清理、静态夹具和文档。继续遵守不追加耗时优化、不改产品UI、不部署或执行线上删除；SQL/Shared/SDK及正式插件运行包未变。H-09核对USAGE现有行为说明仍准确。

| 审核表   | 复核结论                                                                                                                                                                                        |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | 迁移索引326份来源、86个展开场景、55处外仓owner均有目标；本体浏览器430、ingress2，Node120文件，Vitest发现223文件且无重复/遗漏。固定签包源码仍有正式消费者，保留；没有把旧Agent业务重复放回Host。 |
| 职责归属 | 框架持发现/断言；CI装配与成品分发；runner脚本持内容身份和周刷新；维护脚本持manifest/Actions保留；smoke脚本持项目与数据库生命周期。未新增调度服务或测试框架。                                    |
| 类型归属 | 环境产物沿用同一Host resolver，按真实job执行时间选择；ZIP摘要、source SHA、fingerprint及本仓runner digest在边界核对，两仓固定Node。未修改产品协议或增加限制。                                   |
| 完成证据 | 本体42579155382与插件42580704045完整通过；原始JSON/JUnit/ZIP及17组组合分别核对，无跳过、重试、flaky或遗漏。后续仅文档收口，未执行线上删除或生产部署。                                           |

修正的遗漏：

- E2E触发补齐scripts、补丁、assets和workflow/格式配置；删除无生产者的旧诊断路径。
- Runner指纹补齐dockerignore、递归补丁与vendor，内容身份跨周稳定。最初实现固定digest/周标签，用户随后要求两仓全部latest，已移除固定与独立缓存标签；周刷新改用独立元数据，保留依赖指纹校验，digest只记录观测事实。移动latest不保证同一轮OS字节相同。
- 清理保留默认分支成功完整E2E及准确Host环境/runner闭包；按真实job读取ZIP并核对摘要，缺失/过期/来源错误即停止。删除前复查main身份；不把其它分支latest替代成功main。
- Compose smoke覆盖宿主同名环境变量，固定自身数据目录；清理错误使作业失败，测试失败保留数据库/日志/退出事实。上传仅限诊断和失败数据，不上传临时`.env`密钥。
- 31个测试/辅助文件统一`NEXUS_TEST_ARTIFACT_DIR`，移除旧Agent/复数别名；ingress使用独立报告目录并在CI拒绝only与flaky通过。
- 补充静态引用扫描发现三份无人调用的旧Nginx profiling/截图验证脚本，已移除；手动截图入口改为独立run目录，失败不覆盖旧证据或正式图片，新增2项真实入口回归。
- 移除gitignore旧scripts总屏蔽、失效allowlist与重复条目；插件Node从浮动node改为精确26.13.0，检查与发布同版本，Host准备核对版本并复用环境resolver。
- 更新测试/维护/部署架构、本体与插件README及过时SQLite测试路径；性能目标未达与暂停决定如实保留，资源采集已实现的内容不再误写为未完成。

| 本地验证     | 实测与证据                                                                                                               |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 根check      | 初轮38.66秒、去重ingress后38.34秒通过，含布局索引、双端/测试类型与全仓ESLint。                                           |
| fast         | 初轮120文件307项14.52秒通过；手动截图2项0.66秒、latest构建3项0.72秒通过。最终完整快速层以远程报告核对。                  |
| 维护脚本     | 初版36项0.42秒；latest调整后补非latest标签/无效观测digest拒绝，38项0.43秒通过。                                          |
| 全仓格式     | 初轮35.57秒、latest调整后45.73秒通过；两仓workflow actionlint与bash语法通过。                                            |
| 文档链接     | 最终本体doc/README及两仓测试README共26文件、295个本地路径/锚点，无失效。                                                 |
| 真实环境只读 | latest新协议已核对Host42579155382的真实ZIP、来源、指纹与观测digest；始终只读，未执行删除。初版旧协议的只读结果单独保留。 |

首次维护回归31项中1项失败：旧main-only fixture把成功main环境指向已删除候选，暴露旧预期与新保护规则冲突；修正来源fixture后原删除断言保留，31项通过，再补5项queued回归至36项。首次插件check因本地已清除可重建backend/index.mjs而失败，保留原日志；按正式入口先构建，再执行检查，不能将缺构建误判为代码通过。

证据根：`/home/honus/nexus-task-artifacts/workflow-consolidation-20261109/maintenance-audit-20261109`，保留首次失败、原始报告、资源指标、发现盘点及文档链接结果。首次Host42577885856的质量检查发现最后补ingress配置时重复已有`failOnFlakyTests`字段；本地完整check此前通过后又修改配置导致漏检，已去重并重新执行受影响静态/回归，原始日志保留。该轮真实Docker smoke已通过；修正后的42578371034因用户改为latest的最新要求主动取消，不计通过。最终两仓完整门禁已通过，逐项核对结果如下。

| 最终远程验收                                                                                 | 结果                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Host42579155382](https://github.com/0honus0/nexus-terminal/actions/runs/42579155382)        | 来源`0d1a0f4036e281ab73e4bd7c9c2fb7651b27584a`，插件来源`126f326cb0278de8625c527492d31dcb80bf8f3c`；全部12个必需作业成功。快速309、模块236、Node原生869、有限文件系统5、Docker模块1/原生9、本体浏览器430、互操作54、插件浏览器70通过。                                                                        |
| [Plugin42580704045](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42580704045) | 来源`e81986a3fb400c3f387bbe12cf66f3bcd29bd3f9`，绑定上述成功Host；全部9个作业成功。Vitest5、包122叶case、互操作54及浏览器70通过。                                                                                                                                                                             |
| 原始报告核对                                                                                 | 每仓17组组合各自保持源码/构建/SDK/包摘要一致；Host32/Plugin16份非空WebServer日志，44/16份阶段日志；无失败、跳过、重试或flaky，不将重复层相加作为功能总数。                                                                                                                                                    |
| Runner与smoke                                                                                | 两仓引用均为`ghcr.io/0honus0/nexus-terminal-e2e-runner:latest`。准备时观测digest `sha256:2bdb4e34f1b619abce02ed34fe74de6bff5551769122271aad905ea930b87dbe`，内容指纹`274e9da7b58e9ac1db442ba824fd9ca44ae876025a5f0f2cf496ef625c19191e`；真实环境ZIP解析通过。部署smoke的test/cleanup均0退出，上传不含`.env`。 |
| 墙钟与回写                                                                                   | Host13分20秒，质量3分22秒、runner重建3分22秒、smoke1分20秒、分片6分48秒–9分24秒；Plugin6分5秒，质量2分24秒。目标仍未达，继续性能优化按用户决定暂停。Host自动回写`7e22b1b4`仅更新5项耗时估算，不改变运行包。                                                                                                   |

插件仓另完成本地构建10.79秒和check18.34秒；补充手动截图入口2项0.66秒、latest构建3项0.72秒及38项维护0.43秒通过。两仓正式运行源码和包版本未变，不重发相同不可变版本或应用镜像。证据、首次失败及活动环境保留；只删除确认无消费者的三份旧脚本、旧产物变量/诊断路径和冗余忽略项。

## 登录缓存与认证入口发布回归（2026-11-09）

本批提交`05f98cde497821f1abb5da2eab1ffaaa0181e367`交付聚合登录选项、通用常驻缓存与事件失效、OIDC绑定显示和Passkey注册显示、迁移v66移除独立显示字段，以及前批Dashboard入口移除和RDP/VNC窗口按钮顺序。未改变其余登录布局；USAGE、API、架构与部署说明已同步。用户授权提交推送及main amd64 dev发布，不部署生产。

首次失败保留：

- [Host42589016393](https://github.com/0honus0/nexus-terminal/actions/runs/42589016393)：新增Passkey删除API测试遗漏同源Origin，实际403拒绝正确。提交`c892d00ca372ff3dc4b67252dc4a5119f5252fde`补齐删除/退出及清理请求的Origin，并断言正常退出200，不放宽安全策略或产品断言。
- [Host42590883660](https://github.com/0honus0/nexus-terminal/actions/runs/42590883660)：工具详情和Run已为unknown，聊天卡片停在dispatched；重试通过仍为flaky，整轮失败。独立Chat UI读取工具页后再读取Run状态，可能跨过终态提交；相同终态订阅不会再次刷新工具。插件`d8f40712f64d05ae93a5098a019cb59326291c1e`在观察终态后并行重读正文/工具页，工具读取绑定线程选择生命周期，正常停止订阅不再误丢在途结果；切换/移除线程仍拒绝晚结果。无CSS、布局或控件变化。
- [Plugin42593521353](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42593521353)：质量成功，8片在功能执行前因旧成功Host的依赖指纹与当前latest runner不一致而拒绝。预期指纹`274e9da7b58e9ac1db442ba824fd9ca44ae876025a5f0f2cf496ef625c19191e`，实际`a445f8075673017708790f6eb35776af0717084a564feeef1f76729dcb8e5d60`；保留检查，后续改用本轮成功Host验证，不固定digest或旁路准入。

插件新增4项真实composable回归，使用Vue renderer、真实管理请求owner、deferred读取和Vitest虚拟时钟；修复前2项确定失败，修复后4项通过，整个fast层由5增至9项。本地完整插件check、Chat UI构建及diff检查通过；定向4项耗时19ms，完整9项CLI约0.35–0.45秒。初次修复前探测暴露mock一次性队列跨用例残留，改用resetAllMocks隔离后重新核对：旧代码2失败/2通过，新代码全部通过，不把该测试隔离错误算作生产缺陷。

证据根为`/home/honus/nexus-task-artifacts/workflow-consolidation-20261109/login-release-20261109`，保留首次日志、ZIP、trace、截图、数据库、失败与最终报告及发布身份。原始失败不由后续通过覆盖；源码仓不放生成产物。

| 审核表   | 本轮结论                                                                                                                                                                                                          |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | OIDC绑定/解绑、Passkey注册/最后删除、单次聚合读取及原六视口主题几何通过；RDP/VNC控件DOM/Tab顺序和Dashboard保留目录能力的原浏览器断言通过。                                                                        |
| 职责归属 | Platform持ResidentCache资源与排空，Access持选项投影和事件失效，插件持聊天工具状态；宿主不内置插件业务，流关闭与线程选择各自持生命周期。                                                                           |
| 类型归属 | Shared聚合请求/响应与两端消费者同步；旧公开接口及OIDC显示字段移除，迁移66在正式SQL owner执行，无旧值兼容运行分支。插件SDK4不变。                                                                                  |
| 完成证据 | [Host42593547923](https://github.com/0honus0/nexus-terminal/actions/runs/42593547923)全部12个作业成功，原始JSON/XML核对无失败、跳过、重试或flaky；独立插件42595223641/42596591510及正式发布结果见下方，均已完成。 |

本体最终门禁准确源码`c892d00ca372ff3dc4b67252dc4a5119f5252fde`，绑定插件`d8f40712f64d05ae93a5098a019cb59326291c1e`。快速341、模块245、原生869、有限文件系统5、Docker模块1/原生9、本体浏览器430、插件fast9/包122叶case/互操作54/浏览器70全部首次通过。17份组合的源码/构建/SDK/签包摘要一致，保留32份非空WebServer日志及44份完整阶段日志。不同层不相加作为独立功能数。

本体作业墙钟12分34秒，质量2分37秒，分片含准备/排空5分21秒–9分32秒；每片2分钟及整轮3–5分钟目标仍未达，按用户决定暂停进一步耗时优化。自动回写`590246eaa447fee71361db18b1150f61605b2dda`仅更新7项测试耗时估算，已核对与被测版本的完整文件差异，产品运行源码未变。

[main amd64 dev发布42595253170](https://github.com/0honus0/nexus-terminal/actions/runs/42595253170)成功，来源`590246eaa447fee71361db18b1150f61605b2dda`。匿名只读核验`dev`与`sha-590246eaa447`同摘要`sha256:c6041e3bf28c2ff72b1991edb637601ae0af12b9a150958c1714030f1599b688`，唯一产品平台linux/amd64，manifest/config摘要及OCI revision/source/version均匹配。未下载镜像层或部署生产，依赖审计无生产漏洞。

[插件Validate42595223641](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42595223641)绑定本轮成功Host后，fast9、原生包122叶case、互操作54及浏览器70全部首次通过，无skip/retry/flaky；17份组合、16份非空WebServer日志和16份阶段日志一致。作业墙钟5分39秒、质量1分45秒。

[Chat UI发布42596116833](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42596116833)首次被GitHub结论筛选索引拒绝：直接查询与未按状态筛选的列表均显示42595223641成功，`status=success`查询暂时遗漏该运行。保留原失败日志；提交`abbccb63d1a51059ba6c125932eee76401cd4a63`将发布门禁改为按准确SHA分页、逐项核对工作流路径/完成/成功，不依赖该结论索引，不放宽同源码完整验证要求。2项回归约56ms通过，仓库17项1.74秒通过，ESLint/Prettier/actionlint/diff通过。索引随后同步，原已验源码d8f4071的发布第2次执行成功；最终门禁实现的真实远程执行仍待下次实际发布，不将原工作流重试写成新helper的线上验证。

[最终插件Validate42596591510](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42596591510)验证abbccb6及同一成功Host：质量和8片成功，fast9、原生包124叶case、互操作54、浏览器70全部首次通过；17份组合/SDK/包摘要一致，16/16份服务与阶段日志齐全。相对已验d8f4071只增加CI门禁、2项仓库测试与测试说明，插件运行源码不变。两轮分别保留原始报告，不将重复执行相加为产品覆盖数。

[Nexus Chat2.0.2](https://github.com/0honus0/nexus-agent-plugins/releases/tag/chat-ui-v2.0.2)已从d8f4071正式签名发布，官方Publisher签名、manifest、大小4894720字节与SHA256 `2276a7d014f23b79ed6da95bd8bfcf4b4268ab9fc38b736a3118c841cf28cbc6`核验通过。[目录聚合42596913919](https://github.com/0honus0/nexus-agent-plugins/actions/runs/42596913919)成功并发布[catalog-20261109](https://github.com/0honus0/nexus-agent-plugins/releases/tag/catalog-20261109)为最新目录；原14个包条目逐字段保留，仅追加ChatUI2.0.2，共15项，未重签或覆盖旧包。镜像、独立插件和目录均已交付；本轮没有部署生产或手工维护远端数据。真实Pocket ID、手机Passkey/软键盘及介质/备份故障交错继续归PLAN外部边界。
