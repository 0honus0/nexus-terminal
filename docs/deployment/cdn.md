# CDN 边缘部署指南

> 本文档介绍如何使用 Cloudflare 或 CloudFront 等 CDN 服务加速 Nexus Terminal 的静态资源分发。

---

## 概述

Nexus Terminal 的前端构建产物（Vite + Brotli/Gzip 预压缩）适合通过 CDN 进行边缘缓存。静态资源（JS/CSS/图片）可长期缓存，而 API 和 WebSocket 连接需要直通到后端。

---

## Cloudflare 配置

### 1. 添加域名

1. 登录 Cloudflare Dashboard
2. 添加你的域名
3. 更新域名的 nameserver 到 Cloudflare 提供的地址

### 2. 缓存规则

在 **Rules > Cache Rules** 中添加：

| 规则名称       | 匹配条件                            | 缓存行为                           |
| :------------- | :---------------------------------- | :--------------------------------- |
| 静态资源缓存   | `URI Path matches /assets/*`        | Cache Everything, Edge TTL: 1 year |
| JS/CSS 缓存    | `URI Path matches /*.js` 或 `*.css` | Cache Everything, Edge TTL: 1 year |
| HTML 绕过      | `URI Path matches /index.html`      | Bypass Cache                       |
| API 绕过       | `URI Path starts with /api/`        | Bypass Cache                       |
| WebSocket 直通 | `URI Path starts with /ws/`         | Bypass Cache                       |

### 3. Page Rules（可选）

如果使用免费计划，可使用 Page Rules（最多 3 条免费）：

```text
*example.com/assets/*
Cache Level: Cache Everything
Edge Cache TTL: 1 month
```

### 4. SSL/TLS 设置

- **SSL/TLS 加密模式**: Full (Strict)
- **Always Use HTTPS**: 开启
- **Automatic HTTPS Rewrites**: 开启

### 5. 性能优化

- **Brotli 压缩**: 开启（Speed > Optimization > Content Optimization）
- **Auto Minify**: 开启 JavaScript 和 CSS
- **Early Hints**: 开启

---

## CloudFront 配置

### 1. 创建 Distribution

1. 登录 AWS CloudFront Console
2. 创建新的 Distribution
3. Origin Domain Name 填入你的后端服务器域名（如 `api.example.com`）

### 2. Origin 配置

| 设置项                    | 值                |
| :------------------------ | :---------------- |
| Origin Domain             | `api.example.com` |
| Origin Path               | 留空              |
| Origin Protocol Policy    | HTTPS Only        |
| Origin Keep-Alive Timeout | 60 seconds        |

### 3. Behaviors 配置

创建多个 Behavior 以区分缓存策略：

#### Behavior 1: 静态资源

| 设置项                         | 值                            |
| :----------------------------- | :---------------------------- |
| Path Pattern                   | `/assets/*`                   |
| Viewer Protocol Policy         | Redirect HTTP to HTTPS        |
| Allowed HTTP Methods           | GET, HEAD                     |
| Cache Policy                   | 使用 Managed-CachingOptimized |
| Compress Objects Automatically | Yes                           |

#### Behavior 2: WebSocket

| 设置项                         | 值                                                                 |
| :----------------------------- | :----------------------------------------------------------------- |
| Path Pattern                   | `/ws/*`                                                            |
| Viewer Protocol Policy         | Redirect HTTP to HTTPS                                             |
| Allowed HTTP Methods           | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE                       |
| Cache Policy                   | Use Legacy Cache Policy (转发所有 headers, cookies, query strings) |
| Origin Request Policy          | AllViewer                                                          |
| Compress Objects Automatically | No                                                                 |

#### Behavior 3: API

| 设置项                         | 值                                                                 |
| :----------------------------- | :----------------------------------------------------------------- |
| Path Pattern                   | `/api/*`                                                           |
| Viewer Protocol Policy         | Redirect HTTP to HTTPS                                             |
| Allowed HTTP Methods           | GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE                       |
| Cache Policy                   | Use Legacy Cache Policy (转发所有 headers, cookies, query strings) |
| Origin Request Policy          | AllViewer                                                          |
| Compress Objects Automatically | No                                                                 |

#### Behavior 4: 默认（HTML 页面）

| 设置项                         | 值                                     |
| :----------------------------- | :------------------------------------- |
| Path Pattern                   | Default (\*)                           |
| Viewer Protocol Policy         | Redirect HTTP to HTTPS                 |
| Cache Policy                   | Managed-CachingDisabled（HTML 不缓存） |
| Compress Objects Automatically | Yes                                    |

### 4. 自定义错误页面

配置 404 错误响应返回 `/index.html`（SPA 路由支持）：

| Error Code | Response Code | Response Page Path |
| :--------- | :------------ | :----------------- |
| 404        | 200           | `/index.html`      |

---

## Nginx 配置更新

在 CDN 后面部署时，需要更新 Nginx 配置：

### 信任 CDN 的 IP 头

```nginx
# Cloudflare IP 范围（定期更新）
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 131.0.72.0/22;

# 使用 CDN 传递的真实 IP
real_ip_header CF-Connecting-IP;
```

### 添加 Vary 响应头

```nginx
# 告诉 CDN 根据 Accept-Encoding 缓存不同版本
add_header Vary "Accept-Encoding" always;
```

### Brotli 压缩（如果 Nginx 支持）

```nginx
# 检查是否安装了 brotli 模块
# nginx -V 2>&1 | grep brotli

brotli on;
brotli_comp_level 6;
brotli_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript image/svg+xml;
```

---

## 验证配置

### 检查 CDN 状态

```bash
# 检查响应头是否包含 CDN 标识
curl -I https://example.com/

# Cloudflare 应包含:
# server: cloudflare
# cf-cache-status: HIT/MISS/DYNAMIC

# CloudFront 应包含:
# x-amz-cf-id: ...
# x-amz-cf-pop: ...
```

### 检查 WebSocket

```bash
# 测试 WebSocket 连接
wscat -c wss://example.com/ws/

# 或使用浏览器 DevTools > Network > WS 标签
```

### 检查缓存

```bash
# 检查静态资源缓存
curl -I https://example.com/assets/index-xxx.js

# 应包含:
# cache-control: public, max-age=31536000, immutable
# cf-cache-status: HIT (CloudFront: x-cache: Hit from cloudfront)
```

---

## 常见问题

### Q: WebSocket 连接失败？

- 确保 CDN 配置了 WebSocket 直通规则
- 检查 Nginx 的 `proxy_set_header Upgrade` 和 `proxy_set_header Connection` 配置
- 确认 SSL/TLS 模式为 Full (Strict)

### Q: 静态资源没有缓存？

- 检查 Vite 构建是否生成了带 hash 的文件名
- 确认 CDN 缓存规则匹配 `/assets/*` 路径
- 检查 `cache-control` 响应头是否正确

### Q: 页面加载变慢？

- 确认 Brotli/Gzip 压缩已启用
- 检查 CDN 的 Edge Location 是否覆盖目标地区
- 考虑启用 HTTP/3 (QUIC) 支持

### Q: 如何回退到直连？

- 将 DNS 解析切换回源站 IP
- 或在 CDN 中禁用缓存规则
- 前端代码无需修改，CDN 是透明的

---

## 参考链接

- [Cloudflare 文档](https://developers.cloudflare.com/)
- [CloudFront 文档](https://docs.aws.amazon.com/cloudfront/)
- [Nginx WebSocket 代理](https://nginx.org/en/docs/http/websocket.html)
