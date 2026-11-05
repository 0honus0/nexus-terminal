# 部署与更新

默认使用 Docker Compose。唯一后端为 `packages/backend`（原 backend-next），启动产物 `dist/main.js`；前后端消费 Shared。旧实现从 Git 历史读取，业务运行路径不保留旧值或旧环境变量兼容层；下一版本起的数据库升级策略见下方迁移章节。功能见 [USAGE](USAGE.md)，待验范围见 [实施方案](PLAN.md)。

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

当前代码的数据库基线为 v1，结构签名为 `backend-next-v1-initial-20261105-rdp-certificates`，精确定义以 `packages/backend/src/bootstrap/schema.ts` 为准。当前实现仍只有 v1，下一版本迁移交付与验收见 [PLAN](PLAN.md#待实现与条件维护)。

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

## 数据库迁移（从下一版本起）

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

传递依赖的安全 override 按真实消费者限定：readdir-glob、ESLint、@eslint/config-array 和 @typescript-eslint/typescript-estree 使用 minimatch 11，避免继续解析受影响的旧版本；升级这些上游包时需同步核对其导出、glob 匹配和审计结果。jschardet 4 沿文件编辑器原动态导入使用，支持现有编码识别接口。现有 xterm、Monaco 与 splitpanes 补丁保留；Monaco 补丁使用 pnpm 12 支持的标准 Git diff 头。ssh2 1.17.0 额外应用上游 [Isolate 修复](https://github.com/mscdex/ssh2/commit/45522bb8723d8ecf459a1d222086e56074c11682) 和 [Nan ObjectWrap 修复](https://github.com/mscdex/ssh2/commit/a3a39d795a8d7ff43d5f33aafadccfc03466d044)，确保 Node 26 下原生加密模块能够编译和加载；此项为临时补丁，后续每次依赖升级都须检查：ssh2 新正式版包含上述修复时，同次删除补丁文件、`patchedDependencies` 注册及锁文件引用，再确认 Node 26 下原生加密模块编译、加载成功；不能只更新版本而遗留补丁。OpenAI 7.51.0 本轮明确升级到新发布的稳定版本，仅该精确版本列入 pnpm 默认发布等待期的例外，不关闭整体供应链校验。

单包用 `build:backend` / `build:frontend`。直接启动后端须提供 `NEXUS_DB_PATH`、`NEXUS_ENCRYPTION_KEY`、`NEXUS_PUBLIC_ORIGIN`；默认绑定 `127.0.0.1:3001`。

```bash
NEXUS_DB_PATH=/absolute/path/data/nexus-terminal.db pnpm --filter @nexus-terminal/backend start
scripts/build/build.sh docker
```

启动命令还需从受控环境注入实例密钥和公开 Origin。Docker 构建与运行共用官方 `node:26.13.0-alpine` 基础镜像，Nginx/tini 由 APK 安装；升级 Node 时同步 `.node-version` 和主镜像、E2E runner Dockerfile 的默认 `NODE_VERSION`，构建脚本与 CI 显式传入版本文件的值。npm 安装 pnpm 时仅授权 pnpm 自身的安装脚本；workspace 的构建授权继续由 `allowBuilds` 管理。命中缓存不会刷新系统包；刷新用 `docker build --pull --no-cache .`。后端构建 Shared 后通过 `deploy --prod` 交付，不再构建 Protocol。发布与远程 E2E 仍按当前实施方案执行。

## 手动清理发布历史与缓存

维护入口为 `.github/workflows/cleanup-history.yml`，只有 workflow_dispatch。执行内容、保留范围、权限及失败恢复见 [USAGE](USAGE.md#仓库手动清理)。先完成其它 E2E/发布任务再手动运行；首次在 GitHub 注册新 workflow 需要该文件存在于默认分支。不会触发镜像构建、更新服务器或删除实例数据。

### 1. 职责与范围

`cleanup-history.mjs` 是仓库维护策略和删除执行的唯一 owner，仅面向当前仓库 Actions，以及归属核对通过的两个固定容器包 `nexus-terminal`、`nexus-terminal-e2e-runner`。不涉及产品数据、GitHub Release 或 Git 标签删除。

### 2. 子功能与目录

既有 `scripts/maintenance/cleanup-history.mjs` 持有逐包检查、manifest 闭包、Actions 保留和资源删除；同目录 `cleanup-history.test.mjs` 提供隔离 GitHub/GHCR 回归。工作流只装配手动入口、权限和前置检查。

### 3. 依赖方向

工作流调用脚本；脚本使用 github-script 提供的 Octokit/context/core，以及 Node fetch 访问 GHCR。不依赖产品 Backend、Frontend 或 Shared，不新增运行时服务。

### 4. 类型与转换

GitHub REST 包元数据中的 repository.id 必须与当前仓库 ID 相同；版本 ID 用于精确删除，版本 name 作为 SHA256 manifest digest。GHCR 的索引、平台和证明引用在各包独立遍历，标签通过 HEAD 的 docker-content-digest 复查；配置中合法 OCI revision 汇入关联成功运行的保留集合。token 仅在内存持有并注册日志脱敏，不进入产物。

### 5. 入口与安装

仍只有 `workflow_dispatch`，需要 `contents: read`、`actions: write`、`packages: write` 和两个包的仓库 Actions 管理权限。运行先执行维护回归，再检查全部保留集合，最后删除；没有新安装点或产品协议。

### 6. 数据、事务与并发

各包现有 main/dev/latest 为保留根，递归保留其平台及证明 manifest；共用 digest 的其它标签随版本保留。允许部分标签不存在，包404或空包跳过；有版本却没有保护根时停止。每次版本删除前复查两个包全部保护标签，结束时再查；移动、消失或新出现都停止旧计划。包版本 DELETE 无条件比较接口，多个 API 删除也不是事务，无法撤销已完成的删除。原 workflow 与发布共用按 ref 的 concurrency；另有活跃 Actions 时跳过镜像和缓存删除，但这不提供跨 ref 或外部发布的原子互斥。

首次保留集合及删除镜像/缓存前均重新分类未完成运行。唯一排除阻挡的例外为超期空 queued：结论必须为 null、attempt 为有效正整数、创建/开始/更新三个时间均超过[GitHub 官方35天 workflow 总期限](https://docs.github.com/en/actions/reference/limits)。重读运行后以 `filter: all` 查询全部 attempt 的 job，只有明确 total_count=0 且 jobs 空数组，再重读确认 attempt/三个时间未变化且仍满足超期条件，才忽略其阻挡；记录和产物仍加入保留集合，不删除或取消。其它未完成状态、近期重跑、存在 job 或证据不全均保留阻挡；运行/job 的404不作为空 job 证据，非404读取失败传播并停止。

### 7. 生命周期与失败

当前/活跃运行、保留 revision 的成功运行及最近成功 E2E 留存；旧运行和产物删除前重新确认其运行状态。只有精确 DELETE 的404计为已不存在，其他失败传播；无法确认所属运行的产物保留。包版本删除禁用隐式重试，重跑必须重新检查渠道和计划。失败后按日志核对已删资源，不能把请求失败当作删除未发生。

检查与删除按阶段折叠分组，记录成功/失败耗时；每项输出序号、资源ID、镜像digest/标签与保留/跳过/删除原因，删除开始、确认成功、404及异常分别表达。阶段结束和删除失败时汇总已确认数量。其它活跃运行造成镜像/缓存延后时输出 warning，摘要分列计划候选、实际删除和复查保留/延后，不把未执行删除表述成已清理。

### 8. 当前能力与验收

两个固定包保留规则及保护分支由既有维护回归覆盖；实际执行证据与未验范围见 [testing](testing/E2E.md#清理工作流超期空排队与执行日志2026-11-05源码与静态)。超期空排队识别本轮仅完成源码与静态审核，待正式回归核对旧空记录、全attempt有job、近期重跑、复查变化、读取异常和活跃运行延后。历史夹具不证明新分支或线上删除通过，实际删除数量以手动工作流运行摘要为准。
