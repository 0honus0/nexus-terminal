# 部署与更新

默认使用 Docker Compose。功能见 [USAGE](USAGE.md)，开发规则见 [AGENTS](AGENTS.md)。正式镜像使用旧 Backend；backend-next 尚未切换。

## 部署

需要 Docker 和支持可选 `env_file` 的 Compose v2。

```bash
mkdir -p nexus-terminal
cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env.example -O .env.example
cp .env.example .env
```

编辑 `.env`，在受控网络完成首次管理员初始化后再开放公网；空库 setup 没有部署 token。

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend
```

默认访问 `http://服务器地址:18111`。仅发布 Frontend；本机访问可将 `ports` 改为 `127.0.0.1:18111:80`。

## 配置与数据

```dotenv
NEXUS_IMAGE_REPOSITORY=ghcr.io/0honus0/nexus-terminal
NEXUS_IMAGE_TAG=latest
NEXUS_HTTP_PORT=18111
NEXUS_PUBLIC_ORIGIN=https://terminal.example.com
APP_NAME=Nexus Terminal
RP_ID=terminal.example.com
RP_ORIGIN=https://terminal.example.com
```

| 配置/路径      | 核心要求                                                                         |
| -------------- | -------------------------------------------------------------------------------- |
| image tag      | `latest` 稳定版；`dev` 最近一次手动开发发布，主镜像支持 AMD64/ARM64              |
| public origin  | 实际公开协议、域名和非默认端口，与反向代理保持一致                               |
| RP ID/Origin   | 独立域名按位置使用逗号分隔；Related Origins 可用一个 RP ID 对应多个受信 Origin   |
| `./data`       | 数据及首次生成密钥；备份包含 `./data/.env`                                       |
| `.env`         | Compose 插值和 Backend env_file；environment 优先，修改运行配置后 force-recreate |
| `VITE_*`       | 构建时配置；运行时改 `.env` 不改变已有前端                                       |
| guacd          | 默认 `guacamole/guacd:latest`，Backend 内连 `guacd:4822`；Backend 3001 不公开    |
| IPv6           | 默认 `fd01::/80` / `fd01::1`；冲突时改 `NEXUS_IPV6_SUBNET/GATEWAY`               |
| plugin catalog | `NEXUS_AGENT_OFFICIAL_PLUGIN_CATALOG_URL` 可用官方目录镜像，内容须保持签名       |

```bash
docker compose up -d --force-recreate
```

Frontend/Backend 共用主镜像层，Plugin UI/SDK 走同源 `/plugins/...`、`/sdk/...`。Agent 远程操作/ACP 使用显式授权的 SSH，Browser 使用 Backend CDP；首次启用安装官方签名插件，不安装 Agent Runner。模型 Registry 加载缓存并尝试同步，离线不阻止启动，可手动刷新。

## HTTPS 与代理

在已配置 HTTPS 的 Nginx server 中添加：

```nginx
location / {
    proxy_pass http://127.0.0.1:18111;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_redirect off;
}
```

保留公开 Host/协议，启用 WebSocket；HTTPS 支持 Passkey、剪贴板等浏览器能力，Agent 写操作仍需 CSRF token。

| 入口         | 来源信任                                                                  |
| ------------ | ------------------------------------------------------------------------- |
| 默认 Compose | `TRUST_PROXY=1`；Backend 只接受可信 Frontend，不可被不可信客户端/容器直连 |
| 宿主 Backend | 默认 loopback；外部代理配置精确 IP/最小 CIDR                              |
| 多级代理     | 支持 hop 或逗号分隔 IP/CIDR；隔离绕过入口，不盲目信任全部私网             |

Nginx Proxy Manager 可转发 `http://127.0.0.1:18111`；`X-Forwarded-For` 最后一项须是 NPM 观察到的来源，仅传 `X-Real-IP` 不足。Frontend 信任 loopback/私网入口，将最后一个来源单值转发 Backend；用防火墙保护入口。前有 CDN 时在 NPM 解析真实来源。真实内网豁免 IP 白名单/失败封禁，仍需密码/2FA；HTTP/WS 使用同一来源策略。

Compose 默认启用 IPv6；宿主需要时合并 `/etc/docker/daemon.json`：

```json
{ "ipv6": true, "fixed-cidr-v6": "fd00::/80", "ip6tables": true }
```

执行 `sudo systemctl restart docker` 会影响宿主容器。关闭 IPv6 时同步改 Compose 的 `enable_ipv6` 和 IPv6 IPAM。

## 备份与更新

停止写入后备份完整 data：

```bash
docker compose stop backend
sudo tar -czf "nexus-data-$(date +%Y%m%d-%H%M%S).tar.gz" data
docker compose up -d
```

```bash
docker compose pull
docker compose up -d --remove-orphans
```

开发版先设置 `NEXUS_IMAGE_TAG=dev`。`--remove-orphans` 清除旧 Runner 容器，宿主数据不会自动删除；省略镜像 tag 只拉 latest。

## 构建与发布

```bash
git clone https://github.com/0honus0/nexus-terminal.git
cd nexus-terminal
NEXUS_IMAGE_REPOSITORY=local/nexus-terminal NEXUS_IMAGE_TAG=dev scripts/build/build.sh docker
```

在 `.env` 设置同一 repository/tag，再执行 Compose up，无需 pull。脚本默认构建主镜像 latest；刷新基础镜像/系统包用 `docker build --pull --no-cache -t local/nexus-terminal:dev .`。

本机使用 Node.js Current 和根 packageManager 指定的 pnpm，从仓库根执行：

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm --filter @nexus-terminal/backend-next build
```

- 根 build 仍构建正式后端/前端；单包用 `build:backend` / `build:frontend`。
- 仅用根 workspace/lockfile/catalog，依赖构建由 allowBuilds 管理；Docker 安装包含 scripts/patches，Backend 用 deploy --prod，Frontend 产出静态 dist。
- 镜像使用 alpine:latest 与 APK 最新 nodejs-current/nginx；命中缓存不会刷新系统包。
- 依赖 update/dedupe 保持声明范围，合并前核对 PR 被测 SHA；pnpm 固定版本。
- Release 发布 main 的 latest/版本 tag，须完整 E2E 和 high 级生产依赖审计通过；手动发布默认 dev。
- Agent 先发布官方签名 catalog/插件包，再发布兼容主镜像。
