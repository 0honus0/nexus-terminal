# Services 目录

本目录包含跨模块共享的服务，不属于任何特定业务域。

## 服务列表

| 文件                                                                       | 职责               | 使用方                  |
| -------------------------------------------------------------------------- | ------------------ | ----------------------- |
| `event.service.ts`                                                         | 事件发布订阅总线   | 全局（导入即注册）      |
| `dashboard.service.ts` / `dashboard.controller.ts` / `dashboard.routes.ts` | 仪表盘聚合数据     | 前端 Dashboard 页面     |
| `ssh.service.ts`                                                           | SSH 连接工具函数   | WebSocket 处理器、SFTP  |
| `guacamole.service.ts`                                                     | Guacamole 协议服务 | Remote Gateway 通信     |
| `status-monitor.service.ts`                                                | 系统状态监控       | 前端 StatusMonitor 组件 |
| `import-export.service.ts`                                                 | 连接数据导入导出   | Settings 控制器         |
| `path-history.service.ts`                                                  | 路径浏览历史       | 前端文件管理器          |

## 设计说明

这些服务之所以放在 `services/` 而非独立模块目录，是因为它们：

1. 被多个业务模块共同依赖（如 `ssh.service.ts` 被 WebSocket 和 SFTP 使用）
2. 不具备独立的路由/控制器层（作为工具函数存在）
3. `dashboard.*` 保留在此处因其聚合多个模块数据，不属于单一业务域

## 新增服务标准

- 如果服务仅服务于单一业务域，应放入对应的业务模块目录（如 `auth/`、`connections/`）
- 只有被 2 个以上模块共同依赖的服务才考虑放入此目录
