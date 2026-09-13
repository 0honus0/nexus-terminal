# Nexus 部署问题与决策记录

> 规则：所有有问题的修改项必须先在本文件记录“问题、原因、决策、计划修改、验证方式”，再实施修改。完成后补充“实际修改、验证结果、状态”。

## P-001 Backend 无法访问 Agent Runner

- **发现时间**：2026-09-13
- **问题现象**：Backend 请求 Workspace Runtime `/catalog` 时返回 500，日志出现 `TypeError: fetch failed` / `ECONNREFUSED`。
- **原因**：部署同时启用了 Compose 内的 `agent-runner` 服务，但 Backend 的 `NEXUS_AGENT_RUNNER_URL` 仍指向 `http://host.docker.internal:8790`。Runner 没有把 8790 发布到宿主机，因此该地址不可达；同一 Compose 网络中的 `http://agent-runner:8790` 可达。
- **决策**：当 Compose 内启用 `agent-runner` 时，Backend 必须通过 Docker service DNS 使用 `http://agent-runner:8790`；不再把本部署的 Runner 指向宿主机地址。
- **计划修改**：
  1. `.env` 设置 `NEXUS_AGENT_RUNNER_URL=http://agent-runner:8790`。
  2. Backend `depends_on` 增加 `agent-runner: condition: service_healthy`，避免 Backend 在 Runner 未就绪时启动产生竞态。
  3. 后续同步修正文档/示例中与实际 Compose 启用状态不一致的注释。
- **验证方式**：
  - Backend 容器内访问 `http://agent-runner:8790/v1/availability` / `v1/catalog` / `v1/storage` 时能建立连接；未带 token 时应返回 401，而不是连接拒绝。
  - Backend healthcheck 为 healthy。
  - 实际带认证的 Workspace Runtime API 不再因 `ECONNREFUSED` 返回 500。
- **当前实际修改**：该项在建立“先记录再修改”规则前已经临时实施：`.env` 已改为 `http://agent-runner:8790`，Backend 已添加 Runner 健康依赖。
- **当前验证结果**：Backend 已恢复 healthy；从 Backend 到 Runner 的上述接口均能建立连接并返回 401（未认证），说明网络链路已恢复。
- **本轮实施结果**：线上 `.env` 已固定 `NEXUS_AGENT_RUNNER_URL=http://agent-runner:8790`；Compose 明确 `backend -> agent-runner: service_healthy`，Runner 不发布宿主端口。2026-09-13 22:16 切换时实际观察到 Runner healthy 后 Backend 启动并 healthy。
- **最终验证**：线上 Backend 内带 Bearer token + `X-Nexus-Agent-Protocol: 2026-09-13` 请求 `/v1/availability` 返回 `available=true, mode=native, isolation=logical`；Backend/Frontend/Runner 均 healthy；新容器日志未再出现 `ECONNREFUSED` / `/catalog` 500。
- **状态**：`已修复并验证`

## P-002 插件前端被设计成独立 Origin / 独立端口，导致部署复杂且远端不可用

- **发现时间**：2026-09-13
- **问题现象**：部署原配置为 `NEXUS_PLUGIN_FRONTEND_ORIGIN=http://localhost:18112`。当用户从远端访问 `https://ssh.honus.top` 时，浏览器中的 `localhost` 指向用户自己的机器，不是服务器；同时 HTTPS 主站加载 HTTP 插件资源还会触发 Mixed Content。
- **代码约束**：当前 Backend 明确要求 `pluginFrontendOrigin !== publicOrigin`，否则抛出 `PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED`；并单独启动一个插件静态服务器监听 3002。
- **用户决策**：**去掉“插件必须使用独立 Origin / 独立公网端口 / 独立子域名”的设计。插件前端改为由 Nexus 主服务内部按路径分流，与主站同源。**
- **目标架构**：
  - 外部只使用主站 Origin：`https://ssh.honus.top`。
  - 插件静态资源统一使用同源路径，例如 `/plugins/<appId>/<version>/<entry>`。
  - 不新增公网端口，不要求 `plugin.honus.top` 等额外域名，不要求浏览器直接访问 Backend 的 3002。
  - 主站 Frontend/Nginx 或 Backend 内部完成 `/plugins/` 路由分流。
- **计划修改**：
  1. 移除 `PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED` 这一“必须不同 Origin”的启动/运行时限制。
  2. `frontendDescriptor()` 不再拼接独立 `pluginFrontendOrigin`，改为返回同源 `/plugins/...` URL（或基于 `publicOrigin` 生成同源 URL）。
  3. 将插件静态资源接入现有主服务路径；优先复用当前插件静态服务逻辑，避免复制文件服务、安全 header、路径校验逻辑。
  4. Frontend Nginx 对 `/plugins/` 增加内部代理，或将插件静态路由直接挂载到 Backend 主 HTTP server；最终只暴露现有主站端口。
  5. 去掉 Compose 中 `NEXUS_PLUGIN_FRONTEND_PORT` 的公网映射与独立 `NEXUS_PLUGIN_FRONTEND_ORIGIN` 部署要求。
  6. 更新 `.env.example`、`docker-compose.yml`、部署文档和相关测试。
- **验证方式**：
  - `https://ssh.honus.top/plugins/...` 能加载插件前端资源。
  - 浏览器不再出现 Mixed Content、localhost 错址或跨 Origin 依赖。
  - 不需要额外公网监听 18112/18113。
  - 插件 iframe / sandbox、CSP、资源 MIME、缓存与路径穿越保护继续满足现有安全要求。
  - 主站 API、WebSocket、静态资源与插件路径互不冲突。
- **当前实际修改**：此前为了尝试“独立 HTTPS Origin”方案，部署 `.env` 被临时改成 `NEXUS_PLUGIN_FRONTEND_PORT=18113`、`NEXUS_PLUGIN_FRONTEND_ORIGIN=https://ssh.honus.top:18112`。用户已否决该设计；Nginx 18112 TLS 分流并未实施。
- **回退决策**：在实现同源路径分流前，先撤销上述 18113/`:18112` 半成品配置，避免留下不可用部署状态。
- **本轮实施结果**：Backend 已删除 `AGENT_PLUGIN_FRONTEND_ORIGIN` 配置与 `PLUGIN_FRONTEND_ORIGIN_NOT_ISOLATED` 限制；`frontendDescriptor()` 改为基于 `AGENT_PUBLIC_ORIGIN` 生成同源 `/plugins/...` URL。Frontend Nginx 将 `/plugins/`、`/sdk/` 内部分流到 `backend:3002`。Compose 删除 Backend 3002 的宿主端口映射；线上 `.env` 已删除 `NEXUS_PLUGIN_FRONTEND_PORT` / `NEXUS_PLUGIN_FRONTEND_ORIGIN`，镜像切换为 `same-origin-20260913`。
- **最终验证**：隔离预上线探针实际加载 `/plugins/smoke-static/1/index.html` 与 `/sdk/frontend-v1.mjs` 成功；线上 `https://ssh.honus.top/sdk/frontend-v1.mjs` 返回 JavaScript，`/plugins/nexus.agent/1.0.0/.nexus-package-hash` 正确返回 404 而非 SPA fallback；Backend 3002 无任何宿主 publish，18112/18113 均无监听。
- **状态**：`已修复并验证`

## P-003 Compose 配置/注释与实际启用状态不一致

- **发现时间**：2026-09-13
- **问题现象**：`docker-compose.yml` 中 `agent-runner` 服务实际上已启用，但附近注释仍写“默认不随 Compose 启动”“需要时取消注释”；Backend `depends_on` 也曾保持注释状态。配置意图与实际文件不一致，容易导致后续维护误操作。
- **原因**：部署过程中从可选 Runner 方案演进为 Compose 内置 Runner 后，注释和依赖没有同步完成。
- **决策**：以当前真实部署方式为准：Runner 是本 Compose 的正式服务。删除失效的“可选/取消注释”说明，并让依赖关系显式、可验证。
- **计划修改**：
  1. 清理 `docker-compose.yml` 中与实际状态冲突的 Runner 注释。
  2. 保留明确的 `backend -> agent-runner healthy` 依赖。
  3. `.env.example` 和 `doc/DEPLOYMENT.md` 同步该部署模型。
- **验证方式**：`docker compose config` 无错误；全栈冷启动后 Runner 先 healthy，Backend 再启动并 healthy。
- **本轮实施结果**：源码 `docker-compose.yml` 已把 `agent-runner` 作为正式 service，默认 Runner URL 改为 `http://agent-runner:8790`，清理“取消注释后启用”等失效说明；`.env.example` 与 `doc/DEPLOYMENT.md` 已同步。
- **最终验证**：`docker compose config` 通过；线上切换时 Compose 实际按 Runner healthy → Backend healthy → Frontend healthy 顺序完成，且三者最终均 healthy。
- **状态**：`已修复并验证；关于 Runner“默认正式服务/硬依赖”的部分已被 P-008 修正`

## P-004 变更流程缺少“先记录问题与决策”约束

- **发现时间**：2026-09-13
- **问题现象**：前述部署排障中出现了先修改 `.env` / Compose、后讨论架构的情况，导致留下了 18113 半成品状态。
- **原因**：缺少针对线上部署修改的显式记录门禁。
- **决策**：从本条开始，任何有问题的修改项都必须先更新 `doc/PROBLEM.md`，再实施；修改后必须补验证结果。
- **执行规则**：
  1. 先记录问题与证据。
  2. 明确设计决策和不采用的方案。
  3. 写出计划修改和回滚点。
  4. 再执行修改。
  5. 真实验证后补结果与状态。
- **状态**：`生效`

## P-005 同源 `/plugins/` 经过 Frontend Nginx 时会继承 `X-Frame-Options: DENY`

- **发现时间**：2026-09-13
- **问题现象**：主站 `packages/frontend/nginx.conf` 在 `server` 级别统一添加 `X-Frame-Options: DENY`。如果直接新增 `/plugins/` 代理而不处理 header，Plugin iframe 即使 URL 正确也会被浏览器拒绝加载。
- **原因**：原设计的 Plugin 静态服务绕过主站 Frontend Nginx，因此没有受到主站 X-Frame-Options 的影响；改为同源路径后，请求会穿过该 Nginx。
- **决策**：`/plugins/` 与 `/sdk/frontend-v1.mjs` 使用专用 Nginx location。该 location 不继承主站的 `X-Frame-Options: DENY`，保留 Backend Plugin static server 自己的 CSP、`frame-ancestors`、CORS、CORP、MIME 与 immutable cache header。iframe 仍保持 `sandbox="allow-scripts"`，不添加 `allow-same-origin`。
- **计划修改**：
  1. Frontend Nginx 新增内部 upstream `backend:3002`。
  2. `/plugins/` 与 `/sdk/` 仅代理到该内部端口。
  3. location 级显式 header 配置阻断 server 级 `X-Frame-Options: DENY` 继承，同时不覆盖 Plugin static server 的 CSP/CORS 等响应头。
- **验证方式**：同源 Plugin HTML 响应不含 `X-Frame-Options: DENY`；包含预期 `Content-Security-Policy`、`Access-Control-Allow-Origin: *`、immutable cache；主站普通页面仍保留 `X-Frame-Options: DENY`。
- **本轮实施结果**：Frontend Nginx 为 `/plugins/` 和 `/sdk/` 增加独立 location；通过 location 级 `add_header` 阻断 server 级 `X-Frame-Options: DENY` 继承，并保留 Backend static server 的 CSP/CORS/cache 等响应头。iframe descriptor 继续保持 `sandbox="allow-scripts"`，未加入 `allow-same-origin`。
- **最终验证**：隔离探针中主站响应保留 `X-Frame-Options: DENY`，Plugin HTML 响应无 DENY 且 CSP/CORS/immutable cache 正常；线上 SDK 路由同样无 XFO DENY，CSP `frame-ancestors https://ssh.honus.top` 与 `Access-Control-Allow-Origin: *` 正常。
- **状态**：`已修复并验证`

## P-006 Dev/E2E 入口仍依赖独立 Plugin Origin

- **发现时间**：2026-09-13
- **问题现象**：Playwright/E2E 当前设置 `AGENT_PLUGIN_FRONTEND_ORIGIN=http://127.0.0.1:<pluginPort>`，Docker smoke 也直接访问单独 Plugin 端口；Vite dev server 没有 `/plugins/` 与 `/sdk/` 的同源代理。
- **原因**：测试与开发入口沿用了被废弃的独立 Origin 架构。
- **决策**：测试与开发也必须使用和生产一致的同源 URL。3002 仅作为测试/容器内部代理 target，不再作为浏览器可见 Origin。
- **计划修改**：
  1. Playwright Backend 不再设置 `AGENT_PLUGIN_FRONTEND_ORIGIN`；只保留内部 Plugin listener port。
  2. Vite 增加 `/plugins/`、`/sdk/` 到内部 Plugin listener 的代理。
  3. Docker smoke 从主 Frontend 端口访问 `/plugins/...` 与 `/sdk/frontend-v1.mjs`，不再直接访问 Plugin listener。
- **验证方式**：E2E/Smoke 获取到的 descriptor 与资源 URL 均使用主 Frontend Origin；独立 Plugin listener 不需要发布到宿主机。
- **本轮实施结果**：Vite 已增加 `/plugins` / `/sdk` 到内部 Plugin listener 的代理；Playwright 不再向 Backend 注入 `AGENT_PLUGIN_FRONTEND_ORIGIN`，只把 3002 作为内部代理 target；Docker deployment smoke 已改为通过主 Frontend 端口检查 `/plugins/...` 和 `/sdk/...`，并新增 Plugin route 不得继承 `X-Frame-Options: DENY` 的断言。
- **验证结果**：`bash -n scripts/e2e/docker-deployment-smoke.sh` 通过；由于 honus.top 宿主机没有 Node/pnpm，完整仓库 smoke 在启动阶段因 `node: command not found` 无法在该宿主执行。为避免安装额外宿主开发环境，改用无需宿主 Node 的临时 Compose 等价探针，已真实验证同源 Plugin/SDK 路由与安全 header。
- **状态**：`代码已修复；完整仓库 E2E 待 CI/具备 Node 的环境复跑`

## P-007 Docker deployment smoke 与默认 Compose Runner 模型冲突

- **发现时间**：2026-09-13
- **问题现象**：`scripts/e2e/docker-deployment-smoke.sh` 仍自行启动宿主机 Runner，并把 Backend 的 `AGENT_RUNNER_URL` 覆盖为 `host.docker.internal:<随机端口>`。与此同时，P-003 已决定 `agent-runner` 是默认 Compose 正式服务；原 smoke override 又没有给 Compose Runner 设置唯一 `container_name`，在已有线上 `nexus-agent-runner` 的主机上执行会产生容器名冲突。
- **原因**：Smoke 仍按旧“宿主 Runner 为默认、Compose Runner 可选”的部署模型编排。
- **决策**：Docker deployment smoke 的**生产部署路径验证**必须使用 Compose Runner；宿主 Runner 的专项行为测试如仍需要，应作为独立测试，不再覆盖 Docker deployment smoke 中 Backend 的生产 Runner 地址。
- **计划修改**：
  1. 移除 smoke 中 Backend `AGENT_RUNNER_URL=http://host.docker.internal:<port>` 覆盖与主流程宿主 Runner 启动。
  2. 为 smoke Compose 的 `agent-runner` 设置带 suffix 的唯一容器名。
  3. 将 `NEXUS_AGENT_RUNNER_DATA_DIR` 指向 smoke 临时目录，并继续使用临时 token。
  4. Backend 通过 `http://agent-runner:8790` 验证真实 Compose Runner availability/catalog/storage 与 Workspace Runtime 路径。
  5. 若脚本后半段仍有明确的 host-runner 故障注入用例，将其保留为独立进程但不作为 Backend 主运行时。
- **验证方式**：`docker compose config` 能生成；在已有线上 `nexus-agent-runner` 的主机上 smoke 不发生容器名冲突；Backend 实际 `AGENT_RUNNER_URL` 为 `http://agent-runner:8790`，认证 availability 成功。
- **本轮实施结果**：Docker deployment smoke 已移除 Backend 指向 `host.docker.internal:<runnerPort>` 的覆盖及主流程宿主 Runner 启动；改用默认 Compose `agent-runner`，设置带 suffix 的唯一容器名、临时 Runner data 目录和 `http://agent-runner:8790`。后半段独立的 corrupt-journal 故障注入仍保留为专项 Runner 进程测试，不再充当 Backend 主运行时。
- **验证结果**：脚本 `bash -n` 通过；生产等价临时 Compose 探针在同一主机成功启动独立 Runner/Backend/Frontend/guacd，Runner healthy 且 Backend 认证 availability 返回 `true/native/logical`，未与线上 `nexus-agent-runner` 发生容器名冲突。完整 smoke 仍受宿主缺少 Node/pnpm 限制，需在标准 CI 环境复跑。
- **状态**：`代码已修复；完整 smoke 待标准 CI 环境复跑；“deployment smoke 必须以 Runner 为默认生产路径”的部分已被 P-008 修正`

## 本轮最终状态与剩余验证项

- **线上状态（2026-09-13 22:16+08:00）**：`nexus-terminal-frontend`、`nexus-terminal-backend`、`nexus-agent-runner`、`nexus-terminal-guacd` 均 healthy；主站仍只发布 18111，由现有 Nginx Proxy Manager 通过 `https://ssh.honus.top` 对外服务。
- **插件网络边界**：Backend 3002 仅在 Compose 网络内使用，不发布到宿主；18112/18113 已无监听；浏览器只使用 `https://ssh.honus.top/plugins/...` 与 `/sdk/...`。
- **安全边界**：去掉的是“独立公网 Origin/端口”设计，不是 iframe sandbox。Plugin iframe 继续使用 `sandbox=allow-scripts` 且无 `allow-same-origin`，Plugin JavaScript 保持 opaque sandbox origin，并通过 bounded MessagePort SDK 访问能力。
- **剩余验证项**：P-006/P-007 的完整 repository Docker smoke 尚未在 honus.top 上执行，因为宿主没有 Node/pnpm。等价临时 Compose 生产路径探针已通过；完整 smoke 应在标准 CI（Node 24 + pnpm + Playwright 依赖）再次执行。该缺口不影响当前线上运行验证，但属于 CI 回归证据缺口。

## P-008 Runner 被错误改成基础服务硬依赖，违背“基础能力可独立运行”边界

- **发现时间**：2026-09-13
- **问题现象**：P-003/P-007 的上一版决策把 `agent-runner` 改成默认 Compose 正式服务，并让 Backend 使用 `depends_on: condition: service_healthy` 强依赖 Runner。结果是即使用户只需要 Nexus 主站、连接管理、基础排查、SSH/命令执行等核心能力，也必须先启动 Runner；Runner 镜像/运行时故障还会阻塞 Backend 启动。
- **用户澄清的产品边界**：**Runner 必须是可选增强能力。没有 Runner 时 Nexus 仍可完成基础排查、连接管理、SSH/基础命令执行等核心任务；启用 Runner 后才增加 Workspace Runtime、持久 Workspace、Tool Pack、Runner Plugin、ACP/Runner 侧执行等增强能力。**
- **原因**：上一轮把“当前 honus.top 已启用 Runner”误等同于“产品默认必须依赖 Runner”，混淆了部署实例状态和产品能力边界。
- **决策**：
  1. Backend 对 Runner 使用软依赖；Runner 未配置/不可达时 Backend 正常启动，Workspace Runtime availability 明确返回 unavailable。
  2. `agent-runner` 在 Compose 中保留为可选 service，通过 Compose profile 显式启用，不进入默认 `docker compose up -d` 基础栈。
  3. 默认 `AGENT_RUNNER_URL` 为空，不再隐式指向 `http://agent-runner:8790`；只有启用 Runner 的部署才配置该 URL 与 token。
  4. 移除 Backend 对 `agent-runner` 的硬 `depends_on`。即使启用了 Runner，Backend 也允许先启动；Runner 就绪后增强能力恢复可用。
  5. honus.top 当前仍可选择启用 Runner，因为该实例需要增强功能；但这是实例选择，不是产品基础依赖。
  6. P-003 中“Runner 是本 Compose 正式默认服务”和 P-007 中“production deployment smoke 必须使用 Compose Runner”的决策被本条**部分取代**：Compose 可以提供 Runner，但默认栈和无 Runner 测试必须成立；有 Runner 路径仍需单独验证。
- **计划修改**：
  1. `docker-compose.yml`：给 `agent-runner` 添加 `profiles: [runner]`；移除 Backend 的 Runner `depends_on`；`AGENT_RUNNER_URL` 默认改为空。
  2. `.env.example`：默认 Runner URL/token 留空；文档给出启用方法（设置 `COMPOSE_PROFILES=runner`、URL、token，或使用 `--profile runner`）。
  3. `doc/DEPLOYMENT.md`：明确基础栈与 Runner 增强栈两种模式及能力边界。
  4. Docker smoke/验证拆成两条：无 Runner 时 Backend/Frontend 正常 healthy 且 availability=unavailable；启用 Runner 时 availability=true/native/logical，增强 Workspace Runtime 正常。
  5. honus.top 部署保留 Runner profile 开启状态，避免本次产品边界修正意外关闭当前实例所需增强能力。
- **验证方式**：
  - `docker compose config` 默认配置不要求 `agent-runner`。
  - 不启用 profile 启动时，Frontend/Backend/guacd healthy，Runner 容器不存在，基础 `/api/v1/status` 与主站可访问；Runner availability 返回 unavailable 而不是导致 Backend 500/启动失败。
  - 启用 `runner` profile 后，Runner healthy，Backend 能通过认证访问 `http://agent-runner:8790/v1/availability` 并得到 `true/native/logical`。
  - honus.top 最终仍启用 Runner，线上核心服务与增强 Runner 链路均 healthy。
- **本轮实施结果**：
  1. `docker-compose.yml` 已将 `agent-runner` 改为 `profiles: [runner]`；默认 `docker compose up -d` 的服务集合只有 `guacd/backend/frontend`。
  2. Backend 已移除 `agent-runner` 的 `depends_on`，默认 `AGENT_RUNNER_URL` 为空；Runner 缺失不会阻塞 Backend health。
  3. `.env.example`、`doc/DEPLOYMENT.md`、`doc/architecture/CURRENT_ARCHITECTURE.md` 与 `doc/AGENT.md` 已统一为“Runner 可选增强能力”。
  4. 新增 `scripts/e2e/docker-core-no-runner-smoke.sh`，并在 CI 中先跑无 Runner 基础栈；现有 `docker-deployment-smoke.sh` 显式设置 `COMPOSE_PROFILES=runner`，作为 Runner 增强路径。
  5. honus.top 部署 `.env` 已设置 `COMPOSE_PROFILES=runner`，因此该实例继续启用 Runner，但产品默认配置不再强制启用。
- **验证结果**：
  - 无 Runner 隔离 smoke 已在 honus.top 实跑通过：Frontend/Backend healthy，Runner 容器未启动，主站/status/auth-setup 路由可用，`RunnerHttpAdapter.availability()` 返回 `false/runner_not_configured`，Backend 无 Runner 相关启动错误。
  - `docker compose --profile runner config --services` 包含 `agent-runner`；honus.top 真实部署在 profile 开启后四个服务均 healthy，Backend 通过正式 `RunnerHttpAdapter` 验证 availability=`true/native/logical`。
  - honus.top 公开 `https://ssh.honus.top/` 与 `/api/v1/status` 均返回 200，最近 Backend 日志无 `ECONNREFUSED` / `WORKSPACE_RUNTIME_UNAVAILABLE` 启动错误。
  - 现有 Playwright `ssh` 项目本身不配置 `AGENT_RUNNER_URL`，并包含真实 SSH terminal/quick-command execution 用例（例如 `quick-command-tags-variables.spec.ts` 明确验证 real SSH execution），因此基础 SSH/命令执行与 Runner 设计上保持独立；该完整 E2E 仍由标准 CI 执行。
- **状态**：`已修复并验证`

## P-009 模型能力未进入实际聊天运行

- 现象：聊天测试中模型无法使用预期的基础排查、SSH/命令等能力。
- 决策：先检查 AgentDefinition、Skill、Host tool catalog、Run capability snapshot 与 Provider tools 构建链路，定位断点后再修改；Runner 可选性不能影响基础工具暴露。
- 状态：已记录，待定位。

## P-010 Provider Prompt Cache 命中为 0

- 现象：连续聊天时后台观察到 Provider 的 `cached_input_tokens` / Prompt Cache 命中率始终为 0。这里的“缓存”不是 Thread/Conversation 持久化；对话记录本身已有落库。
- 用户澄清：类似 OpenAI 模型的 Prompt Caching，同一会话第二次及后续请求若存在足够长且稳定的输入前缀，应能出现 cached input。
- 决策：检查最近 `agent_model_attempts.cached_input_tokens`、Provider 模型能力/响应 usage 解析，以及 Context/Tools 在请求中的排序和稳定性；重点确认 Nexus 是否每轮重排/改变 system、历史、Skill metadata、Tool schema 等前缀导致缓存无法命中。确认断点后再修改。
- 状态：已记录，待定位。

- P-010 补充决策：OpenAI-compatible 请求使用稳定的 thread-scoped prompt cache key，帮助同一 Thread 的请求复用缓存；缓存命中数仍只采用 Provider usage 返回值，不在 Nexus 内估算。

### P-009 本轮实施与验证结果

- 已新增只读 `machine_list_connections` Tool，返回当前 App 已授权、且未被 target denylist 禁止的 SSH 连接公开元数据：`id/name/host/port/username`；不返回密码、私钥等凭据，也过滤非 SSH target。
- `machine.diagnostics.read` contribution 现在同时注册连接发现与 diagnostics；已有 `machine_execute_shell` 等工具继续使用返回的 `connectionId`。
- Nexus Agent 的稳定 system instruction 已明确：声明的 tools 即当前可用能力；任务需要环境事实或操作时，应优先调用工具，不应在工具存在时直接声称无法访问。
- 新镜像 `ghcr.io/0honus0/nexus-terminal:cap-cache-20260913` 已构建并部署。编译通过；无 Runner core smoke 继续通过，未重新引入 Runner 硬依赖。
- 编译产物级工具测试验证：`machine_list_connections` 只返回授权 SSH target，RDP 与模拟 denylist target 被过滤。
- 真实 Provider 模型 dry-run：输入“去 honus.top 分析一下系统垃圾之类的，先只分析不要删除”时，GPT-5.6 Luna 返回 `machine_list_connections {}` tool call，而不是文本声称无法访问。
- **状态**：`已修复并验证`

### P-010 本轮实施与验证结果

- `ContextService` 已调整为 cache-friendly 顺序：稳定 safety / Skill metadata 在前，append-only Ledger 历史随后，Goal/Plan/Collaboration/Recall 等易变内容后置，本轮 user input 最后。
- P-010 初版曾在 Core 使用 thread-scoped `promptCacheKey`；该厂商字段已由 P-011 进一步泛化为 `cache.scopeKey`，仅由 OpenAI-compatible adapter 映射为 `prompt_cache_key`。
- 最近历史测试 Run 在修复前 5 次约 3k input tokens，`cached_input_tokens` 均为 0。
- 真实 New API 流式 Provider probe（经 Nexus 自己的 `languageModel`，不绕过 Provider secret adapter）：完全相同 3432-token prompt 连续两次，第一次 `cachedInputTokens=0`，第二次 `cachedInputTokens=2816`，证明当前 New API 渠道能够接受 `prompt_cache_key` 并透传缓存 usage。
- 真实 append-only 多轮 probe：第一轮 `inputTokens=3956, cachedInputTokens=0`；第二轮在保留第一轮 user/assistant 上下文并追加新 user input 后，`inputTokens=3977, cachedInputTokens=3840`，同时模型正确回忆前一轮 marker `ALPHA`。
- 结论：Prompt Cache 现在可真实命中；之前的全 0 主要来自请求前缀结构/路由键不利于复用。New API 在其他渠道类型上仍可能存在流式 usage 丢失问题，但当前 `newapi.honus.top` + `gpt-5.6-luna` 路径已实测正常。
- **状态**：`已修复并验证`

## P-011 Prompt Cache 通用层不能绑定单一模型厂商

- **发现时间**：2026-09-13
- **问题**：当前缓存优化仍有厂商字段泄漏到 Core、Tool schema 在最后一步被移除、Schema 序列化可能非确定等问题。
- **决策**：Core 只实现稳定前缀、确定性 Tool/Skill schema、厂商无关 cache scope 与 tool policy、cache hashes/metrics；OpenAI breakpoint/prompt_cache_key、Anthropic cache_control、Gemini cached context 等仅由 Provider adapter/capability 层映射。
- **计划修改**：保持 Tool schema 稳定并用 auto/none 控制是否允许调用；递归 canonicalize JSON Schema；稳定排序 Skill/Tool metadata；增加 stablePrefix/toolSchema/skillMetadata hash；把现有 promptCacheKey 改为通用 cacheScope。
- **验证**：Core 不含厂商专属缓存字段；允许/禁止工具调用时 Tool schema byte-stable；重复请求 hashes 稳定；OpenAI-compatible adapter 仍能获得 cachedInputTokens。
- **本轮实施结果**：
  1. Core `ModelRequest` 已改为厂商无关 `cache: { scopeKey }` 与 `toolMode: auto|none`；`prompt_cache_key` / `tool_choice` 只存在于 OpenAI-compatible adapter。
  2. Root Agent 与 Subagent 在接近 step budget 尾部时不再删除 Tool schema，而是保持同一 schema 并切换 `toolMode=none`；这样既不允许超预算 tool call，也不破坏缓存前缀。
  3. `ToolCatalog` 使用 canonical JSON 序列化 Schema object keys，Tool 继续按 name 稳定排序；Skill metadata 继续使用稳定排序。
  4. `ContextPlan` 新增不含正文的 `stablePrefixHash`、`toolSchemaHash`、`skillMetadataHash`；Model step debug 记录这些 hash、context epoch、input/cached token 与 cache rate，用于定位 cache miss 来源。
  5. `doc/AGENT.md` 已新增 Provider-neutral Prompt Cache contract：OpenAI/Anthropic/Gemini 的显式缓存字段只能由各自 adapter/capability 层实现。
- **验证结果**：
  - Docker build `generic-cache-20260913` 通过；无 Runner core smoke 继续通过。
  - 容器 contract test 验证 Tool schema byte-stable、schema object keys canonical、`auto/none` 两次请求 tools payload 完全一致、当前 user input 变化不改变 stable/tool/skill hashes。
  - 厂商字段泄漏检查通过：`prompt_cache_key` / `tool_choice` 仅存在于 `infrastructure/agent/providers/openai-compatible.adapter.ts`；Core 只出现 `scopeKey/toolMode/cacheDiagnostics`。
  - 真实 `newapi.honus.top` 多轮 probe：第一轮 `2738 input / 0 cached`，第二轮 append-only 上下文 `2765 input / 1792 cached`，并正确回答 `ALPHA`，证明通用抽象没有破坏 Provider 缓存。
  - honus.top 已部署 `generic-cache-20260913`，Frontend/Backend/Runner/guacd 均 healthy，公开 `/api/v1/status`=200，最近部署级错误=0。
- **后续厂商适配**：OpenAI/GPT 可在 adapter capability 中加入 explicit breakpoint/diagnostics；Anthropic 映射 `cache_control`；Gemini 映射 implicit caching 或 cached-content/context cache。这些能力必须按 Provider/model capability 开关启用，不能由 Core 根据 model 名称硬编码。
- **状态**：`已修复并验证`

## P-012 Prompt Cache 命中率仍偏低，需定位首个前缀分歧点

- **发现时间**：2026-09-13
- **问题现象**：P-011 通用缓存改造上线后，真实 append-only 多轮 probe 第二轮为 `1792 cached / 2765 input`，约 64.8%。这只能证明缓存有效，不能满足“尽量高”的目标；此前相似 probe 曾达到约 96.6%，说明当前仍有可优化的前缀分歧或上游缓存粒度差异。
- **决策**：先定位真实两轮请求的首个 prefix divergence，再修改。只做厂商无关优化：稳定前缀、稳定 Tool/Skill schema、append-only history、动态 section 后置、分段 hash/token 可观测性；不为了追求命中率删除必要上下文，也不在 Core 引入 GPT/Anthropic/Gemini 专属字段。
- **计划**：对连续两轮请求按 safety/skill/history/goal-plan-collaboration/recall/current-input/tools 分段计算 token 估算与 hash，确认哪一段最先变化；随后针对该分歧做最小修改，并用真实 Provider append-only probe 对比修复前后 cached/input。
- **验收**：明确首个分歧点；真实 warm 多轮命中率显著高于当前约 65%，若受上游缓存块粒度/阈值限制则给出实测上限证据；honus.top 健康不回归。
- **状态**：`已决策，待定位`

### P-012 根因定位与新决策

- 可控 Provider 基线表明稳定前缀本身可达到约 96%~99% cached；但相同约 10k-token 前缀的第二轮存在随机 `0 cached`，固定等待时间不能稳定消除。
- New API 仅有 1 个启用 channel，上游指向 `cpa.honus.top`；CPA 当前 `routing.strategy=fill-first`、`session-affinity=false`、TTL=1h。
- CPA auth 目录当前有 31 个 credential 文件。CLIProxyAPI 的 session-affinity 会优先使用显式 `prompt_cache_key` 等会话标识，将同一 session 绑定到同一 credential，并在 credential 不可用时自动 failover。因此当前关闭 affinity 会显著增加同一 Nexus Thread 跨 credential/cache-domain 漂移的概率。
- **决策**：启用 CPA `routing.session-affinity=true`，保留 `session-affinity-ttl=1h` 与既有 failover；Nexus 继续发送厂商无关 `cache.scopeKey`，由 OpenAI-compatible adapter 映射到 `prompt_cache_key`。不在 Nexus Core 增加 credential 路由逻辑。
- **验证计划**：变更前后均使用多个全新 cache scope 做第二轮 append-only probe；比较 second-turn cache hit 的稳定性与 cached/input 比例，同时确认 CPA/New API/Nexus 均健康。

## P-013 多账号 Provider 场景缺少会话级上游 Affinity，导致 Prompt Cache 跨 credential 失效

- **发现时间**：2026-09-13
- **现象**：同一稳定前缀在多账号代理链路中会出现同样请求有时高命中、有时 `cachedInputTokens=0`。CPA 当前有多份 credential；开启代理侧 session affinity 后可明显改善，但 Nexus Core 目前只有 `cache.scopeKey`，Root 与 Subagent 还使用不同 scope，且没有单独表达“这些调用属于同一个上游亲和会话”的通用语义。
- **根因**：Prompt Cache identity 与 upstream credential/session affinity 被混成同一个概念。`scopeKey` 适合标识模型请求自身的缓存作用域，但不适合表达父子 Agent 应尽量落在同一 upstream credential；OpenAI/Codex 类协议还可能使用 session/header 参与 affinity，而这些厂商字段不应进入 Core。
- **决策**：
  1. 在通用 `ModelCacheHint` 增加 `affinityKey`，语义仅为“同一逻辑 Agent family 应尽量保持相同 upstream routing/credential”；Core 不定义具体 header/参数。
  2. Root Agent：`scopeKey=nexus:thread:<threadId>`，`affinityKey=nexus:thread:<threadId>`。
  3. Subagent：保留独立 `scopeKey=nexus:subagent:<runId>:<delegationId>`，但 `affinityKey` 继承所属 Thread，使父子 Agent 可共享 credential affinity，而缓存正文仍各自隔离。
  4. OpenAI-compatible adapter 负责把 `scopeKey` 映射为 `prompt_cache_key`；把 `affinityKey` 映射为兼容的 session affinity header，仅限该 adapter。Core 不出现 `session-id`、`prompt_cache_key`、`cache_control` 等厂商字段。
  5. Provider adapter 必须保持向后兼容：不支持显式 affinity 的 Provider 可忽略 `affinityKey`；不能根据 model 名称在 Core 中硬编码。
- **计划修改**：扩展通用 cache hint；Root/Subagent 传递共同 affinity；OpenAI-compatible adapter 增加 header 映射；补充 contract test 检查 Root/Subagent affinity 一致、scope 独立、厂商字段不泄漏、Provider 请求 header/body 正确。
- **验证方法**：TypeScript/Docker build、无 Runner smoke、adapter contract、真实 New API/CPA 多轮缓存测试，以及部署健康检查。
- **状态**：`已决策，待修改`

### P-013 实施中语义校正：OpenAI `prompt_cache_key` 应映射 affinity，而不是 content scope

- OpenAI 当前文档将 `prompt_cache_key` 定义为用于相似请求缓存优化的稳定标识/分桶键；Codex 也将它与 session identity 对齐。因此它在 Nexus 抽象里更接近 `affinityKey`，不是严格的“缓存内容命名空间”。
- New API 对自定义客户端 header 的动态透传并非通用保证；仅依赖 `session-id` 可能在中间网关被丢弃，而请求体 `prompt_cache_key` 已在当前链路实测可透传。
- **修正决策**：OpenAI-compatible adapter 使用 `affinityKey` 作为 `prompt_cache_key`，并同时发送 `session-id`；若调用方没有 `affinityKey`，才回退到 `scopeKey` 以保持兼容。`scopeKey` 继续保留为 Core 的通用内容缓存 scope，不强制 OpenAI 使用。
- **预期结果**：Root 与 Subagent 仍保留独立 `scopeKey`，但在 GPT/OpenAI-compatible 链路上共享同一 `prompt_cache_key/session-id`，从而在多 credential 代理场景共享 routing affinity，而不会把厂商语义泄漏到 Core。

## P-014 部署目录与主容器被外部清理，公网返回 502

- **发现时间**：2026-09-13
- **现象**：P-013 v2 已完成构建、部署和真实缓存验证后，源码工作树消失；随后发现 `nexus-terminal-backend`、`nexus-terminal-frontend`、`nexus-terminal-guacd` 容器也被移除，部署目录只剩备份文件与 `data.bak`，公网 `/api/v1/status` 返回 502，仅 `nexus-agent-runner` 仍在运行。
- **风险**：直接用旧 `data.bak` 恢复可能丢失 20:47 之后的聊天、Provider/Agent 配置和测试数据；同时源码/Compose 丢失会破坏后续可维护性。
- **决策**：先不覆盖任何现有备份；优先检查 Docker named volumes、残留 mount、容器层/备份时间线，寻找最新数据副本。确认数据来源后，用已验证的 `affinity-cache-v2-20260913` 镜像重建 Frontend/Backend/guacd，保留 Runner optional/profile 语义。恢复服务后再恢复源码工作树和完整文档树。
- **验证方法**：公开状态恢复 200；Backend/Frontend/guacd/Runner healthy；数据库包含最近测试 Thread/Run/Provider 数据；P-013 affinity 仍可命中；源码可重新构建同等镜像。
- **状态**：`已记录，正在恢复`

## P-015 需要独立测试环境承载后续 Nexus 问题修改，避免直接影响正式环境

- **发现时间**：2026-09-13
- **问题**：后续还需要继续修改 Nexus 缓存/Provider/Agent 等问题；直接在 `ssh.honus.top` 正式部署上验证，会把开发测试、配置试验和线上运行耦合，风险过高。
- **用户决策**：以 honus.top 当前 Nexus 运行配置为基线，在 honus.top 的 project 目录下创建一套独立测试环境；通过 Nginx Proxy Manager 新建 `test.honus.top`，测试环境配置中的公开域名统一改为 `test.honus.top`。后续问题先在测试环境修改和验证，再决定是否发布到正式环境。
- **设计决策**：
  1. 测试环境只复制“运行配置基线”，不直接复用正式环境的数据目录、容器名、宿主端口和 Compose project name。
  2. 正式环境 `ssh.honus.top` 保持不变；测试环境使用独立目录、独立 data、独立容器/网络和独立宿主 HTTP 端口。
  3. Runner 仍保持可选增强语义；测试环境是否启用 Runner，以当前正式配置为基线复制，但测试 Runner 不与正式容器冲突。
  4. `NEXUS_PUBLIC_ORIGIN` 及其它公开 Origin/域名配置统一指向 `https://test.honus.top`；不得保留 `ssh.honus.top` 作为测试环境公开 Origin。
  5. Nginx Proxy Manager 新建 `test.honus.top` Proxy Host，反向代理到测试 Nexus 的独立宿主端口，并启用与正式站相同级别的 HTTPS/WebSocket 支持。
  6. 后续源码修改仍只在 AgentDock Git 工作区进行；honus 测试目录只接收已构建镜像和运行配置，不作为源码工作区。
- **计划**：先只读检查正式 Nexus `.env` / Compose 实际状态和 honus project 目录布局；选定无冲突的测试目录与端口；复制并净化配置；创建 NPM Proxy Host；启动测试栈；验证 `https://test.honus.top/api/v1/status` 和正式 `https://ssh.honus.top/api/v1/status` 均正常。
- **验证**：测试与正式环境容器/端口/data 路径完全隔离；`test.honus.top` HTTPS 可访问且 WebSocket 代理配置正确；正式环境健康状态无回归。
- **状态**：`已决策，待实施`

### P-015 方案调整：测试环境运行配置改为同步仓库最新版本

- **用户调整**：测试环境不再继续使用 honus 正式部署目录当前的 `docker-compose.yml/.env` 作为运行配置基线；改为使用 Nexus 同步 Git 仓库的最新 `docker-compose.yml` 与环境配置模板/同步版本。
- **决策**：AgentDock Git 仓库作为测试环境运行配置的唯一来源。先同步远端最新提交，再把最新 Compose/环境模板生成测试 `.env`，只注入测试环境必要的独立值（`test.honus.top`、独立端口、独立 data/Runner 目录等）。正式环境配置只作为迁移必要密钥/数据快照的只读来源，不再复制其 Compose/.env 结构。
- **验证**：记录使用的 Git commit；测试目录的 `docker-compose.yml` 与该 commit 一致；测试 `.env` 只包含从最新模板生成并显式覆盖的测试值；正式部署文件 checksum 不变化。

### P-015 实施与验证结果

- 测试部署目录：`/home/honus/project/nexus_terminal_test`。
- 运行配置来源已按用户调整切换到同步仓库 `origin/main@3d790e4c8cac423582dadf7ed552e0919cba2cf5`；测试 `docker-compose.yml` 与该 commit 的上游文件 SHA-256 一致：`ce0a3423546afc5692ed41942a679c5c7f232e8395dfb21b784636124a379e85`。
- 测试 `.env` 从该 commit 的 `.env.example` 生成，主要独立值：`NEXUS_IMAGE_TAG=latest`、主 HTTP `18121`、Plugin listener `18122`、`NEXUS_PUBLIC_ORIGIN=https://test.honus.top`、`RP_ID=test.honus.top`、`RP_ORIGIN=https://test.honus.top`、独立 IPv6 `fd15:15::/80`。为避免同步库旧 Compose 默认误连正式 Runner，测试 override 显式设置 `AGENT_RUNNER_URL=''`。
- 隔离 override：容器为 `nexus-test-frontend/backend/guacd`，网络为 `nexus-test-network`；测试数据使用独立 `data/`。数据库由正式库通过 SQLite online backup 生成快照，`pragma integrity_check=ok`，之后不与正式环境共享写入。
- Nginx Proxy Manager 已通过其自身 internal service 创建 `test.honus.top` Proxy Host（ID 59），转发 `127.0.0.1:18121`，WebSocket upgrade 开启；独立 Let's Encrypt 证书 ID 63，CN=`test.honus.top`，到期 `2026-12-12`。
- 验证：`http://127.0.0.1:18121/api/v1/status`=200，`https://test.honus.top/api/v1/status`=200；测试 Backend/Frontend healthy。正式 `https://ssh.honus.top/api/v1/status` 同时保持 200，正式 Backend/Frontend/guacd healthy；正式 `docker-compose.yml/.env` checksum 与变更前完全一致。
- 已知基线差异：同步仓库当前仍采用独立 Plugin Frontend 端口/Origin 旧架构，因此测试 `.env` 暂时存在 `NEXUS_PLUGIN_FRONTEND_ORIGIN=http://test.honus.top:18122`；从 HTTPS 主站访问时可能出现 Mixed Content。这正是历史 P-002/P-005/P-006 类问题之一，后续应在测试环境按问题记录修复，不能把该旧设计发布到正式环境。
- **状态**：`测试环境已建立并验证；后续问题修改以 AgentDock Git + test.honus.top 为准`

## P-016 同步库 latest 回退到旧部署边界，测试环境会重现已修复的 Plugin Origin / Runner 依赖问题

- **发现时间**：2026-09-13
- **问题现象**：P-015 按用户要求使用 `origin/main@3d790e4` 作为测试环境运行配置后，确认同步库仍采用独立 Plugin Frontend Origin/宿主端口，并默认把 Backend Runner URL 指向 `host.docker.internal:8790`。在 `https://test.honus.top` 下，Plugin URL 为 `http://test.honus.top:18122`，会触发 Mixed Content；若不显式覆盖 Runner URL，还可能误连正式环境宿主 Runner。
- **与历史问题关系**：该状态重新出现 P-002/P-005/P-006 的同源 Plugin 问题，以及 P-008 的 Runner 产品边界问题。测试环境建立的目的就是在同步库最新代码上重新正式化这些修复，而不是继续依赖 honus 上曾经存在的临时源码树。
- **决策**：先恢复两项厂商无关的部署基础：
  1. Plugin/SDK 改为主站同源 `/plugins/`、`/sdk/` 路由，3002 仅作为 Compose 内部 listener，不再发布独立公网端口/Origin；保持 iframe `sandbox=allow-scripts`，Plugin route 不继承主页面 `X-Frame-Options: DENY`。
  2. Runner 恢复为可选增强能力：默认 `AGENT_RUNNER_URL` 为空，Backend 不硬依赖 Runner；Compose Runner 使用 profile 显式启用，无 Runner 时核心 UI/连接/SSH/基础命令仍可启动。
- **范围**：本轮只恢复 Plugin 同源与 Runner optional 两个基础边界；P-009～P-013 的模型能力/Prompt Cache/Affinity 在该基础验证后另行按记录实施，不混在同一补丁里。
- **计划修改**：更新 Backend runtime config/plugin descriptor/static listener、Frontend Nginx/Vite、Compose/.env.example、Docker smoke 与部署文档；增加无 Runner smoke。所有源码只在 AgentDock Git 工作区修改，随后 commit/build image，再把测试环境镜像切换到该 image。
- **验证**：TypeScript/Frontend build、架构检查；默认 Compose services 不含 Runner；无 Runner smoke；测试环境 `https://test.honus.top/sdk/frontend-v1.mjs` 和同源 `/plugins/...` 可达且无 XFO DENY/Mixed Content；正式环境不变化。
- **状态**：`已决策，待修改`

## P-017 撤销 test.honus.top 对应的 Project 测试部署目录

- **发现时间**：2026-09-13
- **用户决策**：删除 honus.top 上 `/home/honus/project/nexus_terminal_test` 测试部署目录，不再保留该 Project 测试实例文件。
- **边界**：不得修改正式部署 `/home/honus/product/nexus_terminal`、AgentDock Git 工作区或其它 Project；本次也不删除 Nginx Proxy Manager 中的 `test.honus.top` Proxy Host，除非用户另行要求。
- **计划**：先确认目标目录存在且路径精确匹配；删除该目录；确认目录不存在；最后验证正式 `https://ssh.honus.top/api/v1/status` 仍返回 200。
- **验证方法**：`/home/honus/project/nexus_terminal_test` 不存在；正式 Nexus 状态接口正常。
- **实施结果**：已先执行测试 Compose `down --remove-orphans`，随后删除 `/home/honus/project/nexus_terminal_test`。验证 `test_dir=absent`、`test_containers=none`，正式 `https://ssh.honus.top/api/v1/status` 返回 HTTP 200。Nginx Proxy Manager 中 `test.honus.top` Proxy Host 按本问题边界保留，未修改。
- **状态**：`已完成并验证`
