# 部署与更新

默认使用 Docker Compose。唯一后端为 `packages/backend`（原 backend-next），启动产物 `dist/main.js`；前后端消费 Shared。旧实现从 Git 历史读取，不提供旧库、旧快照或旧环境变量的兼容层。功能见 [USAGE](USAGE.md)，待验范围见 [实施方案](后端重构下一阶段实施方案.md)。

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

默认访问 `http://localhost:18111`。仅发布 Frontend；仅本机访问时将 `ports` 改为 `127.0.0.1:18111:80`。

## 配置与数据

| 配置/路径                    | 用途                                                                                      |
| ---------------------------- | ----------------------------------------------------------------------------------------- |
| `NEXUS_IMAGE_REPOSITORY/TAG` | 镜像地址与已发布版本，开发镜像使用 `dev`                                                  |
| `NEXUS_HTTP_PORT`            | Frontend 发布端口，默认 18111                                                             |
| `NEXUS_PUBLIC_ORIGIN`        | 实际公开协议、域名和非默认端口，不带路径                                                  |
| `NEXUS_ENCRYPTION_KEY`       | 必填、固定的 32-byte 标准 base64 实例密钥；不可每次重启重新生成                           |
| `NEXUS_TRUSTED_PROXIES`      | IP/CIDR 或 proxy-addr 具名范围；Compose 默认 `loopback,uniquelocal`，只适用于受控隔离网络 |
| `./data`                     | SQLite、邻接 `.artifacts/.appearance` 等持久文件；备份包含完整目录及实例密钥              |
| `.env`                       | Compose 插值和 Backend env_file；首次初始化设置以后以持久配置为准                         |
| `GUACD_IMAGE`                | 默认 `guacamole/guacd:latest`；Backend 内连 `guacd:4822`，3001 不公开                     |
| `NEXUS_IPV6_SUBNET/GATEWAY`  | 默认 `fd01::/80` / `fd01::1`，与宿主冲突时修改                                            |

首次 Passkey 站点从公开 Origin 推导；多站点可用 `NEXUS_PASSKEY_SITES` JSON 初始化。CAPTCHA、安全策略和站点配置在设置页维护，按界面提示重启激活。插件仓库与信任 Publisher 由管理接口配置，不使用旧 catalog 环境变量。写操作依赖当前会话、同源 Origin/Fetch Metadata，不使用旧 CSRF token 端点。

```bash
docker compose up -d --force-recreate
```

## HTTPS 与代理

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

使用 Node.js Current 和根 `packageManager` 指定的 pnpm。

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run check
pnpm run format:all:check
```

单包用 `build:backend` / `build:frontend`。直接启动后端须提供 `NEXUS_DB_PATH`、`NEXUS_ENCRYPTION_KEY`、`NEXUS_PUBLIC_ORIGIN`；默认绑定 `127.0.0.1:3001`。

```bash
NEXUS_DB_PATH=/absolute/path/nexus-terminal.db pnpm --filter @nexus-terminal/backend start
scripts/build/build.sh docker
```

启动命令还需从受控环境注入实例密钥和公开 Origin。Docker 使用 `alpine:latest`、APK 最新 `nodejs-current/nginx`，命中缓存不会刷新系统包；刷新用 `docker build --pull --no-cache .`。后端构建 Shared 后通过 `deploy --prod` 交付，不再构建 Protocol。发布与远程 E2E 仍按当前实施方案执行。
