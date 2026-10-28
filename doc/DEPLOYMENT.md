# 部署与更新

默认使用 Docker Compose。唯一后端为 `packages/backend`（原 backend-next），启动产物 `dist/main.js`；前后端消费 Shared。旧实现从 Git 历史读取，不提供旧库、旧快照或旧环境变量的兼容层。功能见 [USAGE](USAGE.md)，待验范围见 [实施方案](PLAN.md)。

## 部署

需要 Docker 和支持可选 `env_file` 的 Compose v2。

```bash
mkdir -p nexus-terminal
cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/dev/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/dev/.env.example -O .env.example
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

把生成结果保存为 `.env` 的 `NEXUS_ENCRYPTION_KEY`，并设置实际 `NEXUS_PUBLIC_ORIGIN`。部署文件与所选镜像必须来自同一版本；合并源码不代表镜像已发布。重构版本使用空数据目录，不直接挂载旧产品数据库。在受控网络完成首次管理员初始化后再开放公网。

```bash
docker compose up -d
docker compose ps
docker compose logs --tail=100 backend
```

默认访问 `http://localhost:18111`。远程桌面不再部署 guacd；更新后使用 `docker compose up -d --remove-orphans` 移除旧容器。浏览器内运行 RDP/VNC SDK，Backend 只桥接目标 TCP/TLS，必须能访问目标端口；公网部署使用 HTTPS。仅发布 Frontend；仅本机访问时将 `ports` 改为 `127.0.0.1:18111:80`。

## 配置与数据

| 配置/路径                    | 用途                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| `NEXUS_IMAGE_REPOSITORY/TAG` | 镜像地址与已发布版本，开发镜像使用 `dev`                                                   |
| `NEXUS_HTTP_PORT`            | Frontend 发布端口，默认 18111                                                              |
| `NEXUS_PUBLIC_ORIGIN`        | 实际公开协议、域名和非默认端口，不带路径                                                   |
| `NEXUS_DATA_DIR`             | Compose 宿主数据目录，默认 `./data`；自定义后备份命令中的 `data` 也需替换为该目录          |
| `NEXUS_ENCRYPTION_KEY`       | 必填、固定的 32-byte 标准 base64 实例密钥；不可每次重启重新生成                            |
| `NEXUS_TRUSTED_PROXIES`      | IP/CIDR 或 proxy-addr 具名范围；Compose 默认 `loopback,uniquelocal`，只适用于受控隔离网络  |
| `./data`                     | `nexus-terminal.db` 和 `appearance/`、`artifacts/`、`plugins/`；备份包含完整目录及实例密钥 |
| `.env`                       | Compose 插值和 Backend env_file；首次初始化设置以后以持久配置为准                          |
| `NEXUS_IPV6_SUBNET/GATEWAY`  | 默认 `fd01::/80` / `fd01::1`，与宿主冲突时修改                                             |

数据库文件的父目录即实例数据目录；每个实例使用独立目录。资源目录不再拼接 `.db.appearance/.db.artifacts/.db.plugins`，本次布局为破坏性升级，不自动迁移旧目录或混用旧数据库；以新的空数据目录启动，旧目录需由操作者自行保管，程序不删除旧数据。Compose 的数据库固定为容器内 `/app/data/nexus-terminal.db`，通过 `.env` 的 `NEXUS_DATA_DIR` 配置宿主目录，默认仍为 `./data`。运行中可能出现 SQLite WAL/SHM、恢复日志和临时目录，勿手动清除正在使用的恢复文件。

当前首版数据库仅保留 v1 完整结构；当前结构包含远端依赖安装的 `tools` 机器突变来源、Agent Images 协议、上下文摘要/自动标题、模型响应收讫标记和 Run 级批准策略，结构签名为 `backend-next-v1-initial-20261025-agent-approvals`。即使旧开发库也标为 v1，亦不能据此视为兼容；启用当前工作区构建前使用独立空数据目录并保管原目录与密钥，不把旧库/旧快照直接混入新实例。程序不会自动删除旧数据或执行开发期升级。

首次 Passkey 站点从公开 Origin 推导；多站点可用 `NEXUS_PASSKEY_SITES` JSON 初始化。CAPTCHA 和 Passkey 站点配置在设置页维护，按界面提示重启激活；IP 白名单、登录封禁策略、监控周期和资源缓存 TTL 保存后热更新。白名单保存前确认当前来源仍被允许，保留部署恢复入口。插件仓库与信任 Publisher 由管理接口配置，不使用旧 catalog 环境变量。写操作依赖当前会话、同源 Origin/Fetch Metadata，不使用旧 CSRF token 端点。

```bash
docker compose up -d --force-recreate
```

## HTTPS 与代理

公网入口建议开启 HTTPS 与 HTTP/2，在实际终止 TLS 的反向代理中设置；容器间继续 HTTP/1.1。Nginx Proxy Manager 可在站点 SSL 设置中开启 HTTP/2。若边缘已支持 Brotli，可启用其静态响应压缩；容器原生交付 gzip，不要求额外 Brotli 模块。不要在 CDN 或代理启用全站强制缓存：只对带内容哈希的 `/assets/` 使用长期缓存，`/api/`、`/ws/`、插件 SDK/页面及 HTML/SW 保持各自原策略。

生产 Vite 构建会对 JS/MJS、CSS、HTML、JSON、SVG 和 WASM 生成 `.gz` 旁文件（至少 1 KiB 且压缩更小），Nginx 使用 `gzip_static on` 按 Accept-Encoding 协商；原文件保留，更新后的 Dockerfile 复制整个前端 build 插件目录，无需额外环境变量。哈希字体/图片与 JS 一样缓存一年，非哈希图片仍为七天；HTML/SW 不长期缓存。该优化需要重新构建并更新 Frontend 镜像/容器；只刷新浏览器不能替换已部署资源，不需要迁移数据或修改 Backend 配置。

```nginx
# http 上下文：普通 HTTP 使用可复用连接，只有 WebSocket 才升级。
map $http_upgrade $nexus_connection_upgrade {
    default upgrade;
    '' '';
}

upstream nexus_frontend {
    server 127.0.0.1:18111;
    keepalive 32;
}

# 放在已配置证书的 HTTPS server 内；HTTP/2 同样在该 server 开启。
location / {
    proxy_pass http://nexus_frontend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $nexus_connection_upgrade;
    proxy_set_header Host $http_host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Range $http_range;
    proxy_set_header If-Range $http_if_range;
    proxy_redirect off;
}
```

保留公开 Host/协议并启用 WebSocket。HTTPS 支持 Passkey、剪贴板等浏览器能力。代理必须传递实际观察到的来源，并用网络隔离阻止绕过；宿主 Backend 默认信任 loopback，外部代理使用精确 IP/最小 CIDR，不接受旧 hop 数配置。Compose 默认启用 IPv6，宿主不支持时同步关闭 `enable_ipv6` 和 IPv6 IPAM。

## 备份与更新

```bash
docker compose stop backend
sudo tar -czf "nexus-data-$(date +%Y%m%d-%H%M%S).tar.gz" data .env
docker compose up -d
```

备份含实例密钥，按秘密文件保管。不要只复制数据库，也不要在 Backend 写入时复制目录。

```bash
docker compose pull
docker compose up -d --remove-orphans
```

## 构建与开发

使用 Node.js Current 和根 `packageManager` 指定的 pnpm。 当前锁定 pnpm 11.28.9，依赖更新后仍使用 `--frozen-lockfile` 安装；Undici 8 要求 Node.js ≥22.19.0，推荐继续使用 Current。Playwright 已更新至1.64.1，手工测试环境需按锁定版本重新安装对应浏览器；CI runner镜像指纹由清单、锁文件及补丁生成，会自动重建，不能复用旧浏览器版本。

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run check
pnpm run format:all:check
```

单包用 `build:backend` / `build:frontend`。直接启动后端须提供 `NEXUS_DB_PATH`、`NEXUS_ENCRYPTION_KEY`、`NEXUS_PUBLIC_ORIGIN`；默认绑定 `127.0.0.1:3001`。

```bash
NEXUS_DB_PATH=/absolute/path/data/nexus-terminal.db pnpm --filter @nexus-terminal/backend start
scripts/build/build.sh docker
```

启动命令还需从受控环境注入实例密钥和公开 Origin。Docker 使用 `alpine:latest`、APK 最新 `nodejs-current/nginx`，命中缓存不会刷新系统包；刷新用 `docker build --pull --no-cache .`。后端构建 Shared 后通过 `deploy --prod` 交付，不再构建 Protocol。发布与远程 E2E 仍按当前实施方案执行。

## 手动清理发布历史与缓存

维护入口为 `.github/workflows/cleanup-history.yml`，只有 workflow_dispatch。执行内容、保留范围、权限及失败恢复见 [USAGE](USAGE.md#仓库手动清理)。先完成其它 E2E/发布任务再手动运行；首次在 GitHub 注册新 workflow 需要该文件存在于默认分支。不会触发镜像构建、更新服务器或删除实例数据。
