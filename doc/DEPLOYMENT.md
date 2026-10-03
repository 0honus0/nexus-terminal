# 部署与更新

Nexus Terminal 支持 Docker Compose 部署，并提供运行时配置、反向代理、IPv6、更新和源码构建方式。

## 包管理与构建边界

Docker 构建在 pnpm 安装前复制 `scripts/patches/`，与 workspace/lockfile 一起应用依赖补丁；统一镜像、Agent Runner 和 E2E Runner 使用同一补丁输入。E2E Runner 镜像缓存指纹包含补丁内容。

仓库只使用一个根 pnpm workspace：生产包位于 `packages/backend`、`packages/frontend`、`packages/agent-runner`，测试 package 位于 `tests/e2e`；依赖解析统一由根 `pnpm-workspace.yaml` 与 `pnpm-lock.yaml` 管理。workspace package 不得新增 `package-lock.json`、嵌套 lockfile 或独立安装流程；需要共享版本的依赖通过 pnpm catalog 管理，带 lifecycle/build script 的依赖必须经过根 `allowBuilds` 审查。

从仓库根目录安装一次：

```bash
pnpm install --frozen-lockfile
```

随后通过 workspace filter 或根脚本执行构建，例如 `pnpm run build:backend`、`pnpm run build:frontend`、`pnpm run build:agent-runner`。根脚本可以编排多个 workspace，但 package script 不得再次执行第二套 package-manager install；`scripts/build/build.sh local ...` 假定根 workspace install 已完成。

根 `pnpm run build` 串行构建 Backend、Frontend 和 Agent Runner；`pnpm run check` 串行执行 Frontend／Agent ESLint 及三个生产包的类型检查。Runner 是否部署仍由部署配置决定，完整构建不自动启用 Runner。只需某个包时使用对应 `build:*` 脚本；执行完整 build 后无需重复执行 `build:agent-runner`。

根 `packageManager` 字段 pin 本地、CI 与 Docker 使用的 pnpm release；开发机直接安装该版本的 pnpm，Docker builder 也通过 npm 全局安装该版本。升级 pnpm major 前必须确认 lockfile 与 GitHub dependency/security tooling 兼容。依赖刷新如果修改 shared catalog，需要重新生成唯一根 lockfile，并至少构建 Frontend、Backend、Agent Runner，因为 catalog 变化可能同时影响多个 package。

Docker builder 与 CI 从根 workspace/lockfile 安装；Backend 与 Agent Runner 的 production tree 使用 workspace-aware `pnpm deploy --prod` 生成。Frontend 只产出静态 `dist`。开发约束见 [AGENTS.md](AGENTS.md)。

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

Plugin Frontend 与 Frontend SDK 不使用独立公网 Origin/端口；浏览器统一通过主站同源 `/plugins/...` 与 `/sdk/...` 访问。自 P-023 起这两类静态资源与 API/WebSocket 复用 Backend `3001` listener，但仍由独立的 Plugin/SDK request handler 提供严格 CSP、iframe 与路径校验语义。

### 可选 Agent Runner

Agent Workspace Runtime 使用独立的 `nexus-agent-runner` 执行平面。Nexus 当前是**单用户应用**，因此 Runner 的职责是管理多个持久 Workspace、共享 Tool Pack 与 Workspace generation，而不是在同一用户内部再构造一层安全沙箱。

Workspace 是工作目录与运行环境边界：不同 Workspace 有独立项目文件；同一个 Workspace 可以选择不同的 Node/Python/Go Tool Pack 组合并生成新的 generation。Workspace 之间**不承诺** Linux namespace、network namespace、cgroup 或文件系统安全隔离。使用宿主 Runner 时，Runner 进程与其 Workspace 命令共享宿主系统安全上下文；使用容器 Runner 时，Docker 容器本身是 Runner 进程的操作系统边界。

Ubuntu/Debian host 首次启用前，从源码 checkout 执行：

```bash
./scripts/agent-runner/prepare-ubuntu-host.sh
```

该脚本只安装与 Toolchain Catalog 一致、SHA-256 固定的 `mise 2026.9.5`、Tool Pack 解包工具以及 Workspace Terminal 使用的系统 `script(1)` / `stty`，不编译或安装 Nexus 自定义 native helper。Node/Python/Go 的支持版本由 catalog JSON 维护，mise 按指定版本安装并保留上游校验，Runner 检查实际版本，不维护语言工具链的构建来源 lock 或预设安装树摘要。工具链通过 `/opt/nexus/packs/<family>/<version>` 暴露；多个 Workspace 复用同一份已安装工具链。

Runner 默认监听 `127.0.0.1:8790`。Runner 是可选增强能力：未配置 `NEXUS_AGENT_RUNNER_URL` 时，Frontend/Backend/guacd 基础栈独立启动，连接管理、SSH/基础命令和诊断能力不依赖 Runner。需要 Runner 时可使用宿主 Runner，或通过 Compose `runner` profile 启用容器 Runner；两种模式都必须在 `.env` 设置同一个 `NEXUS_AGENT_RUNNER_TOKEN`。Runner 所有 HTTP 与 WebSocket 控制入口统一要求 `Authorization: Bearer <NEXUS_AGENT_RUNNER_TOKEN>` 和 `X-Nexus-Agent-Protocol: 2026-09-13`；token 至少 32 字符，推荐使用 `openssl rand -hex 32` 生成。该 token 代表对 Runner 的完整控制权，不得写入日志或交给浏览器/Plugin。Runner HTTP 本身不负责 TLS：不要直接暴露到公网；跨主机部署应放在受信私网，或由 TLS 反向代理保护。

仓库同时提供独立 Runner 镜像发布流程：

```text
ghcr.io/0honus0/nexus-agent-runner:latest
ghcr.io/0honus0/nexus-agent-runner:dev
```

`docker-compose.yml` 已提供 `agent-runner` service，但通过 `profiles: [runner]` 保持默认关闭。容器模式可设置 `COMPOSE_PROFILES=runner`（或命令行 `--profile runner`），并把 `NEXUS_AGENT_RUNNER_URL` 设为 `http://agent-runner:8790`。Backend 不对 Runner 建立启动硬依赖；Runner 未就绪时仅增强能力不可用。独立镜像包含固定版本 `mise`、Tool Pack 解包工具与 `script/stty`；容器入口使用发行版 `tini` 作为 PID 1，只负责转发终止信号并回收 Runner 子进程产生的孤儿/zombie 进程，不参与 Workspace 隔离。HEALTHCHECK 调用 `/v1/availability` 验证 `native + logical` Workspace Runtime。

容器 Runner 使用 Docker 默认 capability/seccomp/AppArmor 即可；Compose 示例**不需要** `privileged`、`SYS_ADMIN`、`seccomp=unconfined`、`apparmor=unconfined`、Docker socket 或 nested Docker。这里不要把“容器边界”和“Workspace 边界”混为一谈：容器可以隔离整个 Runner 服务，但容器内多个 Workspace 仍属于同一个 Nexus 用户并共享 Runner 进程权限、内核网络与 Tool Store。

Runner 状态、Tool Pack、缓存和 Workspace runtime 默认持久化到 `NEXUS_AGENT_RUNNER_DATA_DIR`（默认 `./agent-runner-data`）。Runner Plugin 源码只读挂载 Backend 的 `./data/agent/plugins`。Workspace Profile 只冻结真实可执行配置（Recipe/Toolchain/Runner Plugin/ACP Profile/Browser Target/retention）；不再保留没有执行效果的 per-Workspace limits/network 字段。Agent Hard Limits 与 outbound/private-network policy 属于 Backend 自己的正式 owner，不由 Runner 模拟。

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
- `agent-runner`：可选 profile；启用后使用独立 `nexus-agent-runner` 镜像。

`frontend` 与 `backend` 使用同一 Nexus 镜像，镜像层由 Docker 复用；`guacd` 使用独立上游镜像。

当前发布 workflow 构建 `linux/amd64` 与 `linux/arm64`。GitHub Release 事件固定发布 `latest + release tag`；手动 `workflow_dispatch` 可选择 `dev` 或 `release` channel，默认 `dev`，并同时保留自定义 tag 或 `sha-<commit>` tag。

发布运行标题直接显示事件或输入确定的 channel、architecture 和 target；主镜像与 Runner 发布任务使用固定名称，prepare 失败时也不会显示未解析的表达式。生产依赖审计保留 high 阻断，不跳过漏洞检查；邮件与归档依赖由根 lockfile 固定到修复版本。release channel 只允许当前 main 提交，并要求该提交已有完整成功的 E2E workflow（基础检查、所有动态 Playwright 分片、Docker deployment smoke），不再依赖已退出的逐项目 job 名称。

正式发布 Agent 能力时应先发布 `nexus-agent-plugins` 的官方 catalog，再发布 Nexus 主镜像，因为生产 Host 默认从 `nexus-agent-plugins/releases/latest/download/catalog.json` 发现 first-party 插件。首次插件发布推荐先创建目标 tag 的 draft release，手动运行插件仓 `Release plugins` workflow 上传并核验 `catalog.json` 与两个签名 tar，再 publish release；随后再发布同一兼容线上的 Nexus 镜像。这样不会让已发布主镜像指向尚不存在的 `latest` catalog。

## `.env` 与持久化配置

项目根目录提供 `.env.example` 作为模板；首次部署可复制为 `.env`。运行时 `.env` 用于 Docker Compose 插值，并作为 Backend 的可选 `env_file`。

需要特别注意：

- `docker-compose.yml` 中 `environment` 明确声明的变量优先于 `env_file`。
- `APP_NAME`、对外 HTTP 端口、`GUACD_IMAGE`、网络地址段和 Passkey 配置可以从根目录 `.env` 调整。Compose 内部的 Backend 端口固定为 `3001`，Backend 通过内部网络固定连接 `guacd:4822`，避免用户配置与 Nginx/service discovery 脱节。
- Backend 首次启动时会在持久化数据目录中生成运行所需的安全密钥；`./data` 应整体备份。
- `VITE_*` 是前端构建时变量，运行中的容器修改 `.env` 不会重新生成已经构建好的前端静态资源。
- 修改运行时 `.env` 后建议执行 `docker compose up -d --force-recreate`，确保 Compose 重新创建相关容器。

Agent 模型能力 Registry 从 `models.dev` 获取远端快照，并把成功结果保存在 Backend 数据目录。Backend 启动时会先加载已有快照，再以 3 秒超时尝试同步远端；远端不可达不会阻止 Backend 继续启动，有缓存时继续使用缓存，无缓存时 Registry 明确显示为 unavailable。当前不执行周期自动刷新；需要立即更新时，可在 Agent Provider 设置中手动刷新，手动请求使用 15 秒超时。

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

Agent 写操作会同时校验会话 CSRF token 与浏览器 Origin。反向代理应像上例一样保留原始 `Host`，并传递
`X-Forwarded-Proto`；这样 Backend 可以按用户实际访问的公开地址完成同源校验。`NEXUS_PUBLIC_ORIGIN` 仍可作为
显式公开 Origin 配置，但不会再要求它必须与每个反向代理入口完全相同。

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

随后在 `.env` 中设置相同的 `NEXUS_IMAGE_REPOSITORY` 与 `NEXUS_IMAGE_TAG`，再运行 `docker compose up -d`。统一镜像的运行角色入口脚本位于 `scripts/docker/entrypoint.sh`；Docker 相关运行脚本统一归 `scripts/docker/`，开发约束见 [AGENTS.md](AGENTS.md)。

# 反向代理来源信任

## 首次管理员初始化必须隔离网络

空库实例的 Web setup 没有部署 token，可到达该接口的人可能抢先创建管理员。启动前先用防火墙／受限网络隔离，或在 Compose override 将 Frontend 发布端口绑定 `127.0.0.1`，通过本机或 SSH tunnel 完成初始化。核实管理员创建成功后才开放公共入口；不要先将未初始化实例暴露到不可信网络。只发布 Frontend 端口也不代替此要求。首次管理员原子创建保护并发，不验证部署者身份。

随附 Compose 保持动态容器地址，不指定固定 IPv4 子网或 Frontend IP。Backend 无发布端口，默认 `TRUST_PROXY=1`，信任一个入口代理 hop；Frontend Nginx 用 `$remote_addr` 覆盖 Forwarded-For。该 hop 策略要求 Backend 不被不可信客户端／容器直连；若发布 Backend 端口或将不可信容器加入网络，须改用可信代理精确 IP/CIDR，不能继续依赖 hop 数。宿主 Backend 默认仍为 `loopback`。HTTP 与 WebSocket 支持相同的数字 hop 或逗号分隔 IP/CIDR 配置。

### Nginx Proxy Manager（NPM）与真实来源

默认部署为 NPM Docker host 网络 → `http://127.0.0.1:18111` → Nexus Frontend → Backend。Frontend端口保持所有网卡发布，内部端口不发布；NPM启用WebSocket并保持外部Host（含必要端口），发送`X-Forwarded-For`及`X-Forwarded-Proto`。NPM必须把它实际看到的客户端IP放在Forwarded-For最后一项（追加或覆盖），不能仅透传用户自带header；不要仅提供X-Real-IP。

Frontend默认信任loopback/RFC1918/IPv6 ULA入口peer，以适配动态Docker gateway；real_ip_recursive关闭，只取可信入口交来的最后一个来源，不继续穿透内网客户端自带的链。Frontend将该地址作为单值Forwarded-For发给Backend，并仅从可信入口接受精确http/https协议值。此简化配置要求宿主进程及内部Docker网络可信；Frontend并未强制仅NPM可达：需用部署防火墙保护可信转发路径，不能允许不可信私网peer伪造来源；不可信容器不得直连Frontend/Backend。不需要固定容器IP或手动修改gateway地址。

真实内网地址（loopback、RFC1918、IPv6 ULA及link-local）不受IP白名单或失败黑名单限制；公网来源继续使用已启用的失败计数、最大尝试次数和封禁时长。内网豁免不绕过密码/2FA认证。NPM若再位于CDN/其他代理之后，应在NPM处正确解析真实客户端再交给Nexus，不在Nexus递归猜测任意来源链。

`TRUST_PROXY` 默认 `loopback`，HTTP 与 WebSocket 使用相同策略。独立容器或远程代理部署必须显式指定真实反向代理 IP 或最小可信 CIDR（逗号分隔），并限制 Backend 直连访问。不要为方便而信任全部私网范围；可信代理必须覆盖客户端的 `X-Forwarded-For`、`X-Forwarded-Host`、`X-Forwarded-Proto`。WebSocket 不读取 `X-Real-IP`。配置错误可能造成来源白名单／黑名单／审计地址失真或外部 Origin 被拒绝。
