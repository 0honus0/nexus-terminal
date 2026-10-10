# 前端架构

本文按 [模块模板](MODULE_TEMPLATE.md) 维护功能、运行时与界面的职责，开发前读取 [AGENTS](../AGENTS.md)、[人工规则](../rules/HUMAN.md)、[工程经验](../rules/ENGINEERING.md) 及 [编码规范](../rules/CODE_STYLE.md)。产品行为以 [USAGE](../USAGE.md) 为准。

## 1. 职责与范围

Frontend 展示产品状态并驱动用例，服务端事实不在浏览器重建为另一份权威。当前正式 API 仍使用旧 Protocol；`/__targets-next` 为独立新后端开发入口，已有 Targets 管理、Remote PTY 和只读 Files 消费；新 Agent 状态 API 尚无前端消费者。

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

新后端开发能力在 `features/targets-next`、`runtimes/remote-next`；现有业务按真实 owner 扩展。i18n 使用所属功能目录，应用入口聚合，不把翻译或 UI 草稿放入 workspace Shared。

## 3. 依赖方向

app 装配 feature/runtime；feature 通过窄公开能力消费 runtime 和 foundation。跨功能通过公开入口/明确能力，不深层引用私有组件、Store 或实现。foundation 不反向依赖业务。新 Shared 契约按 [SHARED](SHARED.md) 消费，不在前端手写同义 DTO。

## 4. 类型与转换

HTTP/WS transport 从 unknown 验证完整响应及安全错误，wire 与 UI 草稿/展示状态区分。字段、嵌套对象及联合分支按白名单投影；不能用断言冒充响应解码。请求完整编码字节预算与后端共用 Shared，响应流在累计预算内读取，不全量加载后才拒绝。

## 5. 入口与安装

路由和 app 负责安装功能，view 负责展示和用户交互；异步协调、订阅和资源生命周期由明确 controller/runtime 持有。通用 UI 从 foundation/ui 的正式入口消费，功能布局由各业务 owner 负责，不把产品逻辑塞入基础组件。

## 6. 数据、事务与并发

浏览器缓存只是服务端状态投影，不替代版本/CAS/幂等。登录切换、目标切换、刷新和异步写入使用真实请求身份或 generation；await 后检查有效性再发布，旧 finally 不清除新任务状态。多个 HTTP 成功不能声称服务端事务原子性。

## 7. 生命周期与失败

明确打开、取消、订阅、解除、关闭和卸载 owner。取消前端请求不证明后端副作用终止；晚返回的资源仍尝试归还给原 owner。错误映射稳定安全码，区分 loading、成功、拒绝和未知结果；不把失败刷新作为操作已恢复证明。

普通终端、Files、Agent 各有业务生命周期，共用技术原则而不混用权限与资源。PTY ACK/背压由对应 runtime 消费协议，view 不复制流状态机。资源关闭失败须有可追踪反馈，不能静默伪造关闭成功。

## 8. 当前能力与验收

既有正式产品事实由 USAGE 与对应源码核对，本文不保存逐次修复记录。新 Agent 缺口列入实施方案；现有开发入口不等于正式切换。双端协议迁移同步后端、Shared、前端 transport、界面及适用 i18n。

执行 Frontend 类型检查、build、ESLint/Prettier 和根检查；桌面/移动端操作、滚动、取消与资源清理通过真实浏览器行为验证，未执行项明确保留。每次发布/行为变更同步 USAGE，不凭静态通过改写真实行为证据。
