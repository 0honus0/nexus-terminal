# 文档导航

按要解决的问题选择入口；每种内容只在所属文档维护正文，其它位置引用。当前架构文档描述源码，明确标记的重构方案不代表已实现；发布与实测结论按具体版本和证据判断。

| 目的                 | 文档                                                                         | 维护范围                                                             |
| -------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| 使用产品             | [使用说明](USAGE.md)                                                         | 操作、权限、有效限制、失败与恢复；不放施工进度。                     |
| 脚本/客户端接入      | [接口使用补充](API.md)                                                       | 现有接口的调用语义、容量与错误核对；完整契约以Shared和实际路由为准。 |
| 部署、更新、维护仓库 | [部署](DEPLOYMENT.md)                                                        | Compose、环境、数据、迁移、构建和手动清理。                          |
| 开发前读取           | [开发入口](AGENTS.md)                                                        | 阅读顺序与八步流程。                                                 |
| 人工约束             | [人工规则](rules/HUMAN.md)                                                   | 用户明确制定的规则，原文与编号保持。                                 |
| 工程经验/编码        | [工程规则](rules/ENGINEERING.md)、[编码规范](rules/CODE_STYLE.md)            | 共性约束与编码/检查要求；不记录本轮缺陷。                            |
| 设计模板             | [模块模板](architecture/MODULE_TEMPLATE.md)                                  | 八个设计维度与边界检查。                                             |
| 后端设计             | [Backend](architecture/BACKEND.md)、[Agent专题](architecture/AGENT.md)       | 当前owner、依赖、转换、事务和生命周期。                              |
| Agent 重构方案       | [Agent 重构](architecture/AGENT_REFACTOR.md)                                 | SDK4动态注册、App调度、前后端插件、示意图与独立交付的扩展约定。      |
| 前端设计             | [Frontend](architecture/FRONTEND.md)                                         | 视图/草稿/运行时、浏览器资源与恢复。                                 |
| 双端契约设计         | [Shared](architecture/SHARED.md)                                             | 取值、请求/响应、解码与真实消费者的归属。                            |
| 远程桌面             | [Remote Desktop](architecture/REMOTE_DESKTOP.md)                             | RDP/VNC SDK、信任、输入、绘制、音频和资源边界。                      |
| 仓库清理设计         | [Maintenance](architecture/MAINTENANCE.md)                                   | 两包保留集合、并发窗口与删除结果。                                   |
| 测试体系重设计       | [本体与插件测试体系](architecture/TESTING.md)                                | 当前分层、框架入口、双仓互操作、覆盖归属及尚待实测的耗时目标。       |
| 当前工作             | [实施计划](PLAN.md)                                                          | 已确定安排、尚未完成事项和验收判据；完成阶段清理。                   |
| 执行验证             | [测试入口](testing/E2E.md)、[Agent任务场景](testing/AGENT_TASK_SCENARIOS.md) | 当前基线、命令、覆盖与独立判据。                                     |
| 查旧验证             | [历史验证索引](testing/HISTORY.md)                                           | 固定提交的结果、测量与日志来源；不继承旧任务指令。                   |
| 英文概览             | [English README](README_EN.md)                                               | Quick Start与产品概览，详细规则引用唯一入口。                        |

截图由 [测试入口](testing/E2E.md#文档截图) 管理。历史阶段的B/F编号和“尚未提交”等语句不能代表当前功能状态或构成操作授权。
