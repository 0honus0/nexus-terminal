# Nexus Agent 实测记录：2026-10-05 续测

本记录对应 `test` 分支。测试要求：前端 9998、通过 `172.30.30.11:9223` CDP 访问 `https://api.honus.top`，使用 honus 账号、newapi Provider 和 `deepseek/deepseek-v4.1-flash`。凭据已脱敏，不记录密码或 API key。

本轮完整输入、模型输出、工具参数、工具结果及 Run 状态保存在同目录 [RESUME_DATASET.json](RESUME_DATASET.json)。本地原始快照和检查日志在 `data/2026-10-05/resume-*`。此前测试历史在 [TEST_RECORD.md](TEST_RECORD.md)，其早期 BLOCKED 和旧结论不代表本轮状态。

## 基线、方法和范围

- 开始时已执行 `git fetch origin main` 和 `git merge --ff-only origin/main`，结果 Already up to date；main 基线为 `edbe87aa2356e1e3fe0a87afe73f852555d76273`。test 含额外测试/修复提交，不能将 test HEAD 写成等于 main。
- honus 已存在且已认证，复用账号，未重置或重复注册。Provider discovery 发现 50 个模型，Provider test 成功，真实 Run 使用 Chat Completions Provider、目标模型 configurationVersion 1。
- Vite 前端绑定 9998；Backend 为 127.0.0.1:3001；测试 Runner 127.0.0.1:47821。Runner 使用 native/logical 模式。
- 依据 `doc/AGENTS.md`、`doc/USAGE.md`、Agent tools/runtime/HTTP 源码和现有 E2E/scenarios 确定覆盖；通过 UI 发起基础会话，其他复杂测试通过同一已认证 CDP 页面调用公开 Agent API，并读取完整 durable ledger。不能把公开 API 测试全部描述成按钮 UI 测试。
- 共享浏览器/目录中存在另一独立测试会话。本轮后续使用带 `agentFunctional=resume20261005` 标识的独立标签页，使用 resume 前缀留证，不覆盖其他会话记录。其修改和提交不算本轮修复成果。
- 自动化 scenarios 包括审批、预算、恢复、Artifact、Browser、MCP/ACP、Plugin、Subagent 等，但 MCP/ACP/Plugin 真服务配置没有本轮真实模型验收；不能把 fixture 场景通过当作真实服务通过。

## 实际用例及判定

| 用例标识                                  | 输入/操作与实际输出                                                                                       | 判定                                                                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| resume-basic-ui                           | UI 输入只输出 JSON，19+23；输出 `RESUME_BASIC_OK`、sum=42、items 中文/hello                               | PASS；无工具的 Run 为 completed_unverified，符合未执行验证的语义                                                            |
| resume-multiturn-ui                       | 同会话 marker 追加 _MULTI、sum 加8、items 反转；输出 marker 正确、sum=50、hello/中文                      | PASS                                                                                                                        |
| resume-ui-route-persistence-recheck       | 选择子 Agent 测试会话、最小化、点击设置、重新打开；真实 childId 和会话标题仍可见                          | PASS；首次使用共享页的失败不能归为产品缺陷                                                                                  |
| resume-runner-audit                       | pve_debian 上审核 systemd、权限、构建和端口；file_write 未先建父目录 `/tmp/nxr`                           | PARTIAL；NoSuchFile 导致 outcome unknown/隔离，独立确认文件不存在后通过 reconciliation 解除                                 |
| resume-runner-repair                      | 只读 shell 含不存在路径，退出非零；系统误将已知退出视为未知副作用                                         | FAIL；阻塞连接后续测试，已修复并单独复验                                                                                    |
| resume-files                              | 写 calc.js、回读/SHA、真实 file_patch、move/search/list、执行、delete 清理                                | PASS（含人工纠正模型参数）；stdout `FILE_SUM=42\nFILE_DIFF=16\n`、exit0；真实 patch +7/-1，218B；不是仅 fallback file_write |
| resume-shell-exit7                        | stdout EXIT7_STDOUT、stderr EXIT7_STDERR、exit7，再独立执行 AFTER_EXIT7_OK                                | PASS；exit7 为 confirmed failure，后续 exit0 成功，无错误隔离                                                               |
| resume-browser                            | 配置 CDP Browser Target；真实打开 example.com、title、截图；模型又导航 view-source                        | PARTIAL；截图成功，view-source 被策略拒绝，Run interrupted；没有完整 h1 验收                                                |
| resume-browser-artifact-verified          | 独立通过 Artifact API 下载截图                                                                            | PASS；PNG 31941B，SHA256 与 metadata 完全一致                                                                               |
| resume-memory / resume-memory-recheck     | 提交带 content/sourceRefs/confidence/expiresAt 的候选记忆                                                 | FAIL；最初 generic RESOURCE_FORBIDDEN，复测明确 VALIDATION_FAILED；无候选成功创建，无发布。未证明空 sourceRefs 本身非法     |
| resume-subagent                           | 真实委派 readonly review profile，join/list 回收 avg 函数审核结果，主 Agent 再核算                        | 平台链路 PASS，Run completed_unverified；输出质量存在错误，已独立执行审计纠正                                               |
| resume-subagent-independent-audit         | 执行原 avg 和修复 avg，7 个输入，冻结输入验证不变                                                         | PASS；修复版输出 null/4/null/null/6/7÷3/null；子 Agent `[2,10].sort()` 示例错误，实际 `[10,2]`                              |
| resume-workspace / resume-workspace-fixed | 空参数 workspace_create 在审批复核被拒；一轮还被 durable replay 错误中断                                  | FAIL；已定位 normalizedArguments 不符合公开 schema，修复                                                                    |
| resume-workspace-fixed-live               | 创建请求到 Runner，但返回 creating；control 正确公开参数仍被复核拒绝                                      | FAIL；修复 control 规范参数和等待 terminal 语义                                                                             |
| resume-workspace-terminal-live            | 修复后创建 ready、start succeeded；写文件实际成功却被协议解码拒绝                                         | FAIL；mtimeMs 小数被 integer 校验拒绝，已修复；独立确认内容和 SHA 后解除隔离                                                |
| resume-workspace-complete-live            | 写文件/目录/SHA、前台输出 RESUME_RUNNER_42、exit0；提交后台后模型并发提交 exit7                           | PARTIAL；后台 accepted，另一命令 ACTIVE_CONFLICT 被误记 unknown，Run interrupted；单独序列化用例绕过                        |
| resume-workspace-sequential-live          | 严格串行创建/启动/写入/前台/后台 wait/exit7/SHA/list/stop/delete                                          | 核心工具验收 PASS；整体 Run FAILED，模型追加第二轮且 Plan blocked，详见问题项；不能写作整体通过                             |
| resume-owned-cleanup                      | API delete 两个阻塞实例、一个并发冲突实例；检查确认 terminal；预览只包含本轮四个实例后确认 runtimeCleanup | PASS；清理命令 succeeded，deleted 四个，quarantined/skipped 空，最终 runtimeBytes=0                                         |
| resume-workspace-positive-final           | 纯正向最小创建/start/node 输出42/stop/delete，无负向步骤                                                  | 核心生命周期 PASS；Run FAILED，被 completion gate 在 delete 后要求新的 execution evidence，详见末尾验收                     |

## 可复用 Agent 输入/输出数据

`RESUME_DATASET.json` 中每个 case 保存初始请求和 expected、实际 Run 快照关键字段、完整 ledger（user/assistant/tool exchange），并另存追加输入、reconciliation、Artifact 下载、cleanup、Provider/UI 证据。保留失败轮，未以成功轮覆盖失败记录。

关键验收样本：

- SSH：`printf 'EXIT7_STDOUT\n'; printf 'EXIT7_STDERR\n' >&2; exit 7` → exitCode 7、两个输出完整、outcome confirmed；下一命令 `AFTER_EXIT7_OK` exit0。
- 文件：真实 patch 前 SHA `aff5fc3b11ca8446397722acd1b4aed0ded0bbd8adba2686532e8959d0fc4253`，后 SHA `ff70818f6a3a77a90cb351ccf4c3c5ac23125cb31802f3ddf63566545664bed3`；move 后内容 hash 不变。
- Browser screenshot Artifact：`e93ec50b-7201-4227-933f-052f22f4ce61`，SHA `b48e0aaea9618213f1f7c92ab524d999b82dc35a1c8556ac71a2a332ee1781cd`。Artifact 非 retained，有过期时间；长期证据为本记录和下载 hash，不承诺服务端永久可下载。
- Subagent：Run `8563fa50-a25d-4a85-84d9-0e29bb0a5c80`、delegation `c606d790-3803-45ee-9432-916991c4070b`、childRuntime `65a1f403-172d-435f-960e-b28e6501f665`，实际 child completed。
- Workspace 串行：Run `fd6d50de-6730-4160-a6b7-d64b6c0c314c`，Workspace `563a5442-a33f-4c61-8da8-52240389eeeb`，76B calc.js SHA `c689e2195a2df5b3ea0d81d849a4bdda633855c29e1ae8c1e2e6cc0445c361aa`。
- 前台 job `job-11ecb5c0901e70f1f2435d816f9fc9061be7105cbcbaac033fa316565ba2c171` → stdout `RESUME_RUNNER_42\n`、stderr 空、exit0。
- 后台 job `job-a6f133f4bce4cc9a3b91e9671689324d16eca5daac1f42424b27bfce97b3e0d5` → accepted running；wait succeeded、stdoutTail `RESUME_BG_OK\n`、exit0。
- 负向 job `job-378741d2e0c69c7f5b30b892431d098cb652163810dbd231e529b4a686295f1d` → exit7、ok false、outcome confirmed、semantic failed。

## 本轮修复（仅阻塞后续测试）

| 提交       | 修改与证据                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `974a310d` | SSH adapter 保留 CommandExecutionError 中明确、无 signal 的非负退出码及 stdout/stderr；未知/超时仍不当成功。扩展 unified shell 场景，并真实复验 exit7→下一命令 exit0。                                                                       |
| `55998cf4` | Workspace create/control 审批复核只保留公开参数，冻结环境/版本/Generation 仍绑定 operation hash 与 preconditions；Agent 工具等待 Runner terminal，HTTP 普通创建仍默认异步；未确认 provision 不冒充成功。扩展已有 background lifecycle 场景。 |
| `4a1194f1` | Runner file stat/write/list 接受有限非负的小数毫秒修改时间，size 等整数字段仍严格校验。真实 HTTP scenario 写/查/列带小数 mtime 文件，真实模型 file_write/list/SHA/exec 复验成功。                                                            |

每个修复独立本地提交且同提交更新 `doc/USAGE.md`，未 push。共享目录其他会话的 event projector、rejection taxonomy 和 SSH session 修复不记为本轮修改。

## 保留问题与限制

1. Memory 候选提议 VALIDATION_FAILED：合法性需继续定位；模型收到“只试一次”仍重试，并猜测空 sourceRefs 不合法，不能据此认定根因。
2. Browser 策略拒绝 view-source 后 Run interrupted/unknown：拒绝本身符合 allowlist，是否应隔离属于结果分类问题；导航、title、截图成功不能掩盖整轮未完成。
3. Workspace 活动 job 冲突拒绝被视为 unknown mutation，导致 Run interrupted；当前可用明确串行规避，保留未修复。
4. 模型经常生成不符合 schema 的 path/action/工具参数；文件 patch 需纠正，Runner 审计先写不存在父目录。记录人工纠正，不将其记为完全自主成功。
5. 串行负向验收已完成核心步骤，模型仍反复探测已删除 Workspace、尝试第二轮 create/restart并扩大 Plan。通过追加用户输入要求停止后才结束；最终 Run failed/goal not_satisfied/verification failed。纯正向用例再次复现此问题：删除是最后一次 mutation，completion-gate.ts 要求 stepIndex 不早于最后 mutation 的成功 execution 或 ready Plan Artifact；删除后不能继续执行，已完成的命令证据因时间顺序被排除。实际 ledger 连续出现 COMPLETION_EVIDENCE_REQUIRED。此为静态代码与运行证据支持的完成判定问题，未修复。
6. 子 Agent 的默认排序示例有误，主 Agent 复核也漏掉；独立真实执行已纠正。修复 avg 代码 7 样本正确，但极大数浮点精度未验证。
7. 测试 base-tools pack 内 node wrapper 指向系统 Node；不是官方 node toolchain pack 下载/安装验收。Node/Python/Go 包、ACP/MCP、Plugin 的真实集成仍待独立环境测试。
8. 账号本轮复用已认证状态；注册初始化流程本轮未重复。测试账号/Provider/profile/browser target 保留用于后续复测。
9. Browser Artifact 可过期，原始本地日志目录被 git 本地 exclude；已提交的 dataset 是本轮可复用证据，不依赖这些临时日志存在。

## 自动化检查与最终环境

- Node 24.21.0 下全仓 `pnpm run check` 通过（`resume-final-check.log`）。
- Backend Agent scenarios：82 PASS（`resume-final-scenarios.log`）；相关新场景覆盖真实 Runner HTTP codec 和统一 ToolExecutor 审批复核。
- Backend build 通过（`resume-final-build.log`）；Runner build 通过（`resume-runner-build.log`）。
- Agent E2E：35 passed / 1 failed，失败发生在 SSH reset fixture 的 response.ok 前置断言，实际用例未执行，不将它归为 Agent 功能失败或全通过（`resume-e2e.log`）。
- `format:all:check` 曾因本地 ignored raw evidence/harness 48 个文件格式失败；生产修改文件单独 Prettier 检查通过，`git diff --check` 通过。未为了格式重写其他会话证据。
- Runner systemd active；token 环境文件 0600、unit 和 README 0644，端口仅 loopback。Backend/9998 运行。管理 cleanup 仅预览中确认属于本轮的四个 Workspace，命令 succeeded，全部回收。
- 本轮审计时原测试目录已清理。保留测试 Runner 服务以供继续使用，不卸载环境。最后验收后的状态在 dataset 的 final evidence 中。

## 末尾纯正向验收和完成判定缺陷

Run `7cf5d66c-6b17-42e8-aa1d-2a5e5256ca3b`：Workspace `b7d75b09-b1bb-49af-86ed-5f9fd5daf72c`，job `job-21addf8419ff749f699aeb11c6626c272927a8c08c56a7a113a8faa311c5685b`。create ready、start succeeded、stdout `42\n`、exit0、stop succeeded、delete succeeded 全部真实通过。随后 completion gate 连续要求新的 execution evidence，模型重提 workspace_create 被 MUTATION_ALREADY_CONFIRMED 拒绝；最终 status failed。**不能将此 Run 记为 PASS 或 completed verified。**

本轮最后再次 fetch/merge main，仍 Already up to date。只包含本轮五个 Workspace 的 cleanup 预览经归属检查后确认成功；最终 runtimeBytes=0、runningRuns=0、pendingApprovals=0、pendingBudgetRequests=0。Runner 服务和 9998 前端保留。

结论：实际 Runner 执行链已经补齐并独立核验，三处阻塞修复已落在 test 分支；Agent 整体仍有完成判定、Memory、Browser/活动 Job 拒绝分类和输出质量问题，完整保留，未宣称全部通过。
