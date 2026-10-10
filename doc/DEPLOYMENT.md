# 部署与更新

默认使用 Docker Compose。功能与操作见 [USAGE](USAGE.md)，开发约束见 [AGENTS](AGENTS.md)。

## Docker Compose 部署

需要 Docker 与支持可选 `env_file` 的 Compose v2。

```bash
mkdir -p nexus-terminal
cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env.example -O .env.example
cp .env.example .env
```

编辑 `.env`，先在受控网络完成首次管理员初始化，再开放公网；空库 setup 没有部署 token。

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend
```

默认访问 `http://服务器地址:18111`。Compose 只发布 Frontend 端口，默认绑定所有网卡；需要仅本机访问时，将其 `ports` 改为 `127.0.0.1:18111:80`。

## `.env` 与持久化配置

```dotenv
NEXUS_IMAGE_REPOSITORY=ghcr.io/0honus0/nexus-terminal
NEXUS_IMAGE_TAG=latest
NEXUS_HTTP_PORT=18111
NEXUS_PUBLIC_ORIGIN=https://terminal.example.com
APP_NAME=Nexus Terminal
```

| 配置                                       | 说明                                        |
| ------------------------------------------ | ------------------------------------------- |
| `NEXUS_IMAGE_TAG`                          | `latest` 稳定版；`dev` 最近一次手动开发发布 |
| `NEXUS_HTTP_PORT`                          | Frontend 对外端口，默认 `18111`             |
| `NEXUS_PUBLIC_ORIGIN`                      | 实际公开地址，包含协议及非默认端口          |
| `GUACD_IMAGE`                              | 默认 `guacamole/guacd:latest`               |
| `NEXUS_IPV6_SUBNET` / `NEXUS_IPV6_GATEWAY` | 默认 `fd01::/80` / `fd01::1`，冲突时调整    |
| `NEXUS_AGENT_OFFICIAL_PLUGIN_CATALOG_URL`  | 官方插件目录或镜像地址；内容须保持官方签名  |

- `.env` 用于 Compose 插值和 Backend `env_file`；Compose `environment` 优先。
- Backend 内部端口固定 `3001`，连接 `guacd:4822`，不向外发布。
- 数据与首次生成的密钥保存在 `./data`，备份须包含 `./data/.env`。
- `VITE_*` 是构建时配置，运行中修改 `.env` 不改变已构建的前端。

修改运行时配置后重建容器：

```bash
docker compose up -d --force-recreate
```

### Passkey / WebAuthn

```dotenv
RP_ID=terminal.example.com
RP_ORIGIN=https://terminal.example.com
```

独立域名按位置配置逗号分隔的 RP ID/Origin；Related Origins 可用一个 RP ID 对应多个受信任 Origin。

## 容器与镜像结构

| 服务       | 镜像               | 职责                                   |
| ---------- | ------------------ | -------------------------------------- |
| `frontend` | Nexus 主镜像       | 静态资源、API/WebSocket 反向代理       |
| `backend`  | 同一主镜像         | 认证、SSH/SFTP、Agent、RDP/VNC runtime |
| `guacd`    | Guacamole 上游镜像 | 远程桌面协议代理                       |

主镜像：`ghcr.io/0honus0/nexus-terminal:{latest,dev}`，支持 AMD64 / ARM64；Frontend/Backend 共用镜像层。Plugin UI/SDK 通过主站同源 `/plugins/...`、`/sdk/...` 访问，无独立公网端口。

### Agent 执行能力

- 远程操作与 ACP 使用显式授权的 SSH；Browser 使用 Backend CDP。
- 首次启用时从官方 catalog 安装签名插件，不安装 Agent Runner。
- 升级旧 Runner 部署使用 `--remove-orphans` 移除旧容器，宿主数据不自动删除。
- 模型 Registry 启动时加载缓存并尝试同步；远端不可达不阻止启动，可在 Provider 设置手动刷新。

## Nginx 反向代理示例

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

保留外部 Host/协议以通过同源检查；Agent 写操作仍需要 CSRF token。HTTPS 是 Passkey、剪贴板等浏览器能力的重要前提。

### 反向代理来源信任

| 部署方式             | 配置与要求                                                                         |
| -------------------- | ---------------------------------------------------------------------------------- |
| 默认 Compose         | `TRUST_PROXY=1`，只信任 Frontend 一个入口 hop；Backend 不可被不可信客户端/容器直连 |
| 宿主直接运行 Backend | 默认 `TRUST_PROXY=loopback`；外部代理显式配置精确 IP 或最小可信 CIDR               |
| 自定义多级代理       | `TRUST_PROXY` 支持数字 hop 或逗号分隔 IP/CIDR；隔离直连路径，不盲目信任全部私网    |

**Nginx Proxy Manager：** host 网络可转发至 `http://127.0.0.1:18111`，启用 WebSocket，保留外部 Host，传递真实来源与协议。`X-Forwarded-For` 最后一项必须是 NPM 观察到的客户端 IP，不能只透传用户头；仅设置 `X-Real-IP` 不足以传递真实来源。

Frontend 信任 loopback/私网入口，取其传来的最后一个 IP，再以单值转发给 Backend。宿主和容器网络必须可信，并用防火墙保护该路径；Frontend 默认并非仅 NPM 可达。NPM 前有 CDN 时，在 NPM 解析真实来源。

真实内网来源豁免 IP 白名单/失败封禁，不豁免密码/2FA；公网使用已配置的策略。HTTP 与 WebSocket 共用代理信任，配置错误会影响来源识别、审计和 Origin 校验。

## Docker IPv6

Compose 默认启用 IPv6。宿主需要配置时，可在 `/etc/docker/daemon.json` 合并：

```json
{
	"ipv6": true,
	"fixed-cidr-v6": "fd00::/80",
	"ip6tables": true
}
```

```bash
sudo systemctl restart docker
```

重启影响宿主容器。无需 IPv6 时调整 Compose 的 `enable_ipv6` 和 IPv6 IPAM 配置，不只修改宿主配置。

## 更新

先备份完整 `./data`。需要一致的文件备份时，停止 Backend 写入后打包：

```bash
docker compose stop backend
sudo tar -czf "nexus-data-$(date +%Y%m%d-%H%M%S).tar.gz" data
docker compose up -d
```

更新镜像：

```bash
docker compose pull
docker compose up -d --remove-orphans
```

开发版先将 `.env` 的 `NEXUS_IMAGE_TAG` 改为 `dev`。省略 tag 的 `docker pull` 只拉取 `latest`。

## 从源码构建统一镜像

```bash
git clone https://github.com/0honus0/nexus-terminal.git
cd nexus-terminal
NEXUS_IMAGE_REPOSITORY=local/nexus-terminal \
NEXUS_IMAGE_TAG=dev \
scripts/build/build.sh docker
```

在 `.env` 设置相同 repository/tag，再执行 `docker compose up -d`，无需 pull。脚本默认构建 `ghcr.io/0honus0/nexus-terminal:latest`。

强制刷新基础镜像与系统包：

```bash
docker build --pull --no-cache -t local/nexus-terminal:dev .
```

## 包管理与构建边界

本机使用 Node.js Current，以及根 `package.json` 的 `packageManager` 指定版本 pnpm。从仓库根目录执行：

```bash
pnpm install --frozen-lockfile
pnpm run build
```

单包构建：`pnpm run build:backend` / `pnpm run build:frontend`。

- 仅使用根 workspace、lockfile 和 catalog；不嵌套 install 或新增其他锁文件，依赖构建脚本由根 `allowBuilds` 管理。
- Docker 安装包含 `scripts/patches/`；Backend 用 `pnpm deploy --prod`，Frontend 产出静态 dist。
- 镜像使用 `alpine:latest`、APK 最新 `nodejs-current`/`nginx`；命中缓存不会刷新系统包。
- 新后端独立构建：`pnpm --filter @nexus-terminal/backend-next build`，根 build 仍构建正式旧后端。

### 发布与依赖更新

- 自动依赖更新在声明范围内 update/dedupe，核对 PR 被测 SHA 的完整检查后再合并；pnpm 本身仍固定版本。
- Release 发布当前 main 的 `latest` 与版本 tag，须完整 E2E 和 high 级生产依赖审计通过；手动发布默认 `dev`。
- 发布 Agent 能力先发布官方插件 catalog/签名包，再发布兼容主镜像，避免 `releases/latest` 指向缺失目录。
