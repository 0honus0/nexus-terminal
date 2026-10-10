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

当前已建立 Access、Targets、Remote 和有限 Agent 状态契约。子域按业务语义划分，无实际内容不创建空文件。Agent 使用 `agent/scope`（App/Thread）与 `agent/runs`（有限 Run、变更结果及事件分页）；共同安全码、UUID 取值和完整 JSON 字节预算在 `agent/values.ts`，共同错误响应与纯解码在 `agent/http.ts`、`agent/http-codec.ts`。持久事件对象在 runs/model，本批没有 Agent WS，不创建 events。

## 3. 依赖方向

Shared 不依赖 Backend、Frontend、具体 Adapter 或运行时；不访问数据库、网络和环境。values 与 model/http/events 隔离；Platform/业务 SQL Adapter 仅可精确引用确需共用的基础值，不能借 Shared 导入业务对象。package exports 明确列出真实入口，不靠内部深层路径消费。

## 4. 类型与转换

同义同表示的有限取值只定义一次；内部应用表示不同则保留独立类型并显式映射。后端 Service 不把 Shared HTTP 当内部用例类型；公开后端能力可引用消费者需要的 Shared 对象，但逐字段出口投影仍保留。输入从 unknown 严格解码，完整联合结果与安全错误响应都定义，不只迁出成功 DTO。

协议容量是实际 UTF-8/帧字节预算，包含外壳与转义；后端与前端消费相同定义。私有队列、缓存、重放和关闭策略不自动成为 Shared；共享产品限制需有实际契约用途。身份来自认证，不接受 wire 自报 userId。

Agent name/title 原始输入为 128 bytes、prompt 为 16 KiB；创建 Run 完整 JSON 为 128 KiB，其余 JSON 为 16 KiB。响应统一 32 KiB：每页至多 100 个事件，每项固定 UUID、有限事件名与安全整数，编码上界小于 224 bytes；页外壳和其余响应均落在预算内。后端在白名单投影后校验完整编码，纯解码同样限制大小；前端还须在读取流时使用此预算。请求正文原始空白由 HTTP 实际读取限额约束，重编码长度不替代实际 wire 限额。

## 5. 入口与安装

每个协议切片同步 package exports、后端路由解码/投影、前端 transport/codec 和实际功能入口；测试、脚本和公开消费者同批核对。不保留无人消费的兼容转导出。

Agent 六个状态 HTTP 已接入 Shared 的请求、路径、幂等 header、分页 query、成功联合及安全错误；后端 public 只保留可信身份输入、能力和后端结果语义。正式前端 `features/agent/api` 仍消费旧 Protocol；新消费者已在 `features/agent/next` 接入 Shared codec 和容量，真实浏览器行为由实施方案另行验收，不能把正式旧 Agent 当作新 API 消费者。

## 6. 数据、事务与并发

Shared 只表达对外版本、游标、幂等结果等契约，不执行事务。expectedVersion、operationKey、事件序号/分页与 replay 结果的含义由业务 owner 保证；共享类型不替代服务端授权及同事务状态校验。Agent 应用和存储对象独立保留，只复用 values 中的状态/事件基础值；内部 scope_not_found 在 HTTP 转为 not_found，不进入成功响应联合。

## 7. 生命周期与失败

公开失败使用稳定安全码，未知失败不可当成功；不传技术 cause、秘密或对象 dump。协议解码不持有活跃资源。取消、generation、终态和资源关闭分别归实际前后端 owner，Shared 可以描述语义，但不能虚构远端回滚保证。

## 8. 当前能力与验收

核对范围从所有实际功能和端点开始，不仅扫描 Shared 现有目录。每个切片证明 values/model/http/events 的适用归属、实际消费者、编解码和边界投影完整；没有事件协议不预建 events。

Shared check/build、Backend-next check/build、Frontend 类型/build 及对应格式检查均通过后才收口源码阶段，真实行为仍独立验收。Agent 实际消费者与具体收口见 [实施方案](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。
