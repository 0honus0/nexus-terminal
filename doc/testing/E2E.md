# Nexus Terminal E2E

### 第八轮后的分组提交记录（2026-10-19）

本轮按用户最新要求，将原工作区的 23 份在途源码、测试和文档改动拆成可独立审查的组，**完成一组立即本地提交一组**。源码/测试各组依次为：`51230a5d`（设置/主题契约）、`c6d31de8`（SSH Shell 就绪/挂起恢复）、`519a07bd`（SFTP 预提交 stage drain）、`d8fcad51`（复制任务退场）、`370a246d`（登出失败的同主体核验）、`fb446d04`（Agent CAS/Run 回执）、`515e3e9e`（SFTP 大目录夹具）、`6a79a167`（移动上传、归档取消与下载响应）、`88d172f3`（Tag 关联/SSH Key 持久值）。各组已过相应 ESLint/Prettier/严格 TS/构建或 JS 语法静态门禁。以下保留的“工作区在途、尚未提交”说法是**分组提交前的阶段快照**，并非当前 Git 状态。

特别更正两处后续复审结论：移动上传 input 实际是 `WorkspaceSessionSurface` 活动根节点的子元素，**不是** Teleport 的 File Manager dialog 子元素；已调整选择器为活动 `data-workspace-surface`。复制进度基线除核对 `/folder-seed` 下目标文件外，已补充等待任务正常退场，避免最终 metadata/lease close 尚未结算时立即 reset。前述修改均**未运行本地行为/E2E/浏览器测试**；新一轮远程八分片尚未执行，不能标记 PASS。`ToolExecutionUnknown`、插件 Surface、归档真正取消、跨会话 SFTP 清理等独立失败仍在阻断清单，后续需以新远程 Actions 日志逐一确认。

B9 源码审核已收口：当时719/719完整读审，B10/F1修补后当前索引726条；基线证据见[最终源码收口](后端重构待实机验证.md#b9-最终源码收口2026-10-15)和[源码索引](后端重构源码审核.md)。初始v1签名为 backend-next-v1-initial-20261015-b9-mutation-evidence；B10本机可执行范围已收口，外部依赖按D16保留未验，F1已开始，历史B7/B8或旧Backend证据不代表当前行为通过。

> Read [AGENTS.md](../AGENTS.md) before development. Observable product requirements are maintained in [USAGE](../USAGE.md). This document owns test commands, coverage and delivery evidence; update them alongside changes to the actual validation flow.

Playwright is used for browser UI, HTTP API, WebSocket, SSH, and SFTP end-to-end coverage.

**Scope and evidence:** The current Playwright launcher targets `packages/backend`. The fourth remote run failed all eight shards; this batch migrates the failing consumers and fixes their shared causes. Current source review and static checks are not a behavior PASS. Historical product runs against the removed legacy Backend remain evidence only for their recorded baseline. PASS statements apply only to their recorded version and executed cases. Historical Runner/Workspace evidence does not define current development tasks or acceptance of the new backend. Current work is owned by the [implementation plan](../后端重构下一阶段实施方案.md); this documentation review adds no new code-check or behavior PASS.

### 当前远程 E2E 准备

- Playwright 构建并启动当前 Backend；独立环回控制端口默认为29098，支持`NEXUS_E2E_BACKEND_CONTROL_PORT`覆盖。随机控制token只供Node夹具使用，拒绝带Origin的控制请求；控制入口不进入产品HTTP。
- 每个用例先等待原App关闭，再创建独立目录、随机密钥和当前v1数据库；seed模式通过真实setup初始化管理员，empty不初始化。原实例关闭失败则阻断后续重置，保留目录；丢失重置回执不自动重试。restart保持原数据库及密钥，以实际HTTP验证持久状态和凭据解密。
- 已移除旧数据库种子、复制/生成脚本及seed命令；历史升级用例改为当前初始化和重启持久化。Runner镜像安装及指纹包含当前backend和shared，不再复制 Protocol；CI构建实际被测包。第四轮远程质量门禁与 Docker deployment smoke 已通过，八组 Playwright 失败，不沿用烟雾结果替代完整功能验收。
- 失败清单中的 Agent、HTTP、UI、Workspace/SSH 与移动端消费者已按当前 Shared 迁移或核对；精确修复、静态结果和外部待验分别见本文第四轮记录与实施方案。D18 下整批复审和门禁完成后统一交付，不以编译通过宣称远程验收完成。
- D17：当前仅源码、类型/语法、构建与格式检查，不执行Playwright、浏览器或本地行为专项。迁移完成后再按授权运行远程Actions；历史PASS不代表本轮用例已通过。

### B10 重构后端执行入口（本机范围收口）

第三十二批最终统一66文件584/584、0失败/取消/跳过，725536.636675ms、exit0；独立真实五分钟自然到期1/1（三业务分支）、总耗时301570ms通过。冻结1507项、720产品摘要、Backend-next/根check、全仓格式及资源核验通过，日志/tmp/nexus-b10-batch32-unified-final.log、/tmp/nexus-b10-batch32-natural-final.log与/tmp/nexus-b10-batch32-final-verification.log。[本批证据](后端重构待实机验证.md#b10-第三十二批-认证交付自然到期与资源期限2026-10-17)。当前本机必验项收口，外部依赖按D16继续待验；后续F1源码有独立检查，不复用此冻结PASS。历史各批“待验”为当时快照，以本节当前结果和精确证据为准。

第三十一批补齐实际Chromium签名后的Passkey有限提交确认/撤销，以及Files下载交付权限失效；新增8个业务场景，专项26/26通过，最终统一63文件570/570、0失败/取消/跳过、618985.55359ms、exit0。Backend-next/根check、全仓格式及冻结/720摘要/资源核验通过，日志/tmp/nexus-b10-batch31-unified-final.log和/tmp/nexus-b10-batch31-final-verification.log。[本批证据](后端重构待实机验证.md#b10-第三十一批-passkey-确认与下载交付2026-10-17)。本批产品源码不变；其余未验范围继续保留，不代表B10全部通过。

第三十批已修补独立Files数据通道的Workspace租约边界，新增TOTP真实事务确认/撤销及队列/复制权限专项；[本批证据](后端重构待实机验证.md#b10-第三十批-传输租约与因素事务确认2026-10-16)。最终冻结1502项，统一63文件562/562、0失败/取消/跳过、620647.009253ms、exit0；Backend-next build/check、根check、全仓格式及冻结/720摘要/资源核验通过。日志 /tmp/nexus-b10-batch30-unified-final.log 和 /tmp/nexus-b10-batch30-final-verification.log。其余未验子项仍保留，不能视为B10整体完成。

第二十九批已对用户提供的专用Windows经原backend-next HTTP/WS与隔离guacd完成普通RDP实机：真实Windows Server 2022画面、键盘打开winver、鼠标关闭、1280×800调整及新票据重连。用户明确未配置RemoteApp，仍为环境阻断。专项1/1、17624.621512ms、exit0；凭据文件已删除，日志/私有截图仅owner访问，准确脚本hash、首失败及实际范围见[本批证据](后端重构待实机验证.md#b10-第二十九批-windows-实机与租约扫描前围栏2026-10-16)。另扩展原45秒自然lease专项，受控延后扫描、保留真实时钟，在旧WS仍打开时七种操作拒绝，HTTP当前身份管理与新owner原PTY接管通过；原60秒文件预算及test计数不变。最终1501项冻结的统一62文件551/551、0失败/取消/跳过、622171.483557ms、exit0，日志/tmp/nexus-b10-batch29-unified-final.log；Backend-next/根check、全仓格式与冻结/720产品摘要/资源核验通过，日志/tmp/nexus-b10-batch29-final-verification.log。

第二十八批补认证因素技术故障、实际 WebAuthn 验签供应商故障、慢日志接管回滚、真实隔离文件系统 ENOSPC 与混合清理失败、Tool 账本确认丢失、ACP/Job 实际 SSH 进程退出和持久权限监控混合失败，共17个新增业务场景。格式后专项五文件24/24、0失败/取消/跳过，30975.705159ms，日志/tmp/nexus-b10-batch28-focused-final.log。1501项源码/执行配置冻结后，最终统一62文件551/551、0失败/取消/跳过、620730.106873ms、exit0，日志/tmp/nexus-b10-batch28-unified-final.log；Backend-next/根check与全仓格式通过，冻结、720项产品摘要及资源核验通过，日志/tmp/nexus-b10-batch28-final-verification.log；精确范围见[第二十八批](后端重构待实机验证.md#b10-第二十八批-因素技术故障真实空间耗尽与工具账本2026-10-16)。本批未改变产品源码、Shared或正式前端。

真实空间耗尽专项额外要求Linux的unshare、mount、umount及可创建用户/挂载命名空间的权限；只在独立命名空间挂载8/140MiB tmpfs，先核对文件系统类型和容量，不填满宿主磁盘。工作区位于私有home时，按原字节复制构建后的日志Adapter及唯一错误依赖到夹具目录运行，不改写产品实现。缺依赖是环境阻断，不静默skip或以模拟错误替代。

第二十七批新增挂起history/导出和插件owner故障三个专项，并扩展Access/备份/消费背压/MCP/日志/SIGKILL恢复，共27个业务子项；另发现并修复prepared unmark绕过消费背压，prepared断开与实际写失败至PTY退出也已核对。八文件74/74与最终日志/MCP两文件14/14专项通过；后者含重复日志文件，不累加统计。修复关联两文件6/6通过。修复前1486项版本统一59文件531/531通过；修复后1497项冻结纳入11个既有执行配置，719产品摘要不变、WorkspaceService一项更新。最终修复后统一59文件534/534、0失败/取消/跳过、592159.91089ms、exit0，日志/tmp/nexus-b10-batch27-unified-final.log。Backend-next/根check与全仓格式通过，1497项冻结及720产品索引匹配，本批资源核验通过，9个早于本批且无打开句柄的旧tmp目录保留；日志/tmp/nexus-b10-batch27-final-verification.log。精确场景、夹具首失败和范围见[第二十七批](后端重构待实机验证.md#b10-第二十七批-挂起交付插件确认未知与恢复重建2026-10-16)。产品修复只在原WorkspaceService，Shared和正式前端不变，原60秒文件预算不变。

第二十五/二十六批补挂起baseline消费背压、慢日志detach、真实45秒租约、技术日志压缩/分页/旧inode/删除失败，以及ACP实际writer callback；再补Access真实密码/会话事务竞争、MCP应用续接128/任务16准入、SQLite刷新排队取消、后续失败分类与ACP/Job在途监控。五文件13/13和四文件22/22专项通过；1480项版本统一53文件486/486通过，日志/tmp/nexus-b10-batch25-unified-final.log。最终1483项版本两轮复审完成；统一56文件507/507、0失败/取消/跳过、约566.0秒、exit0，日志/tmp/nexus-b10-batch26-unified-final.log。Backend-next/根check和全仓格式通过；冻结、720产品摘要及本批资源核验通过，结果/tmp/nexus-b10-batch26-final-verification.log。范围及首失败见[第二十五批](后端重构待实机验证.md#b10-第二十五批-挂起背压自然租约与实际日志存储2026-10-16)与[第二十六批](后端重构待实机验证.md#b10-第二十六批-认证事务竞争与集成应用层收敛2026-10-16)。没有产品源码/Shared变化；受控应用接缝、真实传输与外部缺证据分别记录。

第二十四批新增传输/集成六个专项及共用真实SSH夹具，扩展原Snapshot SIGKILL专项：35个新增业务场景，覆盖copy/archive真实取消和关联关闭、双端清理故障、混合16/17准入、MCP实际128个pending握手与清理失败、CDP构造取消/键释放、ACP reader/permission清理与Model因果，以及6个publish内部rename窗口和2个恢复再次文件系统拒绝。原包目录7文件60/60通过，约56.3秒；最终统一49文件479/479通过，0失败/取消/跳过，约502.1秒，日志/tmp/nexus-b10-batch24-unified-final.log。Backend-next/根check、全仓格式通过；冻结1476项、720产品摘要与资源核验均通过。统一结果与精确受控/实机范围见[本批证据](后端重构待实机验证.md#b10-第二十四批-传输取消集成清理与恢复内部窗口2026-10-16)。原60秒文件预算不变，未覆盖子项不据此通过。

第二十三批增加 `remote/backend-next-files-queue.integration.mjs`：原 Files Service、SftpFileResource 与真实 SQLite mutation owner，控制 Access、目标查询及 SFTP 到达点。覆盖中间排队取消、队首结算后撤权/指纹变化、close/quiesce、64个 Workspace 预约、晚成功的两阶段清理及双失败因果，共10个业务子项；三文件专项19/19通过，最终统一43文件438/438通过，约447.8秒，日志 `/tmp/nexus-b10-batch23-unified-final.log`。此为受控边界证据，不替代真实SSH copy/archive取消。统一与静态结果见[本批证据](后端重构待实机验证.md#b10-第二十三批-files-排队撤销与-workspace-晚构造预约2026-10-16)。

第二十二批增加 `remote/backend-next-upload-lifecycle.integration.mjs`：实际Access/Workspace/上传WS、环回OpenSSH/SFTP及Linux `/proc` 句柄观察，覆盖ready/部分块取消、字节流断开、显式Workspace关闭、未知围栏和另一SSH端点的健康读写。修复SFTP错误流不发close导致的本地定时器遗漏，原60秒预算不变；五文件专项16/16通过，约14.2秒。最终统一42文件427/427通过，约443.0秒，日志 `/tmp/nexus-b10-batch22-unified-styled-final.log`。原失败、两份冻结及静态结果见[本批证据](后端重构待实机验证.md#b10-第二十二批-真实上传取消与关联关闭2026-10-16)。

第二十一批新增 `remote/backend-next-file-model-lifecycle.integration.mjs`，覆盖原 File Model 的机器/SFTP 晚到、取消与获取拒绝竞争、同步及异步清理失败、关闭等待和独立资源隔离。Machine/SFTP 为受控技术边界，不能据此宣称真实上传取消通过；与既有 Files write 脚本专项8/8通过，统一41文件421/421通过，约430.9秒，日志 `/tmp/nexus-b10-batch21-unified-final.log`；范围及静态结果见[本批证据](后端重构待实机验证.md#b10-第二十一批-files-model-晚到资源与清理2026-10-16)。

当前独立入口（先构建 Shared/backend-next，再以原生 Node 运行，临时数据库与环回服务逐项清理）：

```bash
pnpm run test:backend-next
```

入口委托 `packages/backend` 的 `test`，覆盖 `tests/backend/{storage,http,remote}/backend-next*.integration.mjs`，串行运行、每个测试文件最多60秒。默认 Playwright 启动入口已改为 backend-next，旧用例契约仍在逐项迁移；该变更尚未执行远程验收。DEV历史专项不替代当前正式前端整链回归。新增 HTTP 场景使用本地脚本 Provider，只模拟供应商响应，认证、SQL、Run执行、取消及恢复仍走实际新后端。

首批统一执行统计20/20通过（10个文件，含嵌套用例）；命令、版本、缺陷及覆盖限制见[当前B10证据](后端重构待实机验证.md#b10-首批逻辑与真实传输回归2026-10-15)。日志 `/tmp/nexus-b10-integration-final.log`。历史待验编号只按实际覆盖标记部分通过，不批量改为PASS。

第二批加入 `backend-next-openssh.integration.mjs`，需本机 `/usr/sbin/sshd`、`ssh-keygen`、Info-ZIP和GNU tar，以及启动独立sshd的权限（本轮为root）。专用daemon仅监听环回随机高端口，配置、密钥及数据均临时隔离，不改系统SSH配置。真实登录后验证SFTP/PTY、三格式归档/密码/链接属性、恶意路径拒绝、多块上传、同主机跨Workspace copy/move、Range与票据下载；详细状态见[第二批证据](后端重构待实机验证.md#b10-第二批-opensshsftpworkspace-与原生归档2026-10-15)。缺少依赖须显式记录阻断，不把旧ssh2脚本或内存SFTP结果扩写为OS通过。最终统一命令退出0，11文件、Node统计29/29通过；日志 `/tmp/nexus-b10-openssh-unified.log`，不代表B10整体完成。

第三批增加独立Workspace续接文件，与归档文件共用openssh-fixture.mjs。普通离线输出回放/双阶段确认、挂起恢复与主动接管、注销后新登录续接和Files重新授权已实机验证；仍按原60秒分文件运行。最终统一12文件、Node统计33/33通过，日志/tmp/nexus-b10-resume-unified-final.log，详见[第三批证据](后端重构待实机验证.md#b10-第三批-workspace-续接挂起接管与注销2026-10-15)。未覆盖期限、容量、背压及撤销竞争继续待验。

第四批增加backend-next-access.integration.mjs，验证TOTP真实登录/并发单次消费、受信/不受信代理来源的HTTP/Workspace准入、CAPTCHA技术失败边界，以及Chromium虚拟CTAP2的真实WebAuthn验签。需要现有Playwright Chromium；MockAgent仅替代hCaptcha/Google公网响应并禁止公网连接，不能据此宣称真实供应商或硬件通过。最终统一13文件、Node统计38/38通过，日志/tmp/nexus-b10-access-unified.log。精确结果及剩余项见[第四批证据](后端重构待实机验证.md#b10-第四批-access-因素来源与-captcha2026-10-15)。

第五批增加backend-next-agent-tools.integration.mjs，复用隔离OpenSSH，脚本Provider只给出工具proposal；真实HTTP/审批消费/SQLite/SSH文件写入和模型续轮均走新后端。覆盖normal上下文、声明/调用容量、并发同键批准、拒绝/待批取消/撤权/denylist的实际无写入。两个准入阻断已回到原owner修复；统一14文件45/45、独立7/7通过，日志/tmp/nexus-b10-tools-unified.log。范围及未验项见[第五批证据](后端重构待实机验证.md#b10-第五批-agent-工具审批与授权2026-10-16)。

**B3.3 远程桌面**：B10 第十一批已建立真实 TigerVNC、TLS xrdp、guacd → backend-next HTTP/raw WS 的隔离链路，覆盖图像/输入、票据/容量、权限轮询与部分故障；详见本页第十一批及 testing 对应证据。[B3.3-V01–V12](后端重构待实机验证.md) 的未验子项仍保留，不能复用旧正式 Backend 的结果。原生 Windows 普通 RDP 的独立实机结果见第二十九批；正式前端 F-R12、未配置的 RemoteApp、慢握手与全部清理故障另验；历史 B3.3 源码阶段未测试记录不代表当前 B10 状态。

第六批增加backend-next-agent-shell.integration.mjs、backend-next-agent-files.integration.mjs及共用agent-execution-fixture.mjs。真实Shell/Job、取消/撤权、受控重启与machine claim证据释放、七步文件变更及HTTP输入拒绝走当前新后端/隔离OpenSSH；仅Provider输出脚本化，另有原ToolService排空方法的独立故障回归。统一16文件、Node统计64/64通过，日志/tmp/nexus-b10-execution-unified-final.log；正常close重建不代表崩溃/断电，释放前由fixture独立确认远端进程退出，不能据此推断SSH关闭会终止子进程。详细范围见[第六批证据](后端重构待实机验证.md#b10-第六批-shelljob文件变更与-http-输入2026-10-16)。

第七批增加 backend-next-agent-collaboration.integration.mjs，9个实际父子/协作子场景与原 waitChildren 故障分类回归；独立11/11、统一17文件75/75通过，日志 /tmp/nexus-b10-collaboration-unified.log。Child后台Job的效果未知已验证父最终unknown，消息HTTP观察不消费、独立批准与错族拒绝均走新后端。精确版本、统一结果和剩余限制见[第七批证据](后端重构待实机验证.md#b10-第七批-rootchild-与协作2026-10-16)。MCP/ACP/Browser的有限行为结果见第八批，其余专项继续待验。

第八批增加 backend-next-agent-{mcp,acp,browser}.integration.mjs，需既有Chromium、Puppeteer、环回HTTP与独立OpenSSH。MCP使用真实SDK固定2026-07-28；ACP程序在真实SSH运行；Browser实际CDP核对页面效果与跨客户端context，外部端点/模型输出脚本化，不模拟权限/执行/SQL。独立19业务子场景、Node统计22/22通过，日志 /tmp/nexus-b10-integrations-review-final.log；修复保存ACP入口内层许可与Child准入遗漏。最终统一20文件97/97通过，日志 /tmp/nexus-b10-integrations-unified.log；Backend-next/根check、全仓格式与diff检查通过。版本和限制见[第八批证据](后端重构待实机验证.md#b10-第八批-mcpacp-与-browser2026-10-16)。第九批已补截图字节、Docker及跨实例备份有限整链；其余专项继续待验。

第九批新增 backend-next-{docker,backup}.integration.mjs，需要可用Docker daemon和本地alpine:latest镜像；无依赖时明确失败，不静默skip。所有容器带唯一名称与nexus.b10=docker label，仅清理本轮创建的ID。独立3文件34/34、统一22文件125/125通过，新增25个叶子场景并扩展Browser截图下载/hash/实际解码；修复HTTP上传中断后排空悬挂及Artifact取消误报。命令、最终统一/静态和限制见[第九批证据](后端重构待实机验证.md#b10-第九批-docker跨实例备份与截图正文2026-10-16)。桌面真实服务入口及所有其余历史未验项保留。

第十批新增 backend-next-{notifications,appearance,plugins}.integration.mjs 与 management-fixture.mjs，所有修改经已安装HTTP入口，使用真实SQLite/密码加密、环回HTTP/SMTP和实际插件独立子进程；签名包由既有隔离构建脚本以临时Ed25519密钥生成。需Linux /proc、当前Node permission能力和GNU tar；没有插件运行时注入或公网供应商调用。独立新增62个业务场景、Node统计65/65通过，日志 /tmp/nexus-b10-batch10-review-final.log。修复SMTP全部收件人明确拒绝误记unknown；部分成功、断流和清理失败仍保持原语义。最终统一25文件190/190通过（0失败/跳过、约244秒），日志/tmp/nexus-b10-batch10-unified.log；Backend-next/根check、全仓格式通过。完整场景与静态结论见[第十批证据](后端重构待实机验证.md#b10-第十批-通知外观与插件2026-10-16)。桌面、仓库/SDK浏览器/intents、故障与其他未验项继续保留。

**B3.2 新增待验清单**：待实机文档 B3.2-V01–V12 覆盖 Workspace 状态/Docker、Dashboard 采样、三 system HTTP、指纹/授权/缓存竞态、容量、关闭与 unknown。源码阶段不运行，统一 B10；B7/B6/F1 的独立依赖分别核验。

**B3.1 新增待验清单**：`后端重构待实机验证.md` 的 B3.1-V01–V65，覆盖 Workspace 真 shell 准入与晚开、终端背压/cwd、普通续接、挂起两阶段交付/显式 ACK、owner lease/撤销、100 MiB 历史/4 MiB checkpoint 与管理 HTTP、Files/transfer 双端关闭、并发 pending takeover、长时间日志/取消、独立 Agent/PTY 隔离。当前 B3.1 源码已收口，最终静态证据见待实机清单的“B3.1 源码阶段最终收口”，**B10已验证普通PTY/Files/传输部分正常链、普通终端消费窗口/暂停后续接与journal裁剪、挂起恢复/接管、注销后重新登录续接；容量/期限/挂起日志背压及其余专项故障仍待验**；不能从旧 Backend Playwright、旧 suspend 恢复流程或 R1 Files-only WS 推出通过。按 D2 只能在 B10 且执行入口已指向 backend-next 后运行，并分别保留真实资源清理、传输交付、关联响应的证据。

**用户已授权开始 B10。以下维护执行入口，实际命令和逐项结果见本节当前批次；未登记的历史待验项仍未通过。** 按 [实施方案 B2 至 B10 交付安排](../后端重构下一阶段实施方案.md#b2-至-b10-验证交付安排) 和 D2，须先完成 B1–B9 后端源码及静态准入，才统一运行逻辑回归与重构后端全链路。专项编号与准入/失败回退以 [B10 验证清单](后端重构待实机验证.md#b10-执行交付包与准入) 为准，至少包含 B2-V01–V66、R2-V01–V08；下方旧 backend 的历史 PASS 不纳入本轮计数。

B10 的实际启动配置必须将测试流量、旧正常 HTTP/WS 接口及可核对的消费者**明确指向正在构建的 `packages/backend`**。运行前核实测试启动脚本、环境变量、监听端口及依赖/迁移安装目标；若现有 Playwright 或 Docker 脚本默认仍启动 `packages/backend`，必须先调整 B10 专属测试入口和 fixture，不允许只重命名旧 backend 的测试结果。正式前端 Shared 迁移按 F1 承接；生产切换按实施方案 D4/D5 另行授权，B9 源码收口不代表已切换。

运行顺序及留档约定：先冻结完整 SHA + 未提交 diff、Node/pnpm 版本、数据库隔离根目录、SSH/SFTP/zip/unzip/zipinfo/GNU tar 工具版本与网络形态，运行对应版本的 Shared/backend-next/Frontend 静态检查和构建；再运行单元、集成及隔离 fixture；再跑实际 backend-next 的 HTTP/WS/SSH/SFTP 全链路、旧正常消费者和传输/归档专项；最后注入断线、取消、竞争、恶意归档、权限及资源清理故障并复跑受影响场景。记录每项原始命令、退出码、日志/trace 路径、断言、文件/数据库前后状态和敏感信息脱敏结果，不能仅填写“通过”。未建立对应 backend-next 执行入口或未运行的项目状态仍为「待验证」，权限/工具故障为「环境阻断」。

现有静态检查命令是未来准入时的起点（**此处未执行**）；必须在 B1–B9 源码完成后针对同一版本逐项运行并记录退出码，不能复用历史日志：

```sh
pnpm --filter @nexus-terminal/shared check
pnpm --filter @nexus-terminal/shared build
pnpm --filter @nexus-terminal/backend check
pnpm --filter @nexus-terminal/backend build
pnpm --filter @nexus-terminal/frontend exec vue-tsc --noEmit
pnpm --filter @nexus-terminal/frontend build
pnpm run check
pnpm run format:all:check
git diff --check
```

行为测试命令须在 B10 核对 runner 真正启动/连接 backend-next 后填入本文件的执行记录；目前尚无该新后端完整 B10 E2E 的执行证据，不凭旧脚本名称假定覆盖。

当 B10 发现缺陷，将用例、被测版本、复现证据交回实际 Service/Model/Adapter/Interface/Shared owner 修改，修改后的版本重新执行对应静态和行为范围；禁止用吞错、无依据增大超时、自动重放 unknown 或指向旧后端替代修复。最终 B10 总结应给出逐项编号结论、运行版本、未关闭风险、经过批准的兼容性取舍及是否满足后端完成判据。该总结不自动批准部署、提交或进入 P1/F1。

第十一批新增 backend-next-desktop{,-authorization,-tickets}.integration.mjs、desktop-fixture/desktop-management-fixture及desktop目录下Docker三文件。需可用Docker、Alpine包镜像源（首次构建）、guacamole/guacd:latest和已安装Chromium；缓存构建不强制刷新镜像。实际新后端连TigerVNC与TLS xrdp，图像字节由Chromium解码，键鼠在X Server/xterm核对，资源以原上游TCP确认。28个业务场景、三个父项，实际包目录按统一60秒文件上限运行31/31通过（约142秒），日志/tmp/nexus-b10-batch11-desktop-package-cwd.log。合并文件曾触发原runner文件级60秒超时，已按连接/权限/票据拆分，不改产品TTL或统一超时。16路并发的全局事件监听告警在原Desktop Adapter修正，未提高阈值。最终统一28文件221/221通过（0失败/取消/跳过、约386秒），日志/tmp/nexus-b10-batch11-unified.log；完整结果见[第十一批证据](后端重构待实机验证.md#b10-第十一批-真实桌面与生命周期2026-10-16)，全部历史未验子项仍保留。

B10第十二批新增storage/backend-next-snapshot-crash.integration.mjs及独立snapshot-crash-worker.mjs，需原生Node SQLite/子进程IPC和SIGKILL。使用当前新后端dist、真实持久文件及SQLite，五个步骤时点分别杀原child，有/无旧根、真实Bootstrap未提交启动恢复、提交前后证据不可读与五类损坏日志共19项；实际包目录独立19/19通过（约3.5秒），日志/tmp/nexus-b10-batch12-crash-final.log。无产品注入或迁移；SIGKILL不替代断电，已确认提交后中断不替代提交确认丢失。最终统一、静态、清单及未验限制见[第十二批证据](后端重构待实机验证.md#b10-第十二批-备份持久恢复与异常退出2026-10-16)；仍按原60秒文件预算执行。

第十二批最终统一 pnpm run test:backend-next 已退出0：29文件240/240（含父项），0失败/取消/跳过，约392秒，日志/tmp/nexus-b10-batch12-unified.log；包括最终19项恢复回归和Shared/backend-next build。Backend-next/根check通过，源码清单1452项及原720项索引匹配；完整范围与未验项仍以上述第十二批证据为准。

第十三批新增http/backend-next-plugin-{browser,intents}.integration.mjs及两个plugin fixture，需要既有Playwright Chromium和签名包构建脚本。实际签名资源/完整SDK模块图、opaque sandbox与MessagePort→真实HTTP RPC，以及真实Run事件/订阅/回调失败收敛均经浏览器验证；父页是隔离测试桥，不代表F1。跨App消息核对双方grant、原回执/重启、实际附件/Range/RPC分段与100条容量，修复先截候选再过滤导致漏消息，140条失效候选后的有效回执已回归。实际包目录两个文件37/37通过（35叶子+2父项，约6.2秒），日志/tmp/nexus-b10-batch13-after-fix.log；完整版本、最终统一/静态、修复前失败及未验限制见[第十三批证据](后端重构待实机验证.md#b10-第十三批-浏览器sdk与跨app消息2026-10-16)。仓库/推荐、后端runtime消息、自然期限及流中撤权继续待验。

第十三批最终统一pnpm run test:backend-next退出0：31文件277/277（含父项），0失败/取消/跳过、约392秒，日志/tmp/nexus-b10-batch13-unified-final.log；包含最终Shared/backend-next build，Backend-next/根check和全仓格式通过。1456项源码冻结及720项索引匹配；完整范围仍以第十三批证据为准，不将局部验证扩为B10全部验收。

第十四批新增http/backend-next-plugin-{repositories,runtime-intents}.integration.mjs并扩展原签名包fixture：环回仓库真实配置/目录/下载安装，官方固定公钥与兼容推荐（仅脚本化公网响应），以及两个实际签名子进程的backend-sdk九方法/消息/附件授权。新增45业务叶子、48项含父项；连同第十三批两文件复跑，实际包目录四文件85/85通过、0失败/跳过，约11.6秒，日志/tmp/nexus-b10-batch14-focused-final.log。最终统一33文件325/325通过，0失败/取消/跳过，约404秒；日志/tmp/nexus-b10-batch14-unified-final.log。原生Node permission、Linux /proc、GNU tar和既有Chromium仍为统一runner依赖。未替换产品公钥、runtime或SQL；官方新包完整安装/公网、流中取消撤权、全部自然期限和故障不在此PASS内。静态门禁、1458项冻结与失败历史见[第十四批证据](后端重构待实机验证.md#b10-第十四批-仓库推荐与后台插件消息2026-10-16)。

第十五批新增http/backend-next-plugin-{repository-faults,runtime-lifecycle}.integration.mjs，复用真实环回部分响应/断流、原8任务队列及签名子进程：下载注销/排空、quiesce内SDK拒绝、health失败关闭、SIGKILL的unknown持久化与重启后原实例明确确认。17业务叶子、20项含父项；插件七文件128/128通过、0失败/取消/跳过、约18.7秒，日志/tmp/nexus-b10-batch15-plugin-final.log。修复BoundedFetch把errored stream的cancel原错误传播误判成独立清理失败；无时间跳跃、产品后门或SQL替换。最终统一35文件345/345通过、0失败/取消/跳过、约406秒，日志/tmp/nexus-b10-batch15-unified-final.log；类型、仓库与全仓格式检查通过。1460项冻结、两轮复审及剩余范围见[第十五批证据](后端重构待实机验证.md#b10-第十五批-插件下载故障与运行实例恢复2026-10-16)。

第十六批新增http/backend-next-plugin-artifact-streams.integration.mjs并复用management真实流fixture。用16MiB实际blob、暂停HTTP消费者及Linux原文件句柄确认在途后，验证普通/intent下载的断连、注销、停机、文件版本变化、双方grant/禁用、回执撤销与准备升级；新会话/受控重启保留有效receipt，旧失效receipt不能复活。新增14业务叶子、16项含两个父项，实际包目录插件八文件144/144通过、约25.2秒，日志/tmp/nexus-b10-batch16-plugin-final.log。无产品源码/SQL/Shared变化；最终统一36文件361/361通过、0失败/取消/跳过、约414秒，日志/tmp/nexus-b10-batch16-unified-final.log；Backend-next/根check及全仓格式通过。冻结1461项、720产品摘要未变，范围及静态证据见[第十六批证据](后端重构待实机验证.md#b10-第十六批-在途-artifact-交付与权限围栏2026-10-16)。已在途SDK/RPC、全部容量/自然期限与混合故障仍待验，不把本批HTTP流结果扩为B10整体通过。

第十七批新增storage/backend-next-module-runtime.integration.mjs，使用原Node Module/worker、真实子进程/IPC及受控技术host回调。11个场景覆盖32个host等待/溢出/回收、8控制等待、quiesce、子进程退出后的原host晚结果/独立拒绝、SIGKILL与替换实例隔离、有界失败账本、派发后错误分类及同一后续异常去重；同时确认真实/proc退出后的ESRCH。修复原Node Module失败账本及进程恢复探测，未改SQL/Shared/应用授权。实际包目录连同Shell和八个插件文件共十文件166/166通过、约42.2秒，日志/tmp/nexus-b10-batch17-focused-corrected-final.log；1462项冻结、720索引更新2项及最终统一/静态结果见[第十七批证据](后端重构待实机验证.md#b10-第十七批-隔离运行时在途-host-与独立失败2026-10-16)。修正后最终统一37文件372/372通过、0失败/取消/跳过，约413.7秒，日志/tmp/nexus-b10-batch17-unified-corrected-final.log；Backend-next/根check及全仓格式通过。首轮统一失败记录与修正后结果分别保留；技术结果不代替应用级撤权/安装升级、32实例/全局host额度或全部混合清理验收。

第十八批新增http/backend-next-plugin-rpc-races.integration.mjs与blob-lease-fixture.mjs，需要本机Linux、Perl/Fcntl和支持文件租约的临时文件系统。内核SIGIO确认原NativeBlobStore.open已派发后，经真实HTTP变更双方grant、回执、启停、会话和Artifact版本；实际签名后台child另验证原实例停用/升级排空、新实例与旧回执隔离。原产品SQL/runtime/授权不替换，全部127字节读取不冒充全容量或其他方法。九插件文件161/161通过、0失败/取消/跳过，约29.8秒，日志/tmp/nexus-b10-batch18-plugin-final.log；统一38文件389/389通过，0失败/取消/跳过，约411.9秒，日志/tmp/nexus-b10-batch18-unified-final.log；1464项冻结、720产品摘要不变，失败历史、最终统一/静态和剩余范围见[第十八批证据](后端重构待实机验证.md#b10-第十八批-应用级在途-rpc-与原实例升级2026-10-16)。该夹具不增加生产或远端SSH部署要求。

第十九批新增http/backend-next-plugin-{runtime-capacity,retirement-failures}.integration.mjs，复用签名安装与原Node permission child/IPC、Linux /proc及只读SQLite观察。32真实实例/2在途构造、31+2最后名额竞争、同App共用、发布者批量撤销及独立生命周期失败、卸载unknown重启/围栏/明确确认均经真实HTTP验证。修复原Runtime异步预留占位竞争与Agent已知围栏聚合分类；11插件文件183/183通过，0失败/取消/跳过，约41.6秒，日志/tmp/nexus-b10-batch19-plugin-final.log；统一40文件411/411通过，0失败/取消/跳过，约428.8秒，日志/tmp/nexus-b10-batch19-unified-final.log。1466项冻结及720索引更新3项；失败历史、最终统一/静态及范围见[第十九批证据](后端重构待实机验证.md#b10-第十九批-插件实例容量与失败退役恢复2026-10-16)。每实例32host与生命周期队列32分别表达，不宣称后者或全部容量期限通过。

第二十批扩展原Workspace续接文件和OpenSSH夹具，需原sshd/ssh-keygen及实际PTY。新增三个业务子测试覆盖1MiB普通消费窗口、6MiB精确恢复、满窗口detach后的原Shell与4MiB回放、10MiB离线journal裁剪和越界offset拒绝；字节消费与所有权ACK分别核对。夹具默认ACK按正式客户端20ms合并，允许暂停消费；不改产品容量。相关六文件专项21/21通过，约79.7秒，日志/tmp/nexus-b10-batch20-remote-final.log；统一40文件414/414通过、约430.4秒，日志/tmp/nexus-b10-batch20-unified-final.log；统一后仅补两处空行，最终专项/静态及两份冻结范围见[第二十批证据](后端重构待实机验证.md#b10-第二十批-真实-pty-背压与续接裁剪2026-10-16)。挂起baseline/日志背压、Files取消/晚构造和其他原故障仍待验，不将普通PTY结果扩大为全部传输通过。

SSH search cancellation checks both temporary and persistent SFTP sessions: held reads must settle, open read handles must return to zero, the fixture must stay healthy, and a new search must succeed. The SSH fixture closes remaining file handles when a channel ends, including OPEN operations that finish after cancellation.

CI `scripts/e2e/docker-core-no-runner-smoke.sh` verifies the unified Frontend/Backend/Guacd Compose deployment starts without a production Agent Runner, remains healthy, and does not ship retired Workspace execution modules. The former Runner Job/full deployment smoke depended on deleted production code and has been retired; this lighter core smoke does not cover every authenticated Docker workflow.

`fixtures/agent/task-projects/build-failure` is a dependency-free build-repair input: the production export name mismatches the original build and verification consumers. `agent/functional-regressions.spec.ts` executes the failure, strict patch and original build/verification through a production SSH Run with a scripted provider. It independently compares the final file tree and every preserved file, asserting the exact production source edit, zero exits and data hash. The fixture exercises a real SSH Run; fixture preparation alone does not prove real-model autonomous coding behavior.

The retired `workspace-cleanup-handoff.scenario.ts` was removed along with the Workspace runtime HTTP route. Current A06 and SSH-ACP Playwright tests confirm the retired availability/catalog and App workspace endpoints return 404; current Run creation rejects even `environment: null` with HTTP 400, without creating a Run.

`agent/preset-plugin.spec.ts` also verifies the new SSH-only capability grant boundary through the actual Plugin Stage/Verify/Install and Host HTTP router: File/Shell grant definitions expose only SSH; attempts to save a Workspace-only or combined Workspace+SSH File grant return HTTP 400 without changing the durable grants or policy revision; the subsequent authorized SSH connection-scoped grant still saves and a model Run completes. This is real host/router behavior using the isolated signed E2E Plugin fixture, not evidence of another official Release or of the final Workspace-free application.

`agent/ssh-acp-settings.spec.ts` exercises SSH-only ACP integration settings, an actual SSH session, ACP protocol and inner permission denial/cancellation. Its old production Runner WebSocket health/upgrade probe was replaced by HTTP 404 checks against the Backend's retired Workspace endpoints. The Host installation tests reject the obsolete `workspace-profile` integration and `workspaceRuntime.acpProfiles` settings while accepting SSH argv/cwd integration CRUD.

`agent/host.spec.ts` verifies the Settings UI never fetches retired Workspace availability, keeps Provider/CDP/ACP/Storage settings and rejects all former Workspace management routes. The **current** isolated Playwright Docker run returned **21/21 PASS**, exit 0. Earlier isolated 3-case and pre-removal 20-case results are historical, not current-version evidence.

**Historical validation boundary:** Prior Agent Runner/Workspace tests, archived Docker smoke reports and the obsolete `workspace-cleanup-handoff` scenario do not establish acceptance of the current SSH-only code. The Playwright configuration no longer starts a production Runner; existing ordinary Terminal Workspace E2E and Backend deterministic suites remain independent.

**Updated Backend deterministic acceptance, 2026-10-08:** Agent Run Environment and Workspace Checkpoint fields, Runner background-job semantics and strict Workspace target/inspection decoders were physically removed, not shimmed. Legacy-specific `workspace-cleanup-handoff`, `checkpoint-workspace-evidence`, capability grant migration and historical Settings/machine inspection migration scenarios were removed from the current suite; SSH-only Project Instructions, Run/Checkpoint fixtures, restart recovery and governed mutation tests now exercise current contracts. The complete Backend Agent deterministic suite returned **78 PASS / 0 FAIL, exit 0**; this includes all six ordinary Terminal Workspace scenarios plus SSH/ACP/Browser/Artifact/Memory cases. Prior historical Runner/Workspace E2E results are not evidence for the current version. **All 71 current Agent Playwright cases passed in one official Playwright Docker run (7.8m, exit 0); production Docker smoke also passed locally. Remote CI remains unverified**.

**Final Capability/locale cleanup after production Runner removal:** Removed `workspace.manage` from Backend capability registry, Host protocol, Frontend App Grant category, and the signed first-party E2E Plugin manifest. Removed unused Agent Workspace/Toolchain/Environment/Runner Job translation keys and adjusted all three locale descriptions to SSH-only policy. Complete Backend deterministic (78/78), full signed Plugin Playwright file (8/8), focused Host capability assertion (1/1), and fresh final-state production Docker core no-Runner build/smoke passed. Only the tests explicitly named here were rerun after the capability removal; prior full 71-case pass predates this last scoped cleanup. No remote CI was run.

**Schema #58 / production Runner removal (current E2E partial acceptance):** The production Runner, its fixture launcher, historical Docker deployment and standalone image scripts are removed. The independent CI Playwright tool-container image is retained. In an isolated official Playwright container, the replacement SSH ACP + Agent concurrency E2E tests returned **4/4 PASS**, A06 legacy rejection and SSH-only Run returned **1/1 PASS**, and Host Settings/UI/WS returned **21/21 PASS**. The preset-plugin run first returned 6/8 due to a test Provider/Developer Skill marker mismatch; after fixing the fixture, both focused cases returned 2/2 PASS and the **entire preset-plugin file reran 8/8 PASS (2.1m)**. The full `functional-regressions.spec.ts` returned **23/23 PASS (3.8m)**; `configuration-hints`, `coverage-gaps`, `event-catchup`, and `provider` combined returned **15/15 PASS (38.1s)**. Across the nine current Agent spec files, **all 71 unique cases passed in file-scoped isolated Docker runs** (4+21+8+23+15). A06 was separately confirmed and repeated within the 23; these totals do not double-count it. A subsequent single uninterrupted `--project=agent --workers=1` run executed **71/71 PASS (7.8m, exit 0)** in the official Playwright Docker container. This is stronger evidence than the earlier separate file-scoped runs; remote CI has still not been performed. The unified production image was subsequently rebuilt successfully after deleting an obsolete `COPY packages/protocol/runtime` line in `Dockerfile`; `scripts/e2e/docker-core-no-runner-smoke.sh nexus-terminal:e2e-smoke` ran successfully with Docker Compose Frontend/Backend/Guacd health and production Workspace module absence checks (**exit 0**). This is a local Docker deployment acceptance; remote GitHub CI remains unverified.

The Backend `browser/target-scoped-revision` Agent scenario verifies stable Browser operation identity through unrelated Agent Settings revisions, stale-session close on selected CDP target change/deletion, refusal of old Workspace selectors or stored generation, and cross-Run denial. Browser interaction and screenshot Artifact scenarios exercise the same target-specific hash-derived revision with Browser transfer/observation contracts. The former Runner WebSocket test is gone; `agent/ssh-acp-settings.spec.ts` now checks the Backend's retired Workspace HTTP endpoints return 404 while preserving real SSH ACP denial and cancellation tests (3/3 PASS in the current container run). The real Chromium lifecycle case in `agent/preset-plugin.spec.ts` also passed in a focused isolated Docker run, exercising Browser Context reclamation through cancellation, approval waits and terminal Run settlement (1 passed). These focused results do not replace full Agent E2E and CI acceptance; an asynchronous approval `STATE_CONFLICT` warning was logged during the Chromium case despite passing assertions.

The A04 case in `agent/functional-regressions.spec.ts` uses a scripted provider to launch an actual dependency-free API via production SSH session/Job tools, verify Job identity and real endpoints, compare preserved project bytes, and independently check listener PID/cwd/PORT and disappearance after the bounded lifetime. This short-lived SSH expiry regression does not prove SSH cancel terminates a remote process or indefinite availability.

The A05 variant first discovers and reads the installed signed Operations Skill through production Skill tools, verifies the returned body and signed-content verification, then follows the same real SSH deployment and resource checks. It establishes the Skill-loading-to-deployment chain, not autonomous interpretation of a dedicated deployment Skill. This scripted-Provider test alone does not establish autonomous model interpretation.

The A07 case uses real Chromium and the isolated deployment-page fixture. It invalidates a snapshot, confirms the stale click is rejected before dispatch without reconciliation or deployment, then uses a fresh node to deploy exactly once. Independent fixture state, post-action semantic state, authenticated PNG Artifact bytes/hash/size, browser image decoding and context retirement are checked separately; screenshot generation alone is not business success. This fixture action is not a production release.

The A08 case deliberately proposes a real SSH file-writing command in a plan-only Run with a selected target and full_access approval mode. It requires pre-execution `PLAN_MODE_TOOL_FORBIDDEN`, absence of the would-be side effect, a retained blocked plan and `completed_unverified` partial delivery. This tests backend enforcement, not the scripted Provider's ability to reason about permissions; independent product execution verifies the actual read-only boundary; it does not prove autonomous model interpretation.

Functional task regressions configure their mock model Provider through the frontend settings dialog and send tasks through the Agent Composer. The mock returns model responses/tool proposals only; execution, permissions and durable settlement remain real product behavior. Read-only HTTP/file/process checks provide independent evidence, not an alternate API-only task entry. Fault injection may alter a frontend request revision to exercise actual stale-state rejection. Tests do not attach to an external browser or dispatch CDP commands; the isolated Browser fixture is a product integration endpoint, not a frontend test driver.

Current plugin tasks reuse `fixtures/agent/native-task.ts` for actual App selection, native thread/Run submission, strict Shared decoding and explicitly named tool approvals. SSH ACP additionally exercises the current integration settings UI and independent inner permissions. Goal/Plan, interrupt and legacy task-ui consumers are retired under D15; current follow-ups create explicit new Runs. Stale/late protocol requests, original versions/hashes and resource cleanup remain separate assertions. Touch launcher regressions dispatch touch Pointer events for drag state and use Playwright touchscreen input to open the Hub; they do not establish native touchscreen scroll arbitration during a drag.

The B01 case reproduces a real HTTP 500 with a request ID and matching server stack, patches only the production schema lookup, then runs the unchanged health/catalog/404 checks. The test independently compares protected file bytes, reruns HTTP verification and checks that the identified server PID and listener disappear after both failed and successful checks. Provider scripting verifies the production tool chain, not autonomous diagnosis.

The B02 case starts through the frontend Provider/Composer flow. Its real Unix-socket upstream remains healthy while the gateway returns 502 with a correlated request ID and ENOENT. The product patches only the upstream socket configuration and reruns unchanged health/catalog/404 checks. Independent verification compares every protected file, checks direct upstream and gateway responses, and proves the reported PID, socket and listener were reclaimed after failure and success. Scripted proposals alone do not establish autonomous repair capability.

The current A06 regression verifies that obsolete Workspace availability/catalog/App Workspace REST routes return 404 and both `environment: null` and legacy Recipe selection return HTTP 400 without creating Runs; a new SSH-only Run still completes without a Workspace environment. The isolated Playwright run returned **1/1 PASS**, exit 0. The deleted Runner Job/generation/cwd contract is not part of this acceptance.

`ssh-session-jobs.scenario.ts` also launches a background command through the canonical Shell tool and production SSH session owner against a real loopback SSH channel. It verifies the configured execution lifetime in the result, unverified active status and the expiry warning, then releases the channel to a confirmed terminal result. This does not imply that cancelling an SSH channel guarantees a cancelled remote outcome.

`agent/functional-regressions.spec.ts` exercises the production Run/governance/SFTP file mutation chain with a scripted model provider: create, strict patch, read, deferred move/delete and follow-up evidence. It compares durable content hashes and independently reads the fixture filesystem, including a rejected mismatched patch that must preserve business data and allow a subsequent read. The provider does not simulate filesystem success; this coverage does not establish real-model behavior or Workspace transport parity.

Terminal pointer tests use locator clicks so layout changes and viewport scrolling cannot redirect clicks outside the terminal. OSC 52 clipboard tests start an independent SSH session: the pipe-based SSH fixture does not provide PTY signal semantics for stopping a preceding foreground command with Ctrl+C. Status detail assertions target the shared tooltip panel and live accessible metric label, not native title attributes.

OSC 52 tests type ASCII-only shell commands and decode the Unicode heading from Base64 on the test server. Playwright's non-ASCII text insertion is not a physical key event and can interact with xterm's retained helper-textarea paste value; it must not be used to construct these shell commands. The clipboard assertion still compares the complete Unicode text and all 2000 lines.

Foreground liveness tests wait for successful probe responses to finish browser-side processing before switching to dropped probes. Observing an outgoing ping or catalog refresh alone does not mean the in-flight probe has settled; an immediate foreground event intentionally reuses it. The fixture tracks completion after message dispatch and promise microtasks, without adding an arbitrary sleep.

Mobile automatic-input investigation uses a real remote read loop to consume DSR replies without contaminating shell command editing. It verifies connected status replies, captures actual query output and delivers it on the replacement WebSocket while workspace resume is held, checks disabled input and absence of replies/rejection logs, then verifies the separately observed server-output replay, its new protocol reply, a fresh query and loop exit after recovery. A reply to a replayed server query is not cached user input. This covers automatic status replies in that controlled recovery window, not physical-device IME composition or every unsolicited-input error source.

CI shards enable `DEBUG=pw:webserver` and retain combined output in `.tmp/shard-server.log` with failure diagnostics. This includes managed-service output needed to investigate backend exits before cascading ECONNRESET/ECONNREFUSED failures. The shell pipeline uses pipefail so collecting logs cannot hide a failing test exit status.

The canonical GitHub workflow is `.github/workflows/e2e.yml`. It runs standard lint/type checks, formatting and production builds, eight duration-balanced Playwright shards on isolated GitHub-hosted runners with the latest Node.js Current and the repository-pinned Playwright version, and production-style Docker smoke tests.

The current Docker smoke validates the unified Frontend/Backend/Guacd production image, health status, and absence of retired Agent Workspace code; it does not exercise the deleted production Runner Browser page fixture or standalone deployment.

## backend-next A–D 专项集成验收（2026-10-10）

以下脚本位于根 `tests/backend/`，只对独立的 `backend-next` 临时数据库和环回服务运行，不依赖正式生产 Backend 或部署入口。先执行：

**清理时点：整个 Backend 重构完成后、切换到旧版 E2E 验证前。** 在这两个条件同时满足以前，所有临时专项测试继续保留和维护；执行时机遵循当前实施方案 D2/D3，源码阶段不运行测试；不因为阶段性通过、日常提交或协议阶段开始就提前删除。当前工作分支已经有相关测试提交，未来切换前再单独清理：

- 到约定时点再移除本轮新增的 `tests/backend/remote/backend-next-transport.integration.mjs`、`backend-next-ssh.integration.mjs`、`backend-next-frontend.integration.mjs`，并同步整理复现命令；这些文件**目前仍属于有效的临时验收资产**。
- `tests/backend/storage/backend-next.integration.mjs`、`backend-next-phase2.integration.mjs` 属于**原有仓库测试文件**，不得整文件删除；**必须保留适配现行安全错误码（如 `reference_in_use`、`unavailable`）和全库当前 Schema（单一 v1 初始化，见实施方案 D14）的必要断言**。仅清除真正不再被旧 E2E 切换流程使用的临时验收辅助内容，不允许将上述适配回滚成已失效的旧断言。`backend-next-public-boundary.integration.mjs` 同样保留。
- **保留本文中的验收结论、失败复现、修复依据与未通过项**。下面的命令在 Backend 重构结束前保持可执行；未来清理新增专项文件后，需同步更新此处入口。历史测试提交届时用独立清理提交或最终变更整理处理，不能仅在文档标注后声称已移除。

```bash
pnpm --filter @nexus-terminal/backend build
node tests/backend/storage/backend-next.integration.mjs
node tests/backend/storage/backend-next-phase2.integration.mjs
node tests/backend/storage/backend-next-public-boundary.integration.mjs
node tests/backend/remote/backend-next-transport.integration.mjs
node tests/backend/remote/backend-next-ssh.integration.mjs
```

2026-10-10 上述五个脚本全部通过：存储版本与原子回滚、Targets 公开视图，真实 WebSocket 队列洪泛/按序 Close，受控 PTY EOF/ACK，重复 release 失败聚合，以及真实 `ssh2.Server` 的 SSH Host Key/凭据/PTY 尾字节经 WS 确认后正常关闭。真实 SSH 测试曾复现会话从 live map 移除期间两种尾帧竞态，已修正并使用相同场景复验。

**随后追加的关闭语义专项复验（2026-10-10，同一批临时脚本）**：`backend-next-ssh.integration.mjs` 又用真实 SSH2 连接中断验证客户端收到 `remote_unavailable` 而非成功 `closed`；`backend-next-transport.integration.mjs` 通过真实 WebSocket 验证 `disconnected` 与 `cleanup_failed` 不走正常 EOF，以及 SessionOwner 在 WS 已释放后对相同 Access 会话的重复 DELETE 返回原成功/失败、对其他 token 和未知 ID 拒绝。上述专项均 PASS，但**不等于**真实 HTTP 断线竞争、访问权限中途撤销或长时间压力场景已通过。

额外浏览器脚本运行命令：

```bash
node tests/backend/remote/backend-next-frontend.integration.mjs
```

该脚本将使用隔离的 backend-next、Vite 开发入口与 Playwright Chromium 验证 SSH 连接失败后重复打开、xterm/ResizeObserver 回收及错误文案；还需覆盖旧 generation 的异步错误不覆盖新连接，以及主动关闭后 DELETE 的成功/失败展示。**2026-10-10 当前环境 Chromium 无法访问 `/proc` 相关内核路径且 GPU 进程被沙箱阻断，在浏览器启动阶段失败，页面断言未执行，不算 PASS**。待有合适权限的 runner 执行，不能通过忽略错误、修改断言或仅凭 TypeScript 构建代替验收。

这些测试覆盖的是明确列出的专项故障窗口，不证明多级 Proxy/Jump、大输出、权限撤销、长时间断线或全部 E2E 产品功能；整体余项记录在[后端架构当前能力与验收](../architecture/BACKEND.md#8-当前能力与验收)，协议阶段待办见[下一阶段实施方案](../后端重构下一阶段实施方案.md)。源代码结构或字符串出现与否不是本组测试的判断依据。

**2026-10-10 协议迁移复审补充（非测试 PASS）**：本次核对本地最新 13 个 HTTP/WS、Shared 与前端消费者相关提交，发现 Access 登录 `rate_limited` / `factor_unavailable` 响应与 Shared 错误解码列表不一致，以及 Remote 的 `host_key_untrusted` 声明尚无对应的专用 HTTP 映射；具体 owner 与收口要求见[专项验证清单](后端重构待实机验证.md)。后续专项须增加真实 429/403 登录错误显示、Host Key 不受信任时的公开错误语义核对，且继续保留 Origin/代理、HTTP 4xx、ACL/断线、浏览器重试等剩余验收。首次尝试的 pnpm 检查/构建因存储操作锁无权限、本地 Node 可执行因权限拒绝均未启动；**没有本轮新增的静态 PASS、构建 PASS 或行为 PASS**。此段不推翻上文有明确历史执行记录的专项结果，也不将 Chromium 阻塞误记为已解决。

**同日源码修复后新增的既有专项断言（尚未运行）**：`tests/backend/storage/backend-next-public-boundary.integration.mjs` 对 Access 两个真实登录失败码作 Shared 严格解码与未知码拒绝断言；`tests/backend/remote/backend-next-ssh.integration.mjs` 利用真实 SSH2 服务与受认证 Remote HTTP，要求未确认或错误 SHA256 Host Key 返回 422 `host_key_untrusted`，在恢复正确指纹后密码错误仅返回 503 `remote_unavailable`。此前这些脚本的历史 PASS **不覆盖刚加的断言**。执行前先构建 backend-next/Shared，保持既有入口与原有覆盖；429/403 的真实登录策略触发、开发页实际本地化以及 Host Key 跳板、并发断连仍需要单独真实验收。受当前执行环境限制未能得到新 PASS，不能将代码修改等同于测试通过。

## Structure

- `tests/e2e/specs/auth/` — first-run setup, administrator creation, login, and session establishment.
- `tests/e2e/specs/http/` — HTTP API authentication and protected endpoint flows.
- `tests/e2e/specs/agent/` — Agent Host, Provider, signed Plugin, SSH-only execution, Browser CDP and ACP product flows.
- `tests/e2e/specs/ingress/` — production Nginx ingress regressions exercised against the production-style ingress.
- `tests/e2e/specs/websocket/` — WebSocket upgrade authentication and protocol frame flows.
- `tests/e2e/specs/ui/` — authenticated browser navigation and UI behavior.
- `tests/e2e/specs/ssh/` — real SSH connection and SFTP/File Manager flows.
- `tests/e2e/specs/mobile/` — mobile Workspace, layout, status monitor and touch interaction.
- `tests/e2e/support/` — shared helpers, test servers and the mirrored log reporter.
- `tests/e2e/fixtures/` — committed deterministic seed and isolated external service fixtures.
- `tests/e2e/.tmp/` and `tests/e2e/logs/` — generated runtime data and per-test logs, ignored by Git.

The main E2E projects do not depend on `auth` to create shared state. Normal specs start from the committed seeded database, while the first-run setup regression explicitly requests an empty database. This keeps project and spec scheduling independent from first-run setup order.

The SSH project starts a real `ssh2.Server` on `127.0.0.1:22222`. Its SFTP filesystem is isolated under `tests/e2e/.tmp/ssh-root`, so GitHub Actions does not depend on any external SSH host.

The controlled transfer target forwards `127.0.0.1:22225` to that SSH server; override it with `NEXUS_E2E_SSH_TRANSFER_TARGET_PORT`. It provides a distinct endpoint with the same fixture key and filesystem. Native transfer credentials alone use their real private `/tmp/nexus-transfer-<UUID>` directory so exec and SFTP address the same files.

Local cross-server transfer scenarios require `ssh`, `scp`, `rsync` and `sshpass` on the host PATH, matching the E2E runner image. Missing tools must be supplied before running these scenarios, not worked around by weakening transfer assertions.

Run local Playwright invocations sequentially within a checkout: they share fixture services and the report/artifact directories. Select multiple spec files in one invocation rather than overlapping commands; isolated GitHub shard jobs do not share these resources.

Terminal UI coverage uses the rendered font-size state, terminal surface and Workspace-scoped tablist to verify real SSH output, clipboard interaction, scrollback, geometry, font persistence and session cleanup. Mobile HTML background coverage measures actual animation callback spacing, canceled callbacks, CSS/frame suspension while hidden or under reduced motion, and recovery with the same background document; it validates rendering work, not Android device temperature. Appearance coverage uses visible controls, theme names and public appearance API state for preset selection, mobile typography/text effects, background uploads and local/remote HTML theme flows; it does not depend on production test-only attributes.

Wide-touch Pad coverage keeps a desktop user agent and layout while exercising downward drags at empty history, the history boundary and a real alternate-screen input loop. Touch and mouse-wheel recovery are independent scenarios. Wheel recovery observes the scrollbar reaching its bottom before checking the received completion marker: requested Playwright wheel pixels are normalized by browser DPR and xterm and do not imply a particular number of terminal rows. Synthetic touch cancellation and CSS touch-action assertions do not prove native browser pull-to-refresh behavior on a physical device.

`mobile/pad-file-gestures.spec.ts` checks desktop-UA touch file holds with a controlled clock: movement beyond tolerance and pointer cancellation do not open menus, a subsequent hold opens the archive action, a post-hold click preserves the menu, ZIP creation is observed through SFTP, and mouse right-click remains usable afterward. Synthetic pointer dispatch does not establish physical-device pointer capture or native scrolling behavior.

`mobile/pad-suspended-output.spec.ts` releases a real shell producer only after suspended ownership is available, generates 112MiB of either line logs or single-line output while detached, and checks bounded retained storage, the latest screen, original shell identity, input and historical dragging after browser recovery. It does not seed those bytes into a log file and does not establish an unlimited output-rate or long-duration suspend guarantee.

`mobile/pad-tui-redraw.spec.ts` uses a remote alternate-screen input loop to show old header/footer rows, Chinese wide characters and explicit true-color background cells before each viewport change. Independent full-screen and individual-row erase scenarios require a new frame marker and disappearance of the old text and colored DOM cells. These assertions cover rendered DOM state, not browser compositor pixels. The pipe-based SSH fixture accepts window changes without delivering real PTY SIGWINCH signals, so this does not validate signal-driven application redraw or explain intermittent rendering artifacts on physical Android devices.

Remote-desktop regressions exercise RemoteApp persistence, route-preserving RDP/VNC launch, clipboard exchange, DPI, fullscreen and pointer resize/minimize/restore through the shared window surface. Docker/layout and mobile-preview regressions use public pane controls, existing layout/session/task state and accessible document controls to verify remote commands, compact geometry, layout locking, PDF outline/pinch/panning, preview reset and upload hide/restore/cancellation.

`ssh/suspend-log-compaction.spec.ts` seeds a near-compaction-threshold log in the isolated fixture filesystem, then uses real SSH output and Workspace WebSocket handoff to cross the threshold, resume during continuing output, verify the original shell identity and confirm the physical log was compacted. It avoids sending a 100MiB seed through the terminal renderer and does not substitute a larger ownership lease for storage recovery.

CAPTCHA and proxy lifecycle coverage uses settings headings, form controls and management cards while retaining public-configuration secrecy and explicit credential-update assertions. Panel scaling and advanced mobile touch coverage uses rendered scale state, accessible menus/document actions and the real terminal surface to verify persistence races, archive creation, CodeMirror editing and virtual-keyboard escape sequences without production test markers.

Dashboard and mobile suspend/resume coverage targets host cards, public connection timestamps, tab semantics and suspend identifiers. It retains assertions for independent resource loading, persisted filters, catalog refresh, single-tab recovery, original-shell continuity and older-history touch scrolling.

Test support HTTP controls are limited to deterministic fixture setup and fault injection (for example remote file creation, artificial latency, or SSH availability). Test assertions use the Nexus HTTP/WebSocket/UI/ingress surfaces. Fake external services validate incoming requests directly and return success/failure instead of exposing captured internal request logs to specs.

The Agent preset flow also starts a dedicated real Chromium fixture with loopback CDP and an external context observation endpoint. A model-response barrier holds the Root Run after `browser_session_open`: the spec verifies a new Chromium context exists while the public Run status is `running`, then releases the response, verifies a successful terminal Run and successful tool result, and waits for context count to return to its baseline. A second Run is cancelled while its context is live: the test waits for public `cancelled` status and context reclamation before releasing the barrier, then executes a fresh Run in the same Thread and verifies successful creation, completion and reclamation. A Run with an initial three-request allowance automatically extends within its frozen ceiling while its real Browser context stays live; the held response is released and successful completion reclaims the context. The test restores the original settings after this scenario. Unique provider tool-call identities prevent earlier Thread history from satisfying a later Run's fixture state. This proves Root normal-completion, cancellation/recovery and budget-wait retention Browser behavior, not Child cleanup or late session creation races. The fixture owns only its own Chromium process; it never attaches to a user's browser. The remote launcher allocates isolated control and CDP ports alongside other fixture ports.

Functional/documentation screenshots are declared directly at real E2E checkpoints with `captureFunctionalScreenshot(page, filename)`. Screenshot capture remains opt-in for focused maintenance runs; the canonical E2E workflow does not mutate the repository or commit refreshed screenshots.

Browser approval-wait retention is exercised by opening a real context, proposing a bounded SSH command in `ask` mode, and observing public `awaiting_approval` status with that context still live. Denying or approving the versioned approval resumes the Run; the same context IDs must remain present until the held model response is released. Both branches verify successful completion and context reclamation. This Run's Ledger must contain successful Browser creation and either `APPROVAL_DENIED` or a successful SSH result with the exact fixture output `browser-approval-e2e`. These Root approval scenarios do not establish Child approval behavior.

Cancelling instead of deciding that pending approval must reach public `cancelled` and reclaim the real context. The original approval must become `superseded`; late approval requests using either its original version or its refreshed current version must return HTTP 409, and neither the cancelled Run nor its context may be revived. This exercises immediate terminal cancellation without an active scheduler cleanup fallback; cancellation events must traverse the existing StateCommit post-commit observer.

The automatic-extension scenario also exercises cancellation: the live context must be reclaimed after public `cancelled`. Mailbox budget increases using both the pre-cancellation version and the current cancelled Run version must return HTTP 409, preserving the terminal status and context baseline. Current-version rejection distinguishes terminal-state protection from stale-version protection.

`tests/backend/agent-scenarios/adaptive-execution-budget.scenario.ts` uses real SQLite admission and Native execution to cover a single durable extension under concurrent evaluators, normal completion after expansion, duplicate evidence refusing another extension, concurrent request admission without overshoot, atomic rejection of an oversized tool batch, current Goal／Plan and resource projection, and a failed summary retaining a partial result／checkpoint. These deterministic assertions do not establish live SSH deployment success or an optimal numerical cap for every task.

Child normal-completion coverage delegates to a profile explicitly granted `browser.read`, observes a real context while the Child model response is held, then releases completion and waits for a successful parent Run and context reclamation. The public Subagent record must contain exactly the expected completed Child with a Runtime distinct from its parent. The deterministic Child response projects its actual Browser tool result so the spec can associate the session's Run and Runtime identities with that public Child record and confirm successful creation. This proves Child-created context cleanup at parent Run completion, not cleanup immediately at Child completion while the parent remains active, or cancellation during session creation.

The same delegation flow also cancels the parent while the Child's real context is live and its model response remains held. Both public parent and Child statuses must become `cancelled`, and Chromium contexts must return to baseline before the fixture releases the response. This guards Root execution-slot handoff across model/tool rounds and join waiting: a cancelled Child alone does not satisfy the assertion when the parent remains `cancelling`. It covers cancellation after context creation, not cancellation during asynchronous session creation.

The retired Runner process-group cancellation harness was removed with Agent Workspace. Current SSH session/job cancellation and remote process settlement are exercised by SSH-specific cases; their evidence does not imply the removed Runner process-tree semantics.

Creation-race coverage uses a loopback WebSocket proxy in the dedicated Chromium fixture. It forwards real CDP text frames and holds the response to `Browser.setDownloadBehavior`, after the context/page exists but before session registration completes. Separate Root and Child scenarios observe the held response and live context, cancel the parent Run, release the response, and require public `cancelled` plus context reclamation (and a cancelled Child for delegation). This covers that specific late-initialization window, not every asynchronous creation boundary or an independently cancelled Child while its parent stays running. A safety deadline releases abandoned fixture responses; successful assertions explicitly release them rather than relying on the deadline. No production testing endpoint is added.

Independent Child cancellation is exercised both with a live Browser context and with its final initialization response held. The parent explicitly calls `collaboration_subagent_join` and yields its runtime slot before the Child starts. The public versioned Subagent cancel endpoint must return a cancelled delegation without cancelling the parent. A separate provider response barrier observes the resumed parent still `running`; releasing it must allow successful parent completion with the Child still cancelled and Chromium contexts back at baseline. This verifies Root join parking and wake-up as well as final Run-owned cleanup, not immediate context reclamation while the parent remains active.

## Logs

Every test receives its own text log. The archive layout mirrors the test source layout, for example:

```text
tests/e2e/specs/ssh/file-manager-navigation.spec.ts
tests/e2e/logs/ssh/file-manager-navigation/navigates remote directories over real SFTP.log
```

The log records Playwright steps, API/browser actions, stdout/stderr, final status, failure stacks, and attachment paths. Failed GitHub Actions matrix jobs upload logs, Playwright reports, traces, screenshots, and videos in a project-scoped diagnostic artifact.

On GitHub Actions, the mirrored reporter also prints concise live progress to the job log: test start/end, explicit `test.step(...)` start/result, retry number, and duration. Set `E2E_CONSOLE_LOGS=1` to enable the same console output locally without changing the full per-test log files.

## Local commands

From the repository root:

```bash
pnpm run test:e2e:seed
pnpm run test:e2e
pnpm run test:e2e:auth
pnpm run test:e2e:http
pnpm run test:e2e:agent
pnpm run test:e2e:websocket
pnpm run test:e2e:ui
pnpm run test:e2e:ssh
pnpm run test:e2e:mobile
pnpm run test:e2e:list
pnpm run test:e2e:remote -- --project=http specs/http/auth-2fa.spec.ts
pnpm --filter @nexus-terminal/e2e run test:docs
```

GitHub Actions provides the canonical complete delivery evidence. The quality job runs standard lint/type checks, formatting and production builds serially. Push and pull-request runs use eight Playwright runners by default. Manual workflow dispatch can select 6–10 runners. The selected matrix uses `scripts/e2e/duration-estimates.json` and a longest-estimated-spec-first allocator to distribute the seven normal Playwright projects across duration-balanced shards. Each shard job pulls the current prewarmed E2E runner image, links the frozen workspace from its offline pnpm store, deterministically regenerates the same assignment and runs its assigned spec files. New specs without a direct estimate use the median for their Playwright project, then the global median as a fallback. The Docker job restores the repository-pinned Playwright browser, builds the unified Frontend/Backend image with BuildKit cache, and runs `docker-core-no-runner-smoke.sh` with Guacd. Cache hits only avoid unchanged image layers; this job does not build or run an Agent Workspace Runner. Local commands remain useful for listing tests, running focused specs and reproducing failures. Automated dependency updates dispatch this same workflow on their update branch.

**Local preserved-workspace and E2E tool-runner validation (2026-10-08, `455024b9`):** An independent `nexus-terminal:e2e-runner-local` image was built from the retained `tests/e2e/Dockerfile.runner` using `runner-image-info.mjs` build arguments, without a GHCR push. Its image fingerprint matches the current repository, pnpm is 11.26.0, Playwright is 1.63.0, SSH/SCP/rsync/sshpass are present, and temporary build-only Python/make/g++ are absent. A clean `git archive HEAD` checkout mounted into that image passed `pnpm install --frozen-lockfile --offline`, followed by `playwright test --project=websocket specs/websocket/authenticated-session.spec.ts` **4/4 PASS (12.8s), exit 0**. Separately, the official isolated Playwright Docker image ran `ssh/protocol.spec.ts`, `ssh/reconnect-ui.spec.ts`, and the same WebSocket authentication file together: **29/29 PASS (1.3m), exit 0**, covering the _ordinary Terminal Workspace_ attachment, detach/resume, PTY/binary protocol, tab lifecycle, and authenticated socket revocation. Logs included deliberate invalid-SSH/reconnect failures and session-file-store retries; all assertions passed. The local 8-shard planner resolved **110 spec files**; it was a plan only, not eight remotely executed shards. The remote GitHub Actions workflow and GHCR publish remain unexecuted; the local tool-runner build did not request `--pull --no-cache` and does not establish remote-image equivalence.

**Complete local eight-shard CI-mode acceptance (2026-10-08, `fcc6458b`):** The standard Playwright seven-project catalog lists **439 tests in 110 spec files**. On the unchanged local HEAD, all eight `scripts/e2e/balanced-shards.mjs run --shards 8 --shard N` commands ran inside the locally built `nexus-terminal:e2e-runner-local` image with `CI=true`, a separate clean `git archive HEAD` directory per shard, and successful `pnpm install --frozen-lockfile --offline` before each run. Results were **8/8 shard processes exit 0**, adding up to **439/439 tests passed**:

| Shard     | Spec files | Tests passed |               Reported duration |
| --------- | ---------: | -----------: | ------------------------------: |
| 1         |          1 |           23 |                            5.0m |
| 2         |         14 |           50 |                            3.9m |
| 3         |         14 |           38 |                            4.8m |
| 4         |         15 |           62 |                            5.0m |
| 5         |         17 |           92 |                            5.1m |
| 6         |         16 |           43 |                            4.7m |
| 7         |         17 |           55 |                            4.6m |
| 8         |         16 |           76 |                            5.4m |
| **Total** |    **110** |      **439** | **Eight independent processes** |

The **first** local shard-8 attempt failed **before test collection** because `ui/theme-switching.spec.ts` falls back to `git rev-parse HEAD` when `GITHUB_SHA` is absent; `git archive` intentionally excludes `.git`. Actual GitHub Actions supplies both checkout metadata and `GITHUB_SHA`. For the rerun, the isolated container received `GITHUB_SHA` set to the _already published_ `origin/dev` SHA, solely for live GitHub HTML-theme repository URL verification. `git diff origin/dev..HEAD -- assets/html-themes/remote doc/custom_html_theme` was empty; with this disclosed local-only resource-ref substitution shard 8 passed **76/76**. The locally unpushed HEAD has no GitHub-served SHA URL, so that remote integration cannot be replicated exactly until the revision is published. No product or test assertion was changed, and no GitHub/ GHCR write was performed. This is comprehensive **local CI-mode shard execution**, not a claim that the remote GitHub Actions runner, GHCR image publication, or the separate ingress configuration passed.

For a long-lived remote development host that may already be serving Nexus on the default E2E ports, use `pnpm run test:e2e:remote -- <Playwright args>`. The remote launcher keeps explicit `NEXUS_E2E_*_PORT` overrides, dynamically reserves unique loopback ports for every unset E2E service, and invokes the installed `pnpm` executable directly. It enforces the repository Node engine before starting tests. This helper is for focused remote reproduction; it does not replace the canonical GitHub Actions evidence.

The old standalone Agent Runner smoke and Runner-enabled full-deployment smoke were removed together with the production Agent Workspace/Runner. The preserved `tests/e2e/Dockerfile.runner` is solely a Playwright/CI tool image; `scripts/e2e/build-runner-image.sh` builds and verifies its offline pnpm cache before publication. The current Docker production check is `scripts/e2e/docker-core-no-runner-smoke.sh`.

## CI balanced shards

Release publication validates a complete successful run of this workflow for the current main SHA, so every selected shard and Docker smoke must pass together; retired per-project check names are not release prerequisites. UI regression locators must use accessible roles, names and existing product state or rendered component classes instead of requiring production-only test markers.

The canonical push/pull-request workflow keeps eight isolated Playwright jobs, but their spec assignments are duration-balanced rather than fixed at one job per project. Manual dispatch can select 6–10 jobs. The allocator covers every spec under `auth`, `http`, `agent`, `websocket`, `ui`, `ssh`, and `mobile` exactly once. Matrix jobs fail directly when their Playwright command fails.

Each job checks out the tested commit inside the current E2E runner image, links the frozen workspace offline, and regenerates the same deterministic shard assignment before running it. The image supplies Node.js Current, pnpm, Chromium and Playwright's system dependencies. Its fingerprint includes a weekly refresh marker; a rebuild pulls the floating base image without build cache to refresh Node and OS packages. Fresh GitHub-hosted runners eliminate local port collisions. The default balance can be inspected locally with `node scripts/e2e/balanced-shards.mjs plan --shards 8`.

Every Playwright shard publishes its successful per-spec runtime after the run. A final aggregation job smooths those observations into `scripts/e2e/duration-estimates.json`; a new spec is added immediately, while an existing estimate changes only when the smoothed value differs by at least two seconds and five percent. Pull-request and manual runs upload the proposed baseline as an artifact without writing either branch. A successful branch push writes a material timing update directly back to the same branch that triggered the workflow. The workflow skips the update if that branch advanced after the tested revision. The generated commit contains `[skip ci]`, so pushing the baseline cannot recursively start another E2E workflow. The next E2E run therefore starts from the latest committed balance while one noisy run cannot completely replace established history.

Before Playwright starts, the workflow fingerprints the runner definition, dependency lockfile, Node, pnpm, and Playwright versions. It anonymously reads only the `nexus-terminal-e2e-runner:latest` manifest/config metadata and compares the embedded fingerprint with the current repository, without logging in to GHCR or downloading image layers. A missing or outdated image triggers GHCR login, rebuild, an exact offline workspace-install verification through an Actions-style bind-mounted checkout, and a push directly as `latest`; an unchanged image skips all four operations. Every Playwright shard pulls `latest` when its job starts and links the frozen workspace from the image's prewarmed offline pnpm store. The image fixes pnpm's effective store with `PNPM_CONFIG_STORE_DIR` and enables its side-effects cache, so a checkout mounted outside the image work directory reuses both downloaded packages and lifecycle outputs. Python and the native compiler toolchain build the optional `ssh2` crypto binding once in the same image layer that removes them and clears the apt metadata afterward; release verification confirms those build-only tools are absent and rejects an image if a fresh mounted checkout tries to run the build again. If another branch replaces `latest` before a shard starts, or a fork pull request cannot update the repository package, the shard detects the fingerprint mismatch and downloads only dependencies and the headless browser revision absent from the image. The slim image includes only Chromium's headless shell, its system dependencies, and the command-line tools used by the suite, so normal E2E runs do not reinstall the browser or carry the full headed Chromium package.

Manual workflow dispatch exposes a `refresh_screenshots` option. When enabled, the normal duration-balanced E2E shards capture the declared documentation checkpoints during the same test run and upload their PNG artifacts. After quality checks, every Playwright shard, and Docker smoke succeed, a final job merges the produced screenshots into `doc/imgs/e2e/` and pushes a single `docs(e2e): refresh screenshots [skip ci]` commit back to the selected branch. It skips the write if that branch advanced after the tested revision, and `[skip ci]` prevents the generated commit from starting another E2E workflow.

Production-ingress coverage can still be run explicitly against a prepared production-style endpoint:

```bash
NEXUS_PRODUCTION_BASE_URL=http://127.0.0.1:18113 pnpm --filter @nexus-terminal/e2e run test:ingress
```

## Codex CLI 计时刷新专项（2026-10-19）

用户反馈上一版后仍需点击刷新。本次源码复核发现：已有同步提交分支依赖 SynchronizedOutputHandler 先有缓冲行；完整 DEC 2026 帧在一个解析批次内闭合时没有先登记，关闭通知仍走异步绘制，随后开启的帧可再次阻止绘制。InputHandler 在开启后立即发出行刷新通知，先由同步模式登记范围；关闭时原 RenderService 同步提交。源码及两种交付产物同步补丁，锁文件更新；普通输出的动画帧／100ms 期限保持原路径。

两轮源码复核分别追踪 InputHandler→CoreBrowserTerminal→RenderService→SynchronizedOutputHandler／RenderDebouncer，以及同批／拆批／连续帧、超时、后台暂停和销毁；不添加业务类型、Vue 强制刷新或全局计时器。已离线应用补丁。基线 dev／1f87fd08，Node 22.23.1、pnpm 11.26.0；根 `pnpm run check` 和 Frontend build 均 exit0，日志 `/tmp/nexus-codex-timer-check.log`、`/tmp/nexus-codex-timer-build.log`。依赖两个入口和生产 TerminalView 资产静态确认含开启登记逻辑，`git diff --check` 通过。全仓 `format:all:check` exit1，停在既有工作区 `tests/e2e/support/test-ssh-server.mjs:182–183` 的两处声明空行，日志 `/tmp/nexus-codex-timer-format.log`；该文件不属本专项，不覆盖其在途修改。本专项四份文档单独 Prettier 检查通过，不将其当全仓格式通过。按 D17 未新增或运行行为测试、浏览器专项或本地 E2E。现有 terminal-lifecycle 的同步帧回归通过 serialize 分隔 begin／end，只覆盖其原场景，不能作为本次修复的行为证据。

待远程补充并验收：同批完整帧后紧接未结束帧、连续计时、同批多帧、跨 chunk 控制序列、延迟动画帧、后台恢复和销毁；实际 Codex CLI 不点击持续计时与真实手机验收仍未执行。不宣称用户现场已恢复，不沿用历史 PASS。

## Regression coverage

Agent task-oriented coverage is planned in [AGENT_TASK_SCENARIOS.md](AGENT_TASK_SCENARIOS.md). Its 81 scenarios are design targets, not a claim that all are implemented or verified.

Agent regression inputs live with executable tests: backend cases in `tests/backend/agent-scenarios`, browser/API cases in `tests/e2e/specs/agent`, and shared mock-model inputs in `tests/e2e/fixtures/agent/regression-inputs.json`. Tests do not parse historical Markdown reports or generated live-run datasets. Raw live-model evidence is retained separately and is not a deterministic pass/fail oracle.

The 2026-10-05 regressions cover fractional memory confidence and file timestamps, file permissions, pre-execution Browser/Workspace rejections, bounded child deadlines, cleanup-safe completion evidence, cancellation settlement, recoverable resource quarantine, cross-tab Thread events, and awaiting-input snapshot restoration. Exact-output tests use a deterministic provider fixture; they do not prove a real model always follows “exactly once” tool instructions. The runtime loop guard bounds repetition but does not infer task completion from a single successful tool result. Real ACP/MCP/plugin services, optional toolchain downloads, extreme-number arithmetic and real-phone animation behavior remain separate environment/quality validation, not resolved product defects.

`specs/mobile/terminal-output-scheduling.spec.ts` defers new animation frames while keeping the page visible and the real SSH transport/timers running, then verifies output consumer credit advances, rows visibly update, successive ANSI timer ticks replace the previous line, and subsequent display/input recover. `specs/ui/terminal-lifecycle.spec.ts` mounts the real TerminalView/xterm with a controlled channel to exercise foreground/background drain before remount, split UTF-8, obsolete PTYs and interactions, stale history pages, slow history cursor reset, ordered background-to-foreground output, viewport recovery with deferred frames, and complete DEC 2026 frames followed immediately by an unfinished frame. The synchronized-frame regression fails without committing the completed frame before the next one reopens synchronization; a render deadline alone does not fix it. These cases do not prove real phone IME behavior, fully frozen browser progress, every physical-browser scheduling fault, or all Codex/OpenCode redraw sequences. `specs/mobile/keyboard-geometry.spec.ts` checks fitted rows, remote resize messages and direct xterm input across keyboard-sized viewport changes; it does not open a real system keyboard.

`specs/agent/event-catchup.spec.ts` exercises the production Agent subscriber with controlled WebSocket events: ordered backlog consumption, duplicate filtering, arrivals while consumption is paused, abort/unsubscribe and reconnect using the consumed cursor. It does not validate real backend durable repository replay or sustained slow-consumer memory bounds.

The editor encoding regression in `specs/ssh/file-preview-editor.spec.ts` checks exact saved UTF-16LE bytes including BOM after selecting LF, not only the success message.

SFTP write-watermark candidate (2026-10-04): changing the upload Writable high watermark from 4 MiB to 8 MiB reduced completion median from 4,439.1 ms to 2,303.2 ms in three disk-backed 16 MiB + 123-byte samples with 30 ms fixture WRITE delay (48.1%); peak pending WRITE rose from 7 to 15. No-delay medians were 482.1 / 492.2 ms with overlapping sample ranges, not evidence of a stable regression. All measured files matched exactly and pending WRITE returned to zero. Protocol regressions passed 5/5. `NEXUS_E2E_UPLOAD_MULTI_LARGE_WRITE_PROFILE=1` exercises four 10 MiB files at 50 ms WRITE delay, including progress hide/restore and complete content checks. `NEXUS_E2E_UPLOAD_LARGE_CANCEL_PROFILE=1` sends half of a 20 MiB payload before cancellation, preserves the original destination, checks temporary-file removal and pending WRITE convergence, then verifies a complete subsequent upload. Sending 10 MiB does not prove that Writable buffering reached its watermark at cancellation.

The larger watermark adds 4 MiB of nominal Writable buffering per active upload (24 MiB additional at six streams, 48 MiB at twelve), not a bound on total process memory. Multi-file correctness is not a measured RSS bound. The first large-cancel candidate run failed in final fixture control reset with `fetch failed / other side closed`; its artifacts are retained. After making this scenario's fixture-control requests use `Connection: close`, both 4 MiB and 8 MiB large-cancel cases passed once without retries or increased timeouts. This removes connection reuse as a variable in those samples but does not establish the original failure's root cause. The watermark candidate still requires repository checks/build and full fixed-SHA acceptance before deployment.

The upload backpressure polling candidate (2→4→8 ms instead of fixed 8 ms) was removed after three baseline and three candidate runs at 300 ms fixture WRITE delay. Completion medians were 41,420.1 / 41,422.4 ms, with browser high-water hits in only 2/3 / 1/3 samples. A single candidate drain observation of 13.1 ms is not evidence of repeatable polling benefit; sampled socket drain is not actual loop wait duration. Sustained/background backpressure coverage remains open.

The delayed file-picker upload probe accepts `NEXUS_E2E_UPLOAD_WRITE_DELAY_MS` (integer 0–750) to override the isolated fixture WRITE delay without changing the file source or production watermarks. A 300 ms calibration on the disk-backed 16 MiB + 123-byte file reached the browser 8 MiB high watermark, unlike previous 30 ms samples. Verify actual high-water hits in each measured sample; fixture WRITE delay is not network latency and a brief browser drain does not establish sustained backpressure or background safety.

Local production-candidate evaluation (2026-10-04): unchanged-checkpoint caching passed three resume samples but did not consistently improve request/response or tail-visible latency and was removed. One-chunk upload prefetch passed three disk-backed 16 MiB + 123-byte samples with exact bytes, but completion median changed from 482.1 ms to 500.8 ms and summed Blob-read median from 236.2 ms to 290.9 ms; it was removed. These small sequential samples reject retaining the candidates, not establish stable regressions or resolve prior browser OOM evidence. Input TextEncoder reuse was also removed: its original three-sample comparison had one reply-order failure and therefore no valid complete performance comparison. Controlled recovery reply-order checks are correctness evidence only, not optimization gains.

The mobile automatic-status-reply recovery case reports live/post-recovery input observation intervals and timestamps for resume requests, replayed queries, DSR replies and observed command enablement. UI interaction and polling are included; these timings do not isolate input encoding cost. The same visible query marker is delivered before and after recovery, so its presence alone cannot establish that the replay was processed or serve as a response-gating barrier. The default case holds the replay query until input is enabled and requires exactly one reply to that query. `NEXUS_E2E_INPUT_RESUME_RESPONSE_GATE=1` instead holds the real reconnect response until a cumulative `terminal.flow` acknowledgement covers the replay frame on the replacement socket: that query must produce no reply, including after activation. Both orders require a fresh post-activation query to receive exactly one reply and a user command to exit the remote loop. The earlier uncontrolled failure is retained as evidence of ambiguous delivery order, not counted as resolved real-device inability to type. Do not compare the controlled delivery orders as input-encoding performance results.

The long-list refresh case in `file-manager-navigation.spec.ts` accepts `NEXUS_E2E_REFRESH_DIRECTORY_DELAY=1` for 60 ms OPENDIR delay instead of zero. Each refresh must confirm the expected delayed-open count, retain sorting, final-entry accessibility and long-filename menu geometry checks, and reset the delay. Reported time includes sorting and scrolling until the target is reachable, not isolated directory-request latency. The external-deleted-directory path-sync case separately verifies refresh falls back to a valid ancestor. These condition comparisons do not establish production optimization gains. Set `M11_03A_EVIDENCE_DIR` to a run-specific directory under `/tmp/opencode` when retaining diagnostic artifacts.

The initial-connection capability profile in `suspend-resume.spec.ts` compares three normal connections with three fixture REALPATH-gated connections. Gated samples require an outstanding REALPATH before real shell output is requested; split printf arguments avoid a command-echo false positive. Connection response and shell round-trip intervals are reported separately, and released initialization must permit directory listing. This verifies optional filesystem initialization does not block initial shell use, complementing ready/error/closed suspended-recovery cases; it is not a production optimization before/after comparison or coverage of every optional capability.

The gated filesystem initialization recovery cases wait for server-reported suspended ownership `available` after closing the old socket before attempting another resume. Client socket closure alone is not the server ownership-release barrier; the earlier immediate-resume failure returned `SUSPENDED_SESSION_OWNED` and is retained as diagnostic evidence. Ready/error/closed outcomes still require real shell output while initialization is blocked. The reported gated timing includes fixture-state polling, not only resume response latency. These cases cover suspended recovery, not all initial connection capabilities.

The extensionless-file save step in `file-preview-editor.spec.ts` accepts `NEXUS_E2E_EDITOR_SAVE_DELAY=1` to inject 60 ms fixture WRITE delay instead of zero. It observes Save click through exact isolated destination content, resets the delay in cleanup, and retains editor reopening, encoding and line-ending regressions. Reported verification time includes UI interaction and polling, not isolated remote WRITE time or Monaco CPU. These small-file samples do not cover large text, save failure recovery or demonstrate an optimization before/after gain.

The repeated-refresh case in `file-list-profile.spec.ts` compares one/five synthetic DOM clicks under 300 ms OPENDIR delay, three samples each, correlating real list requests and responses and requiring new fixture files and the correct final directory. The existing UI navigation queue serializes refreshes, so five clicks must issue five requests with peak pending count one. This measures queue cost, not overlapping requests or a coalescing optimization. The earlier overlap assertion failed because its concurrency assumption was incorrect; changing the expectation follows the diagnosed serial navigation behavior, not a reduced correctness requirement. A production coalescing candidate still needs mutation-during-refresh and navigation-order evidence before adoption.

The browser marking case in `suspend-resume.spec.ts` accepts `NEXUS_E2E_SMALL_SNAPSHOT_PROFILE=1` for 200 output lines instead of 2,000. It reports actual serialized snapshot bytes and correlated prepare/commit send/response intervals, while retaining marked and unmarked shell-input checks. Output line count is not retained snapshot line count: terminal scrollback bounds the captured content. Click-to-frame and click-to-response intervals include UI scheduling, transport and server work, so this size comparison does not isolate serializer CPU or demonstrate production optimization gains.

The existing suspended-log reconciliation Agent scenario also compares 128 real 64 KiB appends with batch sizes 1/16, verifies streamed export hashes and deletion, and reports append completion and subsequent flush separately. Set `NEXUS_LOG_COMPACTION_PROFILE=1` to additionally preseed isolated physical files at 131/132 MiB, append 64 KiB, and compare append-plus-flush across the 132 MiB physical compaction threshold. Physical-size assertions and streamed 100 MiB export hashes preserve the public retention boundary. Use `TMPDIR=/tmp/opencode` for these diagnostic runs; the scenario removes only its own unique fixture directory. Uniform fixture bytes validate retained length/content but not ordering of distinct historical chunks. These disk-backed measurements do not establish PTY throughput, power-loss safety, queue stability at arbitrary output rates or production optimization gains; real marking/output/history recovery remains covered separately in `suspend-resume.spec.ts`.

ZIP diagnostics distinguish remote `transfer.compress` from backend-streamed directory downloads. `archive-cancel-recovery.spec.ts` compares three 0/100 ms remote command-delay samples for a 106,496-byte source, requires exact extracted content via `unzip -p` and remote process exit, and retains cancellation, concurrent isolation and failure recovery cases. `sftp-download.spec.ts` compares three 0/20 ms READ-delay samples for four 256 KiB files through the directory ZIP endpoint, verifies the exact entry set and every extracted byte, disposes HTTP responses and observes pending READ and remote handle convergence. The latter fixture is highly compressible, so it does not establish incompressible-data throughput, compression CPU cost, large-directory memory bounds or streamed-ZIP cancellation safety. Neither condition comparison is production optimization before/after evidence; remote command cancellation does not cover the independent HTTP ZIP owner.

The paused HTTP case in `download-admission.spec.ts` creates a 32 MiB fixture with bounded local buffers and hashes the HTTP body incrementally. It compares three normal reads with three real Node HTTP reader pauses of one second, under 20 ms fixture READ delay. At resume the client must have delivered zero bytes while remote response bytes are positive and below the full file size; remote bytes are also observed at 300 ms. Full length/hash, pending READ convergence and remote handle closure remain required, alongside the existing abort/admission recovery case. Partial remote reads beyond normal completion time support downstream backpressure, but two sampled counters do not establish a stationary queue, per-process memory bounds or exact cleanup timing. The earlier 8 MiB fixture fitted within the tested link buffers and did not enter the intended window; a 300 ms pause alone cannot distinguish backpressure from an unfinished ordinary transfer. This is behavior diagnosis, not production optimization before/after evidence.

`search-network-profile.spec.ts` compares wide, deep and skewed trees with 0/20/80 ms fixture OPENDIR delay and three samples per condition. Nonzero-delay searches must observe 25 delayed directory opens for wide/deep trees and 26 for the skewed tree. Exact complete results, the 500-result truncation boundary, missing-directory failure and subsequent successful search remain asserted. The skewed tree also has a 1,500 ms slow directory. This measures the existing traversal under directory-open waiting, not packet-level network latency or an optimization before/after comparison; sequential depth and slow branches remain dependencies. Nested cleanup resets both directory delays and closes the workspace socket.

`file-list-profile.spec.ts` compares navigation and local sorting for 1,000/5,000-entry directories with bounded rendered rows and reachable final entries. `NEXUS_E2E_DIRECTORY_OPEN_DELAY=1` injects 60 ms at fixture OPENDIR, not at each READDIR response; the `/sftp/readdir-delay` counter must confirm all delayed directory opens, including returns to the fixture root. This isolates directory-open waiting from the existing listing and UI costs; it does not emulate full-link latency or demonstrate production optimization gains. Cleanup resets the fixture delay.

Upload cancellation diagnostics in `upload-protocol.spec.ts` distinguish cancel response, observed terminal event, and verified convergence (pending fixture writes zero, temporary path absent, destination bytes preserved, and subsequent upload succeeds). Convergence timings include polling and content verification, not only backend cleanup. Pending-start cancellation waits for the fixture delayed-stat counter instead of a fixed sleep to establish entry into the metadata window. The existing `workspace/upload-idle-timeout` Agent scenario covers an injected short timeout with an isolated Writable; it does not establish real SSH behavior at the default five-minute idle deadline.

The slow-ACK batch case in `file-upload.spec.ts` accepts `NEXUS_E2E_UPLOAD_BATCH_CORES=1|4|8` to supply browser hardware capability before application startup without changing the production scheduler. Both 1 and 4 select the existing six-stream minimum; 8 selects a twelve-stream ceiling, with a ten-file batch limited by its file count. Diagnostics report actual peak upload sockets and time to all upload-ID-correlated completion events; all ten 64 KiB files are downloaded and compared byte-for-byte, and active upload sockets must converge to zero. The 750 ms per-WRITE fixture delay models a slow-ACK small-file batch, not bandwidth, low-core resource pressure, background scheduling, or large-file performance. Capability-condition comparisons are not production optimization before/after evidence.

`small-upload-profile.spec.ts` measures ready, send-to-final-progress, and final-progress-to-completed intervals with exact destination bytes and no upload `.part` residue. Its default conditions compare 0/60 ms WRITE delay. `NEXUS_E2E_UPLOAD_COMMIT_PROFILE=1` instead keeps WRITE delay zero and compares 0/60 ms STAT/LSTAT delay scoped to `/small-`, asserting actual delayed metadata requests through the fixture counter. These are protocol-observation intervals, not isolated backend CPU timings; metadata delay may affect both preparation and completion. `/sftp/stat-delay` accepts an optional `prefix`; without it the existing pending-start cancellation target remains the default. Both delays are reset and the workspace socket is closed in nested cleanup.

Upload read diagnostics in the delayed file-picker case wrap only slices of the selected filename, report per-chunk Blob read durations, and restore the browser methods in cleanup. `NEXUS_E2E_LARGE_UPLOAD_READ_PROFILE=1` selects a disk-backed 16 MiB + 123-byte file with no injected SFTP write delay and verifies exact bytes directly in the isolated SSH fixture; it omits binary frame decoding/storage and the additional browser download, but CDP events still incur overhead. `NEXUS_E2E_UPLOAD_FILE_READER=1` substitutes FileReader only inside the test probe for a same-condition candidate comparison, not in production. Browser OOM/crash samples are failed evidence, not valid timing medians. Page destruction skips obsolete CDP detachment while fixture delay reset still runs; the normal-path regression does not establish crash-cleanup coverage.

With large-upload profiling, `NEXUS_E2E_UPLOAD_BACKPRESSURE_PROFILE=1` injects 30 ms per SFTP WRITE instead of zero delay. A test-side WebSocket send wrapper and 4 ms sampler observe actual upload socket buffered bytes without modifying the queue, thresholds, or production waiting policy. High-water samples are observations, not distinct backpressure transitions; drain intervals measure sampled time from at least 8 MiB to at most 2 MiB (or socket closure), not exact production wait time. The fixture `/sftp/write-delay` response also reports WRITE request count, requested bytes, current pending requests, and peak pending requests since fixture reset. Counts are fixture-wide, so byte assertions require an otherwise idle, reset fixture; requested bytes do not establish write success without exact destination-byte verification. These diagnostics cover foreground successful transfers, not cancellation, background scheduling, or failure recovery.

For input recovery, run `--project=mobile specs/mobile/suspend-resume-ui.spec.ts --grep 'foreground probes|recovery'`. Healthy foreground probes must not reconnect; dropped probes recover the same Workspace without fresh login. Recovery gates automatic terminal status replies, then handles server replay and fresh queries. The post-recovery shell marker is split to prevent input echo from satisfying it. Synthetic foreground events and a routed WebSocket do not reproduce real device suspension, OS OOM, or establish the cause of an incident on a deployed server.

The bounded-window resume UI case also reports click-to-resume-request, response, and success-message observation separately. Compare three samples normally and with `NEXUS_E2E_RESUME_FILESYSTEM_GATE=1`; the latter verifies a pending fixture REALPATH request before releasing it after terminal activation. These observations include browser scheduling and Playwright polling, not pure activation CPU time. Both modes retain historical content and post-history shell-result assertions; release the fixture barrier in cleanup.

`specs/ssh/suspend-resume.spec.ts --grep 'initialization is gated'` uses the isolated SSH fixture's REALPATH barrier and pending-request count to prove that SFTP initialization is actually blocked. Before releasing it, resume must acknowledge committed ownership and a real shell command must produce its result. The scenarios then verify filesystem ready, filesystem permission failure without terminal loss, and close-before-release followed by a second successful resume. This protocol evidence does not measure browser paint or prove every cause of a delayed connecting indicator on a real device.

The delayed file-picker case in `specs/ssh/file-upload.spec.ts` observes upload WebSocket binary-frame timestamps/byte totals and the completion event through browser CDP, while retaining exact remote-byte verification and target refresh. Use `--grep 'file picker uploads a delayed file' --repeat-each=3` for independent samples. Its 786,555-byte payload does not exercise the browser's 8 MiB bufferedAmount high-water threshold. Frame timestamps are send observations, not remote write acknowledgements; completion time includes fixture per-SFTP-write delays, verification, and commit rather than isolating any one phase. No upload chunk/buffer settings or timeouts are changed by this diagnostic.

Directory and search result snapshots use shallow reactive array replacement, not per-entry reactive metadata mutation. Validate this path with `specs/ssh/file-list-profile.spec.ts`, `specs/ssh/file-list-sort.spec.ts`, and `specs/ssh/file-manager-navigation.spec.ts`, retaining remote refresh, replacement search results, natural sorting, and virtualized last-entry access. Compare diagnostic timing samples without adding speed thresholds; frame scheduling and fixture metadata overhead can obscure gains, particularly for smaller lists.

The bounded-window UI history case in `specs/ssh/suspend-resume.spec.ts` logs resume-click-to-visible-tail and, separately, real shell round-trip time after history browsing and returning to the live tail. It does not report a combined click-to-usable duration across the intervening browsing steps. The round-trip output marker is split in the command so echoed input alone cannot satisfy the output assertion. Existing lazy paging, earliest-history access, return-to-live-tail, and cursor-reset checks remain before sending the new command, which changes the terminal state. Use `--grep 'resumed terminal pages older history through a bounded window' --repeat-each=3` for independent samples. Measurements include Playwright actions/polling and local fixture behavior; DOM text visibility is not a compositor paint measurement, and these samples do not cover mobile, background tabs, or weak networks.

The interactive suspend-mark case in `specs/ssh/suspend-resume.spec.ts` produces 2,000 real shell output lines before marking through the UI, then observes outgoing snapshot byte counts and click-to-request/click-to-response times for both `suspend.prepare` and `suspend.commit` through browser CDP. It retains attached-tab interactivity and unmark/live-shell checks. Use `--grep 'marking suspend keeps the UI tab interactive' --repeat-each=3` for independent samples. Click-to-request includes UI scheduling, pending-output drain, and serialization; commit timings also include the preceding prepare phase and are not isolated serializer CPU time. This does not measure recovery painting or prove preservation of every snapshot line.

The cached-tail/history-paging case in `specs/ssh/suspend-resume.spec.ts` logs submission of a preconstructed 665,650-byte snapshot, resume response time, and per-page bytes/latency. It verifies retrieval of all 5,200 fixture lines, cursor reset replay consistency, and bounded small-page reads. Use `--grep 'resume sends only the newest cached tail' --repeat-each=3` for independent samples. These are local protocol diagnostics, not browser snapshot serialization/rendering measurements or public-network guarantees; no additional timing thresholds are imposed.

The sustained-output case in `specs/ssh/terminal-ui.spec.ts` retains parser-consumption and subsequent real shell round-trip assertions while logging command-to-visible-completion time, cumulative `terminal.flow` acknowledgements, and browser long tasks. These diagnostics do not isolate parser time, identify the function responsible for a long task, or prove byte-for-byte output integrity. For three independent performance samples, run the case with `--grep 'terminal parser acknowledges sustained output' --repeat-each=3`; timings are not pass thresholds. This profile does not cover background tabs, reconnect, snapshot serialization, or history paging.

`specs/ssh/file-list-profile.spec.ts` measures real SFTP-backed navigation to the first visible row and browser sort-to-paint over three samples for 1,000/5,000 entries. It checks bounded rendered rows and access to the last entry after scrolling, without timing thresholds. The SSH fixture returns at most 128 entries per `READDIR` response until EOF rather than emitting one potentially oversized NAME packet. Fixture OPENDIR still performs sequential local metadata reads, so navigation timings are not ordinary SSH-server performance guarantees. The profile does not isolate network, decoding, reactive sorting, and rendering costs.

`specs/ssh/file-list-sort.spec.ts` verifies natural numeric/multilingual name ordering, case-insensitive equivalence, and directory precedence in both directions through a real SFTP-backed File Manager. Browser-local comparator profiling compares 1,000/10,000 names over three samples and checks identical complete ordering; timings are diagnostic, not CI speed thresholds or end-to-end large-directory latency guarantees. Run alongside `specs/ssh/file-manager-navigation.spec.ts` to retain refresh, navigation, long-list actionability, and terminal path-sync regression coverage.

Actions run `37180354883` failed the real GitHub remote-theme list in shard 8: Playwright trace recorded local HTTP 400 with `Request failed with status code 403` from upstream on both attempts. Upstream body/rate-limit headers were not retained, so rate limiting is not a confirmed cause. E2E shards now receive the workflow's read-only `GITHUB_TOKEN` for the existing authenticated GitHub catalog path; real list/search/download/apply assertions remain. List failures include local status and response body. Local theme UI regression passed 10/10, but workflow-token behavior requires a new complete remote run; this is not acceptance of the failed SHA.

The preparation recovery fixture also requests a valid sibling alongside a blocked parent: the valid directory must remain after failure, and reusing the prepare ID after fixing the parent must succeed. This exercises acknowledged partial success without destructive rollback. The Agent preset-plugin E2E remains part of local regression because the known-failure settlement branch touches the shared mutation guard.

Upload preparation executes sorted depth layers: all workers in a parent layer settle before starting a child layer, with up to eight workers and no new tasks claimed after a failure is observed. A metadata-acknowledged non-directory is a typed conflict; only preparation whose failures are exclusively these conflicts, after all started work drains, reports a known failed mutation that can release its lease. Other failures and lost leases remain conservative quarantine cases; this does not clear pre-existing quarantine. Recovery coverage reuses the same prepare ID after fixing a blocking file. A separate fixture connection exercises denied LSTAT followed by `RESOURCE_QUARANTINED` even after denial removal. Layered candidate nested preparation measured about 1386ms at 80ms operation delay; it does not prove disconnect/mixed-error safety or cancellation during preparation.

`ssh/upload-prepare-profile.spec.ts` measures existing, new sibling and nested directories with three samples at 0/80ms fixture STAT/LSTAT/MKDIR delay, verifies every requested directory, and attaches operation counts. Internal scheduling adds at most one direct parent per requested path before sorting; the prepared destination allowlist and its capacity accounting retain only explicitly requested directories plus the base. At 80ms, 32 nested children under eight parents measured about 1796ms before versus 1388ms after; metadata requests increased from 45 to 50 and mkdir stayed at 41. This trades extra checks for shorter scheduling waits, not fewer I/O operations or a full-WAN speed guarantee. Boundary coverage rejects implicit-parent, sibling and outside-base upload destinations, recovers the same prepare ID after a file blocks the parent path, and starts/cancels an allowed upload with no temporary residue. It does not cover permission failures, mid-prepare cancellation or every capacity boundary.

Corrected-fixture local regression passed 24/24 across small upload, search profiles, download profiles, upload protocol, download admission and binary-read limits. Search median milliseconds (three samples) for wide/deep/mixed-slow trees were 11/27/1504 at 0ms, 96/564/1546 at 20ms, and 335/2067/2067 at 80ms OPENDIR delay. A 1.5s slow directory still sets the mixed-tree completion floor; refill overlaps independent work but cannot eliminate that wait. Current download median aggregate throughput was approximately 74.5MiB/s locally, 35.3/11.3/4.83MiB/s at 20/80/200ms READ delay, and 40.0MiB/s for four streams at 80ms. These are current-implementation measurements, not a fair corrected-fixture before/after comparison or production performance promises.

The test SSH server explicitly enables `TCP_NODELAY`. An isolated 4KiB upload comparison (three samples per 0/60ms WRITE-response delay) found total medians of 447/506ms before versus 12/73ms afterward, with exact remote bytes and no temporary-file residue. This is a fixture transport correction, not a production upload optimization: the production SSH client already enables `TCP_NODELAY`. Earlier download/search throughput and absolute timings measured the former fixture including its small-packet transport behavior and must not be generalized to ordinary SSH servers. Re-measure on the corrected fixture before attributing further bottlenecks to production code. WRITE-only delay is not full-link RTT; timing profiles are investigative evidence, not latency SLAs.

Suspended-log append creates the storage directory when initializing a per-log writer rather than on every chunk. The local 2048-append investigation (three samples, 256B/4KiB/32KiB chunks, exact length and SHA-256 verification) measured median adapter times of 165/171/234ms before and 109/114/177ms after; these are local microbenchmarks, not end-to-end recovery guarantees. `mobile/pad-suspended-output.spec.ts` and `mobile/suspend-resume-ui.spec.ts` cover real detached output exceeding retained history, compaction/history recovery and the original-shell resume path. They do not prove behavior if an external process deletes the storage directory while a writer is active, or disk-full durability.

The Pad detached-output cases verify touch-history progress relative to the first visible numbered history line, then require `PAD_HISTORY_000` to become visible and the live shell marker to leave the viewport without scrolling the page. They do not assume a fixed pixel drag reaches a particular line: measured terminal row height, wrapped command echoes and shell notices affect that position. Original-shell identity and the real 112 MiB detached output remain required for both line logs and single-line output.

Child Browser independent-cancel coverage fences the live-context case at the provider's post-tool model wait before reading the delegation version; context allocation alone is not a tool-settlement barrier. The creating case uses the Browser creation barrier. Both assert that a stale version is rejected with `409 DELEGATION_VERSION_CONFLICT`, then require current-version cancellation to return `202` with `cancelled`; no conflict retry is used. This addresses the test synchronization gap exposed by Actions run `37177979514`, not a relaxation of production optimistic-version checks.

`ssh/search-network-profile.spec.ts` compares three samples of 24 sibling directories, a 24-level chain, and that chain alongside a directory delayed by 1.5 seconds, under 0/20/80ms OPENDIR delay. Every sample checks exact relative-path sets and no truncation. It also verifies the 500-result bound with unique scoped paths, missing-root failure and a successful complete search afterward. Controlled response delays measure refill scheduling, not full WAN behavior; deep-tree parent discovery remains sequential. The current profile does not prove the 5000-directory ceiling, subtree permission-error handling or physical-device UI latency.

Download network profiles use 4MiB per stream except the 2Mbps profile, which uses 2MiB: 4MiB at that configured rate necessarily exceeds CI's existing 15-second HTTP deadline. The smaller sample still spans two full prefetch windows; request timeouts are unchanged. Network-profile cleanup waits for fixture-confirmed pending READs to reach zero and requires successful configuration reset so an aborted request cannot contaminate the following profile.

`ssh/reconnect-ui.spec.ts` also exercises hidden-page terminal consumption with animation-frame callbacks suspended and retained until visibility is restored. More than 1.2 MB of real SSH output must be acknowledged while hidden; on return the terminal must display the completion marker and accept input on the original shell without another Workspace connect. Hidden terminals use timer-based output batches with the existing byte threshold rather than relying on animation frames. This deterministic case does not simulate full browser process freezing, prove long-duration timer-throttling behavior, or cover every detached-view replay boundary.

Change coverage is counted by production change, not by test-case count. Mutation Origin/Fetch Metadata has eight HTTP cases and Webhook secret editing has seven HTTP cases plus its UI delivery flow; these represent two production changes, not fifteen.

The following mapping groups fifteen production changes with their behavioral E2E entrypoints. Acceptance requires the exact pushed revision's canonical Actions workflow to pass checks/format/build, all eight Playwright shards, and all three Docker smoke modes. Local results are preflight diagnostics only. A passing suite does not imply coverage of behaviors absent from these assertions.

| Production change                          | Behavioral coverage                                                                                                                                                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTTP mutation Origin / Fetch Metadata      | `http/mutation-origin.spec.ts`, `agent/provider.spec.ts`: matching public/direct Origins, denied foreign/opaque/path Origins, metadata rejection and unchanged settings                                                                           |
| Webhook secret header editing              | `http/webhook-secret-contract.spec.ts`, `ui/notification-settings.spec.ts`: redaction, preserve/replace/remove, rejected edits and actual outbound credentials                                                                                    |
| Effective Proxy credential validation      | `http/architecture-contracts.spec.ts`: password/key null or empty rejection, metadata atomicity, omission preservation and no credential reuse after switching to none                                                                            |
| SSH Key mutation audit                     | `http/architecture-contracts.spec.ts`, `http/ssh-key-audit-failure.spec.ts`: mutation audit actor/source and field names without credentials; rejected edit preserves state and emits no success audit, subsequent rename succeeds                |
| HTML theme content response isolation      | `ui/html-theme-security.spec.ts`: real direct navigation displays source, restrictive response headers and no script/localStorage side effect; remote upstream response remains outside this assertion                                            |
| Connection tag atomic replacement          | `http/architecture-contracts.spec.ts`: duplicates, invalid/oversized batches, missing targets, preserved associations and explicit empty replacement                                                                                              |
| Quick Command bounded tag batches          | `http/architecture-contracts.spec.ts`: duplicate IDs, raw oversized/invalid input rejection, no partial association and subsequent valid assignment                                                                                               |
| Active terminal theme deletion             | `http/architecture-contracts.spec.ts`, `ui/custom-terminal-theme.spec.ts`, `http/terminal-theme-deletion-isolation.spec.ts`: active reference cleared and visible fallback; inactive/repeated deletion preserves selected theme                   |
| Password-bound session invalidation        | `websocket/authenticated-session.spec.ts`, `ui/change-password.spec.ts`: established socket revoked, old HTTP session rejected and new-password login restores capability                                                                         |
| Logout revokes established WebSocket       | `websocket/authenticated-session.spec.ts`: live ping before logout, server closure, HTTP 401 and rejected new upgrade                                                                                                                             |
| Bounded Workspace binary read              | `ssh/binary-read-limits.spec.ts`: strict budgets, admission recovery, duplicate-ID ownership, pending-OPEN cancellation, in-place growth bounds and remote handle CLOSE on consumer disconnect before/after acquisition                           |
| Archive cancellation exit evidence         | `ssh/protocol.spec.ts`, `ssh/progress-display-archive-cancel.spec.ts`, `ssh/archive-cancel-recovery.spec.ts`: remote exit evidence, task retirement, concurrent cancellation isolation, extraction round trip and missing-source failure recovery |
| Fresh SSH Shell listener rebinding         | `ssh/reconnect-ui.spec.ts`: outage/reconnect with fresh prompt and executable output under the same Workspace ID                                                                                                                                  |
| Cross-source credential trust confirmation | `ssh/progress-display-baseline.spec.ts`: Send Files requires public trust confirmation before real task submission and progress assertions                                                                                                        |

Webhook secret coverage reads redacted automatic/custom credential headers, preserves `null` secrets through a real UI save, replaces them, then removes their entries. Each stage sends a saved-channel test to a strict fixture receiver that checks actual outbound credentials without logging or retaining them.

Additional production-change mapping: SFTP upload pipelining and download prefetch (`847bb4f2`) is exercised by `ssh/upload-protocol.spec.ts`. With real remote WRITE/READ latency, the test requires bounded throughput and byte-identical full downloads, unaligned ranges, suffix ranges and open-ended ranges crossing prefetch windows through EOF. An out-of-bounds range must return 416 with the exact unsatisfied Content-Range, followed by a successful full download. Cancellation waits until multiple actual remote WRITEs are pending, then requires public cancelled state, remote writes draining to zero, temporary-file removal and preservation of an existing destination; a subsequent upload on the same Workspace must complete with exact bytes. This does not claim rollback of already committed uploads, a content snapshot under concurrent remote edits, or download-disconnect handle reclamation.

`ssh/download-network-profile.spec.ts` measures three samples per isolated SFTP READ profile: no added latency, 20/80/200ms response delays, shared 100/10/2Mbps response bandwidth and four concurrent downloads at 80ms. Each stream verifies length and SHA-256, disposes its HTTP response, and checks remote delivered bytes and pending READ settlement. Attachments include durations, per-stream/aggregate throughput, request count and peak pending requests. Comparisons require identical test harnesses; no universal speed threshold is inferred. Fixture response delay/rate shaping is not full network RTT, packet loss, TCP retransmission or browser-to-backend throttling.

`ssh/download-admission.spec.ts` fills all eight GET slots with fixture-confirmed pending OPENs, rejects excess authenticated and ticket requests with 429, and verifies HEAD at capacity. Aborting consumers must close all late-acquired handles, then eight downloads and the previously rejected ticket must return identical bytes. Resource CLOSE settlement is observed before subsequent sequential missing-file failures and recovery; neither remote CLOSE nor receiving Content-Length bytes alone establishes handler admission cleanup. Directory ZIP cancellation and other transfer phases are not covered by this case.

The Webhook case-collision regressions submit an explicit replacement and a differently cased `null` entry in both orders while removing custom secret classification. They require rejection before persisted mutation, no old secret in the response, unchanged redacted configuration and successful outbound delivery with the original credentials. Create and unsaved-test entrypoints also reject case collisions without persisting a channel. Mixed-case preservation with a single entry remains supported.

The Agent Provider fixture handles semantic handoff requests separately from normal tool scenarios, emitting all eight required sections. The installed-plugin continuation must complete successfully after retained Skill history triggers context compaction, before inline approval is exercised.

Provider discovery verifies both direct-backend and public-frontend same-Origin mutations, rejects a mismatched Origin, and rejects cross-site Fetch Metadata even with an otherwise matching Origin; all Agent rejections preserve the standard error envelope.

The SSH outage regression checks the fresh shell prompt and executable input after reconnecting the same logical Workspace ID; fresh connections replace ended-shell listeners and terminal replay/input state rather than reusing stale bindings.

The no-Workspace-tool fixture assertion is scoped to the latest user input too: subsequent Runs on the same thread can explicitly select SSH Hosts and request approval without inheriting the earlier no-target fixture scenario.

The retired Agent Runner Journal recovery, Runner process-tree kill fixture and standalone deployment smoke are no longer part of the current E2E suite. The supported production Docker acceptance is `scripts/e2e/docker-core-no-runner-smoke.sh`, and SSH session/job interruption plus Backend restart recovery are verified through their independent current Agent/SSH regressions. Historical Runner evidence is not a current test result.

Send Files regression coverage accepts the public credential-transfer trust confirmation before checking task submission, while keeping the held initial-list race and independent form-loading assertions.

Skill fixture scenarios are selected from the latest user input, not retained historical scenario markers; initial metadata-only exposure and explicit `skill_read` body checks remain enforced.

The deleted Runner Journal corruption fixture is not an active deployment check. Current production Docker smoke verifies the Backend/Frontend/Guacd stack and absence of the retired Agent modules; other current SQLite corruption/recovery checks must be interpreted separately.

The SSH exec fixture handles supported SSH signal requests against its command process group and reports actual exit status or exit-signal. Archive cancellation checks require remote exit evidence rather than channel closure alone.

The direct archive cancellation/recovery regression waits for a real held compression process to start before cancellation. On the cancelled terminal event it requires that process to have exited, checks the retired task no longer accepts cancellation and the held destination does not exist, then completes a subsequent compression and checks its output metadata. This does not establish rollback for archives that have already written partial output.

The concurrent archive regression starts two held commands in one Workspace, cancels only one and requires the other process to remain alive. After releasing the hold it checks the second archive completes, removes the unique source fixture, decompresses the surviving archive and compares the restored bytes exactly. Cancellation isolation is not inferred from progress UI or file existence alone.

The missing-source archive regression requires a failed terminal event, retirement of the old cancellation handle and absence of the requested destination, then verifies a subsequent compression completes and returns a ZIP header through binary read. The header check is not a full archive integrity check; the concurrent regression above supplies an extraction round trip.

Direct Workspace binary-read regressions require a numeric safe-integer `maxBytes` ceiling and reject coercible strings, booleans and arrays. Delayed real SFTP reads fill all four admission slots, reject a fifth read, then cancel every admitted read and verify four subsequent reads return identical bytes. A duplicate request-ID regression verifies that rejecting the duplicate preserves the original read's cancellation handle and confirms its aborted result before a successful subsequent read. Three batches of four missing-file reads verify stream-acquisition failures release admission, followed by four successful byte-identical reads. A fixture-confirmed pending SFTP OPEN is cancelled before its delayed reply; the read must abort, retire its cancellation handle and allow four successful byte-identical reads afterward. The growth regression appends to the same fixture file after a confirmed delayed SFTP READ: the existing read returns only its original size-bounded range, reopening with the old budget fails with a size-limit error, and reopening with the exact new budget returns all bytes. This does not promise a content snapshot for concurrent edits; other concurrent edit races remain outside these assertions.

The pending-OPEN disconnect regression confirms the fixture received SFTP OPEN before closing the Workspace WebSocket, then requires one additional read-only handle open and one additional successful SFTP CLOSE. It covers delayed acquisition after consumer disconnect, not SSH transport loss, channel shutdown cleanup or all remote handle lifecycles.

The pending-READ disconnect regression confirms the read-only handle is already open and not yet closed, and the fixture has received a delayed SFTP READ. Closing the consumer WebSocket must then produce a successful remote CLOSE for that handle. A new Workspace on the same SSH connection must also read a unique fixture back byte-for-byte. Together these two regressions cover consumer disconnection before and after acquisition; they do not establish cleanup under SSH transport loss or reconnection of the same Workspace.

The suite intentionally keeps regression tests for previously fixed production issues, including:

- quick-command tag batches reject missing command references in either order and missing tags with 404 / `QUICK_COMMAND_TAG_REFERENCE_NOT_FOUND`, leave no partial associations and permit a subsequent valid assignment;

- desktop Dashboard keeps the Recent Activity section reachable in the initial common viewport while connection/resource panels own their scrolling;
- Quick Commands preserve text-only group rename, header-area expand/collapse, and narrow-pane toolbar scaling without horizontal overflow;
- File Manager path history and favorite-path popovers keep rounded themed chrome, wrap long paths, resize with the viewport, and remain inside viewport bounds;
- unified document search keeps rounded themed controls, while spreadsheet pagination is absent when the active sheet fits on one page;
- first SSH directory change waiting for the initial real shell prompt;
- extensionless text files opening and saving through the editor;
- streamed previews for Unicode image names, Markdown, and XLSX files, plus stale symlink failure isolation;
- cross-session copy and two-phase move semantics with transfer progress;
- real SFTP navigation uses the actual list scroll container and rendered filename label to verify long-list scrolling, truncation, sorting, popup resizing and path history; shared Progress Display helpers distinguish the tab-bar manager from the per-session restore button and use task state, named actions and rendered source cards;
- terminal-tool regressions exercise terminal search, clear-and-redraw, command-history replay and saved quick-command execution through the rendered terminal and command controls; hidden upload progress verifies the visible fractional percentage beside its progress bar;
- document preview coverage uses the active document mode, named preview tabs, PDF toolbar and spreadsheet pager to verify cached state, close/hide behavior, single content scrollbars, external refresh and persisted pagination limits;
- file preview/editor scenarios retain real remote-content, encoding, line-ending, search, database-table and resize assertions using existing editor controls and preview semantics;
- connection creation coverage uses named actions, saved connection cards and inline test results while verifying real SSH authentication, credential-preserving clones, script imports and filtered bulk tests;
- batch connection editing verifies persisted notes, failed-item selection after partial updates, lazy auxiliary catalogs and narrow-screen row selection through existing cards, switches and modal controls;
- SSH key management coverage uses named dialogs and actions to verify file import, name-only edits, saved-key/password authentication switches, delete recovery and narrow-screen loading errors without exposing private-key details;
- password-change coverage uses the Security heading, associated password labels and named submit action to verify local validation, rejected current credentials, cleared inputs, old-session rejection and real login with the changed credential before restoring the test account;
- audit-log coverage uses the page heading, named filters, durable audit row identities and pagination navigation to verify combined filtering, filter persistence across pages and narrow-screen detail scrolling;
- quick-command management uses the rendered panel, named dialogs and row/context actions to verify persisted creation/edit/deletion, live SSH execution and usage counts, dialog resizing/reset and usable flat commands when the tag catalog fails;
- SSH reconnect coverage observes Workspace protocol requests, rendered terminal geometry and named connection-picker controls to verify initial failures, periodic/key-triggered recovery, hidden sessions, HTML backgrounds and mobile tab lifecycle;
- saved connection lifecycle coverage verifies real SSH tests before and after a name-only edit and confirmed deletion from both the visible list and persistence using named card/form actions;
- collapsible quick-command search coverage verifies default visibility, group-save persistence, search focus/Escape behavior and centered controls across sidebar widths using the existing panel and named controls;
- file upload scenarios verify clipboard/file-picker/folder uploads, remote bytes, conflict decisions, delayed SFTP acknowledgements, stream concurrency and hidden progress restoration/cancellation through existing file-manager and progress controls;
- hidden upload batch cancellation waits for every remaining row to reach a terminal state or for the empty-progress surface after automatic record cleanup; a cancelling action is not treated as cancellation completion;
- custom terminal theme and Workspace tag-management scenarios use current editor, token-input and named manager controls while retaining theme persistence/deletion and narrow-screen tag association assertions;
- backup and IP-control scenarios verify real export/import and persisted blacklist policy through named settings controls; mobile touch coverage retains RDP mode persistence without reconnect, live SSH Ctrl input, dormant progress, single-tap navigation and multi-select/editor behavior using current product surfaces;
- notification channel and tagged quick-command scenarios retain persistence, narrow-screen geometry and live SSH variable substitution through current controls; suspended-history recovery waits for available ownership, and fullscreen checkpoint scenarios synchronize with real shell readiness before freezing terminal state;
- multi-megabyte SFTP uploads completing every block before success;
- SSH suspend/disconnect/resume lifecycle;
- mobile terminal height, command-bar sizing, touch long-press context menus, and the status-monitor modal;
- settings regressions locate IP whitelist and logging forms through their labelled controls and verify persisted API values; appearance title-bar tests use the accessible color textbox and document theme state;
- dark/default UI theme switching and legacy input-token normalization use the rendered appearance editor and named Dashboard controls, while retaining contrast, persistence and viewport assertions;
- desktop and mobile no-session Workspace coverage verifies the unified start page, both connection and suspended-session panels, and page-owned vertical scrolling without horizontal overflow;
- mobile global navigation remains horizontally swipeable when constrained while its native scrollbar track/thumb stays hidden;
- mobile terminal long-press selection suppresses the xterm helper textarea's soft-keyboard focus during hold/menu/copy, restores its input attributes after Copy without refocusing, and restores normal focus on a later short tap;
- Workspace layout configurator direction rendering, including horizontal sibling alignment and vertical child stacking in the editor preview;
- narrow File Manager presentation collapsing secondary metadata columns, keeping the type icon close to the filename without horizontal overflow, and centering a deliberately delayed directory-loading spinner in the remaining list area;
- Quick Commands keeping Copy/Edit/Delete in the row context menu with the duplicate inline three-button strip absent;
- desktop no-session Workspace connection-pane divider resizing and persisted width restoration;
- status-monitor network samples and Docker status over the live SSH transport;
- full encrypted backup export/import restoring settings and encrypted connection credentials, with the retired standalone connection-export UI/API kept absent and the backup file picker retaining rounded themed chrome;
- legacy official HTML-theme repository URLs resolving to the current remote catalog instead of returning a missing-directory 400;
- HTTP SFTP download-ticket/Range/inline/directory-ZIP behavior bound to an active Workspace session;
- raw binary upload ready/progress/completion and remote-content verification through the clean Workspace/upload protocols;
- real Login CAPTCHA fail-closed/token lifecycle and browser WebAuthn passkey success/credential-failure/password-fallback surfaces.
- TOTP 2FA setup, login gating, verification, and disable lifecycle;
- historical database startup applying connection migrations, including migration 20 normalizing legacy proxy-route rows without `proxy_id` while preserving real proxy references;
- connection update/clone/delete with preserved encrypted credentials and tag associations;
- RDP/VNC conditional forms and filtered bulk selection/deletion use named controls and connection cards, with API checks for saved connection fields and exact deletion results;
- command-history search, clipboard copy, replay and individual deletion are exercised through real SSH output and persisted history IDs;
- notification delivery tests use localized Add/Test controls and real webhook/SMTP receivers to verify unsaved delivery, localized event content, HTML email and persisted channel error recovery;
- Agent Host coverage verifies launcher passivity, cached conversation visibility, user-scoped layout reset including launcher docking, provider controls and expanded batched tool-call details through existing labels and tool-name state;

For optional focused local browser debugging, install Chromium when the host already has (or can install) the required system libraries:

```bash
pnpm install --frozen-lockfile
pnpm --filter @nexus-terminal/e2e exec playwright install chromium
```

On Linux hosts that do not already contain Chromium system libraries, Playwright may require root privileges for `playwright install --with-deps chromium`.

## Test reset baseline

Each run uses `tests/e2e/.tmp/backend-data` through `NEXUS_DATA_DIR`. The backend database, generated environment data, and file-backed sessions therefore never touch `packages/backend/data`.

Normal E2E specs use `tests/e2e/fixtures/seeded-data/nexus-terminal.db` as their known baseline. In GitHub Actions, every matrix group runs in its own isolated runner/container and copies this committed seed into that runner's `.tmp/backend-data`, so groups never share a runtime database. The backend exposes the E2E reset endpoint only when both `NODE_ENV=test` and `NEXUS_E2E_RESET_ENABLED=1` are set. Before every E2E test case, the fixture restores the database from the declared baseline, clears file-backed sessions, and resets the isolated SSH test server state. Normal cases use the committed seeded database; the first-run setup case explicitly selects an empty database. No test case depends on database state produced by another case, so any case can be selected directly and every CI group can start independently.

Vite also uses an E2E-specific cache directory so local dependency-cache permissions do not affect the test server.

Runtime databases, reports, traces, screenshots, videos, logs, PID files, caches, and test-installed `node_modules` are ignored by Git.

## 阶段逻辑回归

每个涉及行为的代码阶段按改动范围规划并执行逻辑回归，覆盖实际实现及消费者；格式、类型和 build 通过不能替代业务断言。内部重构也核对原有结果与失败语义，不只确认接口仍可调用。

- 正常与边界：核对输入/输出、状态转换、容量临界值、分页和资源归属等受影响行为。
- 失败与副作用：核对拒绝、冲突、异常、回滚/未知结果，既检查返回结果，也检查持久数据或资源是否符合预期。
- 并发与生命周期：改动涉及幂等、版本、generation、取消或关闭时，验证重复调用、晚返回及清理路径；不只测顺序成功。
- 消费者一致性：契约、错误或共享类型改变时覆盖实际双端与跨模块消费者；旧 Backend 的通过不能证明 backend-next，新 transport 的单测也不等于真实浏览器验收。

优先选择既有单元、集成或专项用例，以能验证该风险的最小范围执行；必要时在现有测试结构补充缺失场景，不新建镜像实现或只读取源码文本的测试。外部服务可在适用技术边界使用隔离 fixture；真实 SSH/浏览器及故障注入专项保持单独验收，不把模拟结果扩写成实机保证。

每阶段记录场景、被验代码/消费者、实际命令、分支/SHA/工作区、退出结果及未覆盖项。已知失败本阶段修复，修复后重跑受影响用例；仅文档/纯格式且无行为变化可记不适用并说明依据。用户明确限定测试范围或环境阻断时保留未验证状态，不宣称逻辑回归通过。本要求不自动启动全量 E2E 或改写历史证据。

## Engineering constraints

### 2026-10-10 重构检查点

核验范围为 `refactor/backend-storage-v1`、基线 `d3c1f28c3da2af52cf919b5e7d68c72971613e15` 加本次提交前工作区。实际工具为 `/usr/local/bin/node` v22.23.1、`/usr/local/bin/pnpm` 11.26.0；`.node-version` 的滚动 `node` 不等于固定安装版本。

以下静态检查实际退出 0：Shared check、Backend-next check/build（包含 Shared build）、Frontend build、根 `pnpm run check`（包含前端类型检查）、`pnpm run format:all:check`、`git diff --check`。本机原始输出在 `/tmp/nexus-release-{check,build,format}.log`，临时日志不作为长期可用附件。

以下命令实际退出 0，均使用临时数据库或本机隔离 fixture：

```bash
node tests/backend/storage/backend-next.integration.mjs
node tests/backend/storage/backend-next-phase2.integration.mjs
node tests/backend/storage/backend-next-public-boundary.integration.mjs
node tests/backend/remote/backend-next-transport.integration.mjs
node tests/backend/remote/backend-next-ssh.integration.mjs
```

覆盖 SQLite 事务/迁移、凭据及公开投影、跳板成环拒绝后的元数据/版本回滚、登录失败并发计数与封禁边界、Agent 状态幂等/冲突/权限/分页，以及 WS 队列/EOF/ACK/关闭失败和隔离 SSH Host Key/凭据失败映射。新增 phase2 场景通过记录在 `/tmp/nexus-release-phase2-expanded.log`；其余输出对应 `/tmp/<测试文件名>.log`。测试 fixture 初始化及 UUID 输入已修正后重跑通过。

没有执行浏览器、外部 SSH/SFTP、全链路 E2E、环境故障注入或未知提交专项；前端已记录的错误契约与上下文验证缺口仍未关闭，静态通过不代表前端行为验收。

When adding, moving, grouping, or optimizing tests, follow [AGENTS.md](../AGENTS.md) and verify observable behavior described in [USAGE](../USAGE.md).

`specs/ssh/upload-protocol.spec.ts` includes an 8MiB upload/download latency regression with 60ms SFTP read/write delay, completion-time budgets, byte equality and an unaligned HTTP Range. Timing attachments record actual durations; this is a pipeline regression check, not a real-network bandwidth guarantee. The new case has not yet been verified successfully because the local E2E environment had an occupied service port.

Run-channel durable replay regression consumes every current Protocol event through the production Frontend projector, then forces a disconnect and verifies resumption from the consumed cursor with duplicate suppression. Dedicated events use valid typed payloads; other known events invalidate snapshots. Independent Backend CDP/Browser and SSH job scenarios exercise real transport events without a production Runner. This covers event contract completeness, not every payload semantic or arbitrary future protocol versions.

Agent 自适应预算场景同时验证真实 durable proposal/rejection/model continuation：检查失败的原始错误码跨持久化传给模型，拒绝调用的 toolExecutions 保持零。

移动端远程桌面回归覆盖直接触摸和触控板模式下画面点按不聚焦键盘输入框、兼容 click 路径不唤起键盘、显式键盘按钮显示与收起、文字按键发送、全屏下键盘控制，以及模式切换不重连和偏好持久化。

### B7 源码快照与 B10 准备

B7 完整源码/两轮审核及最终静态证据见 [B7 整批收口](后端重构待实机验证.md#b7-整批源码收口行为待-b10)。最新初始 v1 签名为 `backend-next-v1-initial-20261013-b7-governed-operations`；仅 `governed`，默认执行关闭、工具 grant 空。B10 启动前同步既有 backend-next fixtures 的安装参数、最新空库结构、Shared 联合及原 Run 执行设置，不加旧迁移兼容或放宽断言。新增 B7-F01–F13 与历史 B7 场景全部待验，特别覆盖配置消费者、文件/数据库跨阶段确认、通知排空/重启 unknown、真实事件生产者与关闭顺序。本批没有运行行为测试，正式前端仍由 F1 承接。

## F1 基础认证前端回归

命令：`pnpm run test:frontend-auth`。先构建新后端，再启动独立SQLite/真实Access与临时Vite/Chromium；不切换生产。F1-A当时专项19项检查通过，/tmp/nexus-f1-auth-browser-final.log：7项真实setup/password/Cookie/status/logout及TOTP设置夹具/部分登录/真实TOTP完成检查；12项受控响应/竞态/网络与协议失败、流容量/收尾、请求预算、未知401、派发前取消及禁止自动重放。受控TOTP响应不代替另外的真实TOTP链；尚未验证完整正式登录页/因素设置/Passkey UI，不宣称前端全集完成。

实际DEV原浏览器消费者以原包cwd/60秒预算复跑`tests/backend/remote/backend-next-frontend.integration.mjs`，1/1、0失败/取消/跳过、6164.153414ms、exit0，/tmp/nexus-f1-dev-consumer.log。它验证共用认证变更后原终端失败/重试和observer收尾，不替代正式终端迁移。

F1最终Shared check/build、Backend-next check/build、根check、Frontend build通过；日志/tmp/nexus-f1-{backend-check,backend-build,root-check-final,frontend-build-final}.log（Shared结果见本批实际命令输出）。Shared请求预算显式接入原后端路由后，原认证三个文件31/31、0失败/取消/跳过，9131.999755ms、exit0，/tmp/nexus-f1-access-regression.log；实际限额仍16KiB。全仓格式通过，/tmp/nexus-f1-format-check.log；文档最后回填另执行定向格式/diff。最终源码/配置冻结1512项，/tmp/nexus-f1-auth-final-source-manifest.json，SHA256 42eb3ceacabbf811080349c226f1a0b1b97ddadd6b57030b16bde29a8396a813；720后端摘要、链接、资源及diff核验通过，/tmp/nexus-f1-final-verification.log。B10第三十二批冻结只证明开始F1前的版本，不用于这些新增前端源码。

## F1-B 改密与 TOTP 设置回归

本批基线仍为 `refactor/backend-storage-v1` / `05e140d202e78b8c1248c3c3d0ccf44eb398a278` 加累计工作区；不提交或切换生产。改密与 TOTP 设置复用 Auth 的 Shared transport，Security 持有本地临时 setup 与生命周期，不再调用旧 securityApi 的四个写入口。

`pnpm run test:frontend-auth` 的当前源码专项覆盖 35 项浏览器检查：14 项真实后端/SQLite/Cookie 操作，21 项受控响应与生命周期检查。新增真实 TOTP 密码确认禁用、状态重读、改密拒绝/成功、旧密码失效/新密码可用；实际改密组件验证重复提交仅派发一次，以及会话变化卸载组件后仍完成原路由回登录。受控场景包含未知改密清除本地身份且不重放、远端 QR/额外响应字段拒绝、挑战到期、未知 TOTP 阻止重复写入、只读恢复、因素变更、缓存页停用和卸载清理。没有执行真实安全硬件、公网 CAPTCHA、完整 Passkey/安全配置页面验收。

两轮源码复核关注契约转换/唯一 owner，以及异步交付、页面重建、旧 finally 和秘密清理。页面夹具曾因使用另一份 Vite 优化后的 Vue Router 模块而缺失注入，已改为解析应用实际依赖 URL；最终检查不绕过 DOM 提交或放宽断言。检查失败的中间日志不作为通过证据，最终命令、结果和源码冻结在本批收口时核对。

最终 `pnpm run test:frontend-auth` 构建及 35 项检查退出 0；最后一次等价执行 `node tests/frontend/auth.integration.mjs` 同样退出 0，日志 `/tmp/nexus-f1b-auth-browser-final.log`。Shared check、Shared/Backend-next build（专项命令前置）、根 check、Frontend build、全仓 format:all:check 与 diff 全部通过；日志为 `/tmp/nexus-f1b-{shared-check,check-final,build-final,format-final}.log`。最终冻结 1514 项源码/配置，`/tmp/nexus-f1b-final-source-manifest.json`，SHA256 `b235a7583e5c5f965877569e5c347031e6ef62f0cab6b8e61a8bb51e9088b0e8`；720 后端审核摘要、文档链接和临时资源核验通过，`/tmp/nexus-f1b-verification.log`。本批没有修改后端实现，不重复已收口的 B10 全量；上述 F1-A 冻结与 19 项证据仅代表其原版本。

## F1-B Passkey与安全配置回归

本批延续同一分支和累计工作区，不提交推送或切换生产。Auth 的 Access request/Passkey API、浏览器 Adapter、Store 和正式 LoginPage/PasskeyPanel 已接完整 Shared 因素响应；Preferences 的核心配置 API/mapper 供 Security 通过 public 消费，CAPTCHA/IP面板携带各自原快照CAS，黑名单使用集合DELETE JSON和独立分页。

`pnpm run test:frontend-auth` 最终退出0，日志 `/tmp/nexus-f1-complete-browser-final.log`。当前共 **76 项检查：39项真实后端/SQLite/Cookie/浏览器操作，37项受控协议/竞态/生命周期检查**：

- 原改密/TOTP等35项继续通过。
- Passkey新增14项：9项真实发现、options、Chromium CTAP2虚拟认证器注册/验签、列表/改名/删除，5项受控拒绝、弱化UV、关联时间、非法路径及会话失效取消/晚结果；另有1项真实HttpOnly持久Cookie期限检查，确认“记住我”传到最终签发。
- 配置12项：10项真实保存视图、CAS/冲突、保留其他字段、secret替换/保留/清除、活动快照、黑名单分页/解除；2项受控unknown/分页上下文拒绝。黑名单通过显式受信环回测试代理提供公网来源，因为环回来源按产品规则豁免失败计数，不修改产品准入规则绕过此事实。
- 管理controller 9项受控检查：成功写入后刷新失败单独反馈、阻止重复写入、只读恢复、CAS冲突保留原版本、断流unknown、KeepAlive失效/秘密清除，以及发现失败的重试状态。
- 正式组件5项真实操作：CAPTCHA表单重复提交只写一次；并存的IP面板遇到真实409后阻止写入，重新读取并由用户再次修改才成功；数值输入转换和重启提示；实际PasskeyPanel调用虚拟认证器注册、删除并刷新列表。

实体安全硬件、公共域名/公网CAPTCHA仍D16未验。以上使用真实产品组件的独立挂载，不等于所有生产路由、其他业务会话资源或完整Preferences页面通过；相应集成随F1-C/D完成。

认证相关后端四文件回归38/38、0失败/取消/跳过，`/tmp/nexus-f1-complete-access-regression.log`；未重复B10全量。两轮源码复核分别覆盖类型/唯一owner/预算，以及CAS、ceremony取消、未知结果、confirmed后刷新失败、缓存页/卸载与旧finally；新发现的Passkey“记住我”缺失已补齐并验证真实Cookie期限。已有E-03/E-05/E-07/E-11覆盖这些共性，不重复追加临时规则。

最终静态/构建与格式结果见本节后续冻结记录；历史F1-A及上一批F1-B冻结仅代表其原版本，不能用于本批新增源码。

最终Shared check/build、Backend-next check/build、根check及Frontend build退出0；build包含实际前端类型检查，认证脚本先构建Shared/Backend-next。日志 `/tmp/nexus-f1-complete-{shared-check,backend-check,check-final,build-final,browser-final}.log`。全仓 `format:all:check` 退出0，`/tmp/nexus-f1-complete-format-check.log`；文档最终回填另执行定向Prettier/diff检查。

源码/配置冻结1525项，`/tmp/nexus-f1-complete-source-manifest.json`，SHA256 `23ef8e2720e1134911a17c1b661fc18ac92576e936a42b5def09b5802fe9fa4c`；720后端源码审核摘要、文档本地链接、临时目录/子进程/Docker资源及diff核验通过，`/tmp/nexus-f1-complete-verification.log`。更新的后端Access/Factors HTTP预算生产者已重读并刷新对应审核摘要；此前遗留的九个B10目录保留，当前批没有新遗留资源。

## F1-C1 Proxy与SSH Key回归

```bash
pnpm run test:frontend-targets
```

隔离SQLite/backend-next、Vite与Chromium，挂载正式Proxy页面和SSH Key弹窗/选择器。2026-10-17最终43项通过：19项真实链路，22项浏览器受控故障/边界及2项后端受控producer。日志`/tmp/nexus-f1-c1-browser-final.log`。

真实范围：CRUD/原版本CAS、引用删除拒绝、SQLite秘密原值核对、密码/口令保留与显式清除、私钥替换、严格UTF-8及64KiB文件、正式组件提交与只读恢复。受控范围：提交后丢失响应、不重放、错误资源/版本/字段、完整响应预算与body取消、晚列表、缓存重置/读取失败不误清选择、隐藏/KeepAlive、确认取消及替换隔离。认证注销走真实HTTP，资源事件在隔离挂载中显式调用实际session lifecycle；不等于整个App跨业务撤销验收。

Auth/Security原76项另行复跑通过，日志`/tmp/nexus-f1-c1-auth-regression.log`。冻结1532项源码/配置，`/tmp/nexus-f1-c1-source-manifest.json`，SHA256 `f253d38d4130c8227db161066d5b2d938a8df37a848ae0997fe84a65c56d26c1`。验证入口`/tmp/nexus-f1-c1-verify.mjs`核对冻结、720项后端摘要、本地链接和资源，不复用F1-B冻结。Shared check/build、Backend-next check/build、根check、Frontend build和全仓格式/diff按本批日志记录。

未覆盖：正式Connections/Tags/Host Key/导入测试与Remote资源，完整App路由及跨业务撤销仍F1-C/D；公网/硬件按D16。没有部署或生产切换。

## F1-C1 标签与管理组件回归

入口：`pnpm run test:frontend-targets`（构建 Backend-next 后执行同一隔离浏览器 runner）。本批直接运行已构建产物的 `node tests/frontend/targets.integration.mjs`；最终74项：34真实HTTP/SQLite/Cookie与组件检查、35浏览器受控检查、5真实HTTP handler/受控公开集合生产者检查。包括此前Proxy/SSH Key，旧43项证据保留原基线。

- 真实：标签创建/名称规范化、原版本CAS、名称确保、关联重复合并/空清空/缺引用原子拒绝/连接版本推进、级联删除；正式Picker创建/选择/删除，正式标签组独立改名与确认替换；提交后的只读核对。
- 受控：128-byte UTF-8派发前拒绝、完整集合先校验、部分创建的确定拒绝与真实提交回执丢失、停止后续派发与不重放、错误ID/version响应、重复ID/倒序时间/额外私密字段、失败与缓存重置保留选择、原确认窗口卸载、三语、原会话重置。生产者额外验证Tag条数/完整编码字节超限413，以及10,000项最大转义合法集合通过完整codec。
- 范围限制：标签组挂载时使用真实后端连接视图所需字段；父级正式Connections仍消费旧API，本专项没有验证整个Workspace页面迁移。关系unknown后须重读连接集合，不能只刷新标签名称列表就宣称关系已核对。脚本完整解析/导入与Host Key/终端仍待F1-C1/C2。认证登出后由夹具显式派发会话生命周期事件，非整个App自动派发证明。

环境：Node22.23.1/pnpm11.26.0，分支`refactor/backend-storage-v1`、HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278`；累计工作区未提交。日志`/tmp/nexus-f1-tags-browser.log`。本批源码/配置冻结1537项：`/tmp/nexus-f1-tags-source-manifest.json`，SHA256 `da52cf6220f898f3435c20b4a14efb14cf17ddefaa4adef6434374586238a4f9`；校验脚本`/tmp/nexus-f1-tags-verify.mjs`同时核对720条Backend源码摘要、文档本地链接及本批资源残留，不沿用旧冻结PASS。

Shared check/build、Backend-next check/build、Frontend build、根check、全量格式和diff检查按本批日志`/tmp/nexus-f1-tags-{shared-check,shared-build,backend-check,backend-build,frontend-build,root-check,format-check,verification}.log`记录。编译/受控检查不替代尚未迁移的整页功能；外部仍按D16未验，不提交推送或部署切换。

### F1-C1 Host Key 正式管理回归

沿用现有Targets浏览器专项，不重复全量B10。Connections工具栏安装正式HostKeyManagementModal；夹具独立挂载同一组件并经当前新后端真实HTTP/SQLite验证，并非整个旧Connections页面已迁移。

最终命令 `node tests/frontend/targets.integration.mjs` 退出0，共96项：41真实、47浏览器受控、8生产者受控，比Tags基线新增22项。新增覆盖独立确认/小写地址/覆盖/移除/读回、正式表单和移除确认、真实提交后丢失响应且禁止重放、显式刷新、关闭待确认、关闭后的晚读取、KeepAlive停用后的真实晚提交及重新打开核对、身份失效、三语。严格codec拒绝重复host/port、非规范主机、非法指纹/额外字段及错误资源响应；producer验证10,001项拒绝、完整JSON超限和10,000项最大合法转义集合。受控fetch只替换指定确认响应/时序，真实提交与受控交付分别记录；本轮没有真实SSH握手或独立可信渠道的指纹核验。

两轮源码复核覆盖本批17个源码/测试文件及全部新增入口：边界/转换/真实协议，以及取消/晚结果/unknown/原确认owner。现有E-07/E-08.2/E-11/E-13已覆盖本批经验，没有追加重复rules。第一次Frontend类型检查发现i18n参数需要显式字段对象，已修复并重新检查；本地输入错误保留可编辑状态，已派发失败才要求只读恢复。Shared check/build、Backend-next check/build、Frontend类型检查/build、根check、全仓format:all:check和diff按本批最终日志收口。

环境Node22.23.1/pnpm11.26.0，分支refactor/backend-storage-v1、HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278；累计工作区未提交。日志 `/tmp/nexus-f1-hostkeys-{browser,shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,format-check,verification}.log`。源码/配置冻结1542项，`/tmp/nexus-f1-hostkeys-source-manifest.json`，SHA256 `7ff25e760a6eb9a952d19ebce75cc7b2d92c6ef47bd572e057b87da773a7a84b`；`/tmp/nexus-f1-hostkeys-verify.mjs`核对当前冻结、720项Backend摘要、文档本地链接和资源。更新Targets HTTP、Host Key Service/SQLite三个摘要，其余保留；历史Tags/Proxy冻结仅代表原版本。C1仍有五组及C2/D未验，不推定整个应用切换或资源撤销通过。

## F1-C1 Connections 完整管理回归

本批完成正式连接列表/缓存、Connections整页、Workspace标签树、创建/元数据编辑/凭据独立操作、克隆/删除/串行批量/追加标签、保存/未保存SSH测试，以及新文件导入/配置导出、纯脚本/IP范围创建。后端只补安全凭据GET及连接列表完整预算；SQL仍在原Adapter，无新增迁移。旧ConnectionDto/API已删除，所有应用类型消费者迁Connections public；Remote运行协议仍C2。

两轮审核：第一轮覆盖本批全部新增/修改/删除文件和真实消费者，核对Shared→应用、Model→Storage、公开/HTTP投影与容量；第二轮复查CAS、独立提交、部分回执、unknown、会话/停用/晚响应/旧finally及秘密清理。修复批量回执、关闭确认、读取失败反馈和导入关联目录刷新；没有扩大HUMAN或重复AGENTS/rules。后端10个变更文件逐项更新源码索引摘要，其余历史720项不冒充本批重读。

当前专项命令：Shared check/build → Backend-next check/build → `node tests/frontend/targets.integration.mjs`；另执行Frontend vue-tsc/build、根check、format:all:check、git diff --check。上述最终命令均exit0；源码冻结、720项Backend摘要、本地文档链接及本批资源清理核验通过。运行专项需要本机sshd、ssh-keygen及启动隔离daemon的权限。浏览器专项 **142项**：67真实链路/应用检查、64浏览器受控、10生产者受控及1实际浏览器下载。真实链路使用隔离SQLite、原Access/HTTP、Vite/Chromium和环回OpenSSH：原子创建与回滚、凭据安全摘要/清除/元数据CAS、正式表单/脚本/范围/文件导入部分回执、标签缓存/树、批量追加/删除、未知写入读回、保存/未保存SSH握手与关闭；导出实际下载后核对新数组且不含credential。

受控场景只替换指定fetch/时序：错误资源/状态、重复ID/额外秘密/逆序时间、未知后停止后续批量与禁止重放、关闭确认、晚读取/缓存reset、三语等。真实凭据写入后丢失响应单列受控交付；最大10,000项连接集合/10,001项拒绝由实际HTTP handler的受控public producer验证，没有声称向数据库真实写入10,000条或实测640MiB极端JSON。未验证公网SSH、外部因素/供应商、全部生产App撤销与C2终端/Files/桌面；不重复全套B10。

环境Node22.23.1/pnpm11.26.0，分支refactor/backend-storage-v1，HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278；累计工作区保留，未提交推送。最终日志 `/tmp/nexus-f1-connections-{browser,shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,format-check,verification}.log`。冻结 `/tmp/nexus-f1-connections-source-manifest.json`：1550项，SHA256 `68ed0228abaff6139f5dfc4fde212a27398e57f4907cff6eb3f041af9d934b19`；校验器 `/tmp/nexus-f1-connections-verify.mjs`。精确最终检查状态以该日志为准；先前Host Key冻结只表示原版本。

## F1-C2 Workspace 二进制与传输边界回归

本批仅收口C2-A的NXW1与Socket等待/清理，**C2-A整体仍未完成**。Shared `remote/workspace/workspace-binary`持有唯一编解码，正式WorkspaceSocket及OpenSSH夹具消费；删除前端重复文件，版本也改从Shared读取。二进制读取请求消费Shared严格codec，拒绝NaN/非正数/超额后才建连；文件累计64MiB、历史256KiB均引用Shared。取消只发送当前附件，畸形消息结束等待且不记录JSON解析异常中的原始正文。普通/挂起独立ACK、其余JSON请求/事件及应用mapper尚未迁移，不能视为仅剩测试。

命令 `node tests/frontend/workspace-transport.integration.mjs`：**18项codec检查、17项真实Chromium/受控WS检查通过，exit0**。覆盖完整头/保留位/UTF-8/BOM身份、子数组offset、容量边界；元数据先到/后到、空文件、其他请求帧、重复元数据/终帧、final后数据、畸形JSON/二进制、并发共享opening同ID、原请求累计预算、同帧消费一次、未消费旧回调不能确认新附件、发送失败解除真实已安装abort监听。WS由隔离环回producer发送；发送失败单项控制浏览器WebSocket.send，不声称操作系统发送缓冲故障或真实SSH客户端全链路验收。

命令 `node --test tests/backend/remote/backend-next-workspace-resume.integration.mjs`：**7/7（父项及6子项），exit0**，真实环回OpenSSH/新后端Access/WS验证独立恢复ACK、同PTY、流控/回放、journal游标及撤销；夹具已改用Shared decoder。它验证新Shared解码面对真实生产者，不代替正式WorkspaceRuntimeSession的ACK迁移。两轮复核覆盖本批5个现存源码/测试变更及1个删除入口：第一轮核对生产者→Shared→正式Socket/版本消费者，第二轮核对等待/交付顺序/重复消息/取消/旧消费回调及秘密；复核补修NaN绕过容量、取消自动重开连接及测试只重复已消费回调的覆盖缺口。未新增临时rules条目，仍引用E-07/E-08/E-10/E-13。

环境Node22.23.1/pnpm11.26.0；分支refactor/backend-storage-v1，HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278，累计工作区保留，未提交推送或切换生产。Shared check/build、Backend-next check/build、Frontend vue-tsc/build及根check均exit0；全仓格式、diff及冻结/文档/资源核验均通过。日志 `/tmp/nexus-c2-{browser,workspace-resume,shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,format-check,verification}.log`。冻结 `/tmp/nexus-f1-workspace-source-manifest.json`：1550项，SHA256 `c7dca08a87232d1f7a233d8936215572cb64c138081c9ab53d40fb85f3a828e0`；校验器 `/tmp/nexus-f1-workspace-verify.mjs`。Backend产品源码不变，720项摘要仅核对匹配，不声称本批全量重审；C2余项和D16外部依赖继续待完成/待验。

## F1-C2 普通 Workspace 连接、独立 ACK 与关闭

本批完成正式 `WorkspaceRuntimeSession` 的普通 connect/resume/close，**C2-A 整体未完成**：终端请求/事件严格解码与有限失败契约仍有源码工作，Files/传输/挂起/监控/桌面和App撤销仍按C2-B/C/D。Shared新增普通连接结果与null确认的严格codec；`WorkspaceAttachment`只承载普通/挂起共用附件字段，普通连接回执增加必填replayedBytes，未增加旧回执兼容。后端connect依据真实retained journal返回回放量；前端显式映射独立应用对象，Unix秒转毫秒，以journal端点、回放量及实际接收字节定位游标。

| 证据                                                                             | 本批结果                                                           | 限制                                                       |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------- |
| `node tests/frontend/workspace-session.integration.mjs`                          | 10项结果codec、21项正式Session浏览器受控、10项producer断言，exit0  | 受控WS，不冒充真实SSH或整页UI                              |
| `node tests/frontend/workspace-ssh.integration.mjs`                              | 5项真实Access、Backend-next、Vite/Chromium、环回OpenSSH检查，exit0 | 正式Session/终端channel实际消费；没有挂载整个Workspace页面 |
| `node tests/frontend/workspace-transport.integration.mjs`                        | 18项codec及20项浏览器受控检查，exit0                               | 原NXW1/传输边界回归，非挂起ACK                             |
| `node --test tests/backend/remote/backend-next-workspace-resume.integration.mjs` | 7/7，exit0                                                         | 原后端真实OpenSSH续接/挂起/撤销专项，不代替其余C2迁移      |

受控专项覆盖并发connect/close共享Promise；初始响应前后输出及ACK期间输出进入下次offset；资源身份/原generation+1/换token/完整回放校验；ACK后才resize/启用能力；旧附件请求不能发往替换socket；创建或ACK回执缺失禁止重放；关闭请求只走原附件，晚到创建回执归原owner关闭；终端结束拒绝迟到激活，关闭回执缺失保留unknown。三语未知所有权提示已有正式Terminal消费者，但未声称本专项实际挂载并验证该提示。真实专项先确认远端接收后台命令，再断开、等待离线输出并续接，核对同一PID/原Shell变量、恢复后继续输入及确认关闭；不以浏览器send成功替代远端已执行。

两轮复核：第一轮核对Shared→后端journal→Socket→应用mapper→正式Session/Terminal消费者的owner、单位、嵌套投影和ACK顺序；第二轮核对派发/未知确认/取消/晚回执/终端结束/原附件关闭。第二轮补修原Socket身份跨步骤绑定与终端结束generation围栏。Socket拒绝成功/失败字段矛盾和空失败响应，并删除按错误正文分类的旧日志启发式；完整有限失败契约仍列入C2-A，不把它改成已完成。阶段仍引用H-04–H-09/H-12及E-02/E-07/E-08/E-10/E-13，未修改HUMAN或新增临时rules。

夹具开发时修复了独立Vite缓存导致的重复Pinia实例、错误调用凭据设置签名，以及尚未收到后台命令确认就断开的问题；最终回归使用同一模块解析入口、实际API签名和真实远端输出确认，没有放宽产品断言。

最终Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0；格式、diff及冻结/链接/资源检查见本批日志。Node22.23.1/pnpm11.26.0，分支refactor/backend-storage-v1，HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278，累计工作区保留，未提交推送。日志 `/tmp/nexus-c2-ack-{session,ssh,transport,workspace-resume,shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,format-check,verification}.log`。冻结 `/tmp/nexus-f1-workspace-ack-source-manifest.json`：1554项，SHA256 `78e5d6e7e0dddebc2af73a3db8ba714bc1ff4042200810ae6ee4254129a163b2`；校验器 `/tmp/nexus-f1-workspace-ack-verify.mjs`。仅后端workspace-files的本批connect/bindTerminal修改重新审核并刷新索引摘要，其余720项核对匹配，不声称本批全量重审。未覆盖公网SSH、完整正式页面、App登出/关闭汇总、挂起ACK及D16外部能力。

## F1-C2 终端输入、目录与有限失败契约

本批收口C2-A源码及本机专项：普通Workspace的请求/响应/事件映射与共用envelope改消费Shared；终端输入/resize/flow使用Shared校验和容量，目录结果/事件严格解码。独立应用TerminalViewport归features/terminal/model/terminal-types，终端适配归runtimes/workspace/adapters/terminal-adapters，队列投影归workspace-terminal-mapper。旧Backend/Protocol保留参考及未迁移子协议，新终端没有运行时兼容分支。

目录变更绑定原附件及requestId，核对queued路径，请求确认与实际完成事件均有效后才报告成功；合法规范路径可不同于请求路径。失败事件采用Shared有限取值，失败回执及protocol.error仅接受实际producer的安全码，准入满额改为limit_exceeded。断线/超时保留unknown，不自动重放；本地主动关闭也结清已ACK后的事件等待，重复关闭不重复通知。FileManager错误使用对应三语说明，不直接展示服务端正文。

| 命令                                                                             | 当前结果                                   | 范围                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/workspace-terminal.integration.mjs`                         | 17项codec、17项浏览器、4项producer，exit0  | 输入Unicode/字节预算、尺寸、目录响应/事件、有限失败、确认前事件、错误requestId/排队路径、丢回执、未连接禁止派发、本地关闭等待及畸形事件收尾；真实浏览器+受控WS producer |
| `node tests/frontend/workspace-ssh.integration.mjs`                              | 10项，exit0                                | 正式Session/Terminal/DirectoryPort、真实Access/Backend-next/SQLite/环回OpenSSH；目录探测/切换/回读、实际PTY尺寸、原PID/变量/离线输出续接、关闭确认                      |
| `node tests/frontend/workspace-transport.integration.mjs`                        | 18项codec、20项浏览器，exit0               | 原NXW1、等待/终帧/取消、消费与旧附件专项，在当前冻结版本重跑                                                                                                            |
| `node tests/frontend/workspace-session.integration.mjs`                          | 10项codec、21项浏览器、10项producer，exit0 | 原普通连接/独立ACK/身份代次/unknown/晚创建/关闭专项，在当前冻结版本重跑                                                                                                 |
| `node --test tests/backend/remote/backend-next-workspace-resume.integration.mjs` | 7/7、0失败/取消/跳过，exit0                | 原后端真实SSH续接/挂起/撤销专项，不代表挂起前端已迁移                                                                                                                   |

两轮复核覆盖本批新增、修改、移动文件及真实消费者：第一轮核对Shared基础值/完整联合/codec→Backend Shell Service/WS→Socket→应用mapper/port→正式Session/FileManager；第二轮核对派发前拒绝、请求ACK与完成事件乱序、错误关联、未知效果、本地/远端断开、迟到回执、订阅/timer收尾与秘密。旧terminal.ts已移至terminal-types.ts，全部前端Viewport消费者经应用public入口迁移；未重复迁移其他Remote子协议。

实机首轮尝试在用户输入后补探测，被已有安全政策拒绝；夹具改为首次输入前安装。随后真实Bash暴露Hook命令的`fi`缺少分隔符，导致setup超时；诊断日志`/tmp/nexus-c2-terminal-debug.log`保留失败因果。修复只在原Native Shell Adapter，不放宽迟到注入政策；最终实机验证正常目录效果与续接。另修复Socket本地关闭抑制native stale-close后遗留的事件等待，并增加ACK后主动关闭专项。E-10.1只补充生成脚本须由实际目标解释器验证这一共性经验，不将本次缺陷或阶段沟通写入rules。

环境Node22.23.1/pnpm11.26.0；分支refactor/backend-storage-v1、HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278，累计工作区保留。Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0；日志`/tmp/nexus-c2-terminal-{shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,browser,ssh,transport,session,workspace-resume}.log`。当前源码/配置冻结1560项，`/tmp/nexus-f1-workspace-terminal-source-manifest.json`，SHA256 `73292b7a35c372e44218d6916efbaa9eb82ebba75f6f9011a0412b8afc67c2e4`；核验入口`/tmp/nexus-f1-workspace-terminal-verify.mjs`。720项Backend索引只更新本批Workspace WS、Workspace类型、Shell Service和Native Shell Adapter四项摘要，其余只核对匹配，不宣称全量重审。

最终全仓`pnpm run format:all:check`、`git diff --check`及冻结/720源码摘要/124个本地链接目标/资源核验均exit0，日志`/tmp/nexus-c2-terminal-{format-check,verification}.log`。本批临时目录、SSH/worker子进程及相关Docker资源均已清理；继承的历史目录保持原状。

限制：没有挂载整个Workspace/FileManager/Terminal页面验证三语提示及交互；真实目录专项为Bash/Linux `/proc`，不冒充Zsh或所有登录脚本通过。Files/传输和其他Remote子协议仍C2-B/C；整体App资源撤销与页面交互归C2-D，F1-D、D16和P1继续保留。未提交推送、部署或切换生产。

## F1-C2 Files 浏览、编辑、预览与变更

C2-B1本批收口正式Files 11条用例，以及Document/Preview实际消费；Shared补齐完整成功结果、metadata、ready/error有限事件和结果项容量。应用对象归filesystem-types，wire→应用映射归workspace-files-mapper，协议/生命周期归filesystem-adapters。旧Frontend Files DTO引用已删除；旧Backend/Protocol保留参考及未迁移子协议，不增加运行时兼容。

第一轮核对请求、Shared/后端生产者、成功/失败解码、白名单/嵌套投影及正式consumer；第二轮核对ACK准入、SFTP首次就绪、原附件/generation、预派发/unknown、read取消、关闭/dispose与晚结果。修复首次目录读取早于后台SFTP初始化、预览stat等待无法取消、断线隐式新开socket和成功对象未经验证的问题。已确认的本地发送拒绝保留确定未派发；写后丢回执/畸形成功保留unknown，不自动重放。metadata沿实际Model使用Unix毫秒，1MiB只限制发往后端的完整WS控制消息。

| 命令                                                      | 结果                                   | 精确范围                                                                                                                                                                                                               |
| --------------------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/workspace-files.integration.mjs`     | 18 codec、25浏览器、4派发断言，exit0   | 严格联合/metadata/Unicode/额外字段；路径/搜索关联、重复项、binary final、错误确认；Files就绪/ACK门、取消/本地关闭/dispose/64等待预算、有限失败与未知结果。真实Chromium，WS producer及本地发送拒绝受控。                |
| `node tests/frontend/workspace-files-ssh.integration.mjs` | 20浏览器、4磁盘核对，exit0             | 正式Session/Files/Document/Preview，真实Access/Backend-next/SQLite/环回OpenSSH/SFTP；首次目录读取、search/stat/链接解析、建目录/文件、UTF-16LE/BOM读写、预览容量/取消、chmod/rename/remove、关闭后不派发及超限无文件。 |
| `node tests/frontend/workspace-terminal.integration.mjs`  | 17 codec、17浏览器、4 producer，exit0  | 原终端/目录/unknown专项在本批源码重跑。                                                                                                                                                                                |
| `node tests/frontend/workspace-session.integration.mjs`   | 10 codec、21浏览器、10 producer，exit0 | 原connect/ACK/代次/晚资源/关闭专项在本批源码重跑。                                                                                                                                                                     |
| `node tests/frontend/workspace-transport.integration.mjs` | 18 codec、20浏览器，exit0              | 原NXW1/二进制等待、取消及旧附件专项。                                                                                                                                                                                  |
| `node tests/frontend/workspace-ssh.integration.mjs`       | 10项，exit0                            | 原真实Shell/PID/变量/目录/resize/续接/关闭，确认Files改动未破坏终端链。                                                                                                                                                |

过程中真实编码夹具首次把应用规范名误写为utf16le，核对codec后修正为utf-16le；就绪断言改为只统计Files命令，不能用其他通道的流控消息推导Files提前派发。一次具名选项重构漏改四处旧布尔实参，被类型检查与丢回执回归发现，全部修正后重新执行最终静态/受影响专项。没有放宽生产容量或unknown语义取绿。

环境Node22.23.1/pnpm11.26.0；分支refactor/backend-storage-v1、HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278，累计工作区保留。Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0。日志`/tmp/nexus-c2-files-{shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,browser,ssh,terminal,session,transport,original-ssh}.log`。冻结`/tmp/nexus-f1-workspace-files-source-manifest.json`：1565项，SHA256 `d9327d0fac2f9d9ad0afc1fbbfe6e3d556fddc52bbf91f120d7af6c3ddef04e5`，校验器`/tmp/nexus-f1-workspace-files-verify.mjs`；Backend索引只刷新共享容量引用的File Search/File Service两项摘要，其余仅核对匹配，不宣称720项本批全量重读。

完整Workspace/FileManager/Editor/Preview页面挂载、三语交互及App跨业务撤销仍C2-D；本批真实资源是本机Linux/OpenSSH/SFTP，不冒充公网服务器、上传下载、归档或其他Remote子协议已通过。上传下载继续C2-B2，服务器传输/归档继续B3，C2-C、F1-D、D16及P1保留。未提交推送、部署或切换生产。

最终`pnpm run format:all:check`、`git diff --check`、冻结1565项/720源码摘要/125本地链接目标与资源核验均exit0；日志`/tmp/nexus-c2-files-{format-check,verification}.log`。本批临时目录及SSH/worker资源已清理，继承目录原样保留。文档最后补录后另执行目标Prettier与冻结/diff核验，不复跑无变更的行为场景。

## F1-C2-B2 下载契约与交付

本批只收口C2-B2下载子项，上传仍未完成。真实入口为POST /api/v1/sftp/download-ticket、GET/HEAD /api/v1/sftp/download与GET /api/v1/sftp/download-directory；正式consumer为download-adapters、FilesystemDownloadPort与FileManager，不以DEV页面替代。Shared持有请求/201成功/有限失败codec、固定相对URL、32KiB完整JSON预算与300秒TTL；应用只投影{url}。文件交给浏览器后不宣称已保存，完整页面与三语交互仍C2-D。

两轮复核覆盖Shared/HTTP/正式port/原附件/取消/失活/晚结果、范围与零字节/ZIP。真实Chromium→Vite proxy→Backend-next→OpenSSH/SFTP发现：Content-Length字节提前写完后，代理已完成响应并关闭上游，而Service还在最后授权复查；原请求被判中断，健康Files owner退役，下一次Range返回410。已在HTTP sink只保留最后1字节，源迭代和最后授权成功后随end交付；没有删除授权复查，也没有让本地finish冒充用户保存。HttpInputFailure交还Platform，非法JSON/超完整容量分别400/413；route安全错误改有限码，保留实际状态。

| 命令                                                      | 本批结果                                 | 范围与限制                                                                                                                                                                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/workspace-download.integration.mjs`  | 14 codec + 23浏览器检查，exit0           | 实际Chromium与正式adapter；HTTP producer/网络时序受控。固定相对URL/TTL/投影、ACK门、完整响应容量/媒体类型、两种真实失败envelope与status关联、预取消、网络/响应体断流、无自动重试、断开后晚回执与dispose。                                                                 |
| `node tests/frontend/workspace-files-ssh.integration.mjs` | 38浏览器 + 5磁盘/ZIP检查，exit0          | 实际Access/SQLite/Session/正式Files与下载port、环回OpenSSH/SFTP；票据HEAD/完整字节/单段与suffix Range/416、显式与直接目录ZIP/HEAD、inline/20MiB拒绝、零字节、JSON/容量拒绝、原资源释放后410、关闭后不派发。ZIP另用unzip解码并核对原文件正文。保留B1的编辑/预览/变更回归。 |
| `node tests/frontend/workspace-files.integration.mjs`     | 18 codec + 25浏览器 + 4派发断言，exit0   | 当前Files原就绪、取消、容量及unknown受控专项。                                                                                                                                                                                                                            |
| `node tests/frontend/workspace-terminal.integration.mjs`  | 17 codec + 17浏览器 + 4 producer，exit0  | 当前正式终端/目录能力专项。                                                                                                                                                                                                                                               |
| `node tests/frontend/workspace-session.integration.mjs`   | 10 codec + 21浏览器 + 10 producer，exit0 | 当前正式Session/ACK/关闭/原资源专项。                                                                                                                                                                                                                                     |

环境Node22.23.1/pnpm11.26.0，分支refactor/backend-storage-v1、HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278；原583行累计工作区保留。日志均为`/tmp/nexus-c2-download-<项目>.log`；下载子项最终Shared/Backend-next check/build、Frontend vue-tsc/build、根check、全仓格式、冻结/资源核验与diff均exit0；最终全仓格式进程已收取exit0。后端OpenSSH专项和冻结见下方。未重跑整套B10；测试夹具的临时诊断只观察票据/owner，不改变产品结果，最终常规脚本独立重跑。

尚未验收：上传prepare/start/独立WS/分块/冲突/unknown与自动恢复迁移；完整FileManager挂载/KeepAlive三语交互；全部大文件/慢读/取消清理故障和自然TTL；完整注销/权限竞争与C2-D跨业务资源撤销；外部环境。不能继承B10旧冻结PASS，也不能以下载通过判B2整体完成。未提交、推送、部署或切换生产。

后端实际专项`node tests/backend/remote/backend-next-openssh.integration.mjs`退出0：8个业务子场景、Node统计9/9，0失败/跳过，约51秒；复用真实SFTP/HTTP/PTY/原生归档及票据/Range链，不代表重跑整套B10。日志`/tmp/nexus-c2-download-backend-ssh.log`。

当前源码冻结`/tmp/nexus-f1-workspace-download-source-manifest.json`：1567项，SHA256 `3069a88f07810cce0cf84bcfacdcea0a12423099635285c239d4e204e705c4e2`，核验器`/tmp/nexus-f1-workspace-download-verify.mjs`。相对B1冻结只有10项既有源码/测试变化与2个新增文件；其余原工作区源码摘要不变。Backend索引只更新HTTP下载、DownloadTickets及FileService三项；其余717项仅比摘要，不宣称全量重读。

## F1-C2-B2 上传契约与任务生命周期

本批完成正式TransferChannel/Controller的上传迁移；独立`/ws/uploads`及Workspace四个upload请求沿实际producer核对，没有虚构HTTP上传入口。Shared补完整prepare/start/stop回执、七分支事件与严格codec、精确map和有限失败；Backend只收窄FileUploadEvent失败类型，应用/WS逐字段边界及SQL/资源语义保持。原capabilityAdapters上传大实现移至upload-adapters，旧自动prepare/start恢复、上传Protocol query和错误文本判断删除。应用类型及Controller/冲突契约唯一归transfers/model/transfer-types，全部实际类型消费者同步，无旧路径转导出。

两轮复核：第一轮沿Shared→WS producer→原FileService任务→正式适配→Controller/Progress UI及全部修改消费者核对职责/类型/依赖；第二轮覆盖prepare完整计划/容量、原附件绑定、start回执前事件、close-before-open、分块/进度/终态关联、取消受理/本地取消/unknown、准备时取消/旧代次和资源收尾。修复旧进度事件复活终态、取消布尔值冒充完成，以及准备期间已取消文件仍被后续循环上传。未知结果为独立unknown终态，保留安全三语提示；已发送字节、socket关闭和取消受理均不能宣称远端发布或清理完成。使用既有E-05/E-07/E-11/E-13约束，不把本次任务再写成rules条目。

| 命令                                                                          | 当前结果                        | 实际范围与限制                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/workspace-upload.integration.mjs`                        | 13 codec + 29浏览器检查，exit0  | 真Chromium/正式adapter及Controller，控制producer/WS时序受控；目录整计划/完整路径预算、ACK/原scope、早ready、零字节、close-before-open、丢回执/断线不重发、队列取消、取消受理/unknown、畸形/错路径/乱序事件、晚prepare/进度、准备中取消。 |
| `node tests/frontend/workspace-files-ssh.integration.mjs`                     | 46浏览器 + 8磁盘/ZIP检查，exit0 | 真实Access/Backend-next/OpenSSH/SFTP与正式Session/TransferController；多块UTF-8正文、空文件、目录prepare、真实冲突skip/overwrite，独立SFTP和磁盘核对文件；保留下载38项及ZIP/Files/编辑/预览回归。                                        |
| `node tests/backend/remote/backend-next-openssh.integration.mjs`              | Node统计9/9、0失败/跳过，exit0  | 原后端真实SFTP/HTTP/PTY/归档及上传中断专项；8个业务子场景，约51秒，不是整套B10重跑。                                                                                                                                                     |
| 下载 / Files / Terminal / Session既有专项                                     | 全部exit0                       | 下载14 codec+23浏览器；Files18+25+4派发；Terminal17+17+4producer；Session10+21+10producer。共用Socket/装配变更后重跑，旧下载最后字节交付保持。                                                                                           |
| Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check | 全部exit0                       | 当前最终源码；格式/diff/冻结/资源核验另记录下方。                                                                                                                                                                                        |

环境Node22.23.1/pnpm11.26.0，分支refactor/backend-storage-v1，HEAD05e140d202e78b8c1248c3c3d0ccf44eb398a278。下载交接587行累计工作区保留，本批尚未提交/推送。日志`/tmp/nexus-c2-upload-<项目>.log`。过程中修复类型文件改名漏引入和TS联合收窄；受控完整路径夹具先前恰好4096bytes是合法边界，改用4097验证拒绝；异步Blob读取按实际send观察，不凭单次tick推断已发送。一次浏览器回归受源码修改触发Vite热更新而中止，最终源码冻结后独立重跑通过，不把中止结果当产品PASS。

当前冻结`/tmp/nexus-f1-workspace-upload-source-manifest.json`共1569项，SHA256 `12f6fda9d582826cb04bcfb127f368832b23c15d8482de1f3fd17de1ee13941c`。相对下载冻结：17个既有文件变化、3个新增文件、移除旧transfer.ts；其余原累计源码摘要不变。Backend仅更新file-upload-types一项，完整读审该类型与upload-stream，并接缝复核workspace-files/FileService上传及关闭链；其余719项只比摘要，不宣称本批全量重读。

完整Workspace/上传冲突弹窗/Progress页面与KeepAlive三语实际挂载、App跨业务撤销、全部大文件/慢网/自然超时和清理故障组合仍C2-D。当前已验是正式能力/Controller与真实SFTP有限链路，不是完整页面验收；服务器传输/归档迁移仍C2-B3。盘点下一批时确认旧五个transfers HTTP在backend-next源码中未检出，Shared对应HTTP也尚缺，已纳入B3先设计/补后端再接前端，不能把Workspace copy/move当作同能力已还原。C2-C、F1-D、D16/P1保持；未部署或切换生产。

最终收口：`pnpm run format:all:check`退出0（ESLint与全仓Prettier）；`git diff --check`退出0。`node /tmp/nexus-f1-workspace-upload-verify.mjs`退出0：1569项冻结一致、720个Backend摘要一致、126个本地链接目标存在，本批临时目录/相关sshd与worker无残留；继承的9个B10目录保留且无打开描述符。日志为`/tmp/nexus-c2-upload-{format-check,verification}.log`。源码冻结后未再修改产品/测试；最后文档补录单独格式化、检查并再次核验。C2-B2源码及本批专项已收口，完整页面/扩大故障范围按上文保留，下一批C2-B3。

## F1-C2-B3 Workspace复制移动与归档

2026-10-18，分支refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278加累计工作区。Node /usr/local/bin/node v22.23.1、pnpm /usr/local/bin/pnpm 11.26.0；本批工作区由604增至607项，原有修改保留，未提交推送或切换生产。

范围：Shared transfers/{values,workspace,workspace-codec,task-codec}和精确包出口；Backend file-task-types及workspace-files的有限安全投影；Frontend transfer-adapters、capabilityAdapters/WorkspaceSocket装配、transfer-types/Controller/public/presentation、上传共用失败/回执命名、WorkspaceSessionSurface/WorkspacePage剪贴板及三语消费者。新增受控专项、扩展原真实SSH专项，上传专项同步共用回执命名。其余后台serverTransfersApi/store/UI仍未迁移。

两轮复核：第一轮沿原Files Service/Model/Adapter→WS→Shared→正式adapter/controller/view，移除旧Protocol任务类型、原始错误正文与单文件大适配实现，明确任务所有权和无消费者markPartial删除。第二轮核对原附件、受理/早终态、完整路径/源集合/双端Workspace、密码/有限工具名、进度倒退、取消受理/终态、断线/销毁unknown及旧结果；剪切直接调用后端move，删除前端copy成功后的第二次remove，已确认变更与刷新失败分开。未改变Files真实执行/准入、SQL或D12/D13。

| 当前命令                                                | 结果与实际范围                                                                                                                                                                                                                       |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| node tests/frontend/workspace-transfer.integration.mjs  | exit0：11 codec +28受控Chromium断言。正式Channel/adapter/Controller，正常受理、取消真假回执、早终态、错目标/源owner/operation、递归未知总量、进度倒退、有限密码错误/警告、畸形受理/事件、取消响应丢失、断线不重放、dispose拒绝新任务 |
| node tests/frontend/workspace-files-ssh.integration.mjs | exit0：66浏览器+14磁盘/ZIP核对。真实Access/Backend-next/OpenSSH/SFTP，原Files/上传下载回归、递归复制、同Workspace移动、zip/tar.gz/tar.bz2压缩/解压、密码ZIP缺密码/错密码/正确密码、双Workspace后端move及独立读取/磁盘确认            |
| node tests/frontend/workspace-upload.integration.mjs    | exit0：13 codec +29浏览器；共用TransferFailure和Task回执重命名后重跑                                                                                                                                                                 |
| node tests/frontend/workspace-download.integration.mjs  | exit0：14 codec +23浏览器                                                                                                                                                                                                            |
| node tests/frontend/workspace-files.integration.mjs     | exit0：18 codec +25浏览器+4派发断言                                                                                                                                                                                                  |
| node tests/frontend/workspace-terminal.integration.mjs  | exit0：17 codec +17浏览器+4producer                                                                                                                                                                                                  |
| node tests/frontend/workspace-session.integration.mjs   | exit0：10 codec +21浏览器+10producer                                                                                                                                                                                                 |

真实专项首轮失败于原搜索断言：新增复制产生第二个needle.txt，原夹具仍断言仅一项；修正为核对原/复制后的两个真实路径，完整重跑通过，未放宽产品行为。类型检查首稿曾暴露record类型守卫和请求联合收窄，修正后重跑通过。最终日志只对应修正后执行，不能当首轮通过。受控警告/取消/协议失败不当作真实工具故障；真实双Workspace使用同一环回SSH服务器，不冒充不同服务器的rsync/scp后台直传。

源码冻结：/tmp/nexus-f1-workspace-transfer-source-manifest.json，1572项，SHA-256 87e256ac493017d7d717db283b1a5ca2c10c270029fa9c414a53c442591b89b5。与B2基线相比23个既有源码/配置/测试变化、3新增；Backend只改2文件并同步源码索引，其余718仅比对摘要，不宣称本批720全量重读。日志/tmp/nexus-c2-b3-{shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check,transfer,ssh,upload,download,files,terminal,session}.log；最终格式、后端OpenSSH及资源核验另在收口补录。

本批Workspace子链通过不等于C2-B3整体完成：旧/api/v1/transfers五HTTP、后台任务/原生直传及正式SendFiles/Progress消费者仍缺新实现，已在同一实施方案保留逐入口盘点及下一轮提示词。C2-C/D、完整Workspace页面/三语实际挂载与跨业务撤销、F1-D、D16外部及P1保持未完成。本批发现沿用E-03/E-05/E-07/E-09/E-11/E-13，不把临时缺陷写进rules，不改HUMAN或重复AGENTS正文。

最终收口：Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check、全仓格式检查均exit0；node tests/backend/remote/backend-next-openssh.integration.mjs为9/9（8业务子场景），50918ms、0失败/取消/跳过。日志/tmp/nexus-c2-b3-{backend-ssh,format-check}.log。源码冻结后保持不变；node /tmp/nexus-f1-workspace-transfer-verify.mjs退出0，1572项冻结/720项Backend摘要一致、129个本地链接目标存在，本批临时目录/相关sshd与worker无残留，继承9个B10目录保留且无打开描述符。验证日志/tmp/nexus-c2-b3-verification.log；最后USAGE导航及证据补录仅改文档，单独格式化并再次核验。

## F1-C2-B3 后台发送到服务器

当前版本：refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278 加累计工作区；Node22.23.1/pnpm11.26.0。未提交推送、部署或切换生产。本批独立承接五个/api/v1/transfers管理HTTP，Shared server-*及正式API/store/SendFiles/Progress已接线，不借用Workspace复制专项作为后台任务证据。

两轮审核：完整覆盖6新增/8修改Backend、Shared四文件与精确exports、Frontend新增/删除及正式消费者、两专项测试。第一轮核对真实旧五入口、Service/Model/Platform职责与独立应用对象；第二轮核对独立后台事务准入、实际已验证握手key、双端shell/rsync解释、取消/晚结果/清理unknown、会话epoch和意图关联。修复另一并发意图的确定拒绝清除既有unknown保护；未新增兼容fallback或空持久层。探测与执行的真实发起端/路线/身份/信任核对已提炼到E-03.3，不把任务流水写入rules。

| 当前命令                                                                                                                                                                                                                                        | 实际结果与覆盖                                                                                                                                                                                                                                                                                                                        | 日志                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| node --test tests/backend/remote/backend-next-server-transfers.integration.mjs                                                                                                                                                                  | 8/8、0失败/取消/跳过，14810.556ms；两套独立环回OpenSSH端点，真实源端scp/rsync/auto、加密私钥/sshpass口令、特殊中文/空格/引号/元字符及递归目录实际字节/目录形状、临时秘密清理、五HTTP/认证/缺pin；受控Service排队/执行取消/unknown/关闭、真实SQLite准入身份失效及脱离请求scope、关库重开blocked围栏、Native清理失败/错key/派发后取消。 | /tmp/nexus-server-transfers-backend-final.log      |
| node tests/frontend/server-transfers.integration.mjs                                                                                                                                                                                            | 24项受控Chromium断言；真实Vite/正式Shared/API/Pinia store，受控fetch：严格关联/容量/有限失败/204、分页、旧poll/send/session reset、unknown不重发/不被另一意图拒绝清除、取消单请求/受理非终态。                                                                                                                                        | /tmp/nexus-server-transfers-frontend-final.log     |
| node --test --test-concurrency=1 --test-timeout=60000 tests/backend/remote/backend-next-ssh.integration.mjs tests/backend/remote/backend-next-openssh.integration.mjs tests/backend/remote/backend-next-file-transfer-ownership.integration.mjs | 三文件20/20、0失败/取消/跳过，56403.824ms；受影响机器建连、实际OpenSSH/SFTP及文件任务所有权回归。                                                                                                                                                                                                                                     | /tmp/nexus-server-transfers-ssh-regression.log     |
| node tests/frontend/auth.integration.mjs                                                                                                                                                                                                        | exit0；原正式Auth/Security/Passkey/配置及生命周期专项，核对通用JSON client变更。                                                                                                                                                                                                                                                      | /tmp/nexus-server-transfers-auth-regression.log    |
| node tests/frontend/targets.integration.mjs                                                                                                                                                                                                     | exit0，142项（67真实/64浏览器受控/10生产者受控/1下载）；含保存/未保存实际SSH及严格新契约。                                                                                                                                                                                                                                            | /tmp/nexus-server-transfers-targets-regression.log |

Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0，日志/tmp/nexus-server-transfers-{shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check}.log。专项在源码不变的冻结范围内执行；后端8项执行后未再改后端源码，前端最终24项在修补并发保护后执行。

冻结清单/tmp/nexus-f1-server-transfers-source-manifest.json，1871项，SHA256 379bbe470f04057e21b8acbb2d8e5b35a971350304609e7b534a2aaf20a3dd29。相对上一冻结扩大到相关packages/scripts/tests全部现存文件，数量差不等于新增文件数。源码索引新增6/刷新8，其余712仅摘要核对；不冒称726文件本轮全部重读。最终格式/冻结/链接/资源结果在本节末补录。

边界：真实两端点为同一Linux主机上不同port/hostkey的OpenSSH daemon，不冒称两台物理服务器、公网或目标非直连。任务列表内存保存，执行unknown围栏持久；不承诺自动续传或跨重启完整列表。仅验证受控取消/身份/秘密清理时序，不扩为全部自然期限/容量/混合故障。完整SendFiles/Progress/Workspace页面及三语挂载、App撤销/KeepAlive仍C2-D；C2-C挂起/监控/Docker/桌面、F1-D、D16和P1继续保留。

最终收口：pnpm run format:all:check与git diff --check均exit0；node /tmp/nexus-f1-server-transfers-verify.mjs退出0，1871项源码/配置冻结一致、726项Backend摘要匹配、131个本地链接目标存在；本批临时目录/相关SSH与worker无残留，继承9个B10目录保留且无打开描述符。日志/tmp/nexus-server-transfers-{format-check,verification}.log。最后补录仅改文档，定向格式并再次核验，不复跑未变源码的行为测试。C2-B3源码/本机专项收口，下一批C2-C；完整页面及扩大故障组合仍C2-D。

## F1-C2-C1 挂起管理 HTTP

分支refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278加累计工作区；Node22.23.1/pnpm11.26.0。未提交推送、部署或切生产。本批只收口五管理HTTP，WS mark/prepare/commit/恢复ACK/续租/历史与事件仍是未完成源码，不转为单纯待验。

两轮审核：第一轮覆盖Shared values/http/codec与精确出口→Backend HTTP安全投影/WorkspaceService管理接缝→Frontend API/本地types/mapper/store/public→正式Panel/Modal和所有目录类型消费者，删除旧API及DTO转导出。第二轮覆盖预算/媒体类型/固定filename/错误状态关联、输入/输出规范名、旧读取/写入/会话代次、未知结果保护、显式恢复不能清除后来未知、取消/KeepAlive/卸载/注销、stream取消与释放。修补读前headers校验、注销后的下载交付、晚rename成功通知及复杂轮询条件，删除无消费者的旧Workspace HTTP命名codec；适用E-03/E-06/E-07/E-08/E-11/E-13，未将临时任务写成rules。

| 命令                                                                                                                                                                                          | 最终结果与实际覆盖                                                                                                                                                                                                                                                                                                                                                                                  | 日志                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `node tests/frontend/suspended-sessions.integration.mjs`                                                                                                                                      | exit0，38项受控Chromium断言。真实Vite/Shared/API/Pinia与正式Panel有限挂载：畸形/额外字段/状态关联/规范日期和name/重复ID/条目上限、无效输入不派发、错误code/status、rename关联、旧GET与新会话、unknown不重放/不由poll解除/新unknown不被旧recover清除、log headers与body取消/晚下载、KeepAlive确认取消/恢复、读取失败保留记录、注销确认不派发。fetch及时序受控，不冒充真实SSH页面整链或三语实际挂载。 | /tmp/nexus-suspend-browser-final.log |
| `node --test --test-concurrency=1 --test-timeout=60000 tests/backend/remote/backend-next-suspend-management.integration.mjs tests/backend/remote/backend-next-suspend-export.integration.mjs` | exit0，4/4、0失败/取消/跳过，约7秒。真实环回OpenSSH/PTY、管理HTTP/Shared完整解码、name规范化/额外字段拒绝/4KiB请求超限/无登录/active记录不可走断开移除/明确终止；原日志渲染后重新认证、两名额准入、断开取消及文件句柄释放。                                                                                                                                                                         | /tmp/nexus-suspend-backend-final.log |

浏览器首轮因并行构建触发Vite重载中断；构建结束后独立执行最终专项通过，不将中断作为PASS。后端新夹具首稿误把DELETE entry对活动记录预期为409；实际方法只读断开tombstone并返回404，核对Service后修正为not_found、重跑4项通过，未修改业务或放宽权限断言。冻结脚本首稿遍历到既有失效测试symlink而失败，改为git可追踪/未忽略文件清单；保留原资源，没有删除该链接。

最终冻结/tmp/nexus-f1-suspend-management-source-manifest.json，1875项，SHA256 2744489d0a475dccb9ceb5f3e3bce8878a5f98b3c31956a52ebcc37cfe3e05c0。相对上一1871项为18个既有文件修改、6新增、2删除；Backend仅2个修改，源码索引同步，其余724项只比摘要。旧冻结文件保留。静态/格式/资源最终结果在下段补录；源码冻结后未再改产品或测试。

边界：128MiB渲染后日志保护已有双端实现，但本批未制造128MiB边界/全部自然60秒超时或多清理故障组合；不把4KiB请求超限当作日志容量实机证据。只验证英文Panel有限挂载；三语文案已同步，完整三语/整体Workspace/App撤销留C2-D。前端WS恢复缺独立ACK、prepare失败补偿、lease/history和旧事件尚未迁移，继续C2-C1；监控/Docker/桌面、F1-D、外部D16和P1保留。

最终收口：Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check、全仓ESLint/Prettier及git diff --check均exit0。最终浏览器38项、后端4/4在上述最终冻结下独立执行；日志/tmp/nexus-suspend-{shared-check-final,backend-check-final,backend-build-final,frontend-check-final,frontend-build-final,root-check-final,format-check-final}.log，其中Shared build由Backend-next check/build执行并记录。node /tmp/nexus-f1-suspend-management-verify.mjs退出0：1875项冻结一致、726项Backend摘要匹配、134个本地链接目标存在，本批临时目录/相关SSH及worker无残留，继承9个B10目录保留且无打开描述符；日志/tmp/nexus-suspend-verification.log。最后证据补录只改文档，定向格式并再次核验。C2-C1仅管理HTTP子链收口，继续WS恢复子链。

## F1-C2-C1 挂起恢复 WS

分支refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278加累计工作区；Node22.23.1/pnpm11.26.0。未提交推送、部署或切生产。本批在管理HTTP的独立历史证据之上完成挂起WS子链，不沿用其冻结作为本批PASS。

两轮审核覆盖相对管理HTTP冻结的23个修改/6个新增源码与测试、精确包出口及实际消费者。第一轮核对Shared完整请求/结果/事件/容量→Backend真实生产者→Frontend独立应用类型/mapper→正式Socket/Session/terminal与安全三语接缝；第二轮核对prepare/commit未知、baseline实际字节、原附件与独立ACK、ACK期间live offset、串行续租/代次/期限、撤销、历史页/reset、关闭与晚快照。修补ACK未派发不能抹掉已准备的恢复副作用、标记标签关闭不能误发终止Workspace、关闭追踪在途标记任务及普通断线不能丢弃未挂载终端字节。恢复/标记unknown不自动unmark或重放。沿用H-04–H-07/H-09与E-05/E-06/E-07/E-08/E-09/E-11/E-13，不将临时缺陷写入rules，不修改HUMAN。

| 最终命令                                                                                                                                                                                                                                                     | 结果与覆盖                                                                                                                                                                                                                                                                                                          | 日志                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `node tests/frontend/workspace-suspend.integration.mjs`                                                                                                                                                                                                      | exit0；6项Shared codec、32项受控Chromium与6项生产者核对。正式Session/Socket/适配器：恢复单飞及不同意图拒绝、普通connect互斥、ACK前输入禁用、ACK期间live offset、错会话/基线、丢ACK与unknown不重放、原附件历史页/畸形metadata/reset、撤销代次、续租generation失配、mark容量/丢commit无补偿、unmark、关闭等待晚快照。 | /tmp/nexus-suspend-ws-browser.log               |
| `node tests/frontend/workspace-suspend-ssh.integration.mjs`                                                                                                                                                                                                  | exit0；9项浏览器断言及独立磁盘PID核对。真实Access/新Backend/环回OpenSSH，正式Session执行prepare/commit、标记关闭仅detach、恢复独立ACK、原shell PID一致、history reset及有界NXW1页、主动接管撤销旧附件、unmark后明确关闭。                                                                                           | /tmp/nexus-suspend-ws-ssh.log                   |
| `node tests/frontend/workspace-session.integration.mjs`                                                                                                                                                                                                      | exit0；21项浏览器、10项codec与10项生产者核对，普通连接/恢复ACK/关闭的受影响回归。                                                                                                                                                                                                                                   | /tmp/nexus-suspend-ws-session-regression.log    |
| `node tests/frontend/suspended-sessions.integration.mjs`                                                                                                                                                                                                     | exit0；38项管理API/store/正式Panel有限受控回归，含KeepAlive/注销/unknown及下载取消。                                                                                                                                                                                                                                | /tmp/nexus-suspend-ws-management-regression.log |
| `node --test --test-concurrency=1 --test-timeout=90000 tests/backend/remote/backend-next-suspend-history.integration.mjs tests/backend/remote/backend-next-suspend-lease.integration.mjs tests/backend/remote/backend-next-workspace-resume.integration.mjs` | exit0；11/11，0失败/取消/跳过，79005.176478ms。真实OpenSSH，历史页失败/游标/reset及并发顺序、自然租约截止/原PTY续接、普通及挂起ACK/接管/Access撤销。                                                                                                                                                                | /tmp/nexus-suspend-ws-backend-final.log         |

Shared check/build、Backend-next check/build和Frontend vue-tsc均exit0；最终Frontend build及根check也exit0，日志/tmp/nexus-suspend-ws-{frontend-build,root-check}.log。首轮受控与真实专项已通过后，复核又修补恢复提示状态及普通断线缓冲边界，并增加晚快照关闭断言；重新冻结后独立运行表中最终专项。最终冻结/tmp/nexus-f1-suspend-ws-source-manifest.json，1881项，SHA256 ad326624a7e99cb52e4d43e06ff46c8cfbc159786429db36744bb2bff80bc828；源码冻结后未再修改。原管理HTTP冻结及证据保留，Backend本轮两文件摘要更新，其余724项仅比对。

边界：真实端点为同一Linux主机上的独立OpenSSH daemon，不冒充公网、跨物理设备或跨重启PTY恢复。浏览器专项运行正式Session/Socket/适配器与原管理Panel有限挂载，未挂载整个Workspace/xterm页面；完整页面、实际xterm历史重建/取消、三语实际显示及App跨业务撤销仍C2-D。续租异常有受控generation专项，自然期限由Backend真实专项覆盖，不冒称浏览器已验证全部时钟偏差/限流/背压/清理组合。C2-C1源码与上述本机有限专项收口；监控/Docker、桌面、F1-D、D16外部及P1保留。格式/链接/冻结/资源最终核验在下段补录。

最终收口：全仓ESLint/Prettier（pnpm run format:all:check）与git diff --check均exit0，日志/tmp/nexus-suspend-ws-format-check.log。node /tmp/nexus-f1-suspend-ws-verify.mjs退出0：1881项源码/配置冻结一致、726项Backend摘要匹配、135个本地链接目标存在，本批临时目录及相关SSH/worker无残留；继承9个B10目录保留且无打开描述符，日志/tmp/nexus-suspend-ws-verification.log。最终证据补录仅改文档，定向格式并再次核验；不复跑未变源码的行为测试。下一批C2-C2监控/Docker尚未开始。

## F1-C2-C2 监控与 Docker WS

分支refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278加累计工作区。Node22.23.1（/usr/local/bin/node）、pnpm11.26.0（/usr/local/bin/pnpm）；Docker daemon29.8.2。本批不提交推送、部署或切换生产。只收口Workspace观测WS子链；独立HTTP及采样配置消费者仍在本阶段待办。

两轮审核覆盖相对上一挂起WS冻结的全部新增/修改/删除文件与真实消费者：Shared maps/codec/精确exports→Backend观测入口→Frontend原附件adapter→独立应用mapper/types→controller→正式视图。先核对职责、依赖、嵌套白名单、有限安全码与单位，再核对ACK前准入、start/stop串行与原socket、缺测、命令前旧读取、pending/unknown、停用/断线/晚finally、删除确认及安全三语。移除旧DTO转导出和WorkspaceSocket的Protocol混合maps。Backend仅同步观测空请求codec的真实owner与输入失败映射，不改变普通/Agent授权政策；源码索引仅刷新workspace-files一项，其余725项保留原审核。

| 最终命令                                                                                                        | 结果与范围                                                                                                                                                                                                                                     | 日志                                             |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `node tests/frontend/workspace-observation.integration.mjs`                                                     | exit0；13项Shared codec、27项受控Chromium、2项生产者核对。涵盖ACK前拒绝、嵌套stats/安全ID/请求关联、畸形及丢命令回执、缺测与真实零、原附件退订、晚start、代次、pending、unknown不被轮询/无关拒绝/KeepAlive清除、显式只读恢复及确认后刷新失败。 | /tmp/nexus-f1-observation-controlled-final.log   |
| `node tests/frontend/workspace-observation-ssh.integration.mjs`                                                 | exit0；12项真实浏览器断言及daemon独立删除核对。真实Access→Backend-next→环回OpenSSH→Linux/Docker，正式Session/controller消费真实样本、原生labels、stats、start/restart/stop/remove、退订和Workspace关闭。                                       | /tmp/nexus-f1-observation-ssh-final.log          |
| `node tests/frontend/workspace-session.integration.mjs`                                                         | exit0；10项codec、21项浏览器与10项生产者核对。普通连接/续接/ACK/关闭的受影响回归。                                                                                                                                                             | /tmp/nexus-f1-observation-session-regression.log |
| `node --test --test-concurrency=1 --test-timeout=180000 tests/backend/http/backend-next-docker.integration.mjs` | exit0；10/10，失败/取消/跳过均0，31645.415652ms。普通Workspace及治理Agent真实SSH/Docker，四动作、严格拒绝与权限/批准/目标限制。                                                                                                                | /tmp/nexus-f1-observation-backend-docker.log     |

首轮受控夹具误给无需回执的terminal.flow发送无requestId响应，严格解码按设计断开；修正夹具，不放宽协议。源码/夹具冻结后再执行上表最终检查，期间不改源码。最终冻结/tmp/nexus-f1-observation-ws-source-manifest.json，1888项，SHA256 2202aab2017deb6d94739455dfc650feec1cff255cc80e865825d09a6fb2cb73；旧挂起WS证据独立保留。规则沿用H-04–H-07/H-09及E-02.5/E-05/E-06/E-07/E-08/E-09/E-10/E-11/E-13，不把本批临时问题写入rules或HUMAN。

边界：浏览器运行正式Session/Socket/适配器/controller，不是整个Workspace/DockerManager/StatusMonitor页面的实际挂载验收。删除确认/三语/响应布局已按源码审核，实际界面、App撤销和扩大故障组合仍C2-D。真实SSH与Docker在同一Linux宿主，不代替公网或跨物理设备。浏览器只读核对只解除本地保护，不解除Backend持久围栏，也不证明未知命令已停止。systemOverview的HTTP、资源列表/单项及实际采样配置消费仍待C2-C2，RDP/VNC为C2-C3；Agent/Preferences/Operations/System为F1-D，D16外部和P1继续保留。

本批最终静态：Shared check/build、Backend-next check/build、Frontend vue-tsc/build及根check均exit0，日志/tmp/nexus-f1-observation-static.log。全仓ESLint/Prettier检查exit0，日志/tmp/nexus-f1-observation-format.log；后续仅修改文档，定向格式并复查。node /tmp/nexus-f1-observation-ws-verify.mjs核对1888项冻结、726项Backend摘要、136个本地链接及资源均通过；当前专项临时目录/SSH/worker无残留，继承9个目录保留且无打开描述符。Docker新建容器已由daemon确认删除；git diff --check通过。

## F1-C2-C2 资源概览 HTTP

基线：`refactor/backend-storage-v1`、HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278` 加累计工作区；未提交推送、未部署、未切生产。工具为Node22.23.1/pnpm11.26.0，真实Chromium、Access和临时SQLite；不使用外部凭据。

本批改动为Shared本机/观测安全失败codec、system-overview完整应用边界、Dashboard资源生命周期与有限三语。删除旧API路径/DTO转导出。两轮源码审核覆盖本批14项新增/修改/删除源码及测试；其余累计变更不冒充本轮重审。Backend源码未改，726项源码摘要只核对匹配，不重写历史审核。

| 命令/场景                                                   | 结果与实际覆盖                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/system-overview.integration.mjs`       | exit0：18项codec、6项真实HTTP浏览器、59项受控时序/三语。严格错误/额外字段/预算/失败联合、真实本机与匿名/撤销、空SSH列表和单项404；受控同主机回退/错主机关联、四路去重/逐主机发布、缺测/零值、原请求取消/晚结果/旧finally、首次登录与注销重置、dispose及三语键。 |
| `node tests/frontend/workspace-observation.integration.mjs` | exit0：13项codec、27项浏览器、2项producer；本轮独立复跑，Shared新增HTTP错误codec不破坏既有Workspace监控/Docker。                                                                                                                                                |
| 静态与构建                                                  | Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0。                                                                                                                                                                          |
| 格式、冻结与资源                                            | 全仓format:all:check与diff exit0；1893项冻结/726项Backend摘要/137个本地链接匹配。本批临时目录及相关worker无残留，既有9个B10目录保留且无打开句柄。                                                                                                               |

最终源码冻结：`/tmp/nexus-f1-overview-http-source-manifest.json`，1893项，SHA256 `a6e948283b329f58ed2a72674679e3c264fceb4413f9c132244d7fa225510746`。早期静态后补了首次登录的请求隔离及相应回归，再重新冻结；行为与最终静态均基于此摘要，测试运行中未修改源码。日志：`/tmp/nexus-f1-overview-http-browser.log`、`/tmp/nexus-f1-overview-http-ws-regression.log`、`/tmp/nexus-f1-overview-http-static.log`；格式与核验日志：`/tmp/nexus-f1-overview-http-format.log`、`/tmp/nexus-f1-overview-http-verification.log`。

保证限制：SSH资源成功/同主机回退由受控HTTP验证，本批未新增真实SSH HTTP成功链；不将其写成真实远端验收。未挂载完整Dashboard，页面/隐藏/KeepAlive整体集成交错、Connections与旧Audit时间单位、真实SSH资源HTTP及扩大故障仍C2-D；采样配置仍C2-C2后续，C2-C3/F1-D/D16/P1继续待办。现有规则H-04–H-07、E-02.5/E-05/E-07.8/E-10/E-13.1已覆盖，本次无新增rules或人工规则。

## F1-C2-C2 监控核心配置

基线：`refactor/backend-storage-v1`、HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278` 加累计工作区，未提交推送、部署或切生产。实际工具为 `/usr/local/bin/node` 22.23.1、`/usr/local/bin/pnpm` 11.26.0，真实 Chromium/Access/HTTP/临时 SQLite；不使用历史凭据。

本批相对上一HTTP冻结修改26项既有源码/测试，新增配置controller、共用面板和专项3项。第一轮核对Shared→配置HTTP/Service启动快照→前端API/独立mapper/types→两个正式面板与Dashboard全部消费者，以及删除Workspace图表周期props；第二轮核对CAS保留其它配置、saved/effective、冲突/unknown只读恢复、停用/会话更换/旧finally与图表实际时间。Backend仅完整重审五项配置row/rules/types/service/HTTP，更新五项摘要，其余721项只比对，不宣称全量重审。

| 命令/场景                                                      | 当前执行结果及范围                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/monitoring-configuration.integration.mjs` | exit0：4项真实HTTP/重启；50项受控codec/controller/组件/三语检查。真实配置保存、旧CAS拒绝、只读权威和关闭重建后有效值统一；受控缺字段/额外字段/范围/同版本关联、网络/响应断流、冲突/错误状态/错误保存值、禁止自动重放、只读恢复、已知输入拒绝、晚结果/旧finally/首次登录/注销/dispose。 |
| 正式组件/图表                                                  | 同专项实际挂载MonitoringConfigurationPanel及两个旧正式设置入口，核对数字输入、一次CAS保存、反馈和三语；其余个人偏好请求是受控返回，不当完整Preferences迁移验收。实际StatusCharts挂载保留零值和两个真实样本时点，不依赖伪周期props。                                                    |
| `node tests/frontend/auth.integration.mjs`                     | exit0，既有真实密码/Cookie、TOTP/Passkey、安全配置CAS/秘密keep-clear-replace、管理生命周期及正式安全面板回归通过；Settings fixture同步必填effectiveMonitoring。真实因素和受控分支仍按该专项原范围区分。                                                                                |
| `node tests/frontend/system-overview.integration.mjs`          | exit0：18项codec、6项真实HTTP浏览器、59项受控/三语；本批独立重跑，不沿用上一冻结PASS。                                                                                                                                                                                                 |
| `node tests/frontend/workspace-observation.integration.mjs`    | exit0：13项codec、27项受控浏览器、2项producer；监控/Docker当前回归，不当真实SSH/Docker新增验收。                                                                                                                                                                                       |
| 最终静态/构建                                                  | Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check全部exit0。                                                                                                                                                                                               |
| 格式/资源                                                      | 全仓format:all:check、diff与最终核验exit0；1896项冻结、726项Backend摘要、136个本地链接匹配。本轮临时目录/相关worker无残留；保留9个历史B10目录且无打开句柄。                                                                                                                            |

最终源码冻结：`/tmp/nexus-f1-monitoring-config-source-manifest.json`，1896项，SHA256 `94d58d2b465c4c868b0d924f762963cbb76e282f7af496f1876f5c111ef3b956`。初次组件专项发现夹具混用全局与隔离Vite依赖缓存导致两份Vue/Pinia，以及submit后的DOM检查早于Vue更新；改为Vite虚拟模块统一解析、等待下一次渲染。修正仅在各次运行结束后进行，再冻结并从头完整重跑；不将初次失败当产品行为PASS。初次日志 `/tmp/nexus-f1-monitoring-config-browser-initial-failure.log`，最终专项 `/tmp/nexus-f1-monitoring-config-browser.log`。

受影响回归日志：`/tmp/nexus-f1-monitoring-config-auth-regression.log`、`/tmp/nexus-f1-monitoring-config-overview-regression.log`、`/tmp/nexus-f1-monitoring-config-ws-regression.log`；静态、格式和最终核验分别为 `/tmp/nexus-f1-monitoring-config-static.log`、`/tmp/nexus-f1-monitoring-config-format.log`、`/tmp/nexus-f1-monitoring-config-verification.log`。

范围限制：本批真实启动验证配置的持久/有效事实，Remote实际采样/TTL安装沿Bootstrap唯一快照链源码核对；不把GET有效字段等同真实SSH采样时序已验。完整Dashboard/Workspace页面、KeepAlive/App撤销、真实SSH资源HTTP成功/回退、扩大时序/TTL故障及Connections/Audit相对时间单位仍C2-D。完整个人Preferences其余功能F1-D，桌面C2-C3、D16外部和P1继续保留。沿用H-04–H-07、E-02.5/E-07.8/E-10/E-13等既有规则，本批无新增人工规则或临时rules。

## F1-C2-C3 桌面前端

2026-10-18，分支 `refactor/backend-storage-v1`，HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278` 加累计工作区；入场691项未提交变更原样保留，本轮未提交、推送或切换。运行工具 `/usr/local/bin/node` v22.23.1、pnpm 11.26.0。最终冻结清单 `/tmp/nexus-f1-desktop-source-manifest.json` 含1519项：Frontend/Shared/Backend-next源码、Frontend专项、依赖配置/补丁及移动端触控测试消费者；清单文件SHA-256为 `f14dc0e56e81e69e5e972afb34de83aceb51f674504b2a0a18b2bc846d702d17`，逐项SHA-256与最终检查后源码核对。该范围是本批明确冻结集，不替代上一批更大冻结集，也不把旧PASS复用为本批证据。

两轮源码审核覆盖：Shared桌面values/codec；旧桌面API、Model、Port、输入/剪贴板路径删除及全部消费者；新types/mapper/API/controller、Guacamole/监听/触控/剪贴板adapter；Modal/public/launcher、App尝试时间、三语、移动端测试路径及pnpm双产物补丁。第一轮逐功能核对画面、显示、窗口、输入和转换owner；第二轮核对签发/原目标、generation、晚callback/finally、会话/停用、已发效果与清理因果。Backend应用源码未改，726项摘要仅核对未漂移，不宣称重新全量读审。

| 命令/场景                                                        | 当前结果与实际范围                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/remote-desktop.integration.mjs`             | exit0：29项受控协议/API/controller/真实Guacamole输入机制检查；两协议真实HTTP票据→Chromium绘制非空画面→实际xterm键盘输入→本地关闭；5项正式Modal毫秒事件/三语/会话撤销检查。使用隔离Xvnc/xrdp/guacd、本机SQLite与真实Access Cookie，不使用外部凭据。                                                         |
| 严格协议与时序                                                   | 拒绝额外私密字段、非法票据/时间、安全错误与HTTP状态不匹配、完整响应超量；响应流失败保留unknown；取消后的旧票据不打开WS或发布尝试；新意图不被旧peer回调覆盖，unknown不自动重放。                                                                                                                            |
| 原实例释放与输入                                                 | 五轮真实Guacamole peer创建/触控模式切换/关闭，软键盘与Display全局blur监听归零；两触控模式真实库手势的按下/释放、关闭取消待长按；剪贴板累计超量明确拒绝，不截断。真实controller与正式Modal关闭后再次核对Display监听归零。监听计数的Window包装只在测试页，产品不修改共享Window方法。                         |
| `node tests/backend/remote/backend-next-desktop.integration.mjs` | exit0：24项（含顶层），实际双协议画面/键鼠、输入范围/协议、缺凭据、重放/过期/版本、容量/撤权/故障及日志秘密范围；使用独立本机桌面夹具，不以旧B10记录代替。                                                                                                                                                 |
| `node tests/frontend/auth.integration.mjs`                       | 首次因Vite动态模块获取失败退出1；未修改产品源码，再次完整执行exit0。真实认证/因素、安全配置CAS/秘密意图、管理生命周期和安全面板断言均通过。首次失败单独保留，不冒充产品逻辑PASS。                                                                                                                          |
| 静态                                                             | Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check实际退出0；全仓format及diff最终结果见本批核验（格式日志 `/tmp/nexus-desktop-format-check-final.log`）。原始日志 `/tmp/nexus-desktop-{types,shared-check,shared-build,backend-check,backend-build,frontend-build,check}.log`。 |

专项输出分别在 `/tmp/nexus-desktop-regression.log`、`/tmp/nexus-desktop-backend-regression.log`、`/tmp/nexus-desktop-auth-regression.log`（首轮失败）及 `/tmp/nexus-desktop-auth-regression-retry.log`。首轮源码验证发现依赖生命周期扩展与原方法重名，已改为独立`retire`、保留`dispose(layer)`并重新冻结后完整重跑桌面专项；首次结果不代替最终产物证据。资源与冻结最终核验归 `/tmp/nexus-desktop-verification.log`：1519项摘要、726项Backend索引及142个本地链接通过；测试容器/网络、当前测试目录和相关子进程无残留，入场9个旧临时目录保留且无打开句柄。

尚未覆盖：完整Dashboard/Workspace/App整页联动、KeepAlive/标签关闭及扩大撤销组合、桌面真实鼠标/软键盘IME/剪贴板权限与窗口resize/fullscreen/最小化等完整交互留C2-D；本批两协议真实键盘和画面不替代这些项。RemoteApp未配置、Windows本轮及其余外部能力仍D16，不使用历史凭据或旧实机PASS。完整个人Preferences、Agent、Operations、System仍F1-D；P1不施工。沿用H-04–H-09/H-12、E-01.1/E-02.5/E-03/E-05–E-13，新增经验仅在E-01.1补充第三方生命周期扩展的原方法语义与实际产物核对，不增加临时rules或人工规则。

## F1-C2-D 整页与认证生命周期首批

2026-10-18，分支`refactor/backend-storage-v1`，HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278`加累计工作区；入场713项未提交变更保留。使用`/usr/local/bin/node` v22.23.1、pnpm 11.26.0，未提交推送、部署或切生产，不使用历史外部凭据。

两轮源码复审核对App/Header、Dashboard与Audit取消参数、Workspace公开出口/注册表/Session关闭、挂起恢复替换调用链及三个专项文件。修复毫秒误按秒显示、停用后旧读取发布、同tick身份中间状态被批处理跳过、动态导入清理误触新集合、隐藏旧实例漏关、已移出标签的在途关闭漏等，以及已关闭恢复标签被重新插入。删除App清理包装和运行时裸清理出口，转换仍归现有owner，无Backend/Shared源码修改；其余累计变更不作为本轮全量重审。复审先发现并修复隐藏实例/恢复回填，再冻结源码执行检查；产品源码在全部回归期间未修改。

| 命令/场景                                                       | 结果与实际覆盖                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node tests/frontend/app-lifecycle.integration.mjs`             | 最终exit0，4组断言。加载真实App/main/Router/Dashboard，真实Access初始化/登录与Targets导入/列表；正式页面验证连接毫秒和受控旧Audit秒均显示两分钟前。真实KeepAlive切换撤销旧Audit读取，同tick同用户认证中间失效同步分发logout/attach。Audit正文和快速认证时序为受控，不能写成Operations或新Cookie签发整页验收。 |
| `node tests/frontend/workspace-session.integration.mjs`         | exit0。原10项codec、21项浏览器Session和10项producer检查保留；新增15项注册表受控浏览器断言，覆盖共享dispose、独立清理失败、已移出但仍在关闭的原附件、晚关闭不删新标签、认证同步撤销、预渲染恢复/隐藏替换/用户关闭标签、unknown拒绝成功。WS为受控producer，不冒充真实SSH释放证据。                              |
| `node tests/frontend/workspace-observation-ssh.integration.mjs` | exit0，16项浏览器检查及daemon实际删除。真实Access/Backend-next/OpenSSH/Docker：无效用户先被拒绝后回退同主机有效连接；Shared→前端应用对象交付实际Linux指标、毫秒检查时间、同主机缓存复用且不改最近连接时间。另复跑实际监控、Docker四操作与原Workspace关闭；缓存复用不等于TTL自然到期已验。                     |
| `node tests/frontend/workspace-ssh.integration.mjs`             | exit0，10项真实OpenSSH Session检查：目录、同PID/变量续接、resize、实际关闭和断开。                                                                                                                                                                                                                            |
| `node tests/frontend/workspace-suspend.integration.mjs`         | exit0，6项codec、32项受控浏览器及6项producer检查，包含在途快照关闭及晚结果围栏。                                                                                                                                                                                                                              |
| `node tests/frontend/auth.integration.mjs`                      | exit0，原认证/Passkey/配置/安全面板及生命周期回归。                                                                                                                                                                                                                                                           |
| 静态与格式                                                      | Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check均exit0；最终全仓format/diff、冻结摘要/本地链接/资源核验见`/tmp/nexus-c2d-verification.log`。                                                                                                                                    |

整页专项前三次退出1，原因依次为夹具遗漏Shared要求的confirmPassword、选择器命中页面内另一个header、品牌与导航存在同路径链接。各次均在运行完全结束后修正夹具、复核并更新冻结清单；未修改产品以适配夹具。原失败日志保留`/tmp/nexus-c2d-app-lifecycle{,-retry,-retry2}.log`；最终通过为`/tmp/nexus-c2d-app-lifecycle-retry3.log`。其他日志为`/tmp/nexus-c2d-{workspace-session,observation-ssh,ssh-regression,suspend-regression,auth-regression}.log`；静态为`/tmp/nexus-c2d-{types,build-shared,build-backend,frontend-build,frontend-check}.log`。

最终源码清单`/tmp/nexus-c2d-source-manifest.json`包含1515项Frontend/Shared/Backend-next源码和Frontend专项，逐项摘要在最终核验比对；726项Backend索引仅确认未漂移，不声称重审。依赖补丁本轮未改。验证脚本核对本批临时目录、相关子进程与测试容器退出，保留9个入场旧B10目录，不代为清理历史现场。

仍待C2-D：完整Workspace整页的终端/Files/传输/挂起/监控/桌面联动、扩大跨业务撤销/会话替换、自然TTL和采样/缺测/零值组合、桌面窗口/鼠标/IME/触控/剪贴板权限及新票据重连。正式Dashboard已验子集不替代这些事项。F1-D完整Agent/Preferences/Operations/System、D16外部、P1均未施工。本批只在E-07.3提炼“绑定撤销当时原实例集合、区分可见与已接纳资源”，不修改HUMAN或AGENTS，不把具体缺陷写入rules。

## F1-C2-D 编辑与预览资源撤销子批

环境：分支refactor/backend-storage-v1，HEAD 05e140d202e78b8c1248c3c3d0ccf44eb398a278；保留累计未提交工作。本批Node /usr/local/bin/node v22.23.1、pnpm 11.26.0。两轮源码复审覆盖file-editor session、file-preview session、Workspace注册表/Session/Page和实际组件、adapter接缝：首轮修复读/编码晚结果覆盖、注销草稿残留、私有预览未清理和批量关闭等待窗口；次轮区分close-all取消新打开与reset撤销全部操作，避免拒绝关闭保存中文档后使原保存失效，并确认不误失效同scope其它文档。未重审全部累计变更。

冻结清单 /tmp/nexus-c2d-editor-source-manifest.json 共1515项，SHA256 3104013c69f7ba03a9c32fea6853fb0544652e31ebf77655254e2e54df9a65d9。源码冻结后执行，未在测试期间修改源码。

| 命令/场景                                                                     | 结果与证据                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| node tests/frontend/workspace-session.integration.mjs                         | exit0；原10 codec、21浏览器/10 producer断言；新增编辑/预览22项受控断言、注册表17项（含2项新认证清理断言）；/tmp/nexus-c2d-editor-workspace-session.log。                                                                                                                     |
| node tests/frontend/app-lifecycle.integration.mjs                             | exit0，4项正式App/Router/Dashboard检查；Access/Targets真实，Audit响应和同tick认证时序受控；/tmp/nexus-c2d-editor-app.log。                                                                                                                                                   |
| node tests/frontend/workspace-files.integration.mjs                           | exit0，18 codec/25浏览器/4派发断言；/tmp/nexus-c2d-editor-files.log。                                                                                                                                                                                                        |
| node tests/frontend/workspace-ssh.integration.mjs                             | exit0，10项真实Access/Backend-next/OpenSSH/PTY检查；/tmp/nexus-c2d-editor-ssh.log。                                                                                                                                                                                          |
| node tests/frontend/workspace-files-ssh.integration.mjs                       | exit0，66项真实Access/Backend-next/OpenSSH/SFTP浏览器检查及14项磁盘/ZIP检查；/tmp/nexus-c2d-editor-files-ssh.log。                                                                                                                                                           |
| Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根check | 完成exit0；各日志 /tmp/nexus-c2d-editor-{shared-check,shared-build,backend-check,backend-build,frontend-check,frontend-build,root-check}.log。                                                                                                                               |
| 全仓format、diff、清单与资源收尾                                              | 文档收口后全仓format exit0；/tmp/nexus-c2d-editor-final-format.log。清单1515项、Backend726项索引摘要、147个文档链接目标、diff与本轮夹具资源均核对通过；/tmp/nexus-c2d-editor-verification-final.log。Backend索引仅摘要核对，不代表本轮重新读审726文件；9个历史临时目录保留。 |

22项编辑/预览检查直接消费真实前端session，文件端口的延迟、返回和保存确认受控；不能称真实SFTP故障或完整Workspace整页通过。覆盖读取互相替代、读取中继续编辑、保存原快照与后续输入、断连保留草稿但不能保存、reset清私有内容、旧open/finally/save失效、拒绝close-all不破坏保存，以及preview清空中止原读取/旧refresh不派发。注册表认证撤销确认共享草稿与私有编辑/预览同步清空；不把前端清空解释成远端写入回滚。

C2-D仍保留正式Workspace全部交互、跨业务撤销扩大组合、采样/TTL和桌面交互；本子批不宣称这些已验收。

## F1-C2-D Workspace页面与个人目录契约

环境：`refactor/backend-storage-v1`，HEAD `05e140d202e78b8c1248c3c3d0ccf44eb398a278`；Node `/usr/local/bin/node` v22.23.1、pnpm 11.26.0。保留累计未提交工作，未提交、推送、部署或切换生产。当前个人目录按 Shared 破坏性替换，不接收旧裸数组或旧无版本写入。

本批两轮源码审核覆盖 WorkspacePage/LayoutRenderer、client/preferences、共享 view scope/有限反馈、Files 个人目录、快捷命令与命令历史的 API/model/mapper/Store/UI/public、三语及真实消费者。删除的旧文件路径没有转导出。接续复核发现命令发送晚返回后可能借新会话追加历史：页面补原 signal/Session 检查，Store 派发前复查原 UI permission；再逐项复核该增量和新回归。审核不代表累计工作区全量重审。

最终冻结 `/tmp/nexus-c2d-personal-final-source-manifest.json`，1522项，SHA256 `6dc22d6e6d624d874be3f2477999e1fb39712d4d39ee0fae983ff23ea6df4109`。相对前一版个人目录冻结只变更 WorkspacePage、CommandHistory types/Store 与 App 专项四项；保留原 `/tmp/nexus-c2d-personal-source-manifest.json` 和旧日志。以下检查均在最终源码冻结后执行，测试期间没有修改源码；构建完成后才运行浏览器，未并行重写运行产物。

| 命令/场景                                                                                         | 最终结果与证据                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shared check/build、Backend-next check/build、Frontend vue-tsc/build、根 check、全仓 format、diff | 全部 exit0；`/tmp/nexus-c2d-personal-final-static.log`。文档收口后另复查格式与链接。                                                                                 |
| `node tests/frontend/app-lifecycle.integration.mjs`                                               | exit0，30项；`/tmp/nexus-c2d-personal-final-app.log`。真实 App/Router/Access/Targets/OpenSSH/个人数据 HTTP；Audit、延迟交付、占用目录与确认时序受控。                |
| `node tests/frontend/workspace-session.integration.mjs`                                           | exit0，10 codec、21浏览器/10 producer、编辑预览22及注册表17项；`/tmp/nexus-c2d-personal-final-session.log`。WS与文件端口时序受控。                                   |
| `node tests/frontend/workspace-ssh.integration.mjs`                                               | exit0，10项真实 Access/Backend-next/OpenSSH/PTY；`/tmp/nexus-c2d-personal-final-regressions.log`。                                                                   |
| `node tests/frontend/workspace-files.integration.mjs`                                             | exit0，18 codec/25浏览器/4派发断言；同一 regressions 日志。                                                                                                          |
| `node tests/frontend/workspace-files-ssh.integration.mjs`                                         | exit0，66浏览器与14磁盘/ZIP检查，真实 Access/OpenSSH/SFTP；同一 regressions 日志。                                                                                   |
| `node tests/frontend/workspace-suspend.integration.mjs`                                           | exit0，6 codec、32浏览器/6 producer；同一 regressions 日志，挂起 WS 生产者受控。                                                                                     |
| 冻结/Backend索引/链接/资源                                                                        | `/tmp/nexus-c2d-personal-final-verification.log`；1522项冻结与726项Backend摘要一致。索引仅确认未漂移，不宣称重新读审726项；9个历史临时目录保留，本批夹具退出并清理。 |

App 30项包括：真实 Workspace 终端与 Files 路径输入无任何 runtime boundary 错误挂载；旧查询交付不得新建 SSH；KeepAlive 保留原 Session/唯一 WS；正式命令输入正常追加历史，真实 SSH 发送返回经受控门延迟至离开/重新进入后不再追加，排队历史撤销后无 POST；收藏 CRUD/touch/CAS、102项路径分页、命令 CRUD/CAS、标签创建关联及删除后权威版本、计数、51项命令分页、102项历史分页及清空；已撤销 UI 意图不派发；真实收藏201已提交后受控丢响应，保留unknown、阻止第二次写入、显式只读核对仅一条；旧裸数组受控响应必须 protocol_failure；挂起接管确认撤销不影响新确认；同tick同用户认证替换同步撤销缓存并确认原真实 SSH closed。直接调用 API/Store 的断言不算全部对应 UI 操作已验收。

首轮整页的旧个人数据契约失败保留 `/tmp/nexus-c2d-page-app.log`；局部隔离后的9项中间结果仍有 Files 契约错误，不作为最终成功。随后真实 Shared 迁移修复。先前浏览器执行与构建改写产物交错产生 evaluate context/metadata 等失败，保留 `/tmp/nexus-c2d-page-final-{app,session,ssh}.log`；这些是失败运行，不能引用为 PASS。最新版本按串行构建及冻结源码重跑上述全部命令通过。

未验范围：完整 Files/上传下载/传输/挂起/监控/桌面整页交互与扩大跨业务撤销；真实采样/自然TTL/缺测/零值；桌面 resize/fullscreen/最小化、鼠标/IME/触控/剪贴板权限和新票据重连。其余完整 Preferences/Agent/Operations/System 仍 F1-D，外部 D16 与 P1 不启动。

文档收口复查：`pnpm run format:all:check`、变更文档Prettier、`git diff --check` 与冻结/索引/链接/资源核验均exit0。日志 `/tmp/nexus-c2d-personal-final-format.log`、`/tmp/nexus-c2d-personal-final-doc-format.log`、`/tmp/nexus-c2d-personal-final-verification.log`；USAGE新增导航与本批证据锚点另已核对。

## F1 Presentation与后端日志

2026-10-18：正式Preferences/Workspace已破坏性迁到Shared presentation；日志从个人偏好分离至Operations独立CAS。旧preferences API、Workspace裸HTTP与本地布局兼容均删除。原工作区累计变更保留，无提交/推送/部署。

| 范围       | 当前证据                                                                                                                                                                                                                                                                                 |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 静态       | Shared check/build、Backend-next check/build、Frontend vue-tsc/build与根check均exit 0，日志 /tmp/nexus-presentation-static.log；激活流程修复后Frontend类型/构建exit 0，/tmp/nexus-presentation-fix-static.log。最终全仓format与diff检查exit 0，/tmp/nexus-presentation-full-format.log。 |
| 正式App    | app-lifecycle.integration.mjs 39项PASS，/tmp/nexus-presentation-app.log：真实SSH/页面原有30项及统一个人快照、跨域CAS、Vue响应式草稿白名单冻结、布局侧栏原子写、真实已提交丢响应、较早恢复请求不清后发unknown、排队取消、旧裸布局拒绝、正式设置双表单与旧草稿冲突。                       |
| 受影响回归 | workspace-session、monitoring-configuration、workspace-observation、remote-desktop和auth五专项均exit 0，/tmp/nexus-presentation-regressions.log；各专项保持其原有真实/受控范围，不扩大外部验收。                                                                                         |
| 两轮复审   | 第一次沿API→mapper→唯一Store→Workspace/表单检查版本、队列及转换；第二次检查原权限、读取收敛、unknown恢复时序、递归布局、焦点字符串、KeepAlive与明确恢复入口。回归发现重新激活后未继续query连接，已修正且39项重新PASS；测试控件按实际自定义combobox交互修正，未改产品来适配测试。         |
| 冻结       | /tmp/nexus-presentation-source-manifest.json，1532项，最终专项后逐项哈希一致；包含Backend-next、Shared、Frontend源码和Frontend测试。下一批源码变更后此PASS仅代表本版本。                                                                                                                 |

完整C2-D联动、真实TTL/扩大桌面交互，及完整Agent/Appearance/其余Operations/System/P1继续当前实施方案；不以本子批宣称全部完成。

## F1 审计与通知 Shared 消费

2026-10-18：审计API/独立应用mapper/分页Store/正式列表及Dashboard安全摘要已破坏性迁移；随后Notifications完整列表、三通道表单、已保存/未保存测试及投递记录接Shared，删除旧API/DTO。两轮源码复审修正原会话、原版本、秘密草稿和故障修订恢复，并保留已确认结果；CAPTCHA功能设置说明已纠正为页面持久配置，环境变量仅可选首次seed。

- 审计冻结1533文件：前端type/build、43项正式App回归通过，覆盖真实event/毫秒/nextOffset、安全摘要、旧响应拒绝与正式筛选；同时承接原39项Presentation/Workspace生命周期回归。
- 通知冻结1536文件，SHA-256 061551924aa4486b498c30f092653c8da932b0e53db3ccc538123a3e97ca1f91：Shared与Backend-next check/build、Frontend build、根check通过。notifications.integration.mjs 12项通过，含三通道真实CRUD、keep/clear/replace、UUID/CAS删除、真实本地Webhook投递、queued与sent区分、分页、提交后丢失响应、早发恢复不清晚故障、排队取消、旧响应拒绝、正式表单及三语；App43项和backend-next-notifications 22项受影响回归通过。
- 执行日志分别为/tmp/nexus-audit-app.log、/tmp/nexus-notifications-behavior.log、/tmp/nexus-notifications-app-regression.log、/tmp/nexus-notifications-backend-regression.log与静态日志；冻结源码摘要核验一致。当前可用工具链实际为.agent-tmp Node22.16.0/pnpm11.26.0，不复用其他工具链的历史PASS。
- 仅隔离本机范围，公网SMTP/Telegram/Webhook供应商仍D16；完整C2-D、外观、Agent、System管理和P1继续实施，未提交推送或切换生产。

## F1 System备份恢复与宿主诊断

2026-10-18：正式数据页接Shared备份导出/导入及宿主诊断；删除旧无类型API。通用HTTP失败独立owner，JSON与二进制共用有界完整读取；通知public收窄为真实消费者能力。两轮源码复核覆盖容量准入、原身份/视图、已确认结果、全局恢复状态与Blob URL清理。

冻结 /tmp/nexus-system-source-manifest.json 共1548项，SHA-256 74ab8faa6e302f38901d5a8d3471582903f0a2e071c6a0d6072d881162286bbf。工具链.agent-tmp Node22.16.0/pnpm11.26.0，分支/HEAD不变；测试期间未修改源码。

- Frontend build exit0：/tmp/nexus-system-final-build.log。
- system-management.integration.mjs 11项PASS：/tmp/nexus-system-behavior.log。真实Access/Backend-next/Vite/Chromium、加密完整下载、正式multipart恢复UTC、显式重载保留账户、恢复已提交后受控丢响应、禁止重传、auth reset不清未知围栏；File预容量/取消、跨源/字节预算、正式诊断及畸形响应拒绝、隐藏清秘密。第一次仅因两处相同提示导致严格选择器失败，改为弹窗内断言后重跑完整专项。
- 公共HTTP影响回归：auth、targets、app-lifecycle（43项）、notifications（12项）、monitoring-configuration、system-overview全部exit0；日志/tmp/nexus-system-regression-<name>.log，各专项真实/受控范围不扩大。
- 不宣称旧备份文件前端拒绝、全部恢复故障组合或真实介质通过；D16继续延期。Appearance/Agent/机器突变管理、完整C2-D与P1继续当前方案，未提交推送/部署/切换。

## F1 外观、主题与HTML库

2026-10-18：正式外观、终端主题、两类背景、HTML库/仓库及Workspace字体预览已破坏性迁到Shared，删除旧API/Protocol类型与旧themeEditor路径。两轮审核覆盖协议媒体类型、白名单转换、原草稿版本、串行写入、故障修订与明确只读恢复、视图撤销和资源清理。主题导入仍使用真实multipart，不改成JSON；HTML改名另存副本。

- 原冻结`/tmp/nexus-appearance-source-manifest.json`1556项，SHA-256 `57bf14b2e1e76391a43340df10dc736c01eb97c15039066d7a54163d1f63a0d6`。工具链.agent-tmp Node22.16.0/pnpm11.26.0。
- Shared/Backend-next check/build、Frontend build和根check通过，日志`/tmp/nexus-appearance-static.log`、`/tmp/nexus-appearance-final-build.log`、`/tmp/nexus-appearance-root-check.log`。全仓格式首轮仅FRONTEND文档失败，最终文档收口另行复查，不将该次失败写成PASS。
- `appearance.integration.mjs`14项PASS，`/tmp/nexus-appearance-behavior.log`：真实主题CRUD/CAS/multipart及导出、两类图片字节上传读取删除、Unicode/空HTML与另存副本、Repository共享版本、字体预览隔离、正式旧草稿冲突/刷新、Customizer创建、真实已提交后丢响应的unknown围栏、协议私密额外字段拒绝和reset晚结果隔离。首次缺刷新翻译的失败日志保留，修复后完整重跑。
- Backend外观20项和App43项受影响回归通过，日志`/tmp/nexus-appearance-appearance-backend.log`、`/tmp/nexus-appearance-app-lifecycle.log`。后续恢复管理装配及公共refresh三语新增后，外观14项与System11项再次通过：`/tmp/nexus-mutation-appearance-regression.log`、`/tmp/nexus-mutation-system-regression.log`；本轮Frontend build/根check通过，冻结见恢复管理章节。
- 远端目录及正文使用受控响应，未联系公网仓库；公网与真实介质仍D16。未将本子批算作Agent、完整C2-D或P1完成。

## F1 机器突变恢复管理

2026-10-18：新增正式设置数据页的Shared恢复管理消费者。两轮源码审核沿API严格解码/关联→白名单应用mapper→唯一Store→原草稿/确认→Settings安装核对；修复busy提前解除及重复确认，故障恢复必须读取原未知claim，即使用户已改选其它条目，较早排队恢复不得清除较晚故障。公共refresh三语补齐。

冻结`/tmp/nexus-mutation-source-manifest.json`1566项，SHA-256 `fbc481d7bc3021a512c32788767c0d956a52fd155535f9289eb4ef57352be531`；Node22.16.0/pnpm11.26.0，分支/HEAD不变，无提交推送/部署。Frontend build与根check均exit0：`/tmp/nexus-mutation-build.log`、`/tmp/nexus-mutation-root-check.log`。源码冻结后执行专项，期间不改产品源码；仅修正夹具后重新冻结完整重跑，旧失败日志保留。

- `mutation-recovery.integration.mjs`12项PASS，`/tmp/nexus-mutation-behavior.log`。真实Adapter建立22条持久阻断后启动Backend-next/Vite/Chromium，验证未登录401、两页真实列表、人工证据与独立解除、原revision冲突、排队前撤销、实际提交丢响应且仅一次写入、正式表单逐项确认与三语、私密额外字段/错误资源拒绝、早发恢复不清晚故障、reset后晚读取不发布，以及停机后独立Adapter复读实际结果。
- 占用记录由生产Adapter建立；本夹具没有派发远端突变，不证明真实进程停止，也不替代既有Agent Shell/Files/Docker端到端生产者验收。人工证据与released不证明原操作成功。
- 受影响回归：外观14项、System11项与正式App43项PASS，日志`/tmp/nexus-mutation-appearance-regression.log`、`/tmp/nexus-mutation-system-regression.log`、`/tmp/nexus-mutation-app-regression.log`。冻结中后续仅增加恢复专项的关联/时序断言，产品源码未变，已验子批保持其真实范围。
- 夹具首次直接请求内部监听地址被来源校验拒绝，改经实际同源代理；首次seed的非UUID owner被生产行解码拒绝，修正为真实UUID后完整重跑。没有放宽产品来源检查、解码器或断言取绿。清理失败保留全部原因。

完整C2-D、正式Agent和P1继续实施方案，D16外部延期。文档格式/链接、冻结摘要与资源核验在本批收口执行并记录，不复用历史全仓PASS。

## F1 C2-D 正式Workspace文件整页

2026-10-18：FileManager、LayoutRenderer、SessionSurface两轮源码复核；将文件意图绑定原视图、channel/session，防重复删除及旧finally解除新锁；移动/上传/归档已派发任务归原TransferController，离页清密码，晚错误不重开原弹窗，任务观察拒绝显式收尾。未引入兼容层或修改Shared/Backend契约。

冻结 /tmp/nexus-workspace-page-final-source-manifest.json 共1567项，SHA-256 6aff0fd07ed5c95fadaff17477b6e56395cd00d896163f141dcddb4d7a5afbfb；工具链.agent-tmp Node22.16.0/pnpm11.26.0，分支/HEAD不变。源码冻结后执行，测试期间未改产品源码。

- workspace-page-files.integration.mjs **17项PASS**，/tmp/nexus-workspace-page-expanded.log：真实Backend-next/Access/Vite/Chromium/OpenSSH/SFTP的正式页面导航、新建目录/文件、Monaco保存实际字节、Markdown预览、原生选择器上传、实际浏览器下载字节、rename、copy源保留/move源删除、zip及解压恢复、删除取消/确认、应用内离开取消原确认；原生选择器和受控Clipboard晚返回不上传；真实挂起mark/关闭标签/catalog available/恢复ACK，前后BASHPID一致并重新读取Files；真实加密ZIP密码拒绝经受控等待延迟到离页后交付，不重开旧密码框。
- Session/Files/Transfer/Suspend四受影响专项exit0，分别/tmp/nexus-workspace-page-regression-<name>.log。范围仍按各专项原真实/受控分类，不冒充全环境。
- 初次归档脚本未展开子菜单、挂起脚本误用非协议detached值、生成脚本替换误将双美元变单美元，均修正夹具并重冻完整重跑；产品校验/协议未放宽。旧失败日志保留，非PASS。
- D-2真实自然TTL/扩大观测、D-3完整桌面、完整Agent和P1仍继续；D16外部延期。本批静态/全仓格式、App和资源核验结果随后按实际补齐，未提交推送/部署或切生产。

## F1 C2-D 正式监控整页

2026-10-18：产品源码未变，沿真实页面新增workspace-page-monitoring.integration.mjs。/tmp/nexus-monitoring-page-behavior.log四项PASS：正式Workspace组件发起一秒Linux采样、连续真实毫秒历史；正式Dashboard显示真实SSH指标、即时命中同一checkedAt、自然五秒TTL后实际重采；KeepAlive离开后status.stop发出且原session历史停止增长；受控协议响应通过正式卡片区分缺测“—”与真实零“0%”。后者仅为展示分支验证，不冒充本机实测零。采样/缓存均使用首次持久化配置，不修改时钟或替换采集器。

冻结/tmp/nexus-monitoring-page-source-manifest.json共1568项，SHA-256 a5cce962735f99e553db7e37feff5a63784551793e01bf542f50e767d30599c1；工具链.agent-tmp Node22.16.0/pnpm11.26.0。首次夹具将条件等待和后续快照分离导致断言失败，改为同次取得满足判据的完整快照后重冻通过，未修改产品源码或放宽判据。最终测试格式整理后的冻结另在收口记录，不沿用旧测试源码摘要。

同主机认证失败回退、Docker真实列表/控制与停用仍沿workspace-observation-ssh独立范围；原受控专项覆盖晚样本及缺测/零值模型语义。扩大桌面交互、Agent/P1及D16仍分别保留。

## F1 C2-D 正式桌面整页

2026-10-18：正式Dashboard→App→RemoteDesktopModal→Shared票据→Guacamole→隔离Xvnc/xrdp/guacd，两协议完整本机交互通过。整页发现连续尺寸编辑的旧偏好响应回填/共享旧版本竞态，App装配单次保存状态，Modal保存期间禁用宽高和拖动；失败使用Preferences安全反馈，身份替换后不向新用户发布旧错误，不自动重放。最终源码与受影响调用链复审两次，未增加Shared字段或兼容路径。

- remote-desktop-page.integration.mjs **17项PASS**，/tmp/nexus-desktop-page-complete-final-behavior.log：RDP/VNC各自真实非空画面、900×700尺寸及延迟保存期间互斥、最小化/恢复/浏览器全屏保持原socket、浏览器直接触控改变真实远端指针、允许剪贴板时真实Guacamole字节、原browser context明确denied与真实NotAllowedError保持连接、软键盘真实键入、受控composition保留中间值且完成正文在远端只出现一次、新票据重连及旧socket实际关闭、关闭后原browser socket与底层TCP分别归零；最后正式Header注销关闭已最小化的真实桌面并释放资源。
- composition使用合成浏览器事件与真实远端正文断言，触控使用Chromium touchscreen API；不冒充物理手机、系统输入法或完整远端剪贴板取回。允许剪贴板验证实际出站协议字节，拒绝权限验证实际浏览器拒绝。
- 最终冻结/tmp/nexus-desktop-page-expanded-source-manifest.json共1569项，SHA-256 8395ccd4867166277881b322cef1a72e6bba63adc3b0b2bb9f8e61574820a595；工具链.agent-tmp Node22.16.0/pnpm11.26.0，分支refactor/backend-storage-v1/HEAD05e140d不变。测试期间未修改产品源码。
- Frontend build、根check与App43项exit0，分别/tmp/nexus-desktop-page-final-build.log、/tmp/nexus-desktop-page-final-root-check.log、/tmp/nexus-desktop-page-final-app.log。既有remote-desktop.integration.mjs已exit0，/tmp/nexus-desktop-page-regression-desktop.log：原受控生命周期/容量/触控与实际双协议键入、三语Modal/监听释放通过。最终格式/资源核验另按实际补记，不能沿用此前冻结的全仓PASS。
- 失败夹具保留：初始模块网络变化、尺寸断言、原生触控等待、剪贴板context定位与注销控件定位；最终只允许明确ERR_NETWORK_CHANGED后的初始只读导航重试，不重放setup或变更。TCP关闭与browser close独立等待；固定触点碰巧等于原指针不再作为移动判据。各旧失败日志非PASS。

D-1文件17项、D-2监控4项及真实observation-ssh的16浏览器检查/daemon删除均已另批通过；文件子批最终Frontend build/根check、App43及全仓格式也通过，日志/tmp/nexus-workspace-page-final-{build,root-check,app}.log与/tmp/nexus-c2d-final-format.log。它们分别保留原冻结与场景，不代替桌面修补后的受影响回归。完整Agent与P1继续，D16外部延期；无提交/推送/部署或生产切换。

桌面本批最终收口：全仓format:all:check exit0（/tmp/nexus-desktop-page-final-format3.log）；冻结1569项一致、Backend逐文件726项摘要一致、151个本地文档链接目标存在、diff检查通过。/tmp/nexus-desktop-page-final-verification.log确认无本批临时目录/SSH或Worker子进程/观察容器/桌面容器及网络；九个历史目录保留且无打开FD。后续仅证据文字更新，定向文档格式和链接/diff另核对，不重用失败格式日志。

### F1 Agent Registry 独立消费者

范围：Shared Registry 状态/解析响应codec，正式Agent设置的独立状态卡片，Provider页模型查询及其白名单应用转换；Provider管理和完整聚合设置仍待迁移。本批未改Backend产品源码，没有执行公网models.dev刷新，也未以局部组件验收代替整个正式Agent页面。

两轮源码复核分别覆盖协议形状/安全失败/请求关联，以及独立设置装配、身份/页面撤销、晚返回和刷新恢复。产品源码冻结为`/tmp/nexus-agent-registry-source-manifest.json`，1552项，SHA256 `8d41b409e0239a324e6177103391df8252df2e0ebc760aaacf946f55fc3abf26`；清单覆盖Frontend/Backend-next/Shared源码和列出的包/根配置，未包含测试及文档。

`PATH="$PWD/.agent-tmp:$PATH" node tests/frontend/agent-registry.integration.mjs`退出0，日志`/tmp/nexus-agent-registry-behavior.log`，23项PASS：

- 真实隔离Backend-next与Access登录会话：匿名/注销后拒绝、初始无缓存状态、明确无匹配。
- 受控浏览器响应：秒到毫秒投影；未知能力不补false；额外字段、未知错误、来源/快照矛盾、错误modelId、重复推理值与状态/安全码不符均拒绝；超UTF-8预算及不可无损编码标识在派发前拒绝。
- 受控刷新未知与响应流失败：保留unknown，真实卡片阻止重复刷新；只读核对不重发POST；三语错误不展示内部code；模拟底层忽略取消的晚响应在身份撤销后仍不得回填。

Shared check/build、Frontend build、Backend-next check及根check退出0，日志分别为本轮工具输出、`/tmp/nexus-agent-registry-build.log`、`/tmp/nexus-agent-registry-backend-check.log`、`/tmp/nexus-agent-registry-root-check.log`。未新增外部凭据、容器或生产改动；测试自身等待Browser/Vite/Backend关闭并删除本批独立目录。全仓format:all:check退出0，日志`/tmp/nexus-agent-registry-final-format.log`；`git diff --check`通过。冻结复核1552项一致，本批临时目录归零，分支与HEAD未变，日志`/tmp/nexus-agent-registry-final-verification.log`。未提交、推送或部署。

### F1 Agent 执行设置独立消费者

范围：正式 `ExecutionSettings` 卡片、独立 composable/API/应用 mapper 与 Shared 完整响应解码，旧 BudgetContext/Performance/HardLimits/Subagent 控件及对应硬限制/profile请求移除。Backend 仅将相同 profile 基础容量改引 Shared values；执行/事务语义未改变。Provider 管理与完整 Agent 仍未迁完。

两轮源码复核覆盖四个真实HTTP、Provider模型候选、逐字段双向投影、完整容量、原版本/确认关联、互斥、过期/unknown恢复、身份/视图撤销与旧消费者清理。冻结 `/tmp/nexus-agent-execution-source-manifest.json` 共1553项，SHA256 `01c707dc9b7bc84628b50da0d4d207cbbe117ebb43cf2c1baa09225a00a557fa`，包含源码与原清单配置，不含测试/文档。行为验证期间产品源码未修改。

`PATH="$PWD/.agent-tmp:$PATH" node tests/frontend/agent-execution.integration.mjs` 退出0，32项PASS，日志 `/tmp/nexus-agent-execution-behavior.log`：

- 真实隔离 Backend-next、SQLite、Access Cookie：匿名/注销拒绝、初态和三profile、Provider配置/版本化模型候选（不派发供应商请求）、完整预算及模型保存、CAS冲突、硬限制占用预览/确认和持久只读核对。
- 真实 Chromium 中实际卡片保存/确认；完整正式设置组件在旧聚合settings读取失败时仍可使用执行卡片。未把该有限装配验收当作整个Agent或正式路由全流程完成。
- 受控网络：写后断流保持unknown，响应内容/预览与请求不匹配、额外私有字段拒绝；重复工具在派发前拒绝。unknown和冲突阻止再写，读取失败不解锁，成功只读核对不重放；三语安全提示、原模型保留、编辑使确认失效、过期不派发confirm、撤销后晚响应不回填。

首轮夹具在Vue更新按钮disabled前判断读取结束，导致第二次点击落在原busy中；已在操作后等待nextTick再观察收敛，未修改产品，最终重跑通过。受影响 Registry 另重跑23项通过，日志 `/tmp/nexus-agent-execution-registry-regression.log`；此前Registry冻结只作历史证据。

Shared check/build、Backend-next check/build、Frontend build（含vue-tsc）、根check均退出0，日志 `/tmp/nexus-agent-execution-{shared-check,shared-build,backend-check,backend-build,frontend-build,root-check}.log`。全仓 format:all:check 退出0，日志 `/tmp/nexus-agent-execution-final-format.log`；`git diff --check`通过。最终1553项冻结一致，本批临时目录归零，分支与HEAD未变，日志 `/tmp/nexus-agent-execution-final-verification.log`。未调用公网供应商、未使用外部凭据、未切换部署，未提交或推送。工具链沿仓库 `.agent-tmp` Node22.16.0/pnpm11.26.0；这记录实际执行环境，不改变仓库版本约束。

### F1 Agent Provider 管理独立消费者

2026-10-18，D17人工决定前已完成的本批证据：两轮源码审核后冻结 `/tmp/nexus-agent-provider-source-manifest.json`，1556项，SHA256 `c33b2550c79be8b7214640a50a3e575e21d3b65cc7d636852acf951f48c548b6`。正式管理卡片、独立应用类型/mapper/composable、Shared删除回执与发现唯一性解码均在范围；旧Host/SDK Provider读取未迁。

`tests/frontend/agent-provider.integration.mjs` 36项通过（`/tmp/nexus-provider-behavior.log`）：真实Access/SQLite的创建、原版本PATCH/冲突、凭据保留/替换/清除、删除；本机HTTP夹具发现及真实SSE解析测试，模型请求仅一次；受控私密字段/状态/重复目录拒绝、字节预算、真实写后响应断流、只读失败不解锁、三语、撤销晚结果；实际卡片创建与正式聚合失败时独立安装。公网供应商未调用，不代表外部验收。执行设置32项与Registry23项受影响回归通过，日志 `/tmp/nexus-provider-{execution,registry}-regression.log`。

Shared check/build、Backend-next check/build、Frontend build、根check及全仓format:all:check退出0，日志 `/tmp/nexus-provider-{shared-check,shared-build,backend-check,backend-build,frontend-build,root-check,final-format}.log`；工具链 `.agent-tmp` Node22.16.0/pnpm11.26.0。D17生效后不继续新增或运行本地行为测试；后续源码变化不沿用本冻结作为当前PASS，全部适配后统一远程Actions E2E。未提交、推送或部署。

## F1 原生工作区入口与线程适配（2026-10-18，静态）

D17范围：通用工作区17方法从插件归属迁到Scope；原生当前会话/App版本事务准入、Shared严格契约及SDK交付依赖、独立原生线程前端API/mapper/composable和DEV实际组件。正式Host仍未切换。本批未新增/运行行为测试或浏览器专项，未触发Actions，未提交/推送。

Node22.16.0 / pnpm11.26.0。Shared check/build、Backend-next check/build、Frontend build（含vue-tsc）、根check、全仓format:all:check及git diff --check最终均exit0；日志分别为/tmp/nexus-native-final-shared-{check,build}.log、/tmp/nexus-native-reviewed-backend-{check,build}.log、/tmp/nexus-native-reviewed-frontend-build.log、/tmp/nexus-native-reviewed-root-check.log、/tmp/nexus-native-reviewed-format-check.log及/tmp/nexus-native-reviewed-diff-check.log。首次格式检查发现新composable函数间缺空行，已修复并完整重跑通过。静态通过不能替代原生与插件授权竞争、线程幂等/CAS、unknown重试、身份撤销及SDK真实交付回归；这些场景统一留最后远程Actions E2E。

## F1 正式 Agent Host 与运行界面收口（2026-10-18，静态）

范围：正式 Host 实际 App／声明／安装目录，原生线程、Run 创建／终态续接／取消、正文游标、事件、审批、Child 消息元数据、Step／Tool 审计，附件原版本关联及实际 prompt 引用。Frontend 已移除 Protocol 依赖和旧 Agent API／事件流／facade／Store；旧 Backend／Protocol 仍保留参考。按 D15 使用新设计，不恢复旧 Goal／队列／手工 checkpoint 控件。

两轮源码复核覆盖 Shared 严格解码、逐字段应用转换、原 CAS／幂等意图、unknown 围栏、规范化请求与响应关联，以及身份／视图生命周期。修正 unknown Run 活跃判断、临时隐藏的意图保留、附件未知状态通知父界面，以及 Host 暂停或目录读取失败时不无故销毁原运行 owner；会话拒绝仍清除私有状态。附件对象存在不证明关联提交，不据此自动继续发送。

本批依 D17 未新增或运行行为测试、浏览器专项及本地 E2E，未触发 Actions，未提交／推送／部署。此前冻结与 PASS 仅属于原基线，不能作为本轮界面行为 PASS。远程回归前须迁移现有旧夹具／断言：例如 agent/event-catchup.spec.ts 仍动态导入已删除的 agent-events.ts；不得恢复旧模块来满足断言。具体接续见实施方案 V1–V5。

最终静态门禁均退出0：Shared check/build、Backend-next check/build、Frontend build（含vue-tsc）、根check、全仓format:all:check；日志分别为 `/tmp/nexus-host-final-shared.log`、`/tmp/nexus-host-final-backend.log`、`/tmp/nexus-host-final-frontend-build.log`、`/tmp/nexus-host-final-check.log`、`/tmp/nexus-host-final-format.log`。`git diff --check`通过。工具链实际为`.agent-tmp` Node22.16.0／pnpm11.26.0；分支`refactor/backend-storage-v1`、HEAD`05e140d2`未变。最终仅文档证据补充，另行核对文档格式与链接，不重跑行为测试。

### 唯一 Backend 归一（2026-10-19）

- 范围：删除旧 Backend，原 backend-next 归位 `packages/backend`，包名 `@nexus-terminal/backend`；`main.ts` / `dist/main.js` 为唯一启动入口。旧实现定位 `05e140d2:packages/backend`，历史场景、源码索引与冻结摘要只对原基线有效，不能作为重命名后工作区的当前证据。初始 v1 精确签名保持不变。
- 消费者：根构建/check/format、Docker Shared 构建及生产 deploy、Compose 的必填实例密钥/公开来源/代理与健康探针、远程 runner/缓存指纹、所有当前专项的 import 路径和 Frontend DEV 代理已更新。旧实现专属 agent-scenarios、插件升级迁移/吞吐测试和旧数据库基准脚本随旧实现移除；当前 storage/http/remote 和 Frontend 专项保留，未运行。
- 静态环境：分支 `refactor/backend-storage-v1`，修改前 HEAD `05e140d2`；`.agent-tmp/node` 22.16.0 / pnpm 11.26.0，工具目录已忽略，不随源码提交。该版本为实际检查环境，部署仍使用 Node Current。
- 已执行：`pnpm install --frozen-lockfile --ignore-scripts`、根 `pnpm run check`、`pnpm run build`、现有五份 E2E 用例/Playwright config/`support/backend-server.mjs` 的显式严格类型检查、`pnpm run format:all:check`、`git diff --check`，结果 exit 0。日志 `/tmp/nexus-backend-rename-{install,check,build,e2e-types,format-check}.log`。
- 交付检查：`pnpm --filter @nexus-terminal/backend --prod deploy /tmp/nexus-backend-rename-delivery` exit 0，产物包含 main/bootstrap 及 Shared runtime。ssh2 的可选原生加速编译失败后按依赖自身机制回落；该结果不是 SSH 行为证据。`docker compose config --quiet` 使用仅供配置校验的固定测试密钥，修正 shell 展开需要的 `$$` 后 exit 0；shell 启动/烟雾脚本及 Node 控制启动器语法通过。未执行 Docker build/up、Playwright、浏览器或其他行为回归，V1 未完成部分和 D16/P1 继续保留。
- 复审两轮：第一轮沿包名/目录→根门禁→构建/启动→真实消费者修正旧入口；第二轮核对 Shared 独立构建、生产包完整性、Compose Host/插值、单 Backend DEV 代理及受影响专项的环境变量，未恢复旧类型/DB/环境变量兼容分支。本轮明确授权提交、合并 dev 和删除重构分支；合并不代表镜像已发布或整套 E2E 已通过。

本地交付：源码提交 `75289ef9`，合并提交 `a7ba2d80`（父提交 `cad36397` / `75289ef9`）；唯一冲突为 E2E 耗时估计，保留 origin/dev 当前完整数据。已确认重构提交属于 dev 历史后删除本地重构分支，未推送、未删除远端分支、未部署。合并后的源码与静态检查版本一致，差异仅为远端耗时估计及本文状态说明。

### dev 推送及首轮远程 Actions（2026-10-19）

本轮已明确授权推送、删除远程分支和远程 E2E。dev 推送至 `71a0291c`，远程 `refactor/backend-storage-v1` 已删除。[运行 39183397896](https://github.com/0honus0/nexus-terminal/actions/runs/39183397896) 失败：质量检查/格式/生产构建通过；Docker frontend-builder 编译 Shared 报 `tsc: not found`；8个 Playwright 分片全部在 Backend webServer 启动退出，实际用例数为0。不能计为功能失败数或回归通过。日志 `/tmp/nexus-e2e-first-failures.log`、`/tmp/nexus-first-shard2.log`。

修复范围：Docker过滤安装包含依赖工作区开发工具；Reporter保留无测试关联的启动输出及正确异步完成契约。SSH夹具通过独立控制通道提供实际公钥指纹；Auth/SSH helper直接消费Shared偏好CAS、Targets元数据/独立凭据及Host Key确认，不恢复旧settings/connections入口。源码/类型/格式复核后提交，行为以修复后的远程运行单独记录。仍有旧Agent/HTTP/Workspace用例待迁移，不缩减覆盖，不新增本地行为测试。

第二轮 [39184073324](https://github.com/0honus0/nexus-terminal/actions/runs/39184073324)，基线 `6aaf3294`：启动日志已保留，8分片初始化请求返回403，仍未进入用例。控制启动器使用Fetch覆盖Host，改为已配置loopback受信代理的X-Forwarded-Host，不放宽产品Host/Origin校验。Docker继续发现独立包编译引用未导入的ReadableStreamReadResult，补充node:stream/web显式类型导入，不依赖其他工作区偶然加载DOM类型。Workspace helper及两份终端/挂起消费者改用Shared NXW1帧，不保留重复帧解码；补齐Origin、connect响应关联及JSON等待失败监听清理。修复后的行为继续由后续远程运行核对。日志 `/tmp/nexus-second-{shard2,docker}.log`。

第三轮 [39184340686](https://github.com/0honus0/nexus-terminal/actions/runs/39184340686)，基线 `89227f3a`：Backend/Vite已启动并进入实际用例；质量门禁通过。镜像构建通过，容器启动报读取 `/package.json` 的ENOENT。Bootstrap改为读取实际交付包的package.json，并将Backend版本与当前项目/Frontend的1.0.2对齐；烟雾健康请求使用既有受信代理头并经Shared成功codec校验。功能与授权设计未改变，已核对USAGE部署/Shared章节。

旧用例消费者迁移继续：Auth API改为独立核心设置/个人偏好完整CAS与原子布局、通知UUID及显式秘密意图；Origin场景保留全部正反例，按当前政策拒绝无来源和非配置Host；2FA去除旧实现专属speakeasy加载，按RFC6238在测试侧独立计算真实TOTP，消费Shared安全失败并核对当前401/挑战失效。初始App目录按真实首次默认nexus.terminal核对，语言用例分别核对setup本地语言、未保存默认和显式已保存选择。上述改动未运行本地行为，当前结果不代表这些场景PASS；完整各分片失败仍需后续清理与远程复跑。

第三轮失败日志按完整用例标题去重（重试合并）检出325个失败标题、40个通过标题；第4分片另因旧speakeasy依赖在收集时退出，因此这不是完整套件最终统计。当前补丁两轮复审已完成；根check、Backend build、5份变更spec严格类型检查、全仓format和git diff --check通过。2FA反例排除实际时间窗相邻有效码，避免固定000000偶然命中。未执行本地行为回归，待下一轮远程确认。

### 第四轮远程结果与合批修复（2026-10-19，进行中）

[Actions 39185212927](https://github.com/0honus0/nexus-terminal/actions/runs/39185212927)，基线2505acff：质量门禁和Docker deployment smoke通过，8个Playwright分片均失败。分片1–8失败标题按重试去重分别为33/39/27/67/54/41/73/52；基线重置失败造成的连锁阻断不能计为独立产品缺陷。具体待修范围集中在实施方案，未将整套回归标为通过。按D18收齐全部8组并完成本轮失败修复后才统一推送。

当前未推送修复：SFTP技术Adapter按POSIX字面量接受换行名称，保留NUL/路径分隔及损坏字符拒绝，终端/归档/Agent的独立政策不放宽；SSH夹具显式回应SFTP CHANNEL_CLOSE。WS夹具使用配置的localhost来源；正常Workspace恢复使用Shared解码、资源关联、旋转凭据和显式ACK，故障/丢ACK场景仍使用原始请求。容量拒绝及未知操作改为具名有限错误，未泄露技术正文。Auth/setup/通知/Provider、外观CAS、部分SSH/WS消费者迁移已开始，其余旧Agent/管理用例尚未收口；这些源码变更尚无本轮远程行为PASS。

按用户要求删除旧packages/protocol，清除workspace锁文件importer、CI runner Docker COPY及指纹输入；双端已有Shared消费者，不新增兼容包。历史测试记录中的Protocol路径仅描述当时基线。冻结安装通过（/tmp/nexus-protocol-removal-install.log）；后续静态检查结果单独补记。未运行本地行为/浏览器/E2E，也未触发新的远程运行。

本轮当前静态：删除Protocol后冻结安装、根check、Backend build、所有已变更TS E2E消费者的显式严格类型检查及控制启动器checkJs均exit0；新增正常挂起恢复消费者单独严格类型检查exit0。日志分别为/tmp/nexus-protocol-removal-{install,check,build}.log、/tmp/nexus-fourth-batch-spec-types.log、/tmp/nexus-fourth-launcher-types.log及/tmp/nexus-fourth-suspend-types.log。静态不代表8组失败已修完，未提交、未推送。

第四轮续修（本地静态，尚未推送）：已继续迁移 Targets 的连接导入/创建/非 SSH/批量编辑/凭据及 SSH Key 审计消费者，普通挂起恢复统一使用 ACK 和旋转凭据。新增本批覆盖 11 份管理/HTTP spec 的 36 个场景定义：System Settings 6、CAPTCHA 设置 1、IP 控制 2、通知设置/投递 8、Webhook 秘密契约 10、终端主题 2、HTTP 架构契约 6、Proxy 1。该数字仅表示源码场景数量，不是行为通过数；未执行本地用例收集或行为测试。

核对到的实际语义：个人偏好/核心配置/后端日志分别使用各自 Shared CAS；核心配置与 CAPTCHA 保存后重启生效，IP 黑名单用既有隔离控制面的 restart 验证激活，未放宽产品认证。Webhook 每项 header 使用 keep/replace/clear，公开视图仅有 hasValue；原值不返回，拒绝旧 null 编辑和大小写重复名称。投递请求接受不等于发送成功，按 delivery ID 只读轮询最终 sent/failed/unknown，邮件按现有 USAGE 的纯文本契约验证。主题写入/删除保留原版本和 Origin。WS 初始化失败关闭已开的 socket；关闭超时作为失败保留，不能提前报告清理成功。

本续批定向严格类型检查均 exit 0：`/tmp/nexus-fourth-{settings,ip-settings,webhook,theme,notification-ui,notification,architecture,proxy}-types.log`；一次通知迁移脚本误用 index 方法，在写文件前失败，修正 indexOf 后重新执行并严格检查通过。全体当时已修改 E2E TS 严格检查、根 check、Backend build 分别 exit 0：`/tmp/nexus-fourth-expanded-{types,check,build}.log`；此后新增 architecture/proxy 和 WS 清理变更另做最终类型/格式核对。格式写入 `/tmp/nexus-fourth-expanded-format.log` exit 0。未执行行为、浏览器、故障注入、E2E 或新 Actions。原 8 组尚未全部完成修复，继续按 D18 合批，不将以上静态证据写成整套 PASS。

续批追加 RDP HTTP 3 场景（共 12 份管理/HTTP spec、39 个源码场景定义）：连接导入使用 Shared Targets，票据入口保留现有路径及无请求体约束；WS 夹具使用实际 localhost 来源，不放宽产品 Host/Origin。隔离非管理员种子改用当前临时目录及 access_accounts/password_hash；非管理员 upgrade 拒绝与 owner 票据可继续使用分别验证，未知票据为合法形状的随机值，格式错误拒绝和有效格式票据失效分别判断。定向严格类型检查 `/tmp/nexus-fourth-rdp-types.log` exit 0，仍无行为 PASS。

本续批最终核对：新增及既有变更 E2E TS 全量显式严格类型检查 exit 0（`/tmp/nexus-fourth-continuation-final-types.log`）；CJS/SSH/Backend 控制启动器语法及 diff 检查 exit 0（`/tmp/nexus-fourth-continuation-final-syntax.log`）；全仓格式 exit 0（`/tmp/nexus-fourth-continuation-final-format.log`）。根 check 与 Backend build 的本续批结果仍为前述 expanded 日志，产品源码此后未改。二轮复核修正个人偏好读取断流提示分类、UiInput 包装下的 Header 行定位、Remote Desktop upgrade 的实际 401 拒绝，以及同一管理员不同会话也不能消费原票据；没有放宽产品校验。随后仅补迁移命令历史 UI 的 Shared 分页解码与 localhost 剪贴板授权（原 items.map 失败），定向类型检查 `/tmp/nexus-fourth-history-types.log` exit 0。最终文档及该单文件按相同 Prettier 格式核对；这些静态结论不替代整套远程行为。分支 dev、HEAD 2505acff 保持不变，未提交、未推送、新 Actions 未触发。

第四轮续修追加（源码与静态，未提交）：Agent coverage 的五项已按当前 Shared 迁移，包括一次性硬限制确认、原版本策略、Memory 候选/发布/撤销、签名插件 AppIntent 幂等和升级排空。硬限制用例在协议最大值以内先收紧再恢复，未扩大协议上限。Dashboard 改由真实 UI 建连并在 SPA 内回到看板；最近连接属于内存状态，不用原始 WS 或整页重载代替。审计以安全记录 ID 核对最新事件，偏好读取与 Targets 元数据保持各自 owner。

快捷命令实际缺陷已修正：命令和标签目录独立完整读取，标签失败时可执行已成功读取的命令并显示未分类，管理写入和使用计数保持围栏；只有显式重读且两者成功才解锁。USAGE/Frontend 对应章节已同步。CAPTCHA 登录消费者改为 Shared 配置与真实重启激活，清理允许读取 401 后使用独立认证 owner；公网 test key 的准确 hostname 与自然到期仍未确认，不计外部验收通过。

Host 用例按 D15 迁移对照：

| 原检查目的                               | 当前检查入口与边界                                                                                                                           |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 启动器、拖动、停靠、触控、窗口缩放和跨页 | 显式创建真实 App，保留几何交互；窗口持久化使用当前用户 v2 命名空间，核对损坏记录拒绝与用户隔离                                               |
| 线程读取和未知创建重试                   | 原生 workspace 严格解码；读取等待期间保留选择身份；未知结果先检查，再显式复用完整原 operationId/版本/输入，不重复创建                        |
| 启用和模型/运行配置                      | 执行开关与启动器分离；正式 Provider 表单、能力/凭据/协议/发现/真实 probe；失败写入围栏和只读恢复；显式模型旧版本保留为不可用，不自动选择替代 |
| Host 断连、事件追赶和跨标签              | 保留目录失败时原窗口/草稿；显式刷新恢复；实际 Run 事件游标追赶；两标签独立草稿与原版本冲突，不重建已删除 Host 领导者/订阅流                  |
| 订阅准入和生命周期                       | 已退休 Host WS 拒绝连接；原生认证读取保持可用；安全匿名错误、真实实例 UUID、显式空 grants、App 原版本启停与策略修订                          |

ACP 两个产品链用例改为当前设置表单、保存的 SSH 目标/argv/cwd 和固定 integration version。模型夹具调用实际 `acp_integration_execute`；外层启动和每次内层权限分别审批。拒绝/取消均检查独立进程证据、真实进程消失、没有越权文件和安全 Tool 审计。被取消的派发仍保留 unknown，不依据取消状态声称远端回滚。模型夹具区分 `max_tokens` 与 `max_completion_tokens`，要求只出现一项；未放宽生产预算或审批。

当前静态证据：根 check、根 build 先前本续批分别 exit 0（`/tmp/nexus-review-check.log`、`/tmp/nexus-review-build.log`）；Host/ACP 迁移后变更 E2E TS 的严格检查 exit 0（`/tmp/nexus-host-complete-types.log`），检查配置仅放忽略目录 `.agent-tmp/e2e-review-tsconfig.json`，沿用前端别名以核对动态 import 的实际模块类型。JS 模型夹具 `node --check` 通过。此后最终 check、全体类型与格式结果单独补记。以上均非行为证据；未运行本地 Playwright、浏览器、行为测试或用例收集。functional/preset-plugin/task-ui 及其余模型夹具仍有已知旧消费者，整批八组未完成，未提交、未推送或触发新 Actions。

第四轮续修追加：`functional-regressions.spec.ts` 保留 23 个场景，迁移到真实 App UUID、原生 workspace 和 Shared 严格解码。`fixtures/agent/native-task.ts` 只显式批准场景列出的工具，不恢复 full_access；`functional-model.mjs` 使用当前扁平工具参数、读得的 SHA-256/指纹及实际结果，最终模型报告与本机文件、HTTP、PID/端口事实分别核对，不从公开审计接口读取秘密正文。签名 Operations 包声明其实际使用的 context.read；不据此授予其他能力。

| 原场景目的                     | 当前对应与限制                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| plan-only 拒绝部署             | 当前无 plan 模式；显式拒绝 shell 审批，Run failed，文件不存在；不伪造被拒工具的后续模型回复                                                                  |
| Browser 过期点击和部署/PNG     | 过期引用 Run unknown 且部署次数为 0；显式取消后另起意图，只部署 1 次；实际下载 PNG、哈希和图片解码，检查 Browser context 已释放                              |
| 旧 Workspace 环境              | 退休接口 404、当前 create-run 拒绝 environment，空 Run 列表和可执行的新 Run 分别核对                                                                         |
| 前台修复/后台服务/只读交接     | 原验证脚本与文件逐项保留；后台先独立核对 HTTP、cwd、环境和 PID，再让 Run 结束；最终端口关闭/进程消失后才删除目录                                             |
| 文件生命周期与搜索取消/容量    | 使用读得的 hash/指纹和显式审批；不匹配/超限派发保留 unknown；搜索深度、文件数、单文件容量拒绝且内容未变，符号链接不跟随；同 App 新 Run 与新 App 恢复分别覆盖 |
| 旧计划/结构化等待输入/精确输出 | 不恢复计划门禁或 awaiting_input；普通问题完成原 Run，显式 follow-up 创建另一 Run；重开界面恢复正文，旧 Run 不变；JSON/marker 精确输出保留                    |
| 四种 Memory 置信度             | 模型候选固定 0.5 且来源为实际 Run；管理入口分别保留 0/0.5/0.8/1，并通过 UI 发布、旧版本拒绝、显式重读和撤销；不把管理输入加回模型工具                        |
| 远期委派期限                   | 旧绝对 deadlineAt 与当前 durationSeconds 超上限分别拒绝，Run failed、模型 Step 保留 tool_calls、没有 Child；不伪造可恢复的旧 tool error envelope             |

两轮源码复核修正正文分页上限、unknown 活跃占用、显式 App 选择、Memory 发布后的重读围栏和实际工具输出字段。变更 E2E TS 严格检查 exit 0（`/tmp/nexus-functional-native-types.log`），JS 语法检查通过；随后格式和根门禁另记最终结果。未运行本地行为/浏览器/Playwright 或用例收集，23 是源码场景数量，不是 PASS 数。preset-plugin/task-ui 及剩余跨域复核尚未完成，八组仍按 D18 合批，未提交/推送。

### 第四轮整批续修：插件、取消与挂起日志（源码审核）

远程基线仍为 [39185212927](https://github.com/0honus0/nexus-terminal/actions/runs/39185212927)，未产生本批行为 PASS。以下是源码迁移及复审结论，依 D17 未在本机执行行为、浏览器、E2E 或收集。

| 原覆盖                     | 当前实现与判据                                                                                                                                                                                                                                   |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 插件不安全包、官方来源     | 不安全归档在 remote/stage 前拒绝且 stages 不增加；官方入口拒绝第三方 repositoryUrl 覆盖。受控包仍验证实际签名、manifest 与 publisher。实际固定官方 catalog、固定 key 和下载/安装验收仍属 D16 外部待验，不能以拒绝覆盖场景代替。                  |
| 卸载与 AppStorage          | 原 installation revision 写入、卸载、清除保留数据；同 operationId 回放相同回执，旧 revision 拒绝，新意图确认零项。removed 状态不误用仅 draining/upgrade 可读的 data-snapshot。                                                                   |
| Custom/Fullstack 插件      | 实际 App UUID、隔离 iframe/MessagePort、Shared RPC；SDK 存储由独立管理读取验证；跨 App 不泄漏，Node 文件/子进程权限拒绝由真实 worker 探测。remote/stage 已返回 verified，不重复 verify。                                                         |
| Root/Child Browser         | Root 六阶段和 Child 五阶段继续使用真实 CDP context 与创建屏障；取消前版本不重试，必须观察持久取消后再释放创建屏障，并等待原取消回执与 context 归零。Child 独立取消使 Root unknown；父不能假报完成。                                              |
| Skills、工具批次与重复意图 | 签名 Skill 先 metadata 后 name/version/hash 读取；退役 Plan 工具换为当前 fact_write，验证同 assistant turn 的全部工具结果及顺序；两条相同 shell 为两个明确意图，实际文件恰好两行；读取保留 hash。                                                |
| Host 与附件                | 原生线程创建/改名/切换、终态 follow-up、审批原 hash/version、Step/Tool 审计、失败不虚构正文、Artifact 上传/下载实际字节；旧 Goal/Plan/checkpoint/delete 明确 404，不恢复旧 API。无消费者 task-ui 删除。                                          |
| 挂起日志                   | 压缩和 Pad 大输出按真实 Backend 隔离目录与挂起 UUID 读取实际日志，不再创建旧目录；压缩种子在 shell gate 内写入，真实追加越过 132 MiB 后触发批量压缩，保留 100 MiB 及原 shell。恢复显式 Shared ACK。Pad 两种真实 112 MiB 输出仍保留，无渲染替身。 |
| CAPTCHA                    | 公共 hCaptcha 测试密钥配置合成 hostname dummy-key-pass；新增 localhost 不匹配拒绝，保留真实到期、错误 secret、重置及新 token 成功链。生产精确 hostname 校验不变；公网执行及真实站点配置仍待远程/外部验收。                                       |

未修改的失败消费者也纳入盘点：小上传/编辑保存、归档取消/复制进度、目录排序/搜索/下载网络、移动键盘/TUI/触控/输出调度等沿当前实际 Workspace/UI 调用，保留既有独立字节、进程退出与清理断言。静态 TS 范围扩至全部失败 spec 加本批 TS 消费者共 116 个根文件；发现上传用例漏导入 DragFileDescriptor 后修正。静态、语法和构建证据在最终交付时追加，不据此清空八组远程未验状态。

本批最终静态门禁：`pnpm run check`、`pnpm run build`、`pnpm run format:all:check` 均 exit 0，日志 `/tmp/nexus-final-batch-{check,build,format-check}.log`。116 个根文件及其依赖的额外严格 TS 检查 exit 0（`/tmp/nexus-final-batch-e2e-types.log`）；12 份新增/修改 JavaScript 的 `node --check` 通过；`git diff --check` 通过。实际工具链为 Node 22.23.1 / pnpm 11.26.0，远程浮动 Node 镜像仍有独立执行范围。第一轮复核修正 remote stage 已验签、Child 取消父 unknown、真实日志目录/ID/ACK；第二轮复核修正创建屏障与原取消回执等待、fact_write 实际 fact 嵌套结果和上传类型导入。对应 USAGE 快捷命令、Files 字面量路径以及既有 Agent/插件操作章节已核对。未运行本地行为测试，下一步按 D18 统一交付后收集全部八组结果。

### 第五轮远程结果与交接（2026-10-19）

[Actions 39199314555](https://github.com/0honus0/nexus-terminal/actions/runs/39199314555)，分支 dev，提交 `1f87fd08e5387529dc76429729f59aa376704219`：Prepare E2E runner image、Checks/format/build、Docker deployment smoke 均成功；8 组 Playwright 均失败。所有分组已经结束，符合 D18 的整轮收集要求。Update duration balance / documentation screenshots 因失败跳过，不代表该轮 E2E 通过。

| 分组 | jobId        | Playwright 最终摘要                   | 补充范围                                                                    |
| ---- | ------------ | ------------------------------------- | --------------------------------------------------------------------------- |
| 1    | 117889287066 | 32 failed                             | Agent Job 清理后 baseline 500，随后 503 连锁阻断                            |
| 2    | 117889287088 | 19 failed / 23 passed                 | 插件/Browser/ACP、普通 UI/归档/命令等独立失败                               |
| 3    | 117889287040 | 10 failed / 18 passed                 | RDP、响应正文、文件列表、重置入口、偏好写入                                 |
| 4    | 117889287084 | 30 failed                             | reporter 另有一个 timedOut 标题；Remote Files 清理导致 baseline 失败        |
| 5    | 117889287075 | 18 failed / 61 passed                 | 通知、延迟下载、协议/归档、命令及移动 UI                                    |
| 6    | 117889287069 | 20 failed / 27 passed                 | 审计/IP/下载/预览/归档；复制清理导致 baseline 失败                          |
| 7    | 117889287002 | 18 failed / 53 passed / 7 did not run | 整组到达 15 分钟 global timeout，后续 7 项尚未实际运行                      |
| 8    | 117889287026 | 43 failed                             | reporter 另有一个 timedOut 标题；上传 commit/discard 清理导致 baseline 失败 |

上表为各 job 最终摘要，不合并 timedOut、重试或 did not run 成虚假通过率。按 reporter 失败/timedOut标题去重共192个，涉及67份spec；其中大量属于baseline失败连锁阻断，不能按192个独立产品缺陷报告。此前仅截取最终摘要得到的59份文件/172条不是完整范围，已用完整reporter清单替换。80段非baseline错误仅是定位片段，不是全量任务清单。

同机证据：`/tmp/nexus-fifth-<jobId>.log`、`/tmp/nexus-fifth-shard-<1..8>.txt`、`/tmp/nexus-fifth-inventory.txt`、`/tmp/nexus-fifth-failures.json`。临时文件不保证跨机器存在；缺失时用下述命令和上表逐组重取，不依赖旧 gh 日志缓存：

```sh
gh run view 39199314555 --json headSha,status,conclusion,jobs
gh api repos/0honus0/nexus-terminal/actions/jobs/<jobId>/logs > /tmp/nexus-fifth-<jobId>.log
```

曾并发调用 `gh run view --job --log` 时出现 EOF / invalid zip；改为上面的 job logs API 后已取齐。该下载问题不是产品失败；第2/4组现存文件来自成功的gh输出，其余来自job logs API。

#### 已确认事实与未确认线索

- **已确认**：ssh2 1.17.0 的 `ext_openssh_rename` 在 `_extensions['posix-rename@openssh.com'] !== '1'` 时同步抛普通 Error，没有 SFTP 状态码，尚未派发。原 Adapter 通过通用 call 误归 unknown 并关闭 lease；现补丁先判协商能力。后备替换、原临时文件清理、取消及真实未知仍需复核，不能据此断言所有清理失败已解决。
- **已确认**：Shared Browser endpoint 只接受 ws/wss，现测试传入 HTTP discovery origin；ACP invoke 当前定义为 global capability；命令标签列表明确不接受 sortBy；重连压力测试仍调用不存在的产品 reset 路由；插件 option 默认隐藏，不能用它的可见性验证安装。上述已有未提交补丁，尚未运行门禁。
- **已确认链路，原因待完整核定**：A04启动持续运行的Run-owned Job，模型只读status就结束，Run返回unknown；后续drain/close传播unknown，使基线重置失败。必须区分远端效果未知、进程真实退出和清理失败；不能修改测试启动器吞掉close失败来恢复后续用例。
- **待核实线索**：归档夹具仍按旧marker/旧前缀重写虚拟路径及登记进程，当前脚本已变；延迟下载/上传存在性能失败；openNativeTask使用准备时thread标题/version点击超时；Chromium response.json出现Network.getResponseBody无数据；正式UI定位、状态保存及协议差异。尚未完整排查，不将这些推断记为已证实修复原因。

交接时有8个源码/测试文件已改（明细见实施方案），没有修复后的静态或行为PASS，没有提交、推送或新Actions。此前 `nexus-final-batch-*` 静态通过仅属于已推送的1f87fd08。后续复审须检查新补丁、格式、未使用参数和额外E2E严格TS；工具链入口 `PATH=/tmp/nexus-regression-tools:$PATH`，前轮实际Node22.23.1/pnpm11.26.0，执行前再次核对。本机不得运行行为、浏览器、E2E或用例收集。长期规则/人工规则本次未变；源码任务与两轮复审、门禁及交付顺序见实施方案T1–T10。

接手后的只读因果核对：A04/A05 的模型夹具原先在后台 Job 仍运行时只读取 status 就结束，`ToolJobService.drain` 因 unknown 拒绝假成功。当前未验收补丁为隔离服务增加 POST `/shutdown`，模型先请求停止再 `shell_job_control wait`，spec 保留原 HTTP 健康/目录/进程检查并追加 Job `completed` 断言；正式 cancel/unknown 语义未放宽。此更改尚无远程行为 PASS。本机 `node --check` 曾尝试但执行环境返回 `node: Permission denied`，不得登记为语法 PASS；`git diff --check` 通过，仅证明当前差异无空白错误。T1 的 SFTP 后备替换与清理、其余 67 份 spec 及两轮审核仍待完成，不得提交推送。

#### 第五轮源码修复记录（未验收）

追加源码核对：`ssh2` WriteStream 单个大块 WRITE 必须逐包等待；`SftpFileResource.streamStage.append` 已改为 16 KiB 切片、512 KiB 有界 cork/uncork 写窗口，所有回执完成才提交，失败保留 unknown。`upload-protocol.spec.ts` 除原 10 秒吞吐判据外新增 fixture 实际并行 SFTP WRITE 计数与写完收敛检查。归档夹具补齐原生 `sh -c` 无 marker 的 cp/zip/ln/unzip 命令及内嵌 command-v preflight hold。审计 `operation-observer` 已确认原先仅从公开响应读取 userId，导致 SSH Key CRUD 审计 userId=null；现用原会话执行前的 Access 身份补上（保留匿名 null），对应 `http/architecture-contracts.spec.ts` 尚需远程验收。`http/auth-2fa` 改为从真实 UI 读取已显示 TOTP secret/QR，`ssh/connection` 核对真实 UI 成功文本，绕开浏览器导航后 CDP 正文不可读的问题；IP 黑名单开关选择器改为实际 UiCheckbox 控件 marker。未执行测试或静态检查，不将任何项宣称 PASS。

接手后继续从 Actions 八份 job 日志核对，而非依据汇总通过率。现已逐份检查并写入补丁的范围包括：`agent/functional-regressions`（A04/A05 Job 停止与受批准 wait）、`agent/preset-plugin` 与 `agent/ssh-acp-settings`（原工作区待验补丁）、`http/auth-api`（Telegram 合法密钥与秘密脱敏）、`http/backup`（invalid_password HTTP 401）、`http/rdp-remoteapp`（`\|\|notepad` 原值）、`ssh/cross-session-transfer`（显式信任当前 fixture Host Key）、`ssh/file-manager-navigation`（favorites 分页和 CAS 删除）、`ssh/file-upload-reconnect-stress`（原 reset 控制面补丁）、`ssh/panel-wheel-scaling`（合法列宽字段）、`ssh/protocol`（当前 WS 1003 关闭理由）、`ssh/reconnect-ui`（history 分页）、`ssh/terminal-tools-ui`（quick-command 分页/使用计数）、`ui/change-password`（英语配置后再查 Security）、`ui/connection-create`（导航后核对两个真实持久连接及标签）、`ui/proxy-management`（从原认证上下文读创建结果及明确 secret 更新）和`ui/notification-settings`对应的正式 `NotificationsView` 窄屏动作换行。`test-ssh-server.mjs` 初步适配现用归档脚本与 marker，`native-task.ts` 查询原 ID 的最新线程版本；均为**源码待验补丁**，不能归入通过率。

安全与性能保留项：`ssh-sftp` 缺扩展先判断且已派发未知不得重放；归档原生脚本目录映射需复核 shell 引号、结束 marker、hold 和真实清理；写入 60ms/32KiB 性能失败发现 ssh2 WriteStream 单块 `_write` 的串行回执逻辑，但尚未实施安全有界并发修复。`ssh/suspend-resume`、下载 admission/吞吐、Agent Host、HTTP 审计/IP/2FA、复杂移动 UI 等独立失败仍待处理。以上变动没有执行本地 E2E、浏览器、用例收集或行为验证；没有提交/推送，新远程八组结论不存在。仅 `git diff --check` 通过；Node 静态入口被当前执行隔离拒绝，并非 Node 语法检查通过。

#### 本轮失败 spec 全量索引

#### 本次 20 份失败 spec 的逐文件核对（源码候选，不代表 E2E PASS）

**后续 Actions 复核（2026-10-19）**：第五轮之后已存在第六轮 Actions [39210783294](https://github.com/0honus0/nexus-terminal/actions/runs/39210783294)，HEAD `96e24d5c`，quality/build、Docker smoke 成功，八个 Playwright shard 均 `failure`、执行已经结束。八组 job 日志已分别读取，当前 HEAD 与这次远程 SHA 一致。此表针对第五轮所选的 20 个独立 spec，最新第六轮中大部分仍有同名失败；**不能将未推送的本地补丁算成第六轮已验收修复**。除原有 20 项外，最新结果新增/暴露 `ssh/connection-edit-delete.spec.ts`、`ui/notification-delivery.spec.ts` 的 CDP 正文丢失；已在同批补充消费者修正。`ui/login-captcha-surface.spec.ts` 的失败已从提交后 hostname 分支前移到 `loadLoginWithCaptcha` GET 校验，`ui/connection-create.spec.ts` 从导入结果移到成功的 SSH test GET/POST 回执；均按第六轮新失败位置调整源码。

第六轮新增的消费者静态修复：登录页面要求浏览器实际取得 CAPTCHA GET 状态 200，再以认证请求上下文 GET 同一公开配置进行 Shared 解码，避免 `page.goto` 导致 CDP 正文丢失；`connection-edit-delete` 的两次 saved SSH test 要求 HTTP 成功并展示 Connections 行实际成功文案，修复 `readConnectionList` 的双重解码，删除验收时后台 GET 失败不再被误判为“已删除”；`connection-create` 保留真实成功文案断言而不访问丢失的浏览器 response body；`notification-delivery` 在触发前抓取已存在 delivery ID，真实 UI POST 后只通过已认证持久 delivery 列表确认**唯一新增 ID、settingId 与事件、终态**，不重复触发外部通知。新增修复均未运行本地行为测试或 E2E，仍须下一轮完整八组验证。

本批只从第五轮原始失败证据和真实代码调用链判因，D17 禁止在本机运行 Playwright、浏览器、E2E 或用例收集。**“已改”指源码消费者或 owner 已有对应补丁；“待验”不等于已经通过 Actions。** 不将同一个 helper 修复自动记为整组回归通过。

| 序号 | 第五轮失败 spec（`tests/e2e/specs/`）      | 单项根因/证据                                                                             | 源码整改与剩余判断                                                                                       |
| ---- | ------------------------------------------ | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| 01   | `ui/login-captcha-surface.spec.ts`         | 测试问题：认证跳转后 CDP 无法读取 `response.json()`，401 与真实 CAPTCHA 警告均已出现      | 已改为保留 401 和页面实际 alert 证据，拒绝条件不变，待验                                                 |
| 02   | `ui/system-settings.spec.ts`               | 测试问题：保存成功后无 dirty draft，Save 按钮被正常禁用                                   | 已改保存完成断言为 disabled；仍逐次从真实 Preferences 读取持久值，待验                                   |
| 03   | `ui/theme-switching.spec.ts`               | 测试问题：寻找已撤除的“Link active bg color”旧 UI 标题                                    | 已定位当前 UI 最末 JSON 编辑区域、保留 footer 遮挡/几何断言，待验                                        |
| 04   | `ui/custom-terminal-theme.spec.ts`         | 待核实：编辑原始 JSON 后直接 Save，未观察到预期创建请求；源码有独立 blur 验证             | 已明确先 blur/验证无错再 Save；若远程仍无 POST 必须修真实保存路径，不视作完成                            |
| 05   | `ui/dashboard-workflows.spec.ts`           | 测试问题：WorkspaceService WS 建连不走 SessionOwner 的 `SSH_CONNECT_SUCCESS` 审计源       | 已移除无权期待的事件 ID，保留真实绑定成功、Dashboard recent 时间递增和随后 Terminal 恢复，待验           |
| 06   | `ui/backup-ui.spec.ts`                     | 产品问题：原生备份 file input 本身缺少圆角/边框/裁剪，computed-style 返回 0               | 已修正式 BackupSettingsPanel CSS，保留所有形状/窄屏断言，待验                                            |
| 07   | `ssh/terminal-protocol.spec.ts`            | 测试契约问题：1MiB 是未消费窗口上界，不是必须送满的下界，整帧不能分割                     | 用 Shared 最大窗口/最大帧校验，并检查 ping 后稳定平台期和全量续流，待验                                  |
| 08   | `ssh/file-list-profile.spec.ts`            | 待核实：5,000 项列表导航时旧目录仍显示，夹具 OPENDIR 曾逐个串行 `lstat`                   | SSH 隔离夹具按每 64 项有界并发读元数据、输出顺序与原容量/时限不变；仍须排除产品导航失败，待验            |
| 09   | `ssh/docker-manager-ui.spec.ts`            | 确认测试夹具问题：Docker `CreatedAt` 原为 number，正式 Docker parser 要求 CLI JSON string | SSH Docker fixture 改为真实文本字段；容器名、stat、按钮、布局原断言保留，待验                            |
| 10   | `ssh/file-document-preview.spec.ts`        | 确认测试清理错误：Preferences REST PUT 误传局部对象，缺版本与 `preferences` 正式包络      | 已改为 Shared CAS 全值写入；仍显式断言清理结果，不吞失败，待验                                           |
| 11   | `ssh/connection-list-search.spec.ts`       | 测试问题：可选 Preferences 读取失败不要求 Connection picker 同时显示全局 toast            | 已记录真实被中断 GET 次数并证明目标列表仍可用，待验                                                      |
| 12   | `ssh/quick-command-tags-variables.spec.ts` | 确认测试契约问题：调用 tag list 时带不支持的 `sortBy=name` 得到 400                       | 已核对待验 `support/commands.ts`：HTTP 仅发送 limit/offset，本地分页解码仍保留 name 排序；需独立远程复验 |
| 13   | `ssh/quick-command-management.spec.ts`     | 与 12 同 owner，但本用例失败在 cleanup 的 tag-list 读取                                   | 同一 Shared 消费修复已覆盖该调用，清理逻辑仍要求成功，不能因 12 通过而代替该 spec 结果                   |
| 14   | `ssh/binary-read-limits.spec.ts`           | `filesystem.writeText operation_unknown` 指向未协商 POSIX rename 的写入提交链路           | 已核对 SSH Adapter 协商后备补丁，预算/文件增长的测试断言未变；还需远程确认                               |
| 15   | `ssh/file-preview-editor.spec.ts`          | 编辑内容没有落地，与同轮 SSH rename 提交失败具有公共嫌疑                                  | 已有对应 SFTP 提交/清理修复；**真实文本保存仍待单独远程核对**                                            |
| 16   | `ssh/editor-save-profile.spec.ts`          | 远程临时文件提交失败，与 14/15 共享写入链但性能、临时文件收尾另有断言                     | 保留每项字节、超时和临时文件清理判据，需单独远程确认                                                     |
| 17   | `ssh/archive-cancel-recovery.spec.ts`      | 归档原生命令变为带 NEXUS marker 的 `sh -c`，旧 SSH 夹具错判 exec/路径                     | 已有脚本识别、虚拟路径/hold/计数补丁；取消和清理不能仅凭 helper 判 PASS                                  |
| 18   | `ssh/progress-display-archive.spec.ts`     | 隐藏任务找不到 Cancel，与执行 hold 未按新标记生效相符，尚不排除 UI 生命周期缺陷           | 已映射当前归档标记和执行 hold；需核对任务真的处于 running/cancelling 才能判定                            |
| 19   | `mobile/pad-file-gestures.spec.ts`         | 触摸菜单选择压缩后没有生成 ZIP，涉及同一归档执行与清理链                                  | 保留真实触摸取消/鼠标菜单/压缩文件判据；归档夹具补丁待单独远程确认                                       |
| 20   | `ssh/protocol.spec.ts`                     | detached Workspace 归档操作失败，涉及后台 native archive 执行流                           | 已核对归档命令映射修正；断开/续接后的结果回放单独待验，不用前台归档 PASS 代替                            |

**归类结论**：01、02、03、05、07、10、11、12、13 是测试契约/观察错误；06 是正式前端产品缺陷；09 是确定的 SSH 测试夹具数据类型错误。04、08 和 14–20 仍存在独立未验结果，不能说“20 份 E2E 已全部修复并通过”。这 20 份之外的第五轮失败、超时和 did-not-run 原范围继续保留，D18 不允许只交付这部分后推送。

#### 第二批 20 份失败 spec 逐项审查（2026-10-19；不代表远程通过）

#### 第三批：剩余 26 份第五轮失败 spec 逐项归因（2026-10-19；远程待验）

先将第五轮 67 份文件的去重索引减去前两批逐份记录：前两批记录本身含 3 份相交，所以并非只剩 19，实际上还有以下 **26 份**。已逐项对照 Actions `39210783294` 全八组日志的首失败位置：`HTTP 500` 是 owner close 真正抛错；同 shard 后续 `HTTP 503` 是测试控制服务拒绝重置、保护故障现场的**连锁阻断**，不把这一类归咎于对应页面，也不绕过 Fixture reset。恢复条件是底层 owner 确定清理、整个 spec 在新的八组远程 Actions 上独立重跑成功。

| #   | spec（相对 `tests/e2e/specs/`）            | 第六轮首个失败证据与本次行动                                                                                                                                                                                                                             | 当前状态                      |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| 01  | `agent/functional-regressions.spec.ts`     | A07 浏览器配置 PUT 400；A04 实际 Run-owned Job 状态 unknown，随后 ToolJobService.drain unknown 导致控制器 reset 500。部署服务关闭和等待 Job 状态的在途模型/夹具已核对；浏览器 PUT 400 的具体拒绝条件尚待确认，不能修改 granted security scope 猜测取绿。 | **独立待修/待验**             |
| 02  | `mobile/background-geometry.spec.ts`       | 该 shard 较早 Agent Job shutdown reset 500/503 后被阻断；无该用例布局断言的独立失败证据。                                                                                                                                                                | 受连锁阻断，未验收            |
| 03  | `ssh/small-upload-profile.spec.ts`         | 同 Agent shard reset 503，未触及原有 ready/commit/profile 断言。                                                                                                                                                                                         | 受连锁阻断，未验收            |
| 04  | `ssh/status-docker-protocol.spec.ts`       | 同 Agent shard reset 503，Docker/status 协议未执行。                                                                                                                                                                                                     | 受连锁阻断，未验收            |
| 05  | `ssh/workspace-layout-restore.spec.ts`     | 同 Agent shard reset 503，原 Workspace draft/layout 恢复未执行。                                                                                                                                                                                         | 受连锁阻断，未验收            |
| 06  | `ui/ssh-key-management.spec.ts`            | 同 Agent shard reset 503，SSH key CRUD、页面错误状态均未执行。                                                                                                                                                                                           | 受连锁阻断，未验收            |
| 07  | `websocket/authenticated-session.spec.ts`  | 同 Agent shard reset 503，密码轮换撤销旧 WS 未执行。                                                                                                                                                                                                     | 受连锁阻断，未验收            |
| 08  | `ssh/terminal-tools-ui.spec.ts`            | HTTP Quick Command GET 是 Shared 分页包络，旧 `commands.find` 抛 TypeError。已核对在途严格分页 helper 修复，不删除本 spec 操作及历史统计断言。                                                                                                           | 夹具消费者待远程验            |
| 09  | `mobile/ssh-workspace.spec.ts`             | 同一 shard 上一 Workspace/FileResource 未完成清理致 reset 500，重试 503；本 spec 未执行。                                                                                                                                                                | 受连锁阻断，未验收            |
| 10  | `mobile/touch-advanced.spec.ts`            | 接续 09 的 reset 503；任意文件系统 picker 未执行。                                                                                                                                                                                                       | 受连锁阻断，未验收            |
| 11  | `mobile/touch-workflows.spec.ts`           | 接续 09 的 reset 503；Guacamole/touchpad 模式未执行。                                                                                                                                                                                                    | 受连锁阻断，未验收            |
| 12  | `mobile/suspend-resume-ui.spec.ts`         | 两处独立失败：断开控制 WS 后 hanging 原 Workspace 元信息仍指旧 ID、ownershipState available（应重附着）；日志导出被阻断后页面提示不是已移除的旧 `Network Error`。已单独对齐当前安全 unknown 提示，真正复附着仍未完成。                                   | **前端/测试各一，复附着待修** |
| 13  | `ssh/download-network-profile.spec.ts`     | 80/200ms RTT 下 4MiB 下载拿到 200 headers，但旧 ssh2 ReadStream 顺序等 READ 导致 15s 请求超时。新 Platform Adapter 候选 8×32KiB 有界 READ，严格有序输出，字节 SHA256、原期限、无丢失约束不放松。                                                         | 产品性能补丁，远程待验        |
| 14  | `ssh/download-admission.spec.ts`           | 暂停 32MiB 下载超时、先前 8 个请求取消后恢复 GET 404。分析指向读流中断破坏原 Workspace SFTP lease；改 GET body 用独立 fingerprint 匹配资源；HEAD 原路由、资源授权/429/句柄计数不放宽。                                                                   | 产品隔离补丁，远程待验        |
| 15  | `ssh/progress-display-baseline.spec.ts`    | 前一下载相关 FileResource close unknown 导致 reset 500/503，未到 Progress Display 行为。                                                                                                                                                                 | 受连锁阻断，未验收            |
| 16  | `ssh/progress-display-upload-copy.spec.ts` | 同 15 reset 503，隐藏/取消上传复制没执行。                                                                                                                                                                                                               | 受连锁阻断，未验收            |
| 17  | `ssh/status-history-time-axis.spec.ts`     | 同 15 reset 503，时间轴与视口固定未执行。                                                                                                                                                                                                                | 受连锁阻断，未验收            |
| 18  | `ssh/suspend-log-compaction.spec.ts`       | 同 15 reset 503，压缩/恢复终端历史未执行。                                                                                                                                                                                                               | 受连锁阻断，未验收            |
| 19  | `ssh/terminal-session-cache.spec.ts`       | 同 15 reset 503，切换缓存/背景存续未执行。                                                                                                                                                                                                               | 受连锁阻断，未验收            |
| 20  | `mobile/dashboard-mobile.spec.ts`          | 该 shard 的 SFTP 上传清理先前 reset 500/503，移动端 Dashboard 根本未运行。                                                                                                                                                                               | 受连锁阻断，未验收            |
| 21  | `mobile/touch-preview-progress.spec.ts`    | 同 20 reset 503，移动端表格预览控件未运行。                                                                                                                                                                                                              | 受连锁阻断，未验收            |
| 22  | `ssh/file-upload.spec.ts`                  | 2 个真实断言：非图片 Ctrl+V 原远程复制没有出现目标文件；十文件拖入只看见前五个新增文件，后面 retry 发生 SFTP stage cleanup reset 500。已修补用户明确取消在 SFTP ACK 后再删除私有暂存的 owner 路径；粘贴与批量尾部缺文件仍不能据此判修复。                | **独立文件功能待修/待验**     |
| 23  | `ssh/progress-display-copy-cancel.spec.ts` | 同 22 SFTP 未确认 stage 删除致 reset 503，文件复制 cancel 断言尚未执行。                                                                                                                                                                                 | 受连锁阻断，未验收            |
| 24  | `ssh/search-network-profile.spec.ts`       | 同 22 reset 503，深树搜索性能阈值尚未执行。                                                                                                                                                                                                              | 受连锁阻断，未验收            |
| 25  | `ssh/sftp-download.spec.ts`                | 同 22 reset 503，ZIP 精确解压/RTT 下载尚未执行。                                                                                                                                                                                                         | 受连锁阻断，未验收            |
| 26  | `ssh/terminal-ui.spec.ts`                  | 同 22 reset 503，移动端终端主题完整覆盖尚未执行。                                                                                                                                                                                                        | 受连锁阻断，未验收            |

技术根因复审：第六轮的原始 nested AggregateError 明确存在 `ToolJobService.drain -> ToolExecutionUnknown` 和 `RemoteFileService/FileResource.stage.discard -> RemoteResourceCleanupFailure` 两条独立 shutdown 链，某些 copy 前置读失败还会留下无法证明删除的 stage。**测试控制服务 `failed=true` 是必要安全围栏，禁止在 reset 辅助入口自动抹平未知清理或跳过后继用例**。本次先改的 SFTP 并发 READ、独立下载连接与用户预提交 cancel drain 只是有根因依据的源码修复候选；A07 配置 PUT400、移动端悬挂会话断线重附着、粘贴与多文件上传尾项以及上一批 20+20 中未决根因，均继续留在 D18 提交阻断列表。没有任何新八组结果，不宣称远程已绿。

本次后续静态复审补充（仍不属于远程 PASS）：

- A04 后台 Job 之前把本次 `shell_execute` 操作的短期限 AbortSignal 注册为持久 Job 的 owner，导致工具调用已经提交但 Run 尚未结束时，超时信号仍能异步中止后台命令；ToolService 现在将 Job 的取消 owner 改为整个 Run 的信号，JobService 依旧独立维护 45s 期限、授权重验及最终 Root drain，不延长命令上限。A04 的 `unknown` 还需要验证是否有其他来源，不能只凭此修改宣称 completed。
- 同一份 suspended mark 的 `originalWorkspaceId` 是 backend 不变的原始 Workspace ID，二次/三次 resume 的新 `workspaceId` 不再与其相等。旧 foreground 自动恢复按新 ID 查 `originalWorkspaceId` 必然找不到；前端新增只读的 stable `associatedSuspendedSessionId` 和按 suspension ID 的精确匹配，恢复时复用 disconnected tab 槽位。调整移动端断线 E2E 对 original ID 的错误期待，但继续断言新恢复 ID、唯一 tab、backend attached 和原 PTY 状态。
- 多文件上传 Frontend 将每个 Workspace 同时建立的 SSH/SFTP upload 限定为六个，尾项排队，避免浏览器 CPU 数量触发全部在途 SSH 资源开启。**这只是并发容量候选**；十文件实际完整字节/覆盖/跳过以及对高性能下载的独立吞吐检查仍为阻断验收项。
- A07 的同一个 PUT `/browser/configuration` 400 **也出现在另一个 shard 的** `agent/preset-plugin.spec.ts` Browser lifecycle 和 child Browser 用例，并非 Deployment fixture 独有。两处请求都走 `requestAgentJson` 和 Browser configuration Shared 严格解码；目前还不能确定是 HTTP 输入拒绝、客户端序列化、还是 Browser Service 的 validation/refusal。绝不放宽 URL allowlist、TLS、权限或 400 断言以制造成功，继续视为跨 spec 根因。

证据为完整完成的 Actions [39210783294](https://github.com/0honus0/nexus-terminal/actions/runs/39210783294)：`96e24d5c`，Checks/Build 和 Docker smoke 成功、8 个 Playwright shard 均失败。本批仅源码核对与修正，未提交的修改未出现在这轮 Actions 中。既有补丁必须按该 spec 的独立断言复验；绝不因为修复共享 fixture 而宣布相邻用例通过。

| #   | spec（`tests/e2e/specs/` 下）              | 逐项证据与分类                                                                                                             | 本地处理及真实待验条件                                                                                                                                                                                             |
| --- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 01  | `agent/host.spec.ts`                       | 设置领导者保存成功提示缺失原因待核；旧断言假定 App 列表只有 1 项，误将仍存在的 onboarding plugin GET 认作废弃 404          | 增加实际 leader PUT 200 判据；列表检查测试新建 App 的完整对象而非禁止内置 App；对当前推荐插件 GET 只接受 Shared 成功或确定的 503 `provider_unavailable`。并发草稿、CAS 409、安全 socket 拒绝及外部目录仍须独立验收 |
| 02  | `agent/preset-plugin.spec.ts`              | 第一个 appId 文本匹配命中不可见 option；并非插件在 UI 上没有安装                                                           | 保留 option 唯一值检查，增加真实可见安装 `article` 断言；isolated SDK、完整 Surface、写入隔离待验                                                                                                                  |
| 03  | `agent/ssh-acp-settings.spec.ts`           | Shared 定义 `integration.acp.invoke` 使用 global grant，不接受 targets；测试传了失效 scope 得 400                          | 复核已在途 global scope 补丁；不放松 inner permission 拒绝/取消与 Workspace 配置断言，待验                                                                                                                         |
| 04  | `http/auth-2fa.spec.ts`                    | 2FA 登录成功后 CDP body 被导航释放                                                                                         | 对两处首因素成功保留 HTTP 200，验证真正出现并可用 TOTP token 字段/后续拒绝与登录状态，不继续读取已失效正文，待验                                                                                                   |
| 05  | `http/auth-api.spec.ts`                    | Telegram botToken 必须为数字 ID 加分隔的合法格式，旧测试秘密在创建时即被输入校验拒绝                                       | 复核在途格式合法但仍用于检查**全响应不含秘密**的 token；邮件及 Telegram 两侧 redact 判据不变，待验                                                                                                                 |
| 06  | `http/backup.spec.ts`                      | 错密码跨实例导入实际返回正式 `401 invalid_password`，旧测试写死 400                                                        | 已有补丁与正式错误状态一致；仍断言未改连接与备份数据、完整恢复及 unknown 语义，待验                                                                                                                                |
| 07  | `http/rdp-remoteapp.spec.ts`               | `                                                                                                                          |                                                                                                                                                                                                                    | notepad`是传入的规范 RemoteApp ID，旧测试错误期待去掉` |     | `   | 已核对原值持久化断言修正，不改票据或 RemoteApp 安全验证，待验 |
| 08  | `http/architecture-contracts.spec.ts`      | SSH Key audit 期望三项含真实 userId，远程实际匹配 0；曾发现 Targets 回执不含 user                                          | 已核对 Observer 在执行前按可信 session 识别 actor、仍不读私钥正文；**不能仅凭该补丁推定 0 已解决**，待远程核实三个事件、路由、ID、审计数据保密                                                                     |
| 09  | `ui/proxy-management.spec.ts`              | `POST` 返回 201 后页面导航，CDP body 不可读                                                                                | 已有补丁读真实已保存列表找唯一 ID 再 GET 详情；保留密码 keep/update/clear 与 320px UI 检查，待验                                                                                                                   |
| 10  | `ui/notification-settings.spec.ts`         | 320px 下事件名标签的匿名 flex 文本撑出布局至 ~371px，属于产品布局问题                                                      | 正式 `NotificationSettingForm` 固定 checkbox、允许长事件字换行、行宽限幅；保留每个 label right、所有事件和值及保存可用性断言，待验                                                                                 |
| 11  | `ui/change-password.spec.ts`               | APIRequestContext 重新登录后浏览器仍停留 `/login`，`reload()` 无 Security 标签可点击                                       | 改为显式 `goto('/settings')` 后进入 Security，仍校验旧会话 401、换密后新凭据和最终恢复，待验                                                                                                                       |
| 12  | `ui/ip-blacklist-settings.spec.ts`         | Reka UiCheckbox 原测试选 switch 角色存在定位变更，根因应继续核实 UI 配置装载                                               | 已有补丁按 `[data-ui=checkbox]` 并保持 `aria-checked=true`，依旧验证重启生效/解封，待验                                                                                                                            |
| 13  | `ssh/file-manager-navigation.spec.ts`      | favorite GET 返回 Shared 分页包络而非可迭代数组                                                                            | 已核对带排序、偏移、版本的分页 decoder 与删除重排处理；逐条导航、收藏持久化、空态需复验                                                                                                                            |
| 14  | `ssh/reconnect-ui.spec.ts`                 | command-history cleanup 旧数组假设；同时多次重连没在 12s 达标及部分 Tab 不可见是**独立未解**                               | 已核对有界分页 history decoder；禁止用其掩盖重连/终端生命周期问题，待检查实际重连节奏与 Pane/Tab owner                                                                                                             |
| 15  | `ssh/panel-wheel-scaling.spec.ts`          | Preferences 写入旧 `type/size` 列宽字段导致 400                                                                            | 已核对三处使用新列宽键 `name/permissions/modified`，保留快速滚轮、乱序写响应安全与尺寸上下界，待验                                                                                                                 |
| 16  | `ssh/upload-protocol.spec.ts`              | ssh2 单块写回执串行导致 60ms/packet 下超时，为正式产品性能问题                                                             | 已核对真实 FileResource 有界 16KiB/512KiB 并发确认和 uncertain fencing；原 10s 与独立服务端并发统计均不降低，待远程验证                                                                                            |
| 17  | `ssh/file-upload-reconnect-stress.spec.ts` | overlap cancel/transport loss/reset 后 Backend reset 得 `not_found`，可能是取消/资源退场连锁，不是普通夹具 assert          | **待核实根因**，本批不跳过 8 轮、不把 404 改成 PASS，也不吞取消/清理失败；需进一步审查 owner 的 reset 收尾                                                                                                         |
| 18  | `ssh/connection.spec.ts`                   | UI Add 保存正式接口是 `POST /targets/connections/import` 200，不是旧 `POST /targets/connections` 201                       | 已改匹配正式接口且只读确认唯一持久连接，保留真实 SSH 测试、终端及 SFTP ready 断言，待验                                                                                                                            |
| 19  | `ssh/suspend-resume.spec.ts`               | gated file init 释放后 `terminal.currentDirectory` 返回 `remote_unavailable`，属 ShellIntegration/会话生命周期独立技术问题 | **待核实**，已追踪 WorkspaceService → WorkspaceShellService → NativeShellIntegration 的 currentDirectory；不能删除 cwd 断言或简单扩大超时取绿                                                                      |
| 20  | `ssh/cross-session-transfer.spec.ts`       | 新连接在 Workspace 绑定时被 Host Key trust 拒绝                                                                            | 已核对调用可信主机密钥确认入口的在途补丁，仍须验证真实跨会话字节、progress、取消与危险目标拒绝，待验                                                                                                               |

**本批范围状态**：完成 20 份的原始失败点、契约和对应 owner 静态审查；有针对性代码/fixture 修复，`#01`、`#08`、`#14`、`#17`、`#19` 等仍含明确未解决的独立问题。此表不能用于从 67 份失败清单划掉 20 份；本地没有执行行为测试、浏览器、用例收集或 E2E，D18 统一推送前必须继续二轮复审与全量静态门禁。

第二批阶段静态证据：Node 22.16.0／workspace pnpm 11.26.0 已复用，E2E 67 份 strict TS 配置 `pnpm --filter @nexus-terminal/frontend exec tsc6 --noEmit -p ../../.agent-tmp/e2e-review-tsconfig.json` exit 0；本轮末 `pnpm run check` exit 0，`pnpm run build` exit 0（Backend TS 与 Frontend vue-tsc/Vite），`pnpm run format:all:check` exit 0（包含 Frontend、Tests 及 doc），`git diff --check` exit 0；改动的 SSH server `node --check` exit 0。以上均为静态验证，未调用 Playwright、浏览器或本地 E2E。后续变更仍须复跑；两轮全量源码复审及八组远程验证尚未结束，因此不提交推送。

静态阶段检查更新（同次接手，**不包含任何本地行为/E2E**）：workspace 永久安装 `.toolchain/node-v22.16.0-linux-x64`，官方 SHA-256 校验通过，Corepack 使用项目 pnpm 11.26.0，目录仅加入本地 Git exclude。`pnpm run format:all` 覆盖包括 frontend 在内的全仓 ESLint 自动整理和 Prettier，随后 `pnpm run check` exit 0、`pnpm run build` exit 0、`pnpm run format:all:check` exit 0。对本轮变更的 `functional-model.mjs`、`startup-failure/server.mjs`、`test-ssh-server.mjs` 执行 `node --check` 均通过。沿用 `.agent-tmp/e2e-review-tsconfig.json` 对覆盖 67 份失败 spec 的现有严格 TS 静态检查，最初发现 `native-task.ts` 漏导入 `AGENT_THREAD_MAX_PAGE`，已修复并复跑 exit 0。上述是**阶段静态证据**；文件仍有后续修改，需在最终提交前重跑。没有本地 Playwright、浏览器、用例收集或行为测试。

第五轮产品/测试错误分类核实：`SshSftpLease.replace` 未协商扩展的错误映射、`SftpFileResource.streamStage` 在 ssh2 写流串行 WRITE 下的上传性能、`operation-observer` 丢失 Target CRUD 操作者 ID，均为**已确认的产品代码问题**（补丁仍待远程）。`native-task.ts` 漏导入、Browser URL、ACP scope、分页数组假设、错误列宽、Agent A04/A05 夹具不结束持续 Job、旧归档 marker、导航后 CDP 正文获取和 IP Checkbox 选择器，为**已确认测试/夹具或测试消费者假设问题**（均待远程）。归档安全清理、下载网络延迟、挂起恢复、Agent Host、移动和其他独立 spec 均标记**根因待核实**。不能因产品与测试各有局部修正便将 67 份 spec 标记通过；八组最新远程验证仍未发生。

以下按完整reporter标题收集，含连锁阻断和timedOut；不是已修复清单。同一文件跨分组出现时仍逐组核对。

| 分组 | 需核对的 spec（相对 tests/e2e/specs）                                                                                                                                                                                                                                                                                                                                                           |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `agent/functional-regressions.spec.ts`、`mobile/background-geometry.spec.ts`、`ssh/small-upload-profile.spec.ts`、`ssh/status-docker-protocol.spec.ts`、`ssh/workspace-layout-restore.spec.ts`、`ui/ssh-key-management.spec.ts`、`websocket/authenticated-session.spec.ts`                                                                                                                      |
| 2    | `agent/preset-plugin.spec.ts`、`agent/ssh-acp-settings.spec.ts`、`ssh/archive-cancel-recovery.spec.ts`、`ssh/docker-manager-ui.spec.ts`、`ssh/editor-save-profile.spec.ts`、`ssh/quick-command-tags-variables.spec.ts`、`ssh/terminal-protocol.spec.ts`、`ssh/terminal-tools-ui.spec.ts`、`ui/change-password.spec.ts`、`ui/dashboard-workflows.spec.ts`                                        |
| 3    | `http/rdp-remoteapp.spec.ts`、`ssh/binary-read-limits.spec.ts`、`ssh/file-list-profile.spec.ts`、`ssh/file-upload-reconnect-stress.spec.ts`、`ssh/panel-wheel-scaling.spec.ts`、`ui/login-captcha-surface.spec.ts`、`ui/proxy-management.spec.ts`                                                                                                                                               |
| 4    | `agent/host.spec.ts`、`http/auth-2fa.spec.ts`、`mobile/ssh-workspace.spec.ts`、`mobile/touch-advanced.spec.ts`、`mobile/touch-workflows.spec.ts`、`ssh/connection.spec.ts`、`ssh/suspend-resume.spec.ts`、`ssh/upload-protocol.spec.ts`                                                                                                                                                         |
| 5    | `http/auth-api.spec.ts`、`mobile/pad-file-gestures.spec.ts`、`mobile/suspend-resume-ui.spec.ts`、`ssh/download-network-profile.spec.ts`、`ssh/protocol.spec.ts`、`ssh/quick-command-management.spec.ts`                                                                                                                                                                                         |
| 6    | `http/architecture-contracts.spec.ts`、`ssh/download-admission.spec.ts`、`ssh/file-preview-editor.spec.ts`、`ssh/progress-display-archive.spec.ts`、`ssh/progress-display-baseline.spec.ts`、`ssh/progress-display-upload-copy.spec.ts`、`ssh/status-history-time-axis.spec.ts`、`ssh/suspend-log-compaction.spec.ts`、`ssh/terminal-session-cache.spec.ts`、`ui/ip-blacklist-settings.spec.ts` |
| 7    | `http/backup.spec.ts`、`ssh/file-document-preview.spec.ts`、`ssh/file-manager-navigation.spec.ts`、`ssh/reconnect-ui.spec.ts`、`ui/custom-terminal-theme.spec.ts`、`ui/notification-settings.spec.ts`、`ui/system-settings.spec.ts`、`ui/theme-switching.spec.ts`                                                                                                                               |
| 8    | `mobile/dashboard-mobile.spec.ts`、`mobile/touch-preview-progress.spec.ts`、`ssh/connection-list-search.spec.ts`、`ssh/cross-session-transfer.spec.ts`、`ssh/file-upload.spec.ts`、`ssh/progress-display-copy-cancel.spec.ts`、`ssh/search-network-profile.spec.ts`、`ssh/sftp-download.spec.ts`、`ssh/terminal-ui.spec.ts`、`ui/backup-ui.spec.ts`、`ui/connection-create.spec.ts`             |

### 终端动态背景重构审查（2026-10-19）

用户确认仅 HTML 动态背景，无图片；两会话中长期隐藏的一方切回后偶发空白，要求整体审查并直接重构，不保留旧兼容代码。

源码缺口：原 ready 与 iframe 加载依赖 TerminalView 的 FitAddon／动画帧测量，props.active 和 KeepAlive 状态没有作为背景消息的显式输入；父级消息只根据 iframe 尺寸判断 visible，隐藏时内部 viewport 可能仍非零，ResizeObserver 又可能合并同尺寸切换。原沙箱恢复保留失效 RAF ID；减少动态效果后 canvas resize 清屏却不补画。KeepAlive 失活还主动销毁背景文档。

新 owner：use-terminal-background 独立持有挂载、实际可见状态、观察和恢复，主题隐藏期间延后新 srcdoc，普通切换保留文档。terminal-background-document 合并原 runtime 和内嵌 resize bridge，统一几何／动画状态；每个可见待绘制帧有 100ms 期限，旧回调有 generation，移动端保持至少50ms节流，减少动态效果下尺寸变化／恢复允许一次静态补画。旧 mobileBackgroundRuntime 删除，全部源码消费者改用新入口；原 CSP 与 sandbox 权限不放宽。

第一轮沿 Appearance 管理／Store→Workspace visual／active→TerminalView→composable→沙箱复核职责与内容，第二轮核对初次非零尺寸、active 与预渲染错序、加载后隐藏、同尺寸切换、恢复、RAF 超期与晚回调、减少动态效果、KeepAlive 和卸载。内置主题按当前保存副本消费，不为旧主题增加兼容重写；不保证第三方主题自身错误、缺失 resize、外部依赖或 WebGL context 丢失可自动修复。

本机基线 dev／8fa1713c、Node22.23.1／pnpm11.26.0。Frontend build exit0（含 vue-tsc），日志 `/tmp/nexus-background-refactor-build.log`；背景三文件 ESLint exit0，日志 `/tmp/nexus-background-refactor-eslint.log`；本批源码与四份文档 Prettier exit0，日志 `/tmp/nexus-background-refactor-focused-format.log`。提取桌面／移动 runtime 后分别 `node --check /tmp/nexus-background-runtime-{0,50}.js` 均通过，仅语法编译，没有执行 DOM／动画；旧源码入口搜索无残留，`git diff --check` 通过。根 check exit1：Frontend ESLint通过后，在其它在途 `packages/backend/src/modules/remote/files/model/file-resource.ts:590–599` 的两处空行及一处 curly 失败（`/tmp/nexus-background-refactor-check.log`）；全仓格式同样受该文件及 `tests/e2e/support/test-ssh-server.mjs:191–192` 两处空行阻断（`/tmp/nexus-background-refactor-format.log`）。不覆盖这两份其它在途修改，不将专项检查计为根门禁通过。按 D17 未新增或执行本地行为／浏览器／E2E；后续远程需补充并验收：两会话同尺寸切换和长期后台、快速切换与主题加载错序、RAF延后／取消后晚回调、移动限帧、减少动态效果 resize／恢复、KeepAlive／卸载及真实用户主题。现有 background-geometry 两项只覆盖原尺寸与暂停范围，不能作为本轮行为 PASS。

## 通用滚轮缩放重构审查（2026-10-19）

基线 dev / `8fa1713c`，含本轮未提交源码及其它在途变更；Node v22.23.1、pnpm 11.26.0。用户确认文本文件字体缩放反向跳动，并要求统一模块、替换已有实现；按 D17 未新增或运行本地行为测试、浏览器专项、E2E 或用例收集，也未提交、推送或触发 Actions。

源码定位：Monaco 原监听在冒泡阶段修改字号，内部滚轮已可能滚动；字体旧保存返回时 Appearance accept 清空未结算预览，且连续保存携带手势时旧版本。Files/Status/Quick Commands 同样存在旧版本自动保存或缺少预览保护的链路。它们均是本轮已确认的源码风险，未冒充浏览器复现证据。

实现：useWheelScale 统一捕获阶段监听与清理、步进、即时值/外部值同步、可选同步/渲染后视口恢复及代次。六处实际消费者已替换，没有旧组件 resolver 或缩放 wheel 绑定。Monaco 通过模型位置和屏幕偏移保持位置；Files 虚拟列表合并同一轮渲染前的定位，核对 DOM/内容身份，关闭浏览器自动锚定。Appearance/Presentation 在各自串行队列内读取即时设置版本，仅修改所选缩放字段；普通编辑草稿仍保留原版本冲突。Workspace 持有最新未结算预览，旧保存结果不能清空其它待保存字段。

两轮源码审核覆盖：六处事件路径、普通滚动与 Terminal 历史加载、鼠标/双指设置入口、props 回读、同字段连续保存、跨字段队列、外部冲突/未知失败、目标替换及卸载后恢复取消。架构八节及接入示例见 Frontend 的“通用滚轮缩放”，产品操作见 USAGE 文件编辑/工作区/个人偏好章节。

| 检查                              | 结果与证据                                                                                                                          |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Frontend build（vue-tsc + Vite）  | 通过，退出 0；`/tmp/nexus-wheel-build.log`。首轮发现重复 style 属性，已合并并通过最终重跑。                                         |
| Frontend ESLint                   | 通过，退出 0；`/tmp/nexus-wheel-frontend-eslint.log`。                                                                              |
| 本轮源码和文档 Prettier           | 通过；`/tmp/nexus-wheel-focused-format.log`，文档回填后再核对。                                                                     |
| 根 `pnpm run check`               | 前端通过，后端失败：其它在途 `file-resource.ts:590/591/599` 的 function-spacing/curly；`/tmp/nexus-wheel-check.log`。               |
| `pnpm run format:all:check`       | 失败：上述后端问题及其它在途 `test-ssh-server.mjs:191/192` 的 function-spacing；`/tmp/nexus-wheel-format.log`。不覆盖其它任务修改。 |
| `git diff --check` / 旧消费者搜索 | 通过；resolver 仅在 foundation 内实现和使用，六个功能均使用 useWheelScale。                                                         |

远程待验：文本长文件滚动到中部后缩放，短行/自动换行/鼠标位于空白区/文件首尾；字号与比例上下限，小 delta、大 delta、连续同向、反向惯性和显式反转；旧保存延迟期间继续缩放并同时调整其它面板；保存失败、版本冲突及重新加载；虚拟列表中部快速缩放/切目录；六处普通滚动、终端顶端历史加载与鼠标接管；双指入口；v-if 重挂载和卸载后无恢复回调。本轮静态结果不代表以上行为已通过。

## 普通文本编辑器搜索修复审查（2026-10-19）

基线 dev / `8fa1713c` 加未提交工作区；Node v22.23.1、pnpm 11.26.0、Monaco 0.56.0。用户报告普通文件 Ctrl+F 图标方块、结果跳转正文不动及上方提示被遮挡。按 D17 未新增/运行本地行为测试、浏览器测试、E2E 或用例收集；未提交、推送或触发 Actions。

源码及产物原因：原 Codicon `@font-face` 只出现在 `jsonMode-*.css`，普通文本没有稳定的加载路径；Monaco 宿主冒泡 click 无条件 focus 正文，干扰搜索框和按钮；内置 HoverWidget 的上下布局只检查 window 高度，未检查实际编辑器/弹窗祖先的 overflow 裁切，窗口上方有空间不代表提示可见。前两者已由组件显式字体依赖和移除宿主 click 修复；提示通过版本固定的 ESM HoverWidget 补丁计算真实垂直可用区域并限制高度。查找/替换匹配、导航和 reveal 仍由原 FindController 管理，不新增外层选区或滚动回写。

Monaco 补丁为 `scripts/patches/monaco-editor@0.56.0.patch`，pnpm workspace/lock 同步绑定 hash `c23d454741b9c602522924706171e4362a6cf35302051169b54531f4484538e7`；安装从缓存完成，无下载。补丁仅覆盖正式 Vite 使用的 ESM 入口，不声明 AMD/min 入口也已修复。两轮源码复审核对目标文档、父级裁切、上下空间均不足、显式位置/forcePosition、原提示生命周期，以及组件搜索入口/焦点/滚动记录。

| 检查                               | 实际结果与证据                                                                                                                                                                                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frontend build（vue-tsc + Vite）   | 退出 0，`/tmp/nexus-search-build.log`。                                                                                                                                                                                   |
| 根 `pnpm run check`                | 退出 0，包含前后端 ESLint、Frontend type check、Shared build 和 Backend type check；`/tmp/nexus-search-check.log`。                                                                                                       |
| 全仓 `pnpm run format:all:check`   | 退出 0，`/tmp/nexus-search-format.log`。                                                                                                                                                                                  |
| 组件和 Vite 配置专项 ESLint        | 首轮发现 Vite 配置原有两处函数间距，已修复；最终退出 0，`/tmp/nexus-search-focused-eslint.log`。                                                                                                                          |
| 专项 Prettier / `git diff --check` | 均通过，退出 0；`/tmp/nexus-search-focused-format.log`。                                                                                                                                                                  |
| 补丁安装与 JS 语法                 | `pnpm patch-commit` 缓存安装成功；对实际安装的 ESM hoverWidget 执行 `node --check` 退出 0，`/tmp/nexus-monaco-patch-commit.log`。                                                                                         |
| 构建字体依赖图                     | `/tmp/nexus-search-assets.log`：FileEditor 预加载依赖包含 `MonacoEditor-CeKmAFMc.css`，该文件直接声明 Codicon font-face，指向已打包 `/assets/codicon-Brq4_Ui5.ttf`；不需先打开 JSON。此为静态产物核对，非浏览器加载证据。 |

远程待验：首次只打开普通 txt/日志，不打开 JSON 时搜索图标；Ctrl/Cmd+F、点击输入框后持续输入、Enter/Shift+Enter/上下按钮导航到长文件首中尾并核对选区与 scrollTop；开关大小写/整词/正则，替换单项/全部和只读拒绝；鼠标/键盘提示在顶端、窄栏、短面板和弹窗内不被裁切，正则校验消息可读；两个编辑器切换、背景标签关闭、缩放与搜索并用。静态通过不能代替这些交互验收。

## 第八轮远程 Actions #39239518815：失败定位与在途修正（2026-10-19）

远程 `dev` HEAD `30aaa70c73d7b593857e4f749fe1c2ba2382cc79`， [Actions #39239518815](https://github.com/0honus0/nexus-terminal/actions/runs/39239518815) 的 Checks/format/build、Docker smoke 均 PASS，八个 E2E shard 均 FAILURE。完整八组原始 job logs 已分别读取，首次错误和后续 reset 失败明确分开：shard 2 Agent Task `ToolExecutionUnknown -> RemoteMachineOperationError(operation_unknown)`，shard 4 上传 WS abort 后暂存 `abort/discard(operation_unknown)`，shard 6 cross-session copy `append/discard(operation_unknown)` 都产生真实 Root owner cleanup unknown；其后对应 500/503 的 spec **没有执行自身的用例断言**，严禁视为已修复或通过。以下候选均尚未在下一轮 Actions 验证。

| spec / owner                                                                                                                                                                         | 第八轮确切失败与修改或阻断                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/captcha-settings`                                                                                                                                                                | 确认 GET `/settings/captcha` 是公开生效视图，没有 `version` 字段；此前误用 `readSettingsCaptchaResponse` 导致 Shared 拒绝。已改为认证 GET `/settings` 的正式持久设置 decoder；PUT 状态、版本、启动前生效围栏、secret 断言不放宽                                                                                                         |
| `ui/system-settings`                                                                                                                                                                 | Save 成功且无脏草稿后 disabled；改回确认 disabled，仍校验实际 PUT 和后端持久值                                                                                                                                                                                                                                                          |
| `agent/host`                                                                                                                                                                         | 前轮 `Concurrent Model Calls` 文案大小写写错；更进一步发现 Run 限额不得低于 Model Calls，改以可独立下调的 `Concurrent model calls` 进行并发版本冲突审查，仍要求真实 200/409                                                                                                                                                             |
| `ui/ssh-key-management`, `agent/ssh-acp-settings`                                                                                                                                    | 创建 HTTP 200/201 已收到，浏览器在页面关闭或编辑器重渲染时 CDP response body 丢失；改为真正已保存列表按名称/配置的唯一匹配并读取正式 credential/version，无重复 mutation                                                                                                                                                                |
| `ssh/sftp-download`                                                                                                                                                                  | 确认 429 response body 为 `{ message: 'limit_exceeded' }`，不是 `{ code }`；仍要求有效票据不逐出、文件变化失效与容量限制                                                                                                                                                                                                                |
| `ssh/connection-list-search`                                                                                                                                                         | 正式按钮叫 `Save Associations`，并非 `Save`；Tag 改名和成员写入仍分开校验                                                                                                                                                                                                                                                               |
| `ui/theme-switching`                                                                                                                                                                 | 错误仓库域名 `example.com` 在 Shared client codec 就被拒绝，绝不会发送 PUT/GET；现确认提示错误、没有不安全网络请求、原 Repository/HTML 状态不变，仍校验之后合法空值提交                                                                                                                                                                 |
| `agent/functional-regressions`                                                                                                                                                       | A07 的未知 Run 由 API 独立 cancel 后，已挂载 Hub 的 composer 仍处上轮状态；显式重新读取实际 Hub/Thread 后再提交新用户 intent，不重用 unknown 写入                                                                                                                                                                                       |
| `ssh/file-manager-navigation`, `ssh/suspend-resume`                                                                                                                                  | ShellIntegration 只能在已验证 prompt 安装 hook，用户已经输入 shell 命令时不允许临时注入探针；调整测试为用户输入或 suspend.prepare **之前**验证当前 cwd / 安装 hook，其他 Shell 历史和恢复断言不删                                                                                                                                       |
| `ssh/file-list-profile`                                                                                                                                                              | 大目录仍未在原 10 秒断言内导航完成；测试 SFTP fixture 使用有界 256 项 metadata batch、256 项以内的 NAME 消息以减少 RTT 回合，不改变正式应用 5,000 项、最大时限及渲染边界，远程待验                                                                                                                                                      |
| `ssh/progress-display-archive`                                                                                                                                                       | 二次源码复核确认前一候选断言不符合当前状态机：`WorkspacePage.hiddenProgressSources` 过滤 `cancelled`，`transferController` 在确认终态后自动移除；因此隐藏任务不能再等待 `Cancelled` 文案或 `Remove` 按钮。已纠正测试为等待隐藏，并继续按原场景验证取消后远程 ZIP／解压内容不存在；第八轮真实取消后行未隐藏的根因仍未确定，不能计 PASS。 |
| `mobile/suspend-resume-ui`                                                                                                                                                           | 二次恢复后的 suspended mark `originalWorkspaceId` 应仍为第一次 ID；旧测试错误地寻找二次 Workspace UUID，修正为不可变原始 ID，保留最新 attached/日志恢复判据                                                                                                                                                                             |
| `mobile/touch-preview-progress`                                                                                                                                                      | 全局最后一个隐藏 file input 不一定属于当前活动 File Manager；测试明确作用域到打开的 File Manager，真实多文件上传和浮窗尺寸断言仍保留                                                                                                                                                                                                    |
| `ssh/terminal-ui` + Auth Store                                                                                                                                                       | 失败 logout POST 使 auth store 先本地退出并销毁 Workspace，但拒绝响应后仍需通过只读 `/auth/status` 核对旧凭据才可恢复相同主体显示错误；真正服务端登出已成功时绝不恢复本地身份，身份/清理失败不吞。新代码复核还未经过远程                                                                                                                |
| `ssh/upload-protocol` + FileService                                                                                                                                                  | 断开二进制 WS 只表明 transport 中断；当前后端立即 abort 专属 SFTP signal，导致已完成 ACK 的私有 stage 也无法 discard。改为对未提交、还活着的 stage 先中止业务接收并等待写入工作者归还/删除，返回状态仍 `operation_unknown` 而非成功/取消；真正 SFTP 失效或已进入 commit 则保留不确定性及 cleanup ledger                                 |
| `ssh/workspace-layout-restore`, `agent/preset-plugin`, `ssh/protocol`, `ssh/cross-session-transfer`, `ssh/upload-protocol` 的 socket CLOSE、`ssh/reconnect-ui`, `ssh/file-upload` 等 | **未解决独立主因**；明确留在下一轮阻断清单，不通过延长性能/安全门槛或只修公共 fixture 认定通过                                                                                                                                                                                                                                          |

第八轮后续定向审阅：shard 6 的 `progress-display-baseline` 首个视觉测试在 3 秒写延迟下启动真实 SFTP 复制，关闭弹窗后没有等待远端目标安装，即允许下一个 Backend isolated reset 抢先关闭 copy lease，随后日志显示 `copyOneFile.append -> discard` 双重 unknown。已在 `tests/e2e/specs/ssh/progress-display-baseline.spec.ts` 补充关闭视觉用例前回到文件管理器，严格确认路径为 `/folder-seed` 且目标文件可见；另一项浮窗遮挡测试也在结束前确认相同目标。此修补避免把根目录原始同名源文件当完成证据；未改变生产清理的 unknown 围栏，也尚未证明所有跨会话 copy / stage 出错由此解决。Archive 隐藏取消记录的源码所有者契约另如上纠正，实际取消时后端可能仍有真实失败，远程待判。

本阶段允许的静态门禁：根 `pnpm run check` 已通过（ESLint、Shared build、Frontend/Backend 类型），`pnpm run format:all:check` 已通过；改动后仍需最终再核对，Backend/Frontend build 与其它静态语法门禁在进行中。没有运行本地 Playwright/E2E/浏览器或用例收集；本次未提交推送。

本次本地严格遵循 D17：只读 Logs、源码差异审查、TypeScript/ESLint/Prettier/前后端 Build/纯 JS 语法静态门禁；不启动任何 E2E、浏览器或测试用例收集。未完成独立根因与全量两轮复审前，不在未授权情形下继续推送。

## 第七轮远程 Actions #39226129870：全八组反馈与当前补丁（2026-10-19）

### 第八轮远程复核（Actions 39239518815，dev 30aaa70c）

2026-10-19 已取得完整八个 shard 的原始 job 日志：Checks/format/build、Docker smoke 均 PASS；8 个 Playwright shard 均失败。按 reporter 每个 shard 去重的失败 spec 计数分别为 **3 / 13 / 1 / 6 / 3 / 6 / 4 / 6**（总计 42 个 shard 内首次失败文件计数；未据此断言 42 个独立根因）。shard 2 出现 `ToolExecutionUnknown -> RemoteMachineOperationError(operation_unknown)`，随后多个 spec 被 isolated reset HTTP 503 阻断；shard 4、6 分别出现上传 stage `abort/discard` 和 copy stage `append/discard` 的 `RemoteResourceCleanupFailure`，同 shard 后续 503 属未执行、不能删覆盖。

本次第八轮核对新增的独立证据和处理：`agent/ssh-acp-settings.spec.ts` 保存集成后已使用只读 GET 校验唯一持久记录，但随后创建 Agent Run 仍从可能导航丢失的浏览器 CDP response 读取正文；改为捕获**同一次**真实 POST 上游响应并回交浏览器，再用原 Shared codec 验真实 Run ID，不重发 mutation。`RemoteFileService.finishUpload` 先前只在用户明确 cancel 时保留 SFTP lease drain 已派发的 stage WRITE；在二进制 WebSocket 丢失、服务端收到 upload.abort、**尚未提交 stage** 的情况下仍先 abort SFTP，导致 REMOVE 无法确认。现将这条明确的预提交清理路径同时覆盖传输中断，但对客户端返回值仍认定 `operation_unknown`，若已进入提交阶段或原本已断流则保持未知和 cleanup 围栏，不伪称回滚成功。这两个修复均是源码候选，未做本地行为测试，未通过新远程八组验收。

本轮其他失败继续逐项保留：`agent/functional-regressions` 完成状态不符、`agent/preset-plugin` 真实插件 Surface、`ssh/file-list-profile` 5000 项目录在 10 秒内未完成导航、`ssh/upload-protocol` binary/control WS close 未确认、`ssh/suspend-resume` takeover、`ssh/cross-session-transfer` 拷贝、`ssh/progress-display-archive` 取消后 task 残留、`ssh/file-upload` 首波并发不足、`ssh/protocol` ZIP Unicode、`mobile/suspend-resume-ui` 恢复、`ssh/reconnect-ui` 标签、`ui/theme-switching`、`ui/system-settings`、`ui/captcha-settings` 等。已在工作区的其他 17 份局部补丁保持原样并逐个复核；不能因同类 helper 的修复将所有失败视为已解决。继续按 D17/D18 不跑本地 E2E、不推送半成品、不弱化阈值或吞清理失败。

**第八轮阶段性验证授权（2026-10-19，用户最新指令）**：用户明确要求“可以先把改完的提交运行一次，看修改的对不对”。因此这一次只将当前已写入的第七轮修复候选统一提交并推送 `dev`，用于触发完整远程 Actions，属于 D18 整轮收口前的明确授权例外，**不代表 45 份失败 spec 已关闭**。原先逐份记录中的 SFTP cleanup unknown、归档取消、上传和布局/重连等未解项仍必须继续查证。提交前本地严格 TS、`pnpm run check`、Backend/Frontend build、`pnpm run format:all:check`、SSH 测试夹具 `node --check`、`git diff --check` 均已 exit 0；没有在本地运行浏览器、Playwright、E2E 或用例收集。远程八组结果尚需在新 run 完成后逐组验收。

基线 `dev`/`b1f89858fce5555d11a58a851060d0c2f8a05dae`，GitHub [Actions 39226129870](https://github.com/0honus0/nexus-terminal/actions/runs/39226129870)，八组结束；Checks/format/build 与 Docker smoke 为 PASS，八组 Playwright 均 failure（第 7 组 timedOut）。逐组按完整 reporter 首次失败题目去重得到 **45 份失败 spec**（各组分别 4/5/3/7/4/10/5/7）。同 shard 后续 `Backend-next isolated baseline reset HTTP 500/503` 不是对应测试自身的产品失败；必须回溯首次资源 cleanup failure，不能绕过隔离重置或把未执行项标记通过。

本次在途修改按照 root 和每份消费者单独归因，仍没有运行本地行为/E2E/用例收集：

| 直接失败 spec                             | 分类与有证据的改动（全部**远程未验收**）                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `http/auth-2fa.spec.ts`                   | 明确的测试初始化错误：2FA UI 用例 `setUiLanguage` 在 `loginAsInitialAdmin` 之前访问受保护的 Preferences GET，401；改为先登录再写语言，不跳过后续真实 2FA 拒绝及恢复                                                                     |
| `ui/login-captcha-surface.spec.ts`        | 恶意 public config 只通过 `page.route` 注入；`context.request` 读取的是未污染的真实 server config。只在主动注入分支不把两者误判相同，仍要求 UI fail-closed 和登录 POST 未发出                                                           |
| `ui/captcha-settings.spec.ts`             | 页面消费 PUT 后失去 CDP response body，仍断言 PUT 200，再读取正式 `/settings/captcha` GET 验 version、effectiveVersion、restart 和持久状态                                                                                              |
| `agent/host.spec.ts`                      | Concurrent Runs 测试任选低于 Concurrent Model Calls 的值，触发合法 `invalid_input` 400。备选值只选符合现有交叉限制的合法范围；仍验证首写 200 和原版本写 409                                                                             |
| `agent/ssh-acp-settings.spec.ts`          | Reka UiCheckbox 不接受原 `locator.check()` 操作方式；给正式 Integration Editor checkbox 明确 label 和 aria-label；测试通过真实点击及 `aria-checked` 验证                                                                                |
| `ui/ssh-key-management.spec.ts`           | 预期原始 `Network Error`，但正式 Targets consumer 将网络故障安全地本地化为通用失败；保持拦截 GET、Modal alert、320px 宽度断言                                                                                                           |
| `ssh/quick-command-management.spec.ts`    | 失败是 Tag 可选列表 GET，不能要求完整 Quick Commands 主查询也显示报错；直接计数被拦截 tag GET、保持未标记回退与真实命令执行                                                                                                             |
| `ui/notification-delivery.spec.ts`        | 表单显示其 POST 接受时的 queued receipt，与异步最终投递状态不同；仍验证异步真实 sent、刷新后正式 ledger 显示已发送                                                                                                                      |
| `ui/notification-settings.spec.ts`        | 正式通知渠道卡片此前没有按 `item.id` 的 `data-notification-id` 标识；在唯一卡片 root 补稳定数据 ID，不删除秘密 keep/replace/clear 测试                                                                                                  |
| `ui/system-settings.spec.ts`              | Preferences 当前设计允许已保存后继续按 Save，旧测试误认为必须 disabled；仍断言实际 PUT、版本、后端持久语言/时区及 reload                                                                                                                |
| `ui/theme-switching.spec.ts`              | 同一编辑器先移动 overlay slider 再上传图片，完成上传更新 Appearance version，但旧草稿保存仍用旧 CAS version；在单编辑器 upload/remove 已确认结果仅更新该 editor 版本基线，不覆写未保存 opacity 草稿，保留 0.37 精确值                   |
| `ui/backup-ui.spec.ts`                    | 测试忘记真正的破坏性恢复确认，POST 从未发出；确认对话框后验证导入回执与正式恢复 overlay，显式执行完成恢复后的 Reload；不把 unknown 当成功                                                                                               |
| `ui/ip-blacklist-settings.spec.ts`        | 移除封禁 IP 必须经过独立破坏性确认；保留 DELETE 200、正式 decoder 与最终空态，补实际 Confirm 点击                                                                                                                                       |
| `ssh/connection-list-search.spec.ts`      | 正式 Tag Group Manager 分离改名 `Save tag name` 和关联 `Save` 两项独立 CAS 写入。先确认改名，再操作过滤选择及关联，不允许脏名称时跳过校验                                                                                               |
| `ssh/sftp-download.spec.ts`               | 旧票据测试假设 65 次签发自动逐出最老者，正式 owner 是每用户 64 个 live ticket 上限（包括先前首张票据）、超额 429 不驱逐；测试改为先签发剩余 63 张、超额断言 429、老票据仍可使用、文件突变后老票据 410，不放松 IP/Range/TTL              |
| `ssh/download-admission.spec.ts`          | 8 个 HTTP body 收完可能领先 remote CLOSE 与 admission release；保留最大 8、额外 429、HEAD 可达和精确字节，只在未超时的有界 poll 中验证 ticket 最终重新准入 200                                                                          |
| `mobile/suspend-resume-ui.spec.ts`        | 正式 suspended log 下载名为 UUID `.txt`，旧测试要求 `ssh_log_*.log`；保留真实字节内容与恢复前后痕迹断言，匹配当前正式导出名                                                                                                             |
| `ui/dashboard-workflows.spec.ts`          | Recent Connection wire timestamp 只有 Unix 秒精度，前后两次连接同一秒会同值；第二次发起前明确跨下一秒时间量化边界，仍保留后续 10 秒内严格 `>`、刷新而不导航的判据                                                                       |
| `ssh/terminal-ui.spec.ts`                 | 旧 Appearance PUT 缺 expectedVersion 且尝试通过设置接口写 read-only 文件指针，正式 Shared 拒绝；采用每次读版本的一次性 updateTestAppearance，仍保存/恢复主题和 CSS 几何                                                                 |
| `websocket/authenticated-session.spec.ts` | **产品侧安全修复候选**：密码修改的事务确实删掉所有用户 token，但活跃、空闲 Workspace WS 只每 15 秒复核 token，测试要求 10 秒内撤权。缩短工作区独立认证复核到 3 秒，保持认证失败即 close、原凭据立即无法调用的服务检查，不放宽 10 秒断言 |
| `ssh/file-manager-navigation.spec.ts`     | Path change UI input 先同步填值，SFTP 导航与 per-session history POST 异步；先轮询有界真实 history GET 直到该绝对路径已落库，再打开历史下拉；仍检查宽度、复制、删除、路径导航                                                           |

**仍有直接未解决或只能视作线索的失败**：`agent/functional-regressions` A08 导航后的 CDP body 退场、`agent/preset-plugin` 3 安装项 Select options、`ui/proxy-management` unknown 后 Delete 未禁用、`ssh/file-list-profile` 大目录 10s 内加载、`ssh/archive-cancel-recovery` 取消归档 reported failed、`ssh/docker-manager-ui` 停止按钮定位、`ssh/suspend-resume` filesystem gate 解除后 cwd remote_unavailable、`ssh/upload-protocol` WS CLOSE 结算、`ssh/protocol` detached archive not_found、`ssh/file-preview-editor` plainfile 种子缺失、`ssh/progress-display-archive` 隐藏任务、`ssh/cross-session-transfer` operation_unknown、`ssh/file-upload` Ctrl+V 字节及大批后半段、`ssh/reconnect-ui` 多次自动重连、`mobile/touch-preview-progress` 浮窗可见等。`mobile/ssh-workspace`、`mobile/touch-advanced`、`mobile/touch-workflows`、`ssh/progress-display-baseline`、`ssh/progress-display-upload-copy`、`ssh/status-history-time-axis`、`ssh/suspend-log-compaction`、`ssh/terminal-session-cache` 等是前置基线 reset 500/503 的**未运行**项；不能据主根因修复而从清单抹除。

继续逐文件核对后新增的**直接源码根因**：`ui/proxy-management` 测试看到 Delete 按钮消失，而非仍存在但 enabled。ProxiesView 原先 `v-else-if="message"` 在未知 DELETE 后卸载全部已知行。现将错误 alert 与数据列表并列渲染，保留后端已确认的旧行和 `needsRefresh` 写入围栏，Refresh 才解除；未修改 API 成功语义。`ssh/protocol` 发起 archive 时尚未 await `filesystem.ready`，而 startArchive 正式 owner 依赖已获准的 FileResource，增加真正 readiness barrier。`ssh/suspend-resume` 的 resumed shell 已有前景输入，ShellIntegration 不能事后注入 PID 探针；先在原始附件确认 cwd 为 `/` 再 suspend，仍要求恢复后命令可用和 cwd 一致，不能把探测错误改成成功。

**第七轮 SFTP fixture 的已确认契约缺陷**：`tests/e2e/support/test-ssh-server.mjs` 的 `SETSTAT`、`FSETSTAT` 原来仅实施 chmod/truncate，对 SFTP 客户端要求的 `atime/mtime` 仍答 `STATUS_CODE.OK`，从未更改时间。真实 FileService `copyOneFile`/directory 复制会在 SFTP 目标恢复元数据后按 `modifiedAt` 精确复验，因此假成功会引发 `operation_unknown`；本地 SFTP server 还可能留下一批待清理暂存文件，继而污染其他 spec。现仅在这两个测试 SSH server 事件中按 SFTP 秒值实施 `FileHandle.utimes` / `fsp.utimes`，非法秒值拒绝；未放松任何生产复制验证或改变生产 SFTP。_这明确解释了复制元数据不一致，但并不证明第 4/6 shard 所有 `abort/append/discard` 清理 unknown 也由它直接导致；仍须 Remote Job 独立验证与二轮复审。_

续审 `ssh/file-preview-editor`：失败是测试在点击异步 Save 后调用 `expect.poll(() => readFile(...))`，首次暂存替换期间恰好读到 ENOENT，`poll` 函数抛错而不是继续观察最终持久文件。已限定只将 ENOENT 作为尚未安装完毕的瞬时状态，并继续等待**原本不变的精确目标字节**；其他文件错误继续抛出。底层临时缺失是否违反产品承诺尚需复核，不能凭此将“稳定替换”当已验收。相关场景独立标记待远程复验。

新的原始 shutdown 嵌套证据：shard 4 `RemoteFileService` 的 `stage.abort / stage.discard -> operation_unknown`；shard 6 `copyOneFile` 的 `append -> operation_unknown` 后 `discard -> operation_unknown`，最终 `RemoteResourceCleanupFailure`，其余同 shard reset 阻断由此产生。这是**已确认未知清理事实**，不是 safe rollback；严禁将 cleanup failure try/catch 后吞掉、提高总阈值或绕过控制服务的失败围栏。上述产品修复候选尚未覆盖此项，D18 **不得推送**，直到剩余独立根因静态复核两轮、门禁与整批待验项交付条件满足。

`agent/functional-regressions.spec.ts` A08 的首错来自 `fixtures/agent/native-task.ts:startNativeTask()`：Run POST 接受后页面可立即导航，使 DevTools 丢失 `response.json()` 正文。现在对这一次正式 Workspace Run 请求用页面 Route `fetch()` 先捕获**同一次服务器回应**并将它 `fulfill()` 给前端，再验证浏览器 POST 200、Shared Workspace Response 解码及同 Thread 的 Run ID；没有发出第二次 mutation，也没有根据 DOM 猜测成功。该 fixture 被其它 Agent spec 复用，但 A07/Plugin/cleanup 仍须分别验收；不能将 helper 调整改写为全体通过。

## 状态监控等待布局（2026-10-19）

dev / `8fa1713c` 未提交工作区，沿用本页 Node/pnpm 环境。状态面板原等待态用字体旋转图标和只设置 place-content 的 Grid；改用现有 16px UiSpinner，局部纵向 Flex 双轴居中、0.5rem 间距，文字限制最大宽度并允许换行，错误空态复用相同对齐。加载容器提供 status 语义，装饰图标不重复朗读。不改采样、网络、比例及通用 UI；已核对 Frontend 状态监控 owner 说明仍符合实际，无架构边界变化。

源码审核覆盖等待/错误/正常三个分支、窄栏换行、固定尺寸 spinner 不拉伸、比例样式和既有状态切换。USAGE 状态监控章节已同步。按 D17 不新增/运行本地行为测试或浏览器测试，未提交/推送；真实宽窄面板、比例上下限及小高度视觉效果待远程验收。

静态结果均退出 0：Frontend build `/tmp/nexus-status-loading-build.log`、根 check `/tmp/nexus-status-loading-check.log`、全仓格式 `/tmp/nexus-status-loading-format.log`；`git diff --check` 通过。文档回填后再执行本轮专项 Prettier，日志 `/tmp/nexus-status-loading-focused-format.log`。静态结果不作为视觉验收证据。

## 远程第十九轮：第4组取消清理竞态（2026-10-20）

基线 `7d866e21`，Actions [39354280150](https://github.com/0honus0/nexus-terminal/actions/runs/39354280150)。第4组236秒、22项失败；首个直接失败是 `upload-protocol` 在途WRITE取消返回operation_unknown，随后reset出现500/503。重置错误cause指向stage.discard期间SFTP abortLease；其余21项的基线失败不等于各自功能已经执行失败。第8组140秒，按本轮人工指示先修耗时较长的第4组。

调用链：finishUpload设置terminal并等待WRITE队列；队列中的append因此拒绝，upload-stream关闭字节WS，attachment.abort再调用controller.abort，中断了正在等待的stage清理。补修RunningUpload.discarding，首次取消/断流登记该状态；重复取消共享settlement、保留首次结果分类，字节WS关闭不再次取消清理。已进入提交、权限撤销、总任务超时及真实清理失败仍保留原中止/unknown规则。

两轮源码复核分别覆盖取消→队列拒绝→WS关闭→discard，以及重复cancel/abort、首次断流、最终块接纳后取消与实际释放。顺带修正原测试使用uploadId猜测随机stage路径的无效检查：严格解码根目录列表，确认不存在任何上传.part暂存文件；待open取消场景复用同一检查。既有远程测试保留，未在本机执行或收集测试。

当前静态：Node v22.23.1、pnpm11.26.0；Backend check/build、根check、完整format:all:check及git diff --check均退出0；最后文档追加后再次执行六个变更文件Prettier检查及diff检查通过。USAGE和Backend架构同步。补修行为尚未远程运行，第4组不标PASS；全组完成率仍以相同SHA的下一轮实际结果为准。

## 远程第十九轮：第7组多会话夹具准入（2026-10-20）

原Actions39354280150，第7组890秒后超时。7项reconnect-ui多会话用例均在首个SSH标签创建后消失，继而35秒connected等待失败；诊断再等待缺失标签15秒，导致反复55秒超时并中断后续upload-prepare-profile。artifact12235231345的hidden-desktop首次trace明确记录WorkspaceRequestFailure: host_key_untrusted。每例隔离基线重置，createMultiSessionConnections仅导入三个连接，没有调用ensureTestSshConnection所含的信任步骤；不能依赖前例的Host Key。

补修该入口使用既有trustTestSshHostKey，真实读取fixture公钥并通过Shared codec确认，再创建三连接；不自动信任产品侧未知主机。通用support诊断以evaluateAll读取现存标签快照，缺失立即标missing，原cause保留；35秒连通性判据不放宽。两轮源码复核覆盖全部7项调用点、初次失败测试的独立入口及目录准备测试；USAGE产品说明不变，核对既有Host Key约束仍成立。当前修复未运行本机行为测试；远程多会话完整执行及目录准备性能仍待验。

第4组修复ce06c07f已推dev，对应Actions39355923799；本条第7组补修在其等待期间完成，按照2026-10-20更新D18逐组迭代，不能把该run当作已包含第7组补修的证据。

第7组补修静态收口：Node v22.23.1/pnpm11.26.0，根check、完整format:all:check及git diff --check通过；最后文档追加后重查格式。生产代码未改，不重复构建；实际SSH/页面行为只交给推送后的远程Actions。

## 远程第十九轮：第3组大目录发送预算安装（2026-10-20）

原Actions39354280150，第3组唯一直接失败为file-list-profile的5000项导航，1000项三次正常，5000项收到控制WS closeCode1011后仍展示旧根目录；artifact12234817099的trace控制台可定位。Shared和Workspace route已定义8MiB列表响应及发送缓存，但bootstrap/module-manifest admitWebSocket只投影maxTextMessageBytes/maxBinaryMessageBytes，丢失maxBufferedTextBytes；实际channel按默认1MiB拒绝发送完整列表。该链不是夹具NAME帧或30秒断言不足，不扩大断言时间。

修补Bootstrap显式投影既有发送预算，Platform HTTP bindings安装时同步校验该容量为安全整数且不超过32MiB技术硬上限。入站预算、其他路由默认1MiB、Shared8MiB及业务项数均不变；USAGE目录列表章节同步。两轮源码复核覆盖声明→admit包装→bindings校验→http-server装配→channel发送及拒绝路径。既有大目录/排序/虚拟行回归留远程，不运行本机测试；静态结果另记。

第3组补修静态收口：Node v22.23.1/pnpm11.26.0，Backend check/build、根check、完整format:all:check及diff检查退出0；最终追加证据和Backend架构后再检查变更文件格式。无Shared或前端契约改动；已复核默认小预算、明确8MiB、非法预算拒绝及32MiB硬上限分支，行为仍待远程。

## 远程第十九轮：第8组目录复制子项（2026-10-20）

cross-session-transfer前两项已通过，第三项刻意禁止/folder-seed/子项LSTAT以验证READDIR metadata复用；copyOne此前扫描后仍逐项重新stat，正常文件复制返回operation_unknown。Service递归现接收已解码的entry.info；根节点仍stat，字节源按原size精确校验，目标mode/mtime与内容大小仍检查，move删除源前与逐项删除时仍重新读取源事实。该调整不把READDIR观察说成原子快照，不删除未知或清理失败分支。

两轮源码复核覆盖普通/空文件、目录递归、链接、最大深度/条目、move源复查与目标确认。产品能力和协议不变，核对USAGE复制/未知结果说明仍成立；静态后留下一轮远程复验，未执行本机行为测试。本条仅完成第8组目录复制子项，下载取消与并发上传仍待修复，不标整组PASS。

目录复制子项静态收口：Backend check/build、根check、完整format:all:check、git diff --check均退出0；两次源码复核完成。当前远程39356651981对应48faea89，不含此项，不用该run证明目录复制修复通过。

## 远程第十九轮：第1组终端缓存子项（2026-10-20）

原39354280150和最新39356651981均在workspace-layout-restore的终端DOM身份断言失败。WorkspaceUiState对view撤销也resetState，将layout.loaded置false并卸载WorkspaceSessionSurface。现只在session/disposed清空，页面失活仍由view scope撤销原请求/未派发保存；保留已加载布局/焦点与原终端。原permission/revision晚响应保护、身份清理和会话关闭owner不变，不放宽DOM/xterm、草稿、后台输出、geometry及额外读取断言。

两轮源码审核覆盖scope失活/激活、初次加载未完成、缓存返回、登出/换用户、组件卸载和旧异步结果。Frontend vue-tsc/build、根check、完整format:all:check退出0，最终文档格式与diff另检查。USAGE和Frontend架构同步；行为等待含此变更的远程SHA。

39356651981 / 48faea89最新已结束子组：第3组、第4组success；第1组failure，仅workspace-layout-restore失败，36项通过，Agent取消本轮未复现。其余组仍运行中，不能把目录复制/缓存的本地静态结果当作该run行为证据。

## 远程第十九轮：第2组原生插件写回执（2026-10-20）

原39354280150的installed Nexus Agent plugin两次分别在批准/创建线程的response.json失败，DevTools提示响应正文已不可读取。复用原Run夹具的“读取原响应后再交给浏览器”方案，提取captureNativeCommand供Run创建/追加、线程创建/重命名及批准共用。仅转发一次原请求，maxRetries=0，不补发副作用、不伪造回执；按Shared严格解码原请求与响应并保留200、method、版本、批准hash和真实执行断言。路由卸载仅移除本次handler，其他监听保留。

两轮源码复核覆盖三个迁移入口及原Run创建/追加消费者。USAGE产品流程不变，核对现有原生会话、批准及版本冲突说明仍适用；本机未运行行为测试，待含此变更的远程版本验证。第2组其他Dashboard/归档并发/Docker/布局问题仍分别跟进，不标整组完成。

插件回执子项静态：根check、完整format:all:check退出0；最终变更文件格式与diff检查通过。无产品/Shared源码变更，不重复应用构建；行为未在本机执行。

## 远程第十九轮：第6/8组上传取消流竞态（2026-10-20）

upload-adapters在用户已请求cancel时，binary close仍立即fail并删除任务、触发额外abort，随后的控制cancelled事件因任务不存在被丢弃。这解释了隐藏上传/移动端进度显示unknown、不自动清除及重复abort的路径。新增failStream仅在cancelling期间将流失败留原控制链结算；正常运行断流仍unknown，cancel拒绝/控制失败、服务端failed与总期限仍失败，不提前发布取消成功或释放任务。

两轮源码审核覆盖取消前断流、取消中close/error/发送失败、取消回执拒绝、服务端cancelled/failed/先completed、旧流晚拒绝和控制连接断开。Frontend build、根check、完整format:all:check退出0；最终文档格式与diff再查。USAGE/Frontend架构同步；行为只由含此变更的远程版本确认，上传并发和归档并发围栏未修改。

39356651981 / 48faea89完整结果：第3/4/5组success，第1/2/6/7/8组failure，检查/构建与Docker smoke成功。第7组75项通过，原7项多会话均已通过；剩3项集中upload-prepare-profile（全量性能120秒期限、独立连接缺Host Key、已知目录冲突后的恢复）。第8组51项通过、4项失败，目录复制/并发上传/隐藏取消/移动端取消；文件下载本轮通过，不能据此宣布历史偶发彻底解决。第1组36项通过，仅终端缓存失败。最新已推送cb3e7a22 / Actions39357785902包含目录复制和终端缓存；本条客户端取消及插件回执补修尚未包含。

## 远程第十九轮：第2组Dashboard/Docker/布局夹具（2026-10-20）

39356651981重复出现最近连接时间不变、Docker Stop不可用、旧布局ID定位失败。Dashboard用例阻塞的是尚未启动runtime的详情读取，离开页后正确撤销旧query；现把门闩放在已由runtime发出的workspace.connect上，仍走真实WS及SSH，严格验证时间增加/不回跳/连接可用。NativeDockerAdapter将已验证ID包单引号，夹具裸hex regex未匹配，落入真实shell执行失败；regex现精确支持裸/单引号hex，动作及目标验证不放宽。布局预览取当前安装树root id及首子容器，保留子项数/方向/geometry/锁定与持久化断言。

两轮源码审核覆盖WS门闩释放/测试失败finally、CLI start/stop/restart/remove及拒绝未知ID、实际递归DOM。产品代码不变，核对USAGE原后台连接/页面撤销、Docker动作与布局操作说明；待静态收口，行为交远程。

第2组夹具子项静态：node --check test-ssh-server.mjs、根check、完整format:all:check通过，最终文档格式与diff复查通过；未执行本机行为测试。当前远程39358034424 / 2a577341包含先前目录复制、缓存、插件回执及上传取消客户端补修，尚不含本条三个夹具变更。

## 远程第二十一轮：第1组缓存读取计数范围（2026-10-20）

Actions39358034424 / 2a577341，第3/4/5组已success，第1组只剩workspace-layout-restore的额外读取断言（expected0、actual2）。此前终端/xterm DOM身份、草稿、后台输出及geometry断言本轮均已通过。实际/settings默认加载Workspace偏好编辑器，需独立读layout/sidebar的当前版本，不能记作缓存Workspace重载。计数器现只记录/workspace活跃时的这两条GET；返回页面仍严格要求0，不删除读取/身份/geometry断言，不阻止Settings获取真实版本。

源码两次复核覆盖离开Settings/Connections与返回Workspace、路由监听安装点以及Settings默认页；USAGE缓存说明仍成立，无产品代码修改。受影响静态与后续真实行为另记。

## 远程第二十一轮：第7组目录准备（2026-10-20）

原upload-prepare-profile的24组采样在120秒期限内未结束；原ensureRemoteDirectory对全部请求逐条串行。现根先处理，以根下第一段隔离独立分支，最多4个worker；共享隐式父目录的路径仍串行，每个路径仍完整检查父链，不引入陈旧stat缓存或展开无界祖先集合。首个失败停止后续派发，在途worker全部排空后再结算原单一持久claim。公开配额、请求预算、120秒整例期限、32目录/24组采样及实际目录核验均不变。

夹具独立连接补显式Host Key；未知场景改为真实发生部分创建后注入另一分支读取失败，移除故障后以新Workspace验证持久operation_unknown围栏，保留已确认目录，不自动重试。无副作用的确定冲突在独立原场景验证可恢复。allowlist拒绝经Shared event严格解码并精确断言conflict，取消后检查实际目录为空，不依赖随机临时文件名。旧RESOURCE_QUARANTINED文本已无生产者，不恢复兼容错误。

两轮源码复核覆盖root=/、空目录集、共同父路径、四worker共享iterator、首失败停止、并发已派发mkdir继续排空、混合unknown/cleanup因果及最终allowlist。USAGE/Backend架构同步，静态与真实远程结果另记。

第7组目录准备本批静态收口：Backend check/build、根 `pnpm run check`、`pnpm run format:all:check` 和 `git diff --check` 均exit 0；已完成两轮源码复核。未执行本地行为测试，性能与故障分支等待推送后的Actions。

### Agent回执路由与传输夹具补修（2026-10-20）

39358034424第2组trace显示：创建线程回执200后，测试在UI派发后续读取期间撤销拦截，存在一条workspace读取未完成（status -1），线程面板持续busy。原写回执捕获改为在交付回执之前移除自身handler，使派生读取使用正常网络路径；不重放写入、不移除其他handler。Artifact上传精确定位实际submit按钮，避免file input也被Chromium识别为同名button。第6组Send Files实际显示invalid_input：夹具传相对路径，Shared/USAGE要求绝对目标路径，改为/server-transfer-e2e并同步任务摘要断言，不放宽解码。额外E2E严格TS发现upload-protocol从tests无法解析包级Shared导入，统一为现有直接源码路径。

四表：功能覆盖保留线程创建/重命名、Artifact发布和真实多目标部分完成；职责归测试消费者，不修改产品准入或并发围栏；类型沿用Shared codec，无新契约；已完成两轮源码复核，E2E严格TS通过，完整静态门禁另记，行为待Actions。USAGE既有绝对目标目录与版本化线程说明仍符合实际。

Agent/夹具本批门禁：E2E严格TS、根check、全仓format:all:check和diff检查通过；未执行本地行为测试。复制写入批次优化为后续独立变更，不计入本次测试消费者提交。

### 复制背压与大帧取消（2026-10-20）

39358034424第6组6 MiB/120ms WRITE延迟复制在20秒仍running；源码每个32KiB READ后立即等待一次append，使底层WRITE窗口无法利用。改为有界256KiB聚合，每窗等待确认后计进度，零字节/尾块/大块切片/短读失败及迭代器关闭保留，commit、metadata复核、move删除与unknown规则不变。

第8组移动端取消15秒延迟的1MiB协议帧时，Model原append会依次派发两窗512KiB，取消期间第二窗仍派发，超过原20秒判据。Service按512KiB批次调用stage，每批前检查discarding；保持完整帧才发progress，不在途abort租约，不提前释放claim，原worker仍排空已派发写入并确认discard。两个改动均保留原用例时限，不以本地取消当远端停止。

四表：保留复制真实字节/metadata与取消后文件不存在断言；策略归Files Service，Model/SSH Adapter既有ack与失败转换不变；无新增协议/Shared类型；两轮源码复核覆盖0/整窗/尾块、背压、read失败、取消前中后、原队列/claim及临时项收敛。静态和下一轮行为结果另记。

### 文件浏览导航与后台刷新竞争（2026-10-20）

39358034424第8组上传期间返回父目录后，trace最终仍停留/folder-seed。完整调用链显示后台上传完成调用同一个browser.refresh；load等待期间path仍是上一个已确认目录，refresh会以该旧目录发起更新并提升loadToken，从而覆盖正在进行的导航。Browser增加私有requestedPath，refresh及默认load使用最新导航意图，成功按listing规范路径收口，当前失败恢复到已确认目录；旧token失败不能重置新意图。保留原文件可见、搜索与30秒断言，具体失败是否完全消失仍待远程。

四表：范围是用户导航/后台刷新竞争；状态归FilesystemBrowser，不在Workspace复制意图；无新wire对象或Shared契约；两轮源码复核覆盖导航→刷新、刷新→导航、旧成功/失败及最新失败，静态后等待Actions。USAGE/Frontend架构同版维护。

### 39359401469完整结果与第7组补修（2026-10-20）

本轮SHA d6fa14e7：质量/构建、Docker smoke和第1/3/4/5组通过，第2/6/7/8组失败。第7组目录准备原120秒超时场景现46秒通过，allowlist/取消清理场景通过；剩余新Workspace围栏断言与HTML背景恢复。新Workspace拒绝是现有MachineMutation acquire的conflict（原失败仍operation_unknown），夹具补Shared严格解码的管理列表state=blocked及同目标断言，再精确确认conflict；不把二次准入冲突改成原操作结果，不解除围栏。HTML一次性canvas脚本在跨页返回后空白：KeepAlive detach会重建iframe文档，保留srcdoc可能在隐藏零视口运行。deactivate先暂停再移除srcdoc，activate/实际可见尺寸确认后重新加载文档；同页切换不触发此重置，继续保留iframe/主题实例。

四表：保留真实blocked记录、原unknown、二次拒绝及全部红色像素断言；持久规则owner不变，sandbox文档生命周期归Terminal background composable；类型使用Shared MutationList；两轮源码复核检查多会话、隐藏/恢复、晚load及主题更新，静态结果与后续Actions另记。

本批最终门禁：根check、E2E严格TypeScript、前后端build、format:all:check、git diff --check均exit 0。复制/分帧取消、目录导航和第7组背景/围栏补修已完成两轮源码复核；未执行本地行为测试，等待后续Actions。归档运行中取消与真正并行归档仍未修复，不通过放宽unknown、移除持久claim或修改断言规避。

### Agent拦截生命周期与Send Files端点夹具（2026-10-20）

远程177cba3e第1组确认24项失败，首因均为native-task先unroute再fulfill导致Route is already handled；不能把前一批静态通过当行为通过。本批每Page安装一个稳定workspace拦截器，当前捕获按App/method匹配且只认领一次，读取或其余请求fallback；原回执严格解码后交付，不切换拦截模式、不重发写入。结束只清除捕获意图，页面关闭释放handler；同Page并发捕获明确拒绝。

第6组Send Files夹具原先以同一host/port的两个连接ID模拟独立服务器，触发真实重复资源拒绝；此外离线目标也须显式确认Host Key，密码传输的known_hosts须与exec创建的私有目录一致。新增受控22225 TCP转发端点及环境端口，成功/离线目标分别显式确认受控指纹，目标使用夹具真实绝对目录以匹配rsync -s协议。SFTP仅对精确UUID命名的/tmp/nexus-transfer目录和key/known_hosts放行原OS路径，其余仍在虚拟根。原部分成功、失败详情、目标文件及任务删除断言不变；不修改生产准入和安全围栏。

| 审核表   | 本批结论                                                                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 功能对应 | Agent原写回执与派生读取；Send Files真实双目标部分成功，不放宽超时或结果断言。                                                                                                                                             |
| 职责归属 | 仅测试消费者/受控SSH夹具；页面持有唯一拦截器，转发夹具追踪两端socket并在关闭时排空。                                                                                                                                      |
| 类型归属 | 原Shared workspace和Host Key严格codec继续使用；不新增协议或业务类型到Platform。                                                                                                                                           |
| 完成证据 | 两轮源码复核覆盖一次认领、连续调用、失败清意图、代理断连/停机、私有凭据及绝对目标；根check/build已通过，严格E2E TS曾发现route返回Disposable，已调整并重跑；最终静态结果另记。行为仅等待新SHA的远程Actions，不在本地执行。 |

USAGE既有绝对目标、显式信任与任务结果说明仍符合产品行为，本批无产品变更。归档取消/并行为独立未完成项，不以此补丁销项。

本批最终静态门禁：根check、前后端build、严格E2E TypeScript、全仓format:all:check、SSH夹具node --check和git diff --check均exit 0（/tmp/nexus-round24-*.log）。两轮源码复核完成；没有运行本地行为测试，待推送后远程验收。177cba3e第6组现43通过、4失败：复制性能与其后续上传/复制用例已通过；剩归档取消、Send Files、挂起压实及终端缓存，后两项为本轮独立排查范围。

### 177cba3e后续失败与夹具消费修正（2026-10-20）

本批a8bed777已推送dev，新运行[39361569436](https://github.com/0honus0/nexus-terminal/actions/runs/39361569436)；原177cba3e第2组因此取消，不记PASS或FAIL。原第3/4/5/7组通过，第1/6/8组失败；第6组复制性能和第8组移动端取消已通过，不再沿用旧版本失败判断。

第6组terminal-session-cache手工导入连接后漏Host Key确认，两次均KEY_EXCHANGE_FAILED并无已连接tab；补显式确认原夹具指纹。suspend-log-compaction的约2MiB输出超过未确认窗口，Node消费者只收字节、没有terminal.flow；增加仅本场景启用的有界串行ACK消费，累计量来自真实终端帧，操作结束移除监听并排空最后ACK，失败不吞；不对其他背压场景全局auto-ACK。

第8组backup-ui离线trace显示恢复200且回执正确，点击reload后才unroute，模块图中的vue.js请求status=-1，DOMContentLoaded超时；改为先撤销原import handler，再同时等待真实DOMContentLoaded与点击reload，不增加期限、不重复import，保留认证/表行/文件/清理回执断言。原用例重试通过仍不能掩盖首轮失败。

四表：功能对应保留三会话实例/resize、真实压实大小/同shell恢复、完整备份恢复；职责归测试生产者/消费者和真实生命周期；无新增产品/Shared类型，ACK沿既有Shared解码边界；两轮源码复核检查确认顺序、累计真实字节、单个在途ACK、失败汇总/监听退出、回执与重载顺序，静态结果另记。USAGE原Host Key、流控和备份说明仍适用。

仍未修复：归档运行中取消/真正并行；第8组6文件上传同样被Files mutationTail整段串行化，首波只开1个上传stream。后者与归档并行共有持久host/port独占claim限制，不能只删除本地队列或跳过claim；需要同owner有界分组、路径冲突准入和整组排空后结算，unknown仍阻断外部准入。保持现有并发/性能断言，不标记已完成。

本批最终静态：根check、严格E2E TypeScript、全仓format:all:check及git diff --check均exit 0（/tmp/nexus-round25-*.log）；两轮源码复核已完成。仅测试与证据文档变化，产品源码未改；前后端build沿a8bed777基线已通过，本批无构建输入变化。行为待后续远程SHA，不运行本地测试。

### Dashboard重连拦截安装顺序（2026-10-20）

177cba3e第2组Dashboard reconnect两次均120秒等待。源码核对Playwright 1.63.0的WebSocketRouteDispatcher.install→addInitScript→Page.addScriptToEvaluateOnNewDocument：首次routeWebSocket在SPA已加载后安装，当前文档不会获得WebSocket包装，因此connectStarted永不触发。现将路由安装移到初次connectTestSshFromConnectionsPage导航之前，初次连接不阻塞，仅第二次Reconnect启用gate；仍等待runtime派发workspace.connect后离开Workspace，并核对后台完成刷新原Dashboard时间和稍后原session已连接。不更改产品逻辑、120秒期限或断言。

四表：功能为原后台重连完成不导航/刷新recent；owner仅测试故障注入；无新类型或Shared修改；两轮源码复核覆盖首次直通/第二次阻塞/原finally释放/跨页runtime，严格E2E TS通过，格式和最终静态另记。a8bed777新远程39361569436第1/3/4组已通过，其他尚在运行；3117909a后续三项夹具修复已提交，保留现轮证据后一起推送。USAGE原后台Workspace与recent说明适用。

本批门禁最终：根check、严格E2E TypeScript、format:all:check、git diff --check均exit 0（/tmp/nexus-round26-*.log）。远程a8bed777的39361569436现第1/3/4/5/7组PASS，第6组44通过/3失败（Send Files真实传输已PASS，剩归档取消、压实ACK及缓存Host Key），第8组54通过/1失败（仅多上传stream串行化）；第2组尚在运行，下一推送如取消须保留未验范围。3117909a与本批Dashboard修复等待新SHA验证。
