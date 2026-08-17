# 部署与更新

本文档集中说明 Nexus Terminal 的 Docker Compose 部署、运行时配置、反向代理与更新方式。README 只保留最短可用流程。

## Docker Compose 部署

创建目录并下载仓库中的 Compose 与环境变量模板：

```bash
mkdir -p nexus-terminal && cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env -O .env
```

启动：

```bash
docker compose up -d
```

默认对外 HTTP 端口为 `18111`，可通过 `.env` 中的 `NEXUS_HTTP_PORT` 修改。

## 容器与镜像结构

Frontend、Backend 与 Remote Gateway 共用同一个镜像：

```text
ghcr.io/0honus0/nexus-terminal:latest
```

Compose 仍以三个独立服务运行不同角色：

- `frontend`：Web 静态资源与反向代理入口。
- `backend`：认证、SSH/SFTP、设置、审计等后端 API。
- `remote-gateway`：RDP/VNC 远程桌面网关。
- `guacd`：Guacamole 协议代理。

同一镜像的层会由 Docker 复用，不会保存三份完整镜像。

当前发布 workflow 构建 `linux/amd64` 与 `linux/arm64`。

## `.env` 与持久化配置

项目根目录 `.env` 同时用于 Docker Compose 插值，并作为 Backend 与 Remote Gateway 的 `env_file`。

需要特别注意：

- `docker-compose.yml` 中 `environment` 明确声明的变量优先于 `env_file`。
- `APP_NAME`、端口、网关地址、Passkey 配置等都可以从根目录 `.env` 调整。
- Backend 首次启动时会在持久化数据目录中生成运行所需的安全密钥；`./data` 应整体备份。
- `VITE_*` 是前端构建时变量，运行中的容器修改 `.env` 不会重新生成已经构建好的前端静态资源。
- 修改运行时 `.env` 后建议执行 `docker compose up -d --force-recreate`，确保 Compose 重新创建相关容器。

### Passkey / WebAuthn

`.env` 中使用：

```dotenv
RP_ID="yourdomain.com"
RP_ORIGIN="https://yourdomain.com"
```

`RP_ID` 与 `RP_ORIGIN` 均支持逗号分隔配置；一个 RP ID 对应多个 Related Origins 时，可以让多个受信任来源共享同一 Passkey 体系。

## Nginx 反向代理示例

如果在 Nexus Terminal 前增加自己的 Nginx，可使用：

```nginx
location / {
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $http_host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_redirect off;
    proxy_pass http://127.0.0.1:18111;
}
```

生产环境建议使用 HTTPS。浏览器对剪贴板等能力有安全上下文限制，HTTP 环境下部分功能会受限。

## Docker IPv6

Compose 网络默认启用 IPv6，并使用 `.env` 中的 `NEXUS_IPV6_SUBNET` / `NEXUS_IPV6_GATEWAY`。

如果宿主机 Docker 尚未启用 IPv6，可在 `/etc/docker/daemon.json` 中按宿主环境配置，例如：

```json
{
  "ipv6": true,
  "fixed-cidr-v6": "fd00::/80",
  "ip6tables": true
}
```

然后重启 Docker：

```bash
sudo systemctl restart docker
```

如不需要通过 IPv6 连接远端服务器，可按实际网络环境调整或关闭相关宿主配置。

## 更新

Compose 部署不需要拉取源码：

```bash
docker compose pull
docker compose up -d --remove-orphans
```

更新前建议备份 `./data`。

## 从源码构建统一镜像

```bash
git clone https://github.com/0honus0/nexus-terminal.git
cd nexus-terminal
./build.sh docker
```

默认镜像为：

```text
ghcr.io/0honus0/nexus-terminal:latest
```

可以覆盖仓库名与标签：

```bash
NEXUS_IMAGE_REPOSITORY=local/nexus-terminal \
NEXUS_IMAGE_TAG=dev \
./build.sh docker
```

随后在 `.env` 中设置相同的 `NEXUS_IMAGE_REPOSITORY` 与 `NEXUS_IMAGE_TAG`，再运行 `docker compose up -d`。
