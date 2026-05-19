# 高级配置

本指南介绍 Nexus Terminal 的高级配置选项，帮助您根据实际需求进行精细调整。

## CORS 跨域配置

当您需要通过自定义域名访问，或有多个域名需要访问时，需要配置 CORS。

编辑 `docker-compose.yml` 中的 `remote-gateway` 服务：

```yaml
remote-gateway:
  environment:
    # 添加允许的域名（逗号分隔多个域名）
    CORS_ALLOWED_ORIGINS: https://yourdomain.com,https://www.yourdomain.com
    # 开发模式可设置为 true（不推荐生产环境）
    # CORS_ALLOW_ALL: false
```

| 场景     | 配置值                        |
| -------- | ----------------------------- |
| 单域名   | `https://example.com`         |
| 多域名   | `https://a.com,https://b.com` |
| 开发环境 | `CORS_ALLOW_ALL: true`        |

::: warning 安全提示
生产环境请避免使用 `CORS_ALLOW_ALL: true`，这会带来安全风险。
:::

## Passkey 认证配置

### 基础配置

```env
# Passkey Relying Party ID（域名，不带协议）
RP_ID=your-domain.com

# Passkey Relying Party Origin（完整 URL）
RP_ORIGIN=https://your-domain.com
```

### 多域名支持

一个 Passkey 跨多个独立域名使用：

```env
RP_ID=your-domain.com
RP_ORIGIN=https://domain-a.com,https://domain-b.com
```

### WebAuthn 端点

确保 `/.well-known/webauthn` 可访问，该端点会自动配置。

## API Token 配置

```env
# .env 文件中设置
REMOTE_GATEWAY_API_TOKEN=your-secure-token-here

# docker-compose.yml 中引用
remote-gateway:
  environment:
    REMOTE_GATEWAY_API_TOKEN: ${REMOTE_GATEWAY_API_TOKEN}
```

::: tip 建议

- 使用强随机字符串（建议 32+ 字符）
- Backend 和 Remote Gateway 必须使用相同的 Token
  :::

## 速率限制

| 配置项     | 默认值  | 说明             |
| ---------- | ------- | ---------------- |
| 窗口时间   | 15 分钟 | 限制计数窗口     |
| 最大请求数 | 100 次  | 窗口内最大请求数 |
| 跳过条件   | 已认证  | 登录后不受限制   |

## WebSocket 配置

### 心跳参数

```env
HEARTBEAT_INTERVAL_DESKTOP=30000   # 桌面端心跳（毫秒）
HEARTBEAT_INTERVAL_MOBILE=60000    # 移动端心跳（毫秒）
MAX_MISSED_PONGS_DESKTOP=3         # 桌面端最大丢包次数
MAX_MISSED_PONGS_MOBILE=5          # 移动端最大丢包次数
```

### 多路复用

启用 WebSocket 多路复用，单个物理连接可承载多个 SSH 会话，减少浏览器连接数和服务器资源消耗。

```env
ENABLE_MULTIPLEX=false             # 默认关闭，设为 true 启用
```

> 注意：多路复用模式下，多个终端标签共享同一个 WebSocket 连接。关闭时回退到传统的每会话一个连接模式。

### Nginx 超时

```nginx
location ~ ^/(ws|guacamole)/ {
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
}
```

## 日志配置

```env
LOG_LEVEL=info   # debug | info | warn | error
```

Docker 日志轮转（已在 `docker-compose.yml` 中配置）：

```yaml
logging:
  driver: json-file
  options:
    max-size: '10m'
    max-file: '3'
```

```bash
# 查看日志
docker compose logs -f backend
docker compose logs --tail 100 backend
```

## HTTPS 配置

生产环境强烈建议使用 HTTPS：

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/letsencrypt/live/your-domain.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
}
```

## 防火墙

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw deny 18111/tcp   # 不对外暴露直连端口
sudo ufw deny 3001/tcp    # 不对外暴露后端端口
```

## 环境变量完整参考

### 后端环境变量

| 变量名              | 类型    | 默认值           | 说明                 |
| ------------------- | ------- | ---------------- | -------------------- |
| `NODE_ENV`          | string  | `development`    | 运行环境             |
| `PORT`              | number  | `3001`           | API 端口             |
| `APP_NAME`          | string  | `Nexus Terminal` | 应用名称             |
| `DEPLOYMENT_MODE`   | string  | `local`          | 部署模式             |
| `ENCRYPTION_KEY`    | string  | 自动生成         | 加密密钥             |
| `SESSION_SECRET`    | string  | 自动生成         | 会话密钥             |
| `GUACD_HOST`        | string  | `localhost`      | Guacd 主机           |
| `GUACD_PORT`        | number  | `4822`           | Guacd 端口           |
| `RP_ID`             | string  | —                | Passkey RP ID        |
| `RP_ORIGIN`         | string  | —                | Passkey RP Origin    |
| `ALLOWED_ORIGINS`   | string  | —                | 允许的来源           |
| `ENABLE_METRICS`    | boolean | `false`          | 启用 Prometheus      |
| `ENABLE_GEO_LOOKUP` | boolean | `true`           | 启用 IP 地理位置查询 |
| `LOG_LEVEL`         | string  | `info`           | 日志级别             |

### Remote Gateway 环境变量

| 变量名                     | 默认值                | 说明           |
| -------------------------- | --------------------- | -------------- |
| `GUACD_HOST`               | `localhost`           | Guacd 主机     |
| `GUACD_PORT`               | `4822`                | Guacd 端口     |
| `REMOTE_GATEWAY_API_PORT`  | `9090`                | API 端口       |
| `REMOTE_GATEWAY_WS_PORT`   | `8081`                | WebSocket 端口 |
| `FRONTEND_URL`             | `http://frontend`     | 前端 URL       |
| `MAIN_BACKEND_URL`         | `http://backend:3001` | 后端 URL       |
| `REMOTE_GATEWAY_API_TOKEN` | —                     | API Token      |
| `CORS_ALLOWED_ORIGINS`     | —                     | CORS 允许来源  |
| `CORS_ALLOW_ALL`           | `false`               | 允许所有来源   |

## 故障排查

### 环境变量未生效

```bash
docker compose exec backend env | grep YOUR_VARIABLE
docker compose down && docker compose up -d
```

### 配置文件语法错误

```bash
docker compose config   # 测试 Docker Compose 配置
sudo nginx -t           # 测试 Nginx 配置
```

### 权限问题

```bash
ls -la data/
sudo chown -R 1000:1000 data/
```
