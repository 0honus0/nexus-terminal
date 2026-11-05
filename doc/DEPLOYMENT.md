# 部署与更新

默认使用 Docker Compose。唯一后端为 `packages/backend`，启动产物 `dist/main.js`；前后端消费 Shared。旧实现从 Git 历史读取，业务运行路径不保留旧值或旧环境变量兼容层；数据库升级策略见下方迁移章节。功能见 [USAGE](USAGE.md)，待验范围见 [实施方案](PLAN.md)。

## 部署

需要 Docker 和支持可选 `env_file` 的 Compose v2。

```bash
mkdir -p nexus-terminal
cd nexus-terminal
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/docker-compose.yml -O docker-compose.yml
wget https://raw.githubusercontent.com/0honus0/nexus-terminal/refs/heads/main/.env.example -O .env.example
cp .env.example .env
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

把生成结果保存为 `.env` 的 `NEXUS_ENCRYPTION_KEY`，并设置实际 `NEXUS_PUBLIC_ORIGIN`。部署文件与所选镜像必须来自同一版本；合并源码不代表镜像已发布。首次部署由程序初始化数据库。在受控网络完成首次管理员初始化后再开放公网。

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

数据库文件的父目录即实例数据目录；每个实例使用独立目录。资源目录使用 `appearance/`、`artifacts/`、`plugins/`，实例数据与密钥一起保留。Compose 的数据库固定为容器内 `/app/data/nexus-terminal.db`，通过 `.env` 的 `NEXUS_DATA_DIR` 配置宿主目录，默认仍为 `./data`。运行中可能出现 SQLite WAL/SHM、恢复日志和临时目录，勿手动清除正在使用的恢复文件。

当前迁移链为 v1 初始结构、v2 Shell Job 命令批次结果转换、v3 文件交付/展示批次结果转换；精确签名见 `packages/backend/src/bootstrap/schema.ts`。更新启动时自动顺序迁移，重复启动跳过已执行记录；业务代码只读取迁移后的格式。

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

## 数据库迁移

按 [H-21](rules/HUMAN.md#人工规则列表)，每条数据库结构、CHECK 约束或持久数据变更新增一条独立迁移，使用连续版本号、固定签名和执行记录。`dev` 与 `latest` 使用同一条迁移链，不在正式发布前合并或压缩迁移；没有数据库变更时不增加空迁移。已执行或已发布的迁移及签名保持不变，后续修正追加新迁移。

旧数值、单位、JSON 字段和约束通过 SQL 或迁移脚本转换，业务代码及持久解码只接受新格式。真实 SQL 仍由所属 SQLite Adapter 持有，模块 migrations 与 Bootstrap 负责顺序编排，复用现有 `SchemaMigration` 与 `schema_version`。脚本只在对应迁移应用时执行；迁移和版本记录同事务提交，失败不写入成功标记，未知提交先核对持久结果，不盲目重放。重复启动校验已应用版本和签名，只执行尚未应用的迁移。

交付前验证上一发布基线升级、多条迁移顺序执行、连续 dev 升级、重复启动跳过、空库安装、数据保留、完整性/外键、失败回滚及快照恢复边界。后续功能文档记录对应迁移版本、转换内容与验证结果，升级流程由版本内迁移承担。

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

使用 `.node-version` 指定的 Node.js 26.13.0 LTS 和根 `packageManager` 指定的 pnpm 12.16.1；本地开发、workflow 与 Docker 构建使用相同版本。依赖安装使用 `--frozen-lockfile`；pnpm 12 生成的锁文件包含环境与应用两个 YAML 文档，使用该版本 pnpm 读取，不手工拆分。Playwright 固定1.64.1，手工环境按锁定版本安装浏览器；CI runner 指纹包含 `.node-version`、清单、锁文件及补丁，版本变化会自动重建，每周继续刷新基础镜像与 OS 包。

```bash
pnpm install --frozen-lockfile
pnpm run build
pnpm run check
pnpm run format:all:check
```

传递依赖的安全 override 按真实消费者限定：readdir-glob、ESLint、@eslint/config-array 和 @typescript-eslint/typescript-estree 使用 minimatch 11，避免继续解析受影响的旧版本；升级这些上游包时需同步核对其导出、glob 匹配和审计结果。jschardet 4 沿文件编辑器原动态导入使用，支持现有编码识别接口。现有 xterm、Monaco 与 splitpanes 补丁保留；Monaco 补丁使用 pnpm 12 支持的标准 Git diff 头。ssh2 1.17.0 额外应用上游 [Isolate 修复](https://github.com/mscdex/ssh2/commit/45522bb8723d8ecf459a1d222086e56074c11682) 和 [Nan ObjectWrap 修复](https://github.com/mscdex/ssh2/commit/a3a39d795a8d7ff43d5f33aafadccfc03466d044)，确保 Node 26 下原生加密模块能够编译和加载；此项为临时补丁，后续每次依赖升级都须检查：ssh2 新正式版包含上述修复时，同次删除补丁文件、`patchedDependencies` 注册及锁文件引用，再确认 Node 26 下原生加密模块编译、加载成功；不能只更新版本而遗留补丁。OpenAI 7.51.0 使用稳定版本，仅该精确版本列入 pnpm 默认发布等待期的例外，不关闭整体供应链校验。

单包用 `build:backend` / `build:frontend`。直接启动后端须提供 `NEXUS_DB_PATH`、`NEXUS_ENCRYPTION_KEY`、`NEXUS_PUBLIC_ORIGIN`；默认绑定 `127.0.0.1:3001`。

```bash
NEXUS_DB_PATH=/absolute/path/data/nexus-terminal.db pnpm --filter @nexus-terminal/backend start
scripts/build/build.sh docker
```

启动命令还需从受控环境注入实例密钥和公开 Origin。Docker 构建与运行共用官方 `node:26.13.0-alpine` 基础镜像，Nginx/tini 由 APK 安装；升级 Node 时同步 `.node-version` 和主镜像、E2E runner Dockerfile 的默认 `NODE_VERSION`，构建脚本与 CI 显式传入版本文件的值。npm 安装 pnpm 时仅授权 pnpm 自身的安装脚本；workspace 的构建授权继续由 `allowBuilds` 管理。命中缓存不会刷新系统包；刷新用 `docker build --pull --no-cache .`。后端构建 Shared 后通过 `deploy --prod` 交付，不再构建 Protocol。发布与远程 E2E 仍按当前实施方案执行。

## 仓库手动清理

GitHub Actions 的 `Clean old Actions and container versions`（`.github/workflows/cleanup-history.yml`） 仅支持手动 Run workflow，不随推送、发布或定时任务执行。镜像清理仅限当前仓库关联的 `nexus-terminal` 和 `nexus-terminal-e2e-runner` 两个 GHCR 包；逐包核对仓库归属，分别保留现有 `main`、`dev`、`latest` 标签对应版本及其递归引用的平台和证明 manifest。其余旧发布版本、sha 标签版本和无标签版本均为清理候选；与保留版本共用 digest 的其它标签随版本保留。允许部分保护标签尚未发布（runner 当前只发布 `latest`）；有版本却没有任何保护标签的包会使清理停止，不整包盲删。

同时清理旧 Actions 运行及产物、全部 Actions 缓存；保留上述镜像源码对应的成功记录、最近成功 E2E 及本次清理记录。其它包、GitHub Releases、Git 标签、运行中的服务和实例数据不在镜像清理范围内。清理时保留排队、运行中及重新启动的 Actions 和所属产物；有其它活跃任务时，本次保留镜像版本及 Actions 缓存，待任务结束后手动重跑。

超期空排队记录不会一直阻挡清理：只有仍为 queued、没有结论、创建/开始/更新时间均超过 GitHub 官方 workflow 总期限35天、所有尝试均没有 job，并在读取 job 前后确认尝试号与时间未变化，才忽略其阻挡。该记录及产物仍保留，不尝试强删；近期重跑、有 job 或无法完整核实的记录继续保护。

执行日志按阶段展开，显示检查与删除耗时、逐项序号/ID、镜像 digest/标签、保留和跳过原因，以及已确认删除数量。摘要分别列出计划候选、实际删除与复查后保留/延后；存在其它活跃任务时会明确警告镜像和缓存未清理，不能仅凭 workflow 成功判断所有候选都已删除。

保留镜像无法完整解析、包未关联本仓库或任一保护标签在清理中移动、消失或从缺失变为存在时停止。每次镜像版本删除前复查两个包的保护标签，结束时再次确认；GitHub API 不提供条件删除，复查与删除之间仍存在并发窗口，操作前应先完成其它发布任务。

清理需要仓库 Actions 写权限及两个 GHCR 包的管理权限，包设置须允许此仓库的 Actions 管理访问。GitHub API 单次请求遇到瞬时服务错误时由官方 Octokit 最多重试3次并指数退避；权限/参数错误仍会失败，不降为成功或绕过权限。删除同一资源时404视为已不存在，单独计数，不冒充本轮删除；读取所属运行为404时保留无法重新确认状态的 artifact。镜像版本删除不做隐式重试，保持每次派发前核对渠道，失败后手动重跑重新计算保留集合。重试耗尽或其它失败仍可能已经删除部分旧资源，按运行日志核对权限和状态后手动重跑；不会恢复已删除历史。

策略实现和并发保证见 [仓库维护架构](architecture/MAINTENANCE.md)。先完成其它发布任务，再从 Actions 手动运行 `Clean old Actions and container versions`。
