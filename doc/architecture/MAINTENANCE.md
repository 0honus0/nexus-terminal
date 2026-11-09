# 仓库维护架构

本文描述手动清理脚本的保留策略、并发窗口及失败保证。运行方式、权限和操作后核对见 [部署与维护](../DEPLOYMENT.md#仓库手动清理)；历史证据见 [验证索引](../testing/HISTORY.md)。产品进程、实例数据及数据库迁移不属于此脚本。

## 1. 职责与范围

`cleanup-history.mjs` 是仓库维护策略和删除执行的唯一 owner，仅面向当前仓库 Actions，以及归属核对通过的两个固定容器包 `nexus-terminal`、`nexus-terminal-e2e-runner`。不涉及产品数据、GitHub Release 或 Git 标签删除。

## 2. 子功能与目录

`scripts/maintenance/cleanup-history.mjs` 持有逐包检查、manifest 闭包、Actions 保留和资源删除；`test-environment.mjs`复用CI产物resolver，核对成功main环境ZIP摘要并读取`environment.json`；`tests/tooling/maintenance/logic/cleanup-history.native.test.mjs` 提供隔离 GitHub/GHCR 回归。工作流只装配手动入口、权限和前置检查。

## 3. 依赖方向

工作流调用脚本；脚本使用 github-script 提供的 Octokit/context/core，以及 Node fetch 访问 GHCR；环境ZIP通过现有`unzip`读取，不另写ZIP解码器。不依赖产品 Backend、Frontend 或 Shared，不新增运行时服务。

## 4. 类型与转换

GitHub REST 包元数据中的 repository.id 必须与当前仓库 ID 相同；版本 ID 用于精确删除，版本 name 作为 SHA256 manifest digest。GHCR 的索引、平台和证明引用在各包独立遍历，标签通过 HEAD 的 docker-content-digest 复查；配置中合法 OCI revision 汇入关联成功运行的保留集合。token 仅在内存持有并注册日志脱敏，不进入产物。

## 5. 入口与安装

仍只有 `workflow_dispatch`，需要 `contents: read`、`actions: write`、`packages: write` 和两个包的仓库 Actions 管理权限。工作流先确认`zip/unzip`工具，运行维护回归，再检查全部保留集合，最后删除；没有新安装点或产品协议。

## 6. 数据、事务与并发

各包现有 main/dev/latest 为保留根，递归保留其平台及证明 manifest；共用 digest 的其它标签随版本保留。允许部分标签不存在，包404或空包跳过；有版本却没有保护根时停止。每次版本删除前复查两个包全部保护标签，结束时再查；移动、消失或新出现都停止旧计划。包版本 DELETE 无条件比较接口，多个 API 删除也不是事务，无法撤销已完成的删除。原 workflow 与发布共用按 ref 的 concurrency；另有活跃 Actions 时跳过镜像和缓存删除，但这不提供跨 ref 或外部发布的原子互斥。

首次保留集合及删除镜像/缓存前均重新分类未完成运行。唯一排除阻挡的例外为超期空 queued：结论必须为 null、attempt 为有效正整数、创建/开始/更新三个时间均超过[GitHub 官方35天 workflow 总期限](https://docs.github.com/en/actions/reference/limits)。重读运行后以 `filter: all` 查询全部 attempt 的 job，只有明确 total_count=0 且 jobs 空数组，再重读确认 attempt/三个时间未变化且仍满足超期条件，才忽略其阻挡；记录和产物仍加入保留集合，不删除或取消。其它未完成状态、近期重跑、存在 job 或证据不全均保留阻挡；运行/job 的404不作为空 job 证据，非404读取失败传播并停止。

## 7. 生命周期与失败

当前/活跃运行、保留revision的成功运行、最近任意分支成功E2E及默认分支成功完整E2E均留存；后者保留准确Host构建、环境产物及记录的runner manifest闭包，不能由其它分支更新的latest替代。环境产物按实际成功job执行时间选取，核对ZIP SHA256、来源SHA、fingerprint与本仓latest引用及观测runner digest；digest仅作保留依据，不用于容器启动；两仓测试使用latest并检查依赖指纹。过期、缺失、损坏或缺少对应manifest均停止清理，先重跑main完整E2E再维护。临时ZIP目录在成功/失败时清理，清理错误保留原因。

删除artifact/run前、每次镜像删除及结束时复查最新成功main的id/attempt，变化立即停止旧计划；该复查与DELETE仍非事务。旧运行和产物删除前重新确认其运行状态。只有精确 DELETE 的404计为已不存在，其他失败传播；无法确认所属运行的产物保留。包版本删除禁用隐式重试，重跑必须重新检查渠道和计划。失败后按日志核对已删资源，不能把请求失败当作删除未发生。

检查与删除按阶段折叠分组，记录成功/失败耗时；每项输出序号、资源ID、镜像digest/标签与保留/跳过/删除原因，删除开始、确认成功、404及异常分别表达。阶段结束和删除失败时汇总已确认数量。其它活跃运行造成镜像/缓存延后时输出 warning，摘要分列计划候选、实际删除和复查保留/延后，不把未执行删除表述成已清理。

## 8. 当前能力与验收

保护集合和删除流程由tests workspace的维护回归检查，手动清理工作流在删除前执行该回归。回归覆盖成功main的无标签runner闭包、其它分支latest移动、环境包损坏/过期、来源错误及维护中main变化；本轮不执行线上删除。历史执行结果见 [验证索引](../testing/HISTORY.md#清理工作流超期空排队与执行日志2026-11-05源码与静态)，尚未覆盖的并发与故障组合见 [PLAN](../PLAN.md#待验与外部依赖)。线上实际删除数量及延后项以手动工作流摘要为准，夹具不能证明线上删除成功。
