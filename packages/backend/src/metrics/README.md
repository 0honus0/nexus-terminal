# Metrics 模块

Prometheus 指标采集模块，暴露 `/api/v1/metrics` 端点供 Prometheus 服务器抓取。

## 文件结构

| 文件                    | 职责                                                   |
| ----------------------- | ------------------------------------------------------ |
| `metrics.service.ts`    | prom-client 注册表初始化、默认指标与自定义业务指标定义 |
| `metrics.controller.ts` | 请求处理与响应封装                                     |
| `metrics.routes.ts`     | 单一 GET 端点，委托 controller 处理                    |
| `metrics.middleware.ts` | HTTP 请求延迟自动采集中间件                            |

## 路由注册

路由已在 `config/routes.ts` 中注册，受 `ENABLE_METRICS=true` 环境变量控制。中间件在 `config/middleware.ts` 中全局注册。

## 指标类型

- **默认指标**：Node.js 运行时指标（CPU、内存、GC 等）
- **HTTP 请求延迟**：`http_request_duration_seconds` 直方图
- **WebSocket 连接数**：`websocket_active_connections` gauge
- **SSH 会话数**：`ssh_active_sessions` gauge
