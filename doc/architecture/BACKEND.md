# 后端架构

本文约束新后端及后续功能的放置和依赖。开发前由 [AGENTS](../AGENTS.md) 读取 [人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 与 [编码规范](../rules/CODE_STYLE.md)。按 [模块模板](MODULE_TEMPLATE.md) 维护下面八个章节，不复制人工规则和编码列表。

## 1. 职责与范围

正式后端仍为 `packages/backend`；新架构在 `packages/backend-next`，新包不运行时导入旧 Backend/Protocol。旧包是功能和调用链参考，正式切换需单独迁移与验收，不因新包能构建就切流量。

| 一级模块 | 业务 owner                                                    | 当前边界                                                                                      |
| -------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Access   | 账号、认证、会话与访问策略                                    | 已有初始管理员、密码、持久会话、失败策略；完整因素/角色/策略管理未迁移                        |
| Targets  | 连接配置、凭据、Proxy、SSH Key、Tag、目标解析与 Host Key 信任 | 已有 SSH/RDP/VNC 定义和基础管理；RDP/VNC 定义不等于运行能力                                   |
| Remote   | 普通用户终端、文件与其他远程用例                              | 已有 PTY/WS 和独立只读 Files；写入、传输、挂起恢复与桌面未迁移                                |
| Agent    | Agent scope、Run 与后续执行/治理                              | 已有 App/Thread、pending/cancelled Root Run、幂等与事件；无执行链，新 Shared/前端消费者未迁移 |

后续 preferences、notifications、audit、system 按各自业务所有权实施，不提前创建空模块；Agent 的 Provider/调度/Tool/授权/审批/Job/Artifact/Memory/集成归 Agent 子功能，不复制技术底座。

## 2. 子功能与目录

```text
packages/backend-next/src/
  main.ts                         进程配置与启动
  bootstrap/                      技术实例、模块安装、全库迁移与停机
  platform/
    storage/sqlite/               SQL 契约与 Runtime
      adapters/                   SQLite 方言、版本表及实际 Worker
    ssh/adapters/ssh2/            SSH/SFTP/命令技术实现
    http/                         通用 HTTP/WS
    security/                     通用加密与密码散列
    lifecycle/                    通用有界结果/失败记录
  modules/<module>/
    public.ts                     后端跨模块安全契约
    public-errors.ts              确有消费的安全错误出口
    register.ts                   装配、安装选项与生命周期
    migrations.ts / schema.ts     安装接口与顺序，不含 SQL
    interfaces/http/              协议解码与投影
    <feature>/
      service/                    用例、权限、顺序与应用资源 owner
      model/                      应用类型及存储/技术转换
      storage/                    内部存储任务契约
      adapters/sqlite/            SQL、行解码、事务和 DDL
```

Targets 的 connections/proxies/ssh-keys/tags/host-keys/resolver/import 为同一模块子功能；Remote 的 sessions/files 各有资源；Agent 当前为 scope/runs。无持久化功能不创建 storage。文件按职责和消费者拆分，独立 helper 不自动升级为公用能力。

## 3. 依赖方向

```text
Bootstrap → 模块 register / 迁移安装入口
Bootstrap → Platform 技术实例
Interface → 本模块用例 + Shared 协议
Service → 本模块 Model + 所需跨模块公开能力
Model → 模块 storage 契约 / Platform 技术契约
SQLite Adapter → storage 契约 + Platform SQL
```

Platform 不依赖业务模块、不持有 Connection/Run/User、业务表、授权状态或业务注册槽。业务 SQL Adapter 不依赖 Model/Service/Shared 对象与协议；确需共享的基础值只从 Shared 精确 values 路径引用。

跨一级模块仅用 public 安全能力和明确安装契约，不深层导入 Model/Service；模块内部可直接协作，不绕全局 dispatcher。Service 可使用通用 SecretBox/PasswordHasher 完成凭据保护，Model 转换已保护的数据。应用实例依赖由 Bootstrap/register 安装，不使用可变进程级数据库单例。

## 4. 类型与转换

内部复用应用类型在所属 `model/*-types.ts`；存储契约在 storage；技术契约在 Platform；后端跨模块类型在 public；双端契约按 [Shared 架构](SHARED.md) 归属。类型与实现分开，低层不反向引用上层。

Model 逐字段转换应用与存储/技术输入结果；模块入口/出口 mapper 保护公开边界；HTTP/WS 逐字段投影完整 wire。三个边界各有职责，即使字段相同也保留运行时白名单；同一边界不复制转换。复杂公开投影可独立 public-mappers，单处投影就地保留。

Files 的 `FileResource` 只提供应用身份、可用状态、只读操作和关闭；Machine/SFTP lease/Stream 私有持有于 Model 的 `SftpFileResource`。PTY 同样通过应用资源操作，Service 不取得技术句柄。技术失败在真实 owner 转为具名应用失败，公开出口不传 cause 或凭据。

## 5. 入口与安装

main 读取环境和启动；Bootstrap 安装实例与全库迁移；模块 register 组装内部 Model/Service/Adapter，并返回消费者需要的能力、HTTP/WS 安装及 quiesce/close。Bootstrap 不逐个构造所有业务 Repository，也不引用私有配置类型。

Access 取得可信会话身份；Targets 管理出口只给非敏感对象，可信 SSH 解析为独立后端能力；Remote 普通资源绑定登录会话；Agent 绑定自己的 user/App/Thread/Run。UUID 和目标选择不替代授权。模块内部 HTTP 可调用本模块明确 Service，跨模块仍走 public。

## 6. 数据、事务与并发

真实 SQL 仅在 Adapter：Agent scope/runs 和 Targets Host Key DDL 归各子功能 `adapters/sqlite`，模块迁移通过初始化接口调用。Bootstrap 持有唯一全库版本顺序，已编号迁移保持签名和安装语义，版本 marker 与 DDL 同事务提交。

Platform 的 SQL Executor 契约在 `storage/sqlite/sql-types.ts`；版本表 Adapter、事务控制 Adapter 和 Worker 在 adapters。Runtime 持有队列、隔离和失败语义：回调失败回滚，rollback_failed/commit_unknown 保留因果并使实例不可用；未知提交不自动重试。Worker 严格验证完整消息，损坏/不可关联结果使待完成调用全部拒绝。

业务多表写入和引用/CAS/幂等校验归存储 Adapter 的真实事务。Targets 可信解析在同一 SQL 快照读取目标、凭据与路由，Model 计算指纹并在解密前核对 expectedFingerprint；先读指纹后重新解析不能替代同快照检查。指纹不替代 Host Key 信任，也不证明后续配置永不变化。

## 7. 生命周期与失败

资源有唯一 owner；准入、半开、活跃和关闭任务追踪至真实收敛。等待超时不归还仍被资源占用的名额；晚成功关闭，晚拒绝中的清理失败进入有界诊断及停机汇总。`RemoteResourceCleanupFailure` 区分清理完整性失败与普通授权/建连拒绝。

关闭先保存共享 Promise，再执行可能重入的清理；失败继续后续释放，保留因果并聚合。停机停止新准入、关闭 HTTP/WS 并等待已接纳任务、取消并 drain 模块资源，最后关闭 SQLite。当前动态资源由 Remote 持有，后续 Agent 调度/执行必须提供自己的生命周期。

普通 PTY、Files 和 Agent 使用共同 SSH/SFTP 工厂，但不共用授权或活跃资源。PTY 协议 owner 管 ACK/背压/EOF；Files Model 管严格 UTF-8、有界读取和元数据，Service 管身份/指纹复查、准入/期限/关闭。实际 SFTP 以 opendir/readdir(handle)/close 有界读取目录；取消后的 lease 不复用。本地取消不证明远端停止，整体停机有界、原子 nofollow 和文件快照不能凭接口宣称。

## 8. 当前能力与验收

Access/Targets/Remote 基础切片与有限 Agent 状态已具备源码；未实现能力见职责表。新 Agent 协议与前端消费者仍为明确缺口，不能因没有前端引用就从产品迁移任务中遗漏。

产品行为与容量以 [USAGE](../USAGE.md) 为准，当前工作见 [实施方案](../后端重构下一阶段实施方案.md)，未执行真实专项见 [待实机验证](../testing/后端重构待实机验证.md)。新后端独立 check/build，Shared 与实际双端消费者同步检查；架构审核按模块模板和工程经验执行，静态通过不能证明真实 SSH、并发、清理与浏览器验收完成。
