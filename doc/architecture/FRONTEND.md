# 前端架构

本文按 [模块模板](MODULE_TEMPLATE.md) 维护功能、运行时与界面的职责，开发前读取 [AGENTS](../AGENTS.md)、[人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 及 [编码规范](../rules/CODE_STYLE.md)。产品行为以 [USAGE](../USAGE.md) 为准。

## 1. 职责与范围

Frontend 展示产品状态并驱动用例，服务端事实不在浏览器重建为另一份权威。当前正式 API 仍使用旧 Protocol；`/__targets-next` 与 `/__agent-next` 是独立新后端开发入口。Agent 状态 API 已有 `features/agent/next` 源码消费者，正式旧 Agent 不切换；真实浏览器行为仍独立验收。

## 2. 子功能与目录

| 位置                         | 职责                                                |
| ---------------------------- | --------------------------------------------------- |
| `app/`                       | 入口、路由、全局装配与样式/i18n 聚合                |
| `features/<feature>/`        | 业务界面、用户动作和功能状态                        |
| `runtimes/<runtime>/`        | 连接、协议流、资源生命周期与运行状态                |
| `client/`                    | 当前正式 HTTP client、解码和资源 API                |
| `foundation/`                | 无产品语义的 async/browser/data/interaction/ui 能力 |
| 本包 `shared/`               | 跨功能注入能力、反馈、焦点和认证生命周期协作        |
| workspace `packages/shared/` | 真正双端类型与通信契约                              |

新后端开发能力在 `features/targets-next`、`runtimes/remote-next`；Agent 状态消费归 `features/agent/next` 的 api/model/views/i18n，DEV 路由为 `/__agent-next`。共用的新 Access client 归 Auth next，通过 Auth public 安装到 Targets/Agent，不跨功能深层引用。现有业务按真实 owner 扩展。i18n 使用所属功能目录，应用入口聚合，不把翻译或 UI 草稿放入 workspace Shared。

## 3. 依赖方向

app 装配 feature/runtime；feature 通过窄公开能力消费 runtime 和 foundation。跨功能通过公开入口/明确能力，不深层引用私有组件、Store 或实现。foundation 不反向依赖业务。新 Shared 契约按 [SHARED](SHARED.md) 消费，不在前端手写同义 DTO。

## 4. 类型与转换

HTTP/WS transport 从 unknown 验证完整响应及安全错误，wire 与 UI 草稿/展示状态区分。字段、嵌套对象及联合分支按白名单投影；不能用断言冒充响应解码。Agent next API 使用 Shared codec，controller 再逐字段投影为本地应用状态。请求完整编码字节预算与后端共用 Shared，响应流在累计预算内读取，不全量加载后才拒绝。

跨 controller/view 复用的应用状态及错误联合归所属 `model/*-types.ts`，仅局部使用的类型留实现文件。Shared 负责字段形状及基础取值；transport 持有请求上下文，核对资源身份、端点成功状态与分页 after/limit，再交给 controller。响应声明异常或超预算的早退也收尾未消费 body；已取得的 reader 在最终路径释放锁。

## 5. 入口与安装

路由和 app 负责安装功能，view 负责展示和用户交互；异步协调、订阅和资源生命周期由明确 controller/runtime 持有。Agent next 与 Targets next 只在 DEV 路由安装，并从 Auth public 消费同一 next 认证能力。通用 UI 从 foundation/ui 的正式入口消费，功能布局由各业务 owner 负责，不把产品逻辑塞入基础组件。

## 6. 数据、事务与并发

浏览器缓存只是服务端状态投影，不替代版本/CAS/幂等。Agent next 为同一 create/cancel 写入意图保留稳定 Idempotency-Key；网络、协议或未知提交结果不会自动换 key。version_conflict 只刷新最新状态，不盲目继续写。登录、scope/run 切换、刷新和卸载使用 generation 与 AbortController；await 后检查有效性再发布，旧 finally 不清除新任务状态。事件按 runId/sequence 去重，游标只使用服务端 nextCursor。

## 7. 生命周期与失败

明确打开、取消、订阅、解除、关闭和卸载 owner。取消前端请求不证明后端副作用终止；晚返回的资源仍尝试归还给原 owner。错误映射稳定安全码，区分网络失败、协议失败、业务拒绝和未知写入结果；非 JSON、未知状态/错误码及错误 shape 不当作成功。不把失败刷新作为操作已恢复证明。

transport 产生具名失败与受约束 code，controller/view 只消费该契约；Auth 的共用失败从其公开入口消费，不比较普通 Error.message。服务端安全码引用 Shared，本地通信失败留本包；未知异常统一安全兜底，不能把技术正文用于翻译或决定认证/写入结果。

普通终端、Files、Agent 各有业务生命周期，共用技术原则而不混用权限与资源。PTY ACK/背压由对应 runtime 消费协议，view 不复制流状态机。资源关闭失败须有可追踪反馈，不能静默伪造关闭成功。

## 8. 当前能力与验收

既有正式产品事实由 USAGE 与对应源码核对，本文不保存逐次修复记录。有限 Agent 状态的 Shared、backend-next、Auth next、Agent next transport/controller/DEV view 与三语源码已接入；现有开发入口不等于正式切换。Provider、执行、工具、审批、WS 与真实浏览器行为仍未因此完成。

源码复核的错误契约、类型归属、请求上下文校验及响应早退收尾仍未完成，已转入 [前端延期事项](../后端重构下一阶段实施方案.md#延后的前端事项未验收不删除)。当前先完成后端及其最终环境验收，再进行前端对接；已有 DEV 代码保留。上述边界是开发约束，不能因端点接通和静态通过就声称已全部满足。

执行 Frontend 类型检查、build、ESLint/Prettier 和根检查；桌面/移动端操作、滚动、取消与资源清理通过真实浏览器行为验证，未执行项明确保留。每次发布/行为变更同步 USAGE，不凭静态通过改写真实行为证据。
