# Metrics 模块

Prometheus 指标采集模块，暴露 `/api/v1/metrics` 端点供 Prometheus 服务器抓取。

## 文件结构

| 文件                    | 职责                                                   |
| ----------------------- | ------------------------------------------------------ |
| `metrics.service.ts`    | prom-client 注册表初始化、默认指标与自定义业务指标定义 |
| `metrics.routes.ts`     | 单一 GET 端点，返回 Prometheus 文本格式指标            |
| `metrics.middleware.ts` | HTTP 请求延迟自动采集中间件                            |

## 无 Controller 层的原因

本模块仅有一个端点（`GET /api/v1/metrics`），路由直接调用 prom-client 注册表生成指标数据，无需请求参数解析或业务逻辑处理，因此不设独立 controller 层。路由逻辑足够简单，直接在 routes 文件中处理即可。

## 指标类型

- **默认指标**：Node.js 运行时指标（CPU、内存、GC 等）
- **HTTP 请求延迟**：`http_request_duration_seconds` 直方图
- **WebSocket 连接数**：`websocket_connections_active` gauge
