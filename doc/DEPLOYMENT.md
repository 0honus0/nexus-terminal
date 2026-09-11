# 部署与更新

Nexus Terminal 支持 Docker Compose 部署，并提供运行时配置、反向代理、IPv6、更新和源码构建方式。

## Docker Compose 部署

创建目录并下载仓库中的 Compose 与环境变量模板：

```bash
mkdir -p nexus-terminal && cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env.example -O .env.example
cp .env.example .env
```

启动：

```bash
docker compose up -d
```

默认对外 HTTP 端口为 `18111`，可通过 `.env` 中的 `NEXUS_HTTP_PORT` 修改。

### 可选 Agent Runner host service

Agent 的 Workspace Dev Environment 使用宿主 `nexus-agent-runner` + bubblewrap，不在 Compose 中启动高权限 Runner 容器。Ubuntu/Debian host 首次启用前，从源码 checkout 执行：

```bash
./scripts/agent-runtime/prepare-ubuntu-host.sh
```

该脚本从 bubblewrap 上游 release 安装 Nexus 当前固定的最新稳定版 `0.12.0`（release archive SHA-256 校验），保留 versioned release copy 并将受检二进制安装到稳定 `/usr/local/bin/bwrap`，不覆盖系统 `/usr/bin/bwrap`；随后加载仅匹配该稳定 Nexus-owned binary 的 path-scoped AppArmor profile，并执行真实 user/network namespace probe。版本/SHA/最新稳定状态由 `npm run check:sandbox-prerequisites -- --verify-latest` 与构建脚本统一检查，Runtime 代码只做能力可用性检查。脚本不会把 Runner 设为 privileged、不会关闭 AppArmor，也不会修改 `kernel.apparmor_restrict_unprivileged_userns`。如果宿主明确禁用了 unprivileged user namespaces 或缺少受支持的 profile，脚本 fail closed。

Runner 默认监听 `127.0.0.1:8790`。当 Backend 运行在 Compose 中时，应把 Runner 绑定到仅 Docker host-gateway 可达的宿主接口，并在 `.env` 配置相同的 `NEXUS_AGENT_RUNNER_TOKEN` / `NEXUS_AGENT_DEPLOYMENT_ID`；Compose 默认通过 `host.docker.internal:8790` 访问。不要把 Runner Controller 直接暴露到公网。

## 容器与镜像结构

Frontend 与 Backend 共用同一个镜像。发布仓库提供两个滚动通道：

```text
ghcr.io/0honus0/nexus-terminal:latest  # 稳定 / Release
ghcr.io/0honus0/nexus-terminal:dev     # 最近一次手动 Dev 发布
```

`docker-compose.yml` / `.env.example` 默认仍使用 `:latest`。需要跟随开发镜像时，将 `.env` 中 `NEXUS_IMAGE_TAG=dev` 后再执行 `docker compose pull && docker compose up -d`。

Compose 以三个服务运行：

- `frontend`：Web 静态资源与反向代理入口。
- `backend`：认证、SSH/SFTP、设置、审计以及内置 RDP/VNC Guacamole runtime。
- `guacd`：Guacamole 协议代理。

`frontend` 与 `backend` 使用同一 Nexus 镜像，镜像层由 Docker 复用；`guacd` 使用独立上游镜像。

当前发布 workflow 构建 `linux/amd64` 与 `linux/arm64`。GitHub Release 事件固定发布 `latest + release tag`；手动 `workflow_dispatch` 可选择 `dev` 或 `release` channel，默认 `dev`，并同时保留自定义 tag 或 `sha-<commit>` tag。

## `.env` 与持久化配置

项目根目录提供 `.env.example` 作为模板；首次部署可复制为 `.env`。运行时 `.env` 用于 Docker Compose 插值，并作为 Backend 的可选 `env_file`。

需要特别注意：

- `docker-compose.yml` 中 `environment` 明确声明的变量优先于 `env_file`。
- `APP_NAME`、对外 HTTP 端口、`GUACD_IMAGE`、网络地址段和 Passkey 配置可以从根目录 `.env` 调整。Compose 内部的 Backend 端口固定为 `3001`，Backend 通过内部网络固定连接 `guacd:4822`，避免用户配置与 Nginx/service discovery 脱节。
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

Compose 部署不需要拉取源码。稳定通道：

```bash
docker compose pull
docker compose up -d --remove-orphans
```

开发通道可在 `.env` 设置 `NEXUS_IMAGE_TAG=dev` 后执行相同命令。`docker pull ghcr.io/0honus0/nexus-terminal` 等价于拉取 `:latest`，不会隐式拉取 `:dev`。

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

随后在 `.env` 中设置相同的 `NEXUS_IMAGE_REPOSITORY` 与 `NEXUS_IMAGE_TAG`，再运行 `docker compose up -d`。统一镜像的运行角色入口脚本位于 `scripts/docker/entrypoint.sh`；Docker 相关运行脚本统一归 `scripts/docker/`，见 [EC-REPO-001](./software-requirements/engineering-constraints.md#ec-repo-001)。
