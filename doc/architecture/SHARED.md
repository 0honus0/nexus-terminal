# Shared 架构

本文按 [模块模板](MODULE_TEMPLATE.md) 定义双端契约职责。人工约束见 [HUMAN](../rules/HUMAN.md)，开发入口见 [AGENTS](../AGENTS.md)。

## 1. 职责与范围

`packages/shared` 持有前后端同义同表示的基础取值、业务对象与完整通信契约；不持有后端秘密、权限状态、存储行、技术连接或 UI 草稿。旧正式通信仍使用 `packages/protocol`，迁移按功能同步消费者，不让新后端运行时导入旧 Protocol。

## 2. 子功能与目录

```text
packages/shared/src/<domain>/<feature>/
  values.ts          基础取值、错误码、真实双端容量
  model.ts           双端业务对象
  http.ts            完整请求/响应
  http-codec.ts      确有需要的纯解码
  events.ts          WS/事件契约与必要纯解码
```

当前已建立 Access、Targets 和 Remote 双端契约。子域按业务语义划分，无实际内容不创建空文件。Agent 计划采用 `agent/scope`（App/Thread）与 `agent/runs`（有限 Run、变更结果及事件分页）；当前尚无 Shared Agent，不能描述为已完成。

## 3. 依赖方向

Shared 不依赖 Backend、Frontend、具体 Adapter 或运行时；不访问数据库、网络和环境。values 与 model/http/events 隔离；Platform/业务 SQL Adapter 仅可精确引用确需共用的基础值，不能借 Shared 导入业务对象。package exports 明确列出真实入口，不靠内部深层路径消费。

## 4. 类型与转换

同义同表示的有限取值只定义一次；内部应用表示不同则保留独立类型并显式映射。后端 Service 不把 Shared HTTP 当内部用例类型；公开后端能力可引用消费者需要的 Shared 对象，但逐字段出口投影仍保留。输入从 unknown 严格解码，完整联合结果与安全错误响应都定义，不只迁出成功 DTO。

协议容量是实际 UTF-8/帧字节预算，包含外壳与转义；后端与前端消费相同定义。私有队列、缓存、重放和关闭策略不自动成为 Shared；共享产品限制需有实际契约用途。身份来自认证，不接受 wire 自报 userId。

## 5. 入口与安装

每个协议切片同步 package exports、后端路由解码/投影、前端 transport/codec 和实际功能入口；测试、脚本和公开消费者同批核对。不保留无人消费的兼容转导出。

Agent 的当前 HTTP 位于 `backend-next/modules/agent/interfaces/http`，公开对象/状态在后端 public；前端未消费新 API。迁移必须新增真实消费者，不能仅创建目录就声称完成。

## 6. 数据、事务与并发

Shared 只表达对外版本、游标、幂等结果等契约，不执行事务。expectedVersion、operationKey、事件序号/分页与 replay 结果的含义由业务 owner 保证；共享类型不替代服务端授权及同事务状态校验。

## 7. 生命周期与失败

公开失败使用稳定安全码，未知失败不可当成功；不传技术 cause、秘密或对象 dump。协议解码不持有活跃资源。取消、generation、终态和资源关闭分别归实际前后端 owner，Shared 可以描述语义，但不能虚构远端回滚保证。

## 8. 当前能力与验收

核对范围从所有实际功能和端点开始，不仅扫描 Shared 现有目录。每个切片证明 values/model/http/events 的适用归属、实际消费者、编解码和边界投影完整；没有事件协议不预建 events。

Shared check/build、Backend-next check/build、Frontend 类型/build 及对应格式检查均通过后才收口源码阶段，真实行为仍独立验收。当前 Agent 缺口与具体实施见 [实施方案](../后端重构下一阶段实施方案.md#s1-agent-共享协议与真实消费者)。
