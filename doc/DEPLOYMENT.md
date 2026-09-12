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

### 可选 Agent Runner

Agent Workspace Runtime 使用独立的 `nexus-agent-runner` 执行平面。Nexus 当前是**单用户应用**，因此 Runner 的职责是管理多个持久 Workspace、共享 Tool Pack 与 Workspace generation，而不是在同一用户内部再构造一层安全沙箱。

Workspace 是工作目录与运行环境边界：不同 Workspace 有独立项目文件；同一个 Workspace 可以选择不同的 Node/Python/Go Tool Pack 组合并生成新的 generation。Workspace 之间**不承诺** Linux namespace、network namespace、cgroup 或文件系统安全隔离。使用宿主 Runner 时，Runner 进程与其 Workspace 命令共享宿主系统安全上下文；使用容器 Runner 时，Docker 容器本身是 Runner 进程的操作系统边界。

Ubuntu/Debian host 首次启用前，从源码 checkout 执行：

```bash
./scripts/agent-runner/prepare-ubuntu-host.sh
```

该脚本只安装与 Toolchain Catalog 一致、SHA-256 固定的 `mise 2026.9.5`、Tool Pack 解包工具以及 Workspace Terminal 使用的系统 `script(1)` / `stty`，不编译或安装 Nexus 自定义 native helper。Tool Pack 仍执行版本校验与 Nexus canonical tree digest 校验，并通过 `/opt/nexus/packs/<family>/<version>` 暴露精确版本；多个 Workspace 复用同一份不可变 Tool Pack。

Runner 默认监听 `127.0.0.1:8790`。当 Backend 运行在 Compose 中时，应把宿主 Runner 绑定到 Docker host-gateway 可达的宿主地址，并在 `.env` 设置同一个 `NEXUS_AGENT_RUNNER_TOKEN`；Compose 默认通过 `http://host.docker.internal:8790` 访问。Controller token 至少 32 字符，推荐使用 `openssl rand -hex 32` 生成。不要把 Runner Controller 直接暴露到公网。

仓库同时提供独立 Runner 镜像发布流程：

```text
ghcr.io/0honus0/nexus-agent-runner:latest
ghcr.io/0honus0/nexus-agent-runner:dev
```

`docker-compose.yml` 已提供**默认整段注释掉**的 `agent-runner` service。需要容器模式时，取消该段注释，并在 `.env` 把 `NEXUS_AGENT_RUNNER_URL` 改为 `http://agent-runner:8790`，同时取消 Backend 对 Runner 的 `depends_on` 注释。独立镜像包含固定版本 `mise`、Tool Pack 解包工具与 `script/stty`；容器入口使用发行版 `tini` 作为 PID 1，只负责转发终止信号并回收 Runner 子进程产生的孤儿/zombie 进程，不参与 Workspace 隔离。HEALTHCHECK 调用 `/v1/availability` 验证 `native + logical` Workspace Runtime。

容器 Runner 使用 Docker 默认 capability/seccomp/AppArmor 即可；Compose 示例**不需要** `privileged`、`SYS_ADMIN`、`seccomp=unconfined`、`apparmor=unconfined`、Docker socket 或 nested Docker。这里不要把“容器边界”和“Workspace 边界”混为一谈：容器可以隔离整个 Runner 服务，但容器内多个 Workspace 仍属于同一个 Nexus 用户并共享 Runner 进程权限、内核网络与 Tool Store。

Runner 状态、Tool Pack、缓存和 Workspace runtime 默认持久化到 `NEXUS_AGENT_RUNNER_DATA_DIR`（默认 `./agent-runner-data`）。Runner Plugin 源码只读挂载 Backend 的 `./data/agent/plugins`。Workspace Profile 仍可以保存产品层的 limits/network 配置，但 native Runner 不接收这些字段，也不把它们描述成 per-Workspace cgroup、tmpfs 或 network namespace 强制隔离。

Workspace local Terminal 由 Runner 通过系统 `script(1)` 创建 PTY，Backend/Frontend 继续使用 terminal session attach/detach/bounded replay；resize 写入真实 PTY size，显式 signal 发送到当前 PTY foreground process group。Workspace job、ACP 与 Runner Plugin 作为独立 Runner-managed process group 运行，timeout/stop/restart/delete 会清理整个进程组，避免留下后台孤儿进程。

当前 Runner 镜像可构建 `linux/amd64` 和 `linux/arm64`；Catalog 的 `base-tools` 已支持两种架构，但当前 Node/Python/Go 多版本 Tool Pack 仍只发布 x64，因此 arm64 上这些额外语言版本会按 Catalog 正确显示为 unavailable，而不会错误回退。

## 容器与镜像结构

Frontend 与 Backend 共用同一个主镜像；Agent Runner 使用独立镜像。两者由同一个发布 workflow 生成完全一致的 channel/version tag：

```text
ghcr.io/0honus0/nexus-terminal:latest       # 稳定 / Release
ghcr.io/0honus0/nexus-terminal:dev          # 最近一次手动 Dev 发布
ghcr.io/0honus0/nexus-agent-runner:latest  # 对应稳定 Runner
ghcr.io/0honus0/nexus-agent-runner:dev     # 对应 Dev Runner
```

`docker-compose.yml` / `.env.example` 默认仍使用 `:latest`。需要跟随开发镜像时，将 `.env` 中 `NEXUS_IMAGE_TAG=dev` 后再执行 `docker compose pull && docker compose up -d`。

Compose 默认以三个服务运行：

- `frontend`：Web 静态资源与反向代理入口。
- `backend`：认证、SSH/SFTP、设置、审计以及内置 RDP/VNC Guacamole runtime。
- `guacd`：Guacamole 协议代理。
- `agent-runner`：可选，默认整段注释；启用后使用独立 `nexus-agent-runner` 镜像。

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
scripts/build/build.sh docker
```

默认镜像为：

```text
ghcr.io/0honus0/nexus-terminal:latest
```

可以覆盖仓库名与标签：

```bash
NEXUS_IMAGE_REPOSITORY=local/nexus-terminal \
NEXUS_IMAGE_TAG=dev \
scripts/build/build.sh docker
```

随后在 `.env` 中设置相同的 `NEXUS_IMAGE_REPOSITORY` 与 `NEXUS_IMAGE_TAG`，再运行 `docker compose up -d`。统一镜像的运行角色入口脚本位于 `scripts/docker/entrypoint.sh`；Docker 相关运行脚本统一归 `scripts/docker/`，见 [EC-REPO-001](./software-requirements/engineering-constraints.md#ec-repo-001)。
