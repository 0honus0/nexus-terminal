# 星枢终端 Docker 环境变量配置

> 本文档整理可通过 Docker/Docker Compose 配置的环境变量。

---

## 目录

- [1. Backend 服务变量](#1-backend-服务变量)
- [2. Remote Gateway 服务变量](#2-remote-gateway-服务变量)
- [3. 端口配置](#3-端口配置)
- [4. 完整配置示例](#4-完整配置示例)

---

## 1. Backend 服务变量

> **配置方式**: 在 `.env` 文件中配置，`docker-compose.yml` 会自动加载

| 变量名            | 默认值           | 必填 | 描述                                        |
| ----------------- | ---------------- | ---- | ------------------------------------------- |
| `DEPLOYMENT_MODE` | `docker`         | 否   | 部署模式: `local` 或 `docker`               |
| `NODE_ENV`        | `production`     | 否   | 运行环境: `development`/`production`/`test` |
| `PORT`            | `3001`           | 否   | 后端服务端口                                |
| `APP_NAME`        | `Nexus Terminal` | 否   | 应用名称                                    |

### Passkey 认证配置

| 变量名      | 默认值                  | 必填   | 描述                                                            |
| ----------- | ----------------------- | ------ | --------------------------------------------------------------- |
| `RP_ID`     | `localhost`             | **是** | WebAuthn RP ID。支持逗号分隔多值，与 `RP_ORIGIN` 按顺序一一对应 |
| `RP_ORIGIN` | `http://localhost:5173` | **是** | WebAuthn RP Origin。支持逗号分隔多值（完整 URL）                |

### 远程网关地址配置

| 变量名                           | 默认值                       | 描述                                 |
| -------------------------------- | ---------------------------- | ------------------------------------ |
| `REMOTE_GATEWAY_API_BASE_LOCAL`  | `http://localhost:9090`      | 本地开发时远程网关 API 地址          |
| `REMOTE_GATEWAY_API_BASE_DOCKER` | `http://remote-gateway:9090` | Docker 部署时远程网关 API 地址       |
| `REMOTE_GATEWAY_WS_URL_LOCAL`    | `ws://localhost:8080`        | 本地开发时远程网关 WebSocket 地址    |
| `REMOTE_GATEWAY_WS_URL_DOCKER`   | `ws://remote-gateway:8080`   | Docker 部署时远程网关 WebSocket 地址 |

### Remote Gateway API 鉴权（推荐）

> ✅ 建议为远程网关 API 配置共享令牌，避免 token 生成接口在端口被误暴露时可被滥用。

| 变量名                     | 默认值 | 描述                                                                        |
| -------------------------- | ------ | --------------------------------------------------------------------------- |
| `REMOTE_GATEWAY_API_TOKEN` | -      | 共享令牌：backend 请求 Remote Gateway API 时会携带 `X-Remote-Gateway-Token` |

### 安全相关（自动生成）

> ⚠️ 以下变量首次启动时会自动生成到挂载卷 `./data/.env`（容器内路径为 `/app/data/.env`），**不要手动配置**

| 变量名           | 格式        | 描述                   |
| ---------------- | ----------- | ---------------------- |
| `ENCRYPTION_KEY` | 64字符 hex  | 数据库敏感信息加密密钥 |
| `SESSION_SECRET` | 128字符 hex | 会话密钥               |

### 可选配置

| 变量名                       | 默认值  | 描述                                          |
| ---------------------------- | ------- | --------------------------------------------- |
| `ALLOWED_ORIGINS`            | -       | 额外允许的 CORS 来源（逗号分隔多个域名）      |
| `ALLOWED_WS_ORIGINS`         | -       | 额外允许的 WebSocket 来源（逗号分隔多个域名） |
| `HEARTBEAT_INTERVAL_DESKTOP` | `30000` | 桌面端心跳间隔（毫秒）                        |
| `HEARTBEAT_INTERVAL_MOBILE`  | `12000` | 移动端心跳间隔（毫秒）                        |
| `TRUST_PROXY`                | -       | 是否信任代理 (`true`/`false`)                 |
| `TRUST_PROXY_HOPS`           | -       | 信任的代理跳数                                |
| `LOG_LEVEL`                  | `info`  | 后端日志等级（`debug/info/warn/error`）       |
| `LOG_TZ`                     | -       | 日志时间戳时区（优先级高于 `TZ`）             |
| `TZ`                         | `UTC`   | 后端进程默认时区                              |

### NL2CMD 调试配置

| 变量名                      | 默认值  | 范围        | 描述                                 |
| --------------------------- | ------- | ----------- | ------------------------------------ |
| `NL2CMD_TIMING_LOG`         | `0`     | `0` / `1`   | 是否启用计时日志（开发模式自动启用） |
| `NL2CMD_SLOW_THRESHOLD_MS`  | `3000`  | 0-300000    | 慢查询阈值（毫秒），超过会记录警告   |
| `NL2CMD_REQUEST_TIMEOUT_MS` | `30000` | 1000-300000 | NL2CMD 上游 HTTP 请求超时（毫秒）    |

> ⚠️ **注意**: NL2CMD 的 AI 配置（API Key、Provider、Model 等）存储在**数据库**中，通过前端设置页面 (`/settings/ai`) 或 API 配置。

---

## 2. Remote Gateway 服务变量

> **配置方式**: 在 `docker-compose.yml` 的 `remote-gateway` 服务中配置

| 变量名             | 默认值                | 必填 | 描述                                      |
| ------------------ | --------------------- | ---- | ----------------------------------------- |
| `GUACD_HOST`       | `guacd`               | 否   | Guacd 服务地址（Docker 内部网络用服务名） |
| `GUACD_PORT`       | `4822`                | 否   | Guacd 服务端口                            |
| `FRONTEND_URL`     | `http://frontend`     | 否   | 前端 URL（CORS 白名单）                   |
| `MAIN_BACKEND_URL` | `http://backend:3001` | 否   | 后端 URL（CORS 白名单）                   |

### 可选配置

| 变量名                 | 默认值       | 描述                                     |
| ---------------------- | ------------ | ---------------------------------------- |
| `CORS_ALLOWED_ORIGINS` | -            | 额外允许的 CORS 来源（逗号分隔多个域名） |
| `CORS_ALLOW_ALL`       | `false`      | 是否允许所有来源（⚠️ 仅开发环境使用）    |
| `NODE_ENV`             | `production` | 运行环境                                 |

---

## 3. 端口配置

### docker-compose.yml 端口映射

| 服务           | 外部端口      | 容器端口 | 描述                     |
| -------------- | ------------- | -------- | ------------------------ |
| frontend       | `18111`       | `80`     | Web 应用访问端口         |
| backend        | `3001` (内部) | `3001`   | API 服务端口             |
| remote-gateway | `8080` (内部) | `8080`   | Guacamole WebSocket 端口 |
| remote-gateway | `9090` (内部) | `9090`   | API 服务端口             |
| guacd          | - (内部)      | `4822`   | Guacamole 协议端口       |

### 外部访问端口

| 端口    | 服务     | 协议 |
| ------- | -------- | ---- |
| `18111` | frontend | HTTP |

---

## 4. 完整配置示例

### `.env` 文件示例

```env
# 部署模式
DEPLOYMENT_MODE=docker

# Passkey 配置（生产环境必须修改）
# 单域名
RP_ID=yourdomain.com
RP_ORIGIN=https://yourdomain.com
# 多域名（RP_ID 与 RP_ORIGIN 顺序对应）
# RP_ID=yourdomain.com,another-domain.net
# RP_ORIGIN=https://yourdomain.com,https://another-domain.net

# 远程网关地址
REMOTE_GATEWAY_API_BASE_LOCAL=http://localhost:9090
REMOTE_GATEWAY_API_BASE_DOCKER=http://remote-gateway:9090
REMOTE_GATEWAY_WS_URL_LOCAL=ws://localhost:8080
REMOTE_GATEWAY_WS_URL_DOCKER=ws://remote-gateway:8080

# Remote Gateway API 访问令牌（可选但强烈推荐；需与 docker-compose.yml 的 remote-gateway 一致）
REMOTE_GATEWAY_API_TOKEN=

# 前端通知自动关闭时间（毫秒，正整数）
# 仅在自构建 frontend 镜像时生效（Vite 构建时变量）
VITE_NOTIFICATION_TIMEOUT_MS=3000

# 前端资源 URL 基础地址（可选）
# 仅在自构建 frontend 镜像时生效（Vite 构建时变量）
VITE_API_BASE_URL=
```

## Rate Limit（后端限流）

后端使用 `express-rate-limit` 进行基础限流。默认值已经相对宽松，但在反向代理/Cloudflare 场景或前端多接口并发加载时，仍可能触发 `429`。

可通过以下环境变量调节（单位：毫秒 ms；仅支持正整数，缺省或非法会回退默认值）：

```env
# 通用 API（除 auth/AI 等特殊路由外）
API_RATE_LIMIT_WINDOW_MS=900000
API_RATE_LIMIT_MAX=300

# Settings API（/api/v1/settings/*）
SETTINGS_RATE_LIMIT_WINDOW_MS=900000
SETTINGS_RATE_LIMIT_MAX=500
```

### docker-compose.yml 完整配置

```yaml
services:
  frontend:
    image: heavrnl/nexus-terminal-frontend:latest
    container_name: nexus-terminal-frontend
    ports:
      - '18111:80'
    depends_on:
      - backend
      - remote-gateway
    networks:
      - nexus-terminal-network

  backend:
    image: heavrnl/nexus-terminal-backend:latest
    container_name: nexus-terminal-backend
    env_file:
      - .env
    environment:
      NODE_ENV: production
      PORT: 3001
    volumes:
      - ./data:/app/data
    networks:
      - nexus-terminal-network

  remote-gateway:
    image: heavrnl/nexus-terminal-remote-gateway:latest
    container_name: nexus-terminal-remote-gateway
    environment:
      GUACD_HOST: guacd
      GUACD_PORT: 4822
      REMOTE_GATEWAY_API_PORT: 9090
      REMOTE_GATEWAY_WS_PORT: 8080
      FRONTEND_URL: http://frontend
      MAIN_BACKEND_URL: http://backend:3001
      NODE_ENV: production
      # CORS 配置（可选）
      CORS_ALLOWED_ORIGINS: https://yourdomain.com
      # CORS_ALLOW_ALL: false  # ⚠️ 仅开发环境使用
    networks:
      - nexus-terminal-network
    depends_on:
      - guacd
      - backend

  guacd:
    image: guacamole/guacd:latest
    container_name: nexus-terminal-guacd
    networks:
      - nexus-terminal-network
    restart: unless-stopped

networks:
  nexus-terminal-network:
    driver: bridge
```

### 前端构建时变量（可选）

| 变量名                         | 默认值 | 描述                                                                  |
| ------------------------------ | ------ | --------------------------------------------------------------------- |
| `VITE_NOTIFICATION_TIMEOUT_MS` | `3000` | 前端通知自动关闭时间（毫秒）。仅支持正整数，缺省/非法值会回退默认值。 |
| `VITE_API_BASE_URL`            | -      | 前端拼接后端静态资源地址的基础 URL（如背景图 URL）。                  |

> 重要说明：
>
> - 该变量是 **Vite 构建时变量**，通过 `import.meta.env` 读取。
> - 使用 `heavrnl/nexus-terminal-frontend:latest` 预构建镜像时，运行时注入此变量不会生效。
> - 如需自定义，请改为自行构建 frontend 镜像，并在构建阶段传入。

示例（改为 build 模式）：

```yaml
services:
  frontend:
    build:
      context: .
      dockerfile: packages/frontend/Dockerfile
      args:
        VITE_NOTIFICATION_TIMEOUT_MS: ${VITE_NOTIFICATION_TIMEOUT_MS:-3000}
        VITE_API_BASE_URL: ${VITE_API_BASE_URL:-}
    ports:
      - '18111:80'
    depends_on:
      - backend
      - remote-gateway
```

---

## 快速配置清单

### 首次部署（生产环境）

1. ✅ 修改 `.env` 中的 `RP_ID`（单域名）或 `RP_ID` 逗号分隔列表（多域名）
2. ✅ 修改 `.env` 中的 `RP_ORIGIN`（单域名）或 `RP_ORIGIN` 逗号分隔列表（多域名）
3. ✅ 如需多域名支持，确保 `ALLOWED_ORIGINS` / 反向代理 CORS 配置包含所有前端域名
4. ✅ 启动服务：`docker compose up -d`

---

**文档生成时间**：2025-12-26
