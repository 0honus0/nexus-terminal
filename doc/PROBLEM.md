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
- **2026-09-14 从头复核**：当前 `dev@6ae13e623bb5` 仍在 `packages/e2e/playwright.config.ts` 向 Backend 注入 `AGENT_PLUGIN_FRONTEND_ORIGIN=E2E_URLS.pluginFrontendOrigin`，且 `test-env.ts` 仍保留仅为该旧注入服务的 `pluginFrontendOrigin`。Backend 产品代码已不读取该变量，Vite 也已通过 `/plugins`、`/sdk` 同源代理访问 3002，因此这是测试配置残留，但与本问题“Playwright 不再注入独立 Plugin Origin”的验收不一致。
- **本轮修复计划**：删除 Playwright 的 `AGENT_PLUGIN_FRONTEND_ORIGIN` 注入，并删除不再使用的 `E2E_URLS.pluginFrontendOrigin`；保留 `AGENT_PLUGIN_FRONTEND_PORT` 作为 Backend 内部静态 listener 端口，以及 Vite 对 `/plugins`、`/sdk` 的内部代理。
- **2026-09-14 本轮实施与验证**：已删除 Playwright Backend env 中的 `AGENT_PLUGIN_FRONTEND_ORIGIN` 和不再使用的 `E2E_URLS.pluginFrontendOrigin`；保留 `AGENT_PLUGIN_FRONTEND_PORT` 作为内部 listener。全仓库定向搜索已无上述旧变量/URL 引用，`pnpm --filter @nexus-terminal/e2e test:list` 成功加载 Playwright 配置并发现 233 个测试，说明配置可解析。
- **状态**：`已修复并完成配置级验证；完整 Docker/E2E 仍由后续总回归执行`

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
- **2026-09-14 从头复核**：当前 `dev@6ae13e623bb5` 的 `scripts/e2e/docker-deployment-smoke.sh` 又回到了“宿主机直接启动 Runner + Backend 指向 `http://host.docker.internal:<随机端口>`”的旧编排；脚本没有启用 `runner` profile，也没有使用 Compose 内的 `agent-runner`。这与 P-008 的最终产品语义不冲突于“Runner 可选”，但与本条保留的增强路径验收以及 P-008 已记录的“deployment smoke 显式启用 Runner profile”不一致。
- **本轮修复计划**：保留 `docker-core-no-runner-smoke.sh` 作为基础栈验证；将 `docker-deployment-smoke.sh` 恢复为显式 `COMPOSE_PROFILES=runner` 的增强路径，使用本次 CI 已构建的 `nexus-agent-runner:e2e-smoke` 镜像、唯一容器名和临时 Runner data 目录，Backend 通过 `http://agent-runner:8790` 访问。仅保留后半段 corrupt-journal 等明确的 host-runner 专项故障注入进程。
- **2026-09-14 本轮实施**：`docker-deployment-smoke.sh` 已恢复为显式 `--profile runner` 的增强路径；Backend 固定通过 Compose DNS `http://agent-runner:8790` 访问 Runner，Runner 使用本轮 CI 已构建的独立镜像（默认 `nexus-agent-runner:e2e-smoke`）、带 suffix 的唯一容器名和 smoke 临时 data 目录。主流程已删除宿主 Runner 的随机端口/进程；Browser Runner tunnel probe 同步改为 `host.docker.internal` 并对 Backend/Runner 显式增加 `host-gateway`，避免容器内 `127.0.0.1` 误指向自身。后半段 corrupt-journal host Runner 专项故障注入继续保留。
- **2026-09-14 本轮验证**：`bash -n scripts/e2e/docker-deployment-smoke.sh` 通过；静态断言确认主流程已无 `runner_port/runner_pid/runner_log`，并存在 `--profile runner`、`AGENT_RUNNER_URL=http://agent-runner:8790`、独立 Runner image/data/container 配置。当前 AgentDock 容器没有 Docker CLI；honus 宿主实测 Docker 29.8.0 / Compose 5.5.1 可用，但仍没有 Node/pnpm，因此不能在该宿主完整执行此 repository smoke。完整 Docker smoke 保留给标准 CI 总回归。
- **状态**：`代码已修复并完成脚本级验证；完整 Docker smoke 待标准 CI 总回归`

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
- 状态：`2026-09-14 已通过 P-019 恢复并重新验证；当前 Host Tool catalog 已重新包含只读连接发现能力。`

## P-010 Provider Prompt Cache 命中为 0

- 现象：连续聊天时后台观察到 Provider 的 `cached_input_tokens` / Prompt Cache 命中率始终为 0。这里的“缓存”不是 Thread/Conversation 持久化；对话记录本身已有落库。
- 用户澄清：类似 OpenAI 模型的 Prompt Caching，同一会话第二次及后续请求若存在足够长且稳定的输入前缀，应能出现 cached input。
- 决策：检查最近 `agent_model_attempts.cached_input_tokens`、Provider 模型能力/响应 usage 解析，以及 Context/Tools 在请求中的排序和稳定性；重点确认 Nexus 是否每轮重排/改变 system、历史、Skill metadata、Tool schema 等前缀导致缓存无法命中。确认断点后再修改。
- 原始状态（历史）：已记录，待定位。

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
- **2026-09-14 从头复核**：当前 `dev@6ae13e623bb5` 已丢失本节所述实现。`ContextService` 当前顺序实际为 safety → goal/plan/collaboration → ledger → recall → skill metadata → current input，Skill metadata 没有位于稳定前缀；`ModelRequest` 也没有 cache hint，OpenAI-compatible adapter 不发送 `prompt_cache_key`。因此历史“已修复”只代表曾经验证过的丢失工作树/镜像，不代表当前 Git。
- **2026-09-14 本轮恢复**：当前 `dev` 已重新恢复 cache-friendly Context 顺序（稳定 safety / Skill metadata 在前，append-only Ledger history 随后，动态 Goal/Plan/Collaboration/Recall 后置，本轮 user input 最后），并恢复 provider-neutral `ModelRequest.cache.scopeKey`。OpenAI-compatible adapter 仅在 adapter 层将 `affinityKey ?? scopeKey` 映射为 `prompt_cache_key`，Core 不出现厂商字段。
- **本轮验证**：Backend `build` 与 431-file `check:architecture` 通过；本地假 Provider 对编译产物做真实 HTTP contract 捕获，确认请求体包含 `prompt_cache_key=thread-1`、`tool_choice=none`，请求头包含 `session-id=thread-1`，Provider 返回的 `cached_tokens=1024` 被解析为 `cachedInputTokens=1024`。同一测试 Provider 的开发库近期真实 Agent attempts 已多次记录 `cached_input_tokens=2560/3584`，证明 Provider usage 链路可命中并落库；本轮另一个新 scope 的两次 2740-token 外部 probe 均为 0，按 P-012/P-013 继续作为多 credential/upstream affinity 稳定性问题处理，不再归因于 P-010 的字段缺失。
- **状态**：`2026-09-14 已重新恢复并验证；随机 cache miss 转 P-012/P-013 继续处理`

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
- **2026-09-14 从头复核**：当前 Git 同样缺失本节实现：`ModelRequest` 只有 messages/tools/maxOutputTokens，没有 `cache.scopeKey` / `affinityKey` / `toolMode`；Root 在 step budget 尾部仍直接把 `offeredTools` 变成空数组，Subagent 也会删除 tools；`ToolCatalog` 没有 schema canonicalization；`ContextPlan` 不含 `stablePrefixHash/toolSchemaHash/skillMetadataHash`；OpenAI-compatible adapter 不含 `prompt_cache_key` 或 affinity header。`git log --all -S` 对这些符号均无提交命中，说明历史实现未进入当前 Git 历史。
- **2026-09-14 本轮重新验证**：当前工作树已恢复 provider-neutral `cache.scopeKey/affinityKey`、`toolMode=auto|none`、Root/Subagent 稳定 Tool schema、递归 schema canonicalization 与 `stablePrefixHash/toolSchemaHash/skillMetadataHash` diagnostics。厂商字段扫描确认 `prompt_cache_key/session-id` 只存在于 OpenAI-compatible adapter；真实 SSH Agent Run 连续 4 次 model attempt 的 stable/tool/skill 三类 hash 完全一致，证明运行时 schema/Skill metadata 未随机重排。Backend build 与 431-file architecture check 再次通过。
- **状态**：`2026-09-14 已重新恢复并验证；后续命中率问题转 P-012/P-013`

## P-012 Prompt Cache 命中率仍偏低，需定位首个前缀分歧点

- **发现时间**：2026-09-13
- **问题现象**：P-011 通用缓存改造上线后，真实 append-only 多轮 probe 第二轮为 `1792 cached / 2765 input`，约 64.8%。这只能证明缓存有效，不能满足“尽量高”的目标；此前相似 probe 曾达到约 96.6%，说明当前仍有可优化的前缀分歧或上游缓存粒度差异。
- **决策**：先定位真实两轮请求的首个 prefix divergence，再修改。只做厂商无关优化：稳定前缀、稳定 Tool/Skill schema、append-only history、动态 section 后置、分段 hash/token 可观测性；不为了追求命中率删除必要上下文，也不在 Core 引入 GPT/Anthropic/Gemini 专属字段。
- **计划**：对连续两轮请求按 safety/skill/history/goal-plan-collaboration/recall/current-input/tools 分段计算 token 估算与 hash，确认哪一段最先变化；随后针对该分歧做最小修改，并用真实 Provider append-only probe 对比修复前后 cached/input。
- **验收**：明确首个分歧点；真实 warm 多轮命中率显著高于当前约 65%，若受上游缓存块粒度/阈值限制则给出实测上限证据；honus.top 健康不回归。
- **原始状态（历史）**：`已决策，待定位`

### P-012 根因定位与新决策

- 可控 Provider 基线表明稳定前缀本身可达到约 96%~99% cached；但相同约 10k-token 前缀的第二轮存在随机 `0 cached`，固定等待时间不能稳定消除。
- New API 仅有 1 个启用 channel，上游指向 `cpa.honus.top`；2026-09-14 当前 CPA 实际运行配置已确认是 `routing.strategy=fill-first`、`session-affinity=true`、TTL=`1h`，容器内 bind-mounted config 与宿主配置一致。历史备份 `config.yaml.pre-cache-affinity-*` 记录了此前 `session-affinity=false` 的基线。
- CPA auth 目录当前有多份 credential。CLIProxyAPI 的 session-affinity 会从 Codex/session 类标识或消息哈希提取 session，并在 bound auth 不可用时自动 failover；因此它理论上可降低同一 Nexus Thread 跨 credential/cache-domain 漂移，但不能代替 prompt 前缀稳定性。
- **2026-09-14 决策校正**：先不把随机 cache miss 归因于 credential 漂移，也不先启用 CPA `routing.session-affinity`。Codex 当前实现与官方工程说明都把“旧 prompt 必须是新 prompt 的精确前缀”、稳定 tools/顺序、稳定 model/sandbox/approval/CWD 作为首要缓存条件；Codex 默认使用稳定 session identity 作为 `prompt_cache_key`，并独立发送 session/thread identity。P-012 因此先做逐段/逐字节前缀 diff 与 hash 诊断，只有证明 Nexus 请求前缀完全稳定而 cache miss 仍与上游身份切换相关后，才进入 P-013 的代理 affinity 变更。
- **2026-09-14 逐 message 真实诊断**：新增仅记录 `index/role/hash/estimatedTokens` 的 message diagnostics，不记录 prompt 正文。真实同 Thread 两轮纯文本 probe 中，第一轮 messages 为 `[system#A, system#B, user#C]`；第二轮前 3 个 message 的 role/hash 与第一轮逐条完全一致，之后才 append `assistant#D, user#E`。同时 `stablePrefixHash/toolSchemaHash/skillMetadataHash`、model、toolMode、thread-scoped `prompt_cache_key/session-id` 均不变，但两轮分别为 `3119/0 cached` 与 `3163/0 cached`。这证明本次 miss 不存在 Nexus 侧首个 message-prefix divergence，问题已收敛到 Provider/协议/上游 cache accounting 或 routing 行为。
- **2026-09-14 协议对照**：通过 Nexus 开发库已加密保存的同一 Provider credential 做一次性只读协议探针（credential 未输出/未落盘）。约 10k-token 完全相同稳定前缀下，`/responses` 两次为 `10057/0 -> 10057/8960 cached`，`/chat/completions` 同样为 `10057/0 -> 10057/8960 cached`。因此当前 New API 链路上 Chat Completions 与 Responses 都能达到约 89.1% 的第二次缓存命中，不能把 Nexus 的随机 miss 归因于“没有使用 Codex Responses API”。
- **2026-09-14 CPA A/B（最终复核）**：确认测试前 CPA 已经是 `session-affinity=true`，不是历史记录里的 false。先保留该状态作为 A 基线；随后对配置做带时间戳备份，短时切到 `false`、重启 CPA，并通过真实 Nexus Agent Thread 做 3 组全新两轮 append-only probe。`false` 时三组第二轮分别为 `3154/2560 cached`、`3154/0 cached`、`3154/2560 cached`，即 2/3 仍可命中；恢复 `true` 后，真实 Thread 既出现 `3154/2560 cached` 命中，也已有本节逐 message 完全稳定的 `3163/0 cached` 反例。测试结束后 CPA 已恢复原始 `session-affinity=true`，备份 `data/config.yaml.ab-20260914-010856.bak` 保留。
- **2026-09-14 最终 Provider payload 与下游归因**：开发态 OpenAI-compatible adapter 曾在实际 HTTP send 边界短时抓取最终 `/v1/chat/completions` body（Authorization 永不记录，production 强制禁用）。真实 Probe 2 的第二轮为 `3148 input / 0 cached`，但两轮最终请求的前三条 message SHA-256 逐项完全相同、`toolsSha256` 完全相同、除 messages 外 `staticRequestSha256` 完全相同，且同 Thread 的 `prompt_cache_key` / `session-id` 不变；第二轮仅 append assistant + user。New API 也记录两轮均走 channel 10，cache_tokens 为 `0 -> 0`。CPA 随后短时启用 debug，另一个真实 miss 组 `3117/0 -> 3150/0` 的两轮明确选中了同一个匿名化 Codex credential，没有 failover/rebind。测试后 CPA 已恢复 `debug:false`、`request-log:false`；完整 Provider body trace 代码与 `/tmp` trace 均已删除，只保留 hash/token 级运行时 diagnostics。
- **2026-09-14 独有历史与随机 cache-domain 复现**：短请求固定 `2560 cached` 主要来自跨 Thread 共用的稳定 system/tool 前缀，不能作为 conversation-history 命中标准。改用首个 user message 自开头即带唯一 marker 的长历史后：L1 `5276/2560 -> 5308/4608`，L2 `4489/2560 -> 4518/3584`，证明同 Thread 独有历史可以正确进入缓存；L3 `4489/0 -> 4518/2560 -> 4549/3584`；L4 则连续出现 `4244/2560 -> 4273/2560 -> 4304/0 -> 4331/3584 -> 4358/3584 -> 4385/0 -> 4412/2560`。这些请求的旧 history/hash 始终 append-only，说明同一逻辑 Thread 可在公共前缀、独有历史前缀和完全 miss 之间来回切换，固定等待 6 秒或 20 秒都不能稳定消除。
- **2026-09-14 传输层对照**：当前 OpenAI Codex 主干的 OpenAI provider 使用 Responses API，并支持持久 Responses WebSocket；turn session 会复用连接、缓存增量请求状态，并维护 `x-codex-turn-state` sticky-routing token，v2 还支持 prewarm/`previous_response_id`。本机 New API 为 `v1.0.0-rc.36`；对 `GET /v1/responses` 做未认证 WebSocket Upgrade 实测返回 `404 Invalid URL`，因此当前 Nexus → New API → CPA 链不能直接采用 Codex 同款 Responses WebSocket transport。HTTP `/v1/responses` 与 `/v1/chat/completions` 均已证明可以缓存，但都不能提供 Codex WebSocket 的连接级 sticky-routing 语义。
- **2026-09-14 GPT-5.6 显式缓存边界实验决策**：OpenAI 当前 GPT-5.6+ 支持 `prompt_cache_options`，并允许在 Chat Completions content part 上设置 `prompt_cache_breakpoint`；这与 Claude/Anthropic 通过显式 cache boundary 管理稳定前缀的思路更接近。为验证当前 Nexus → New API → CPA 链是否能够真正利用该能力，本轮只在 OpenAI-compatible infrastructure adapter 做默认关闭的开发态实验，不修改 Core `ModelRequest/ModelCacheHint`。实验形态为最后一个连续 leading system message 加 explicit breakpoint，并用 `prompt_cache_options={mode:'implicit',ttl:'30m'}` 保留 GPT-5.6 后续历史的自动 breakpoint。
- **2026-09-14 显式 breakpoint 实验结果**：本地 loopback fake Provider 的真实 HTTP contract 已确认 OFF 时 wire format 完全不变，ON 时最终 JSON 正确携带 `prompt_cache_options.mode=implicit/ttl=30m`，且仅最后一个 leading system text part 带 `prompt_cache_breakpoint={mode:'explicit'}`。开发 New API/CPA 实测请求没有 400，真实两轮为 `3114/0 -> 3143/2560 cached`；但精确检查当前 CPA `v7.2.155` 对应 commit `7fac6b1` 后确认该能力**不会到达 Codex upstream**：Chat Completions→Codex translator 从空对象重新构造输出，未映射顶层 `prompt_cache_options`；对 `content[type=text]` 也只重建 `type/text`，不会复制 `prompt_cache_breakpoint`。同版本 Responses translator 更明确主动删除 `prompt_cache_options` 并 strip nested breakpoint，以兼容会拒绝这些字段的 Codex OAuth upstream。结论是当前链路上的 200 来自代理过滤而非上游支持；该实验代码已撤回，不保留无效 capability，也不把 GPT 专属字段加入 Core。
- **2026-09-14 `prompt_cache_key` 分桶策略 A/B 决策**：OpenAI 当前把 `prompt_cache_key` 定义为帮助相似请求缓存/分桶的稳定标识，并建议在需要时按用户/客户隔离；CLIProxyAPI 近期 GPT-5.6/Codex 实例也报告“每会话高基数 key”会把相同前缀分散到不同上游 cache routing 节点。Nexus 当前 `prompt_cache_key=affinityKey ?? scopeKey`，Root 即每 Thread 一个唯一 key，而 `session-id=affinityKey` 已单独承担 CPA credential affinity。为验证是否存在过度分桶，本轮保持 `session-id` 不变，只在 OpenAI-compatible adapter 做开发态 A/B：A 继续 thread key；B 用 `SHA-256(userId, providerId, modelId, leading system messages, stable tools)` 生成用户隔离的 stable-prefix key。Core 不新增厂商字段。真实测试使用组内完全相同、组间不同的长 user payload；把固定公共 system/tool 的约 `2560 cached` 与更长的组内独有缓存区分开，以避免短 probe 的公共前缀误判。
- **2026-09-14 `prompt_cache_key` A/B 结果与最终决策**：thread-key 基线使用 6 个 fresh Thread、完全相同的 10029-input-token 长首轮请求，cached 依次为 `[0,2560,0,0,2560,2560]`，排除每组第一条冷启动后 `0/5` 次复用该组新增长前缀；stable-prefix B 组 6 个 fresh Thread 为 `[0,10752,10752,10752,0,10752]`，后续 `4/5` 次复用约 95.8% 输入。反向 crossover 再用等长请求复核：thread-key `[2560,0,0,0]`，stable-prefix `[2560,8704,8704,0]`，输入均为 9726 tokens，后续分别 `0/3` 与 `2/3` 次复用组内长前缀。两轮合计排除冷启动后，thread-key `0/8` 次出现组内长前缀复用，stable-prefix `6/8` 次；stable-prefix 仍偶发 0，说明它显著改善 cache-domain/routing 稳定性但不能消除上游随机 miss。精确 CPA `7fac6b1` 代码进一步确认：OpenAI Chat Completions 路径优先把 caller 的显式 `prompt_cache_key` 用作 `cache.ID` 并写入 Codex upstream body；`cacheHelper()` 也会先设置 `Session-Id=cache.ID`，但后续 header source 可覆盖该值，最终优先级见后文 `Session-Id` 校正。因此该 A/B 可以确认改变了 body cache key / `cache.ID`，但不能再声称最终 upstream `Session-Id` 也必然随之改变。最终保留策略为：OpenAI-compatible adapter 默认使用 `SHA-256(userId, providerId, modelId, leading system messages, stable tools)` 的用户隔离 stable-prefix key 作为 `prompt_cache_key`；Nexus→CPA HTTP `session-id` 继续使用 `affinityKey`，单独承担 Thread/agent-family credential affinity。Core contract 不新增厂商字段。
- **2026-09-14 默认实现最终复测**：移除实验环境开关、让 stable-prefix key 成为普通开发 Backend 的默认路径后，再以 4 个 fresh Thread 发送完全相同的 7920-input-token 首轮请求，结果为 `[2560,7680,7680,7680]`；排除第一条后 `3/3` 都复用约 97.0% 输入，证明收益不是实验开关、单次热窗口或临时配置造成。同期单个同 Thread 两轮长历史 probe 为 `9096/2560 -> 9131/2560`，仍可出现只命中公共前缀的上游 miss，因此不把 stable-prefix 描述成充分修复。
- **2026-09-14 `instructions` vs `input` developer message 结构 A/B 决策**：stable-prefix key 已显著改善跨 Thread 长前缀复用，但仍有偶发完整 miss。当前 CPA Chat Completions→Codex translator 会把 Nexus leading `system` message 转成 Responses `input` 数组中的 `developer` message；其源码中“提取首个 system 到顶层 `instructions`”的逻辑处于注释状态。Codex 自身的 Responses 请求则明确区分稳定 `instructions` 与会话 `input`。下一步仅做开发态 protocol A/B：A 保持现有 `/chat/completions`；B 由 OpenAI-compatible adapter 直接调用 `/responses`，把连续 leading system 内容稳定合并到顶层 `instructions`，其余 user/assistant/tool history 映射到 `input`，tools、stable-prefix `prompt_cache_key` 与 Nexus→Provider `session-id` 保持等价。实验结论前不改变 production 默认路径，也不修改 Core `ModelRequest/Context`。
- **2026-09-14 Responses + instructions 初测与 session-key 决策**：本地 loopback contract 已确认 `/responses` wire format、`instructions/input` 分离、SSE text/usage/completed 解析以及 `session-id` 保留均正确；真实 New API→CPA→Codex smoke 也成功。随后使用 DB-gated 严格串行 6 轮会话测试，`Responses + instructions + stable-prefix prompt_cache_key` 得到 `4222/2560 -> 4259/2560 -> 4296/2560 -> 4333/3584 -> 4370/3584 -> 4407/3584`，说明结构调整本身没有复现原生 Codex 的约 98% warm-session 命中。对照用户同链路原生 Codex `/v1/responses` 6 轮为 `20282/0 -> 20326/19968 -> 20359/19968 -> 20392/19968 -> 20425/19968 -> 20458/19968`，warm 5/5、加权约 97.92%。Codex 原生把 `prompt_cache_key=session_id`；当时基于 CPA `cacheHelper()` 的局部逻辑，曾假设显式 `prompt_cache_key` 也会成为最终 Codex upstream `Session-Id`，但该假设后来被 header source 优先级复核校正（见后文）。因此这一阶段的 A/B 只能视为对 body cache key/session identity 组合的探索，不能单独证明最终 upstream `Session-Id` 取值。Chat Completions 仍保持已验证的 stable-prefix 策略。
- **2026-09-14 Responses session-key 反例与 CPA `image_generation` 排除**：把 Responses 的 `prompt_cache_key` 临时切成 Thread/session affinity 后，严格串行 6 轮为 `4095/0 -> 4127/3584 -> 4159/3584 -> 4191/0 -> 4223/3584 -> 4255/3584`，Keeper 与 Nexus DB 完全一致；因此 session key 能快速达到约 3.5k cached，但不能消除整段 miss。继续核对精确 CPA 运行配置发现 `disable-image-generation: false`；CLIProxyAPI 当前 Codex executor 确实会在该模式下按所选 Codex auth 的 `plan_type` 决定是否向最终 upstream `tools` 注入 `image_generation`，公开源码/issue 也有同一 `prompt_cache_key` 因 free/非-free auth 造成 tools 前缀差异、缓存掉 0 的复现。但 Keeper 对本次 E 组做匿名 credential 归因后确认 6 轮全部落在同一个 Codex OAuth credential（无 failover/rebind），所以第 4 轮完整 miss 不能由跨 plan 的 image tool 注入解释；本轮不改 CPA `disable-image-generation` 配置。
- **2026-09-14 Codex turn metadata A/B 决策**：当前 OpenAI Codex 主干 `ModelClient::responses_session_id` 已明确注释“ChatGPT derives cache affinity from the Responses session-id header”，Root 默认令 `session-id=prompt_cache_key`，而把真实 `session_id/thread_id/turn_id` 放进 `client_metadata` / `x-codex-turn-metadata`。这一阶段据此曾把“stable-prefix `prompt_cache_key` 同时成为 upstream cache-affinity `Session-Id`”作为工作假设，并把剩余差异收敛到 conversation identity metadata；后续精确检查 CPA header source 优先级后已确认该工作假设不适用于当前 Nexus→New API→CPA 实际 wire，最终语义见后文 `Session-Id` 覆盖优先级校正。精确 CPA `7fac6b1` 又会保留 OpenAI Responses body 的 `client_metadata`，并从下游转发 `X-Codex-Turn-Metadata`、`Thread-Id`、`X-Client-Request-Id` 等兼容 header。因此下一轮只在开发态 Responses 路径增加最小 Codex-compatible metadata：`client_metadata.session_id=affinityKey`、`client_metadata.thread_id=scopeKey`，以及等价的 `x-codex-turn-metadata` JSON（不包含 prompt 正文；turn id 由 request message hashes 确定性派生），同时继续用 stable-prefix key 作为 `prompt_cache_key`。若真实串行长会话完整 miss 不下降则撤回，不把这些字段加入 Core。
- **2026-09-14 Codex turn metadata A/B 反例**：E 组为 Responses + affinity/session cache key、未加 Codex turn metadata，6 轮为 `4095/0 -> 4127/3584 -> 4159/3584 -> 4191/0 -> 4223/3584 -> 4255/3584`。随后 F/G/H 在同一开发链路启用最小 `client_metadata` / `x-codex-turn-metadata`，Keeper 又确认命中与异常轮均使用同一 Codex OAuth credential；其中 F 的长历史序列出现 `9155/2560 -> 15237/8704 -> 21319/14848 -> 21351/2560 -> 21383/20992 ...`，H 也出现 `8956/2560 -> 14839/8704 -> 20722/2560 -> 20754/19968 ...`。因此 metadata 可以与高缓存共存，但仍不能消除从独有长历史命中突然退回公共前缀级别的断崖；它不是充分修复。当前用户又确认相关请求均在同一认证信息中，且当前场景不触发图像生成，所以本轮停止沿 credential 切换或 `image_generation` 方向排查，继续只比较最终 Codex upstream 的非图像 tools 与 identity/metadata。
- **2026-09-14 最终 Codex upstream tools/identity 复核**：精确检查 CPA `v7.2.155` / commit `7fac6b1` 的 HTTP Responses executor 后，当前同一 Codex auth 下没有找到会在相邻 turn 随机改变最终非图像 tools 或 identity 的分支。`codex.identity-confuse` 当前未启用；reasoning replay 对 OpenAI Responses source 直接关闭；MultiAgentV2 只对官方 Codex User-Agent 生效，Nexus Node HTTP client 不满足；`NormalizeCodexToolSchemas` 是确定性归一化。用户再次确认异常轮与命中轮都落在同一个认证信息中，并明确当前场景不触发图像生成，因此本轮停止沿 credential 切换与 `image_generation` 方向继续排查。
- **2026-09-14 无 metadata 仍可 `hit -> miss -> hit`**：为了排除 turn metadata 自身，直接用开发库同一 Provider credential 做严格串行 `/responses + instructions + stable-prefix` 长前缀探针，并关闭 Codex metadata。8 轮为 `10552/0 -> 10573/9728 -> 10594/9728 -> 10615/9728 -> 10636/9728 -> 10657/0 -> 10678/9728 -> 10699/9728`。第 6 轮完整 miss 后下一轮立即恢复；该组没有 `client_metadata.thread_id/turn_id/x-codex-turn-metadata` 可漂移，因此额外 conversation identity 不是随机 miss 的必要条件。随后 metadata=ON 的 12 轮又在第 5/9 轮出现 `9956/0`、`10040/0`，其余 warm 为 `9728`，进一步证明 metadata 也不是充分修复。
- **2026-09-14 upstream `Session-Id` 覆盖优先级校正**：此前文档把“CPA 以 body `prompt_cache_key` 作为 `cache.ID` 后，最终 upstream `Session-Id` 也必然等于该 key”写得过强。精确源码显示 `cacheHelper()` 确实先设置 `Session-Id=cache.ID`，但随后 `applyCodexHeadersFromSources()` 调用 `misc.EnsureHeader()`，而该函数的优先级是 **下游 source header > 已有 target header > default**。因此只要 Nexus→New API→CPA 的 `session-id=affinityKey` 被转发到 CPA，最终 Codex HTTP wire 实际就是 body `prompt_cache_key=<stable-prefix>`、header `Session-Id=<affinityKey>`。2026-09-11 的 openai/codex #44716 也用受控实验表明 HTTP/WebSocket `session-id` 会独立影响 reported cache reuse，但稳定 identity 仍不能保证命中。
- **2026-09-14 `prompt_cache_key == Session-Id` 对齐反例**：基于上述优先级，只改开发探针的下游 `session-id`，令最终 upstream body `prompt_cache_key` 与 HTTP `Session-Id` 都等于同一个 stable-prefix key，其余请求保持不变。12 轮为 `7832/0 -> 7853/7680 -> 7874/0 -> 7895/7680 -> 7916/7680 -> 7937/7680 -> 7958/7680 -> 7979/7680 -> 8000/7680 -> 8021/7680 -> 8042/7680 -> 8063/7680`。第 3 轮仍完整 miss，因此“让两者相等”也不是充分修复；不再继续做 key/header 排列组合。
- **2026-09-14 `X-Codex-Turn-Metadata` HTTP header 窄 A/B 反例**：CPA 会保留 Responses body 的 `client_metadata["x-codex-turn-metadata"]`，但不会从该 body 字段自动合成同名 HTTP header；当前原生 Codex 同时生成 canonical body metadata 与兼容 header。为只验证这一差异，本地开发 Responses 路径短时把完全相同的 turn metadata JSON 额外放入 `X-Codex-Turn-Metadata`，其余 stable-prefix key、`session-id=affinityKey`、tools 均不变。沿已有约 20k-token H 长历史严格顺序续轮得到 `20841/19968 -> 20863/19968 -> 20885/13824 -> 20907/19968`；Keeper 确认四轮全部使用同一个匿名 auth index，缓存仍可从约 95.7% 突降到约 66.2% 后立即恢复。结合 metadata ON 严格串行仍有完整 `0` 且同样保持该 auth 的既有反例，该兼容 header 不是充分修复；实验代码已撤回，不保留新的 identity header。
- **2026-09-14 `x-codex-routing-hint` parity 缺口**：当前 OpenAI Codex 主干在 Responses HTTP/WebSocket 请求上发送 `x-codex-routing-hint`，由有效 model（以及可选 service tier）构造，用于 Codex backend routing；`x-codex-turn-state` 则明确只属于单个 turn 内的重试/增量 sticky routing，不能跨 turn 复用。运行中的 CPA `v7.2.155 / 7fac6b1` 完全没有 `x-codex-routing-hint` 处理；进一步复核当前 CLIProxyAPI main，WebSocket native passthrough 已识别该 header，但 HTTP/SSE `applyCodexHeadersFromSources()` 仍没有透传或重建它。因此当前 Nexus→New API→CPA→Codex HTTP Responses 链与原生 Codex 存在一个明确的 backend-routing contract 差异。由于当前约束是不修改 production CPA，而 Nexus 单独发送该 header 会在 CPA HTTP 路径被丢弃，本轮无法对这个差异做有效 live A/B；现阶段把它记录为最值得后续在代理测试环境验证的候选，而不是已证明根因。
- **阶段性结论（已被后续 no-caller-key 隔离实验修正）**：stable-prefix `prompt_cache_key` 相比 per-Thread key 的 A/B 确实显著改善了跨 Thread 相同长前缀复用，因此它证明了“高基数 Thread key 会破坏 cache grouping”；但它并没有证明“由 Nexus 显式生成一个更好的 `prompt_cache_key`”是最终架构。后续更强的隔离实验见下一节。
- **状态**：`2026-09-14 继续由 no-caller-key 长会话隔离实验收敛最终模型调用架构`

### P-012 终局校正：缓存优化从 key/header 组合转向 canonical model input

- **最强隔离证据 1：CPA 标准 session / Chat-style，不传 caller `prompt_cache_key`。** 使用约 21k-token 的完整长历史严格串行 12 轮，得到 `20985/2560 -> 21016/19968 -> 21047/19968 -> 21078/19968 -> 21109/20992 -> ... -> 21326/20992`（`input/cached`）。除首轮身份/序列化切换造成的冷启动外，warm `11/11` 全部非零，稳定阶段约 98%~99% 输入来自缓存。说明深层长历史缓存并不依赖 Nexus 主动提供 `prompt_cache_key`。
- **最强隔离证据 2：同一 Responses `instructions + input`，只去掉 caller `prompt_cache_key`。** 保持已有 `session-id=affinityKey` 行为不变、关闭额外 Codex metadata，严格串行 12 轮为 `21344/0 -> 21359/20992 -> 21378/20992 -> ... -> 21549/20992`。warm `11/11` 均为 `20992 cached`，约 97.4%~98.3%。因此 **Responses 协议本身不是问题，`instructions + input` 结构也不是问题；显式 caller `prompt_cache_key` 才是两组行为的关键差异**。
- **CPA 语义复核**：精确版本 `7fac6b1` 中，caller body 带 `prompt_cache_key` 时，CPA 会优先把它纳入自己的 `cache.ID`；caller 不提供时，CPA 可由标准 session/provider metadata 派生自己的 provider-scoped cache/session identity。此前所有 stable-prefix/per-Thread key A/B 仍是有效历史证据，但最终结论改为：**Nexus 不应越过 Provider/CPA 去拥有 Codex cache identity。**
- **最终边界**：Nexus 负责 `deterministic + stable-prefix-first + append-oriented` 的模型正文；Provider/CPA 负责 cache/session identity 与上游 routing。OpenAI-compatible adapter 的普通调用路径不再生成或发送 `prompt_cache_key`，也不再注入 `client_metadata` / `x-codex-turn-metadata` / `thread-id` / `x-client-request-id` 等缓存实验字段。现有 provider-neutral `affinityKey` 到 `session-id` 的映射暂时保留，只表达既有 Thread/agent-family routing hint；没有证据支持继续新增 header 排列组合。
- **Core canonical input contract**：`ModelRequest` 现在显式分成 `instructions[] + messages[] + tools[]`。`instructions` 只放高稳定内容（当前为 safety 与签名 Skill metadata）；历史 ledger/tool roundtrip 保持原始时间顺序；本轮 user input 放在历史之后；goal/plan/collaboration/recall 等 run/turn 级易变 snapshot 放到尾部。这样“上面不变、变化内容在下面”不再只是 adapter 偶然重排，而成为 Core 的正式输入结构。
- **预算优先级同步校正**：不仅最终序列稳定，token budget 也先保 safety/current-input 必需空间，再优先保稳定 Skill metadata，再保 conversation history，最后才尝试加入 goal/plan/collaboration/recall。避免出现“Skill metadata 最后才分预算、上下文一长就从顶部突然消失”的 cache-invalidating 行为。
- **Tool schema 与 tool history**：Tool schema 继续确定性 canonicalize/稳定排序；达到 step budget 时不再删除 schema，而用 `toolMode=none` 禁止调用，避免 tool 列表本身在相邻 turn 抖动。`assistant tool_call -> tool_result -> assistant` 保留原始 chronology；已用真实 `machine_list_connections` roundtrip 验证，不需要把历史 tool 结果折叠/重写成新的 system summary。
- **Chat / Responses 双协议正式化**：两种协议共享完全相同的 Core canonical input，只在 infrastructure adapter 最后一跳序列化。Chat Completions = `instructions[]` 依次变成 leading `system` messages，再追加同一 `messages[]`；Responses = `instructions[]` 稳定合并到顶层 `instructions`，同一 `messages[]` 映射为 `input`（尾部动态 system 在 Responses 中映射为 `developer`）。不再存在仅开发态 `responses-instructions` 分叉逻辑。
- **切换粒度**：协议是 **Provider 配置**，不是全局进程环境变量。`openai-compatible` Provider 可选择 `chat-completions` 或 `responses`，配置存入现有 `endpoint_policy_json`，旧 Provider 缺字段时默认 `chat-completions`，因此无需 DB migration。Frontend/API 已提供创建时选择与已有 Provider 切换；不同 Provider 可同时使用不同协议。
- **多会话切换约束**：模型请求序列化必须是 `Provider config + 当前 Thread 自身 context` 的纯函数，不读取“当前 UI active session”之类全局状态。A→B→A 时，B 不得改变 A 的 instructions、tool schema、history serialization 或正文。loopback contract 已直接验证完全相同 A 请求在 A→B→A 后两次 JSON body 字节序列一致；各 session 只携带自己的既有 affinity identity，不进入模型正文。
- **缓存观测指标校正**：不能把短请求中的原始 `3584 cached` 当作“缓存深度卡在 3584”。例如总输入仅约 4.2k~4.6k 时，3584 已接近最后完整 cache block。后续主要看 warm `cached/input` 比例、warm turn 是否掉到 0，以及旧 history 是否保持精确前缀，而不是比较不同总长度实验的绝对 cached token 数。
- **Compaction 规则**：后续需要压缩长历史时采用 generation boundary：一代 context 尽量 append-only；到阈值后一次性生成稳定 summary 并开启新 generation，接受一次 cold cost。禁止每轮重新总结/改写旧 history，因为那会持续改变最早 prefix。
- **本地 contract 验证**：同一 canonical request 已分别真实发往 loopback `/v1/chat/completions` 与 `/v1/responses`，SSE usage 均正确解析；两种 body 都不含 `prompt_cache_key`，stable tool schema 一致、`parallel_tool_calls=false`。A→B→A 的 Chat body 完全一致。Backend build、Frontend `vue-tsc + i18n + Vite build` 均通过。Provider E2E 又实际把同一个已持久化 Provider 从 Chat 切到 Responses、执行 `/test`、验证 Responses usage 后再切回 Chat；fake Provider 同时强制检查 `max_output_tokens=16` 且拒绝任何 caller `prompt_cache_key`，该 E2E 已通过。
- **真实 New API → CPA 最终回归（2026-09-14）**：使用当前 `OpenAiCompatibleAdapter`、开发库已保存的 `New API Test` Provider 与 `gpt-5.6-luna`，不传 caller `prompt_cache_key`，分别做独立长前缀严格串行回归。Chat 5 轮为 `17074/0 -> 17095/16128 -> 17116/16128 -> 17137/16128 -> 17158/16128`；Responses 5 轮为 `17072/0 -> 17093/16128 -> 17114/16128 -> 17135/16128 -> 17156/16128`。两种协议 warm `4/4` 均稳定命中约 94%，没有 warm turn 掉 0。另做 Responses A→B→A 会话切换：`A 17071/0 -> B 17071/0 -> A 17071/16128`，回到 A 后立即恢复 94.48% cached，证明切换到另一 session 不会破坏 A 的 cache/session continuity。所有请求均正常 `stop`，模型按要求返回 `OK`。
- **Responses A/B 隔离与交替压力复核（2026-09-14）**：继续保持 caller `prompt_cache_key` 缺失，只保留 `session-id=affinityKey`。先用 A/B 从首条 instructions 即分叉、各自独立 append history 的 fresh 会话做交替测试；探索性批次曾出现单个 warm 请求 `cached=0`，但下一次同 session 立即恢复原有 cache block，重复 fresh 批次又可 warm 全中，因此该现象按“上游允许偶发完整 miss”处理，不能把单次 0 本身当成 session/cache 串扰证据。
- **不同 token 长度防串缓存验证**：为避免 A/B 等长时无法识别 cache block 是否串用，后续故意让两边输入长度显著不同。单批 `A→B × 6` 中，A 为 `14357..14462 input`、warm 始终 `14080 cached`；B 为 `20757..20862 input`、warm 始终 `20224 cached`。首轮 A/B 均为 `0 cached`（正确 cold miss），后续 warm `10/10` 命中，未出现 A 得到 `20224` 或 B 得到 `14080` 的交叉 cache block。
- **5 批 × 12 次最终压力回归**：再执行 5 个完全独立 batch，每批 fresh A/B key、fresh suffix、不同 instructions/payload、不同总 token 长度，且每个 turn 都 append 新内容；总计 `60` 次真实 Responses 请求。10 个首轮 cold 请求全部 `cached=0`；其余 `50` 个 warm 请求 `50/50 cached>0`、`warm cached=0: 0/50`。各批 A/B cached block 始终分离：B1 `A 26368→27392 / B 38656`，B2 `28416 / 41728`，B3 `27392→28416 / 39680`，B4 `29440 / 41728`，B5 `30464 / 43776`；未观察到任何跨 session cache block 混用。该结果进一步支持当前 `session-id=affinityKey` mapping 不需要因 Prompt Cache 再修改。
- **最终决策**：**不做“换一个 cache key”的最小修复。模型调用层以 canonical input 为中心重构；Chat/Responses 是可切换的 wire codec；cache/session identity 由 Provider/CPA 自己管理。**
- **状态**：`已闭环（2026-09-14）：本地 contract/build/E2E + 真实 New API→CPA Chat/Responses 长前缀 + A/B 多会话切换 + 不同长度隔离 + 60-request 压力回归均通过；最终压力样本 warm miss 0/50、cache 串用 0 次`

## P-013 多账号 Provider 场景缺少会话级上游 Affinity，导致 Prompt Cache 跨 credential 失效

- **发现时间**：2026-09-13
- **现象**：同一稳定前缀在多账号代理链路中会出现同样请求有时高命中、有时 `cachedInputTokens=0`。CPA 当前有多份 credential；开启代理侧 session affinity 后可明显改善，但 Nexus Core 目前只有 `cache.scopeKey`，Root 与 Subagent 还使用不同 scope，且没有单独表达“这些调用属于同一个上游亲和会话”的通用语义。
- **根因**：Prompt Cache identity 与 upstream credential/session affinity 被混成同一个概念。`scopeKey` 适合标识模型请求自身的缓存作用域，但不适合表达父子 Agent 应尽量落在同一 upstream credential；OpenAI/Codex 类协议还可能使用 session/header 参与 affinity，而这些厂商字段不应进入 Core。
- **决策**：
  1. 在通用 `ModelCacheHint` 增加 `affinityKey`，语义仅为“同一逻辑 Agent family 应尽量保持相同 upstream routing/credential”；Core 不定义具体 header/参数。
  2. Root Agent：`scopeKey=nexus:thread:<threadId>`，`affinityKey=nexus:thread:<threadId>`。
  3. Subagent：保留独立 `scopeKey=nexus:subagent:<runId>:<delegationId>`，但 `affinityKey` 继承所属 Thread，使父子 Agent 可共享 credential affinity，而缓存正文仍各自隔离。
  4. OpenAI-compatible adapter 不再主动生成 `prompt_cache_key`；若有 `affinityKey`，只保留既有的 `session-id` routing hint 映射。Core 不出现 `session-id`、`prompt_cache_key`、`cache_control` 等厂商字段，也不承担 OpenAI/Codex cache identity 语义。
  5. Provider adapter 必须保持向后兼容：不支持显式 affinity 的 Provider 可忽略 `affinityKey`；不能根据 model 名称在 Core 中硬编码。
- **计划修改**：扩展通用 cache hint；Root/Subagent 传递共同 affinity；OpenAI-compatible adapter 增加 header 映射；补充 contract test 检查 Root/Subagent affinity 一致、scope 独立、厂商字段不泄漏、Provider 请求 header/body 正确。
- **验证方法**：TypeScript/Docker build、无 Runner smoke、adapter contract、真实 New API/CPA 多轮缓存测试，以及部署健康检查。
- **2026-09-14 A/B 最终复核**：CPA 测试前实际已启用 `session-affinity=true`。短时切到 `false` 后，3 组真实 Nexus Agent 两轮 probe 的第二轮为 `2560/0/2560 cached`，即关闭 affinity 仍有 2/3 命中；恢复 `true` 后既有 `2560 cached` 命中，也有逐 message/hash 完全 append-only 却 `0 cached` 的真实反例。因此当前证据不支持“affinity 是 cache miss 根因”或“必须开启才能命中”的强结论。
- **当前决策（被 P-012 终局校正覆盖）**：保留 provider-neutral `affinityKey` contract，只把它当 Thread/agent-family routing hint；CPA 保持测试前的 `session-affinity=true`。OpenAI-compatible adapter **不再由 Nexus 生成 `prompt_cache_key`**，让 CPA/provider 使用自己的标准 cache/session identity。stable-prefix-key A/B 仍证明 per-Thread 高基数 key 有害，但不再是当前 wire contract。
- **状态**：`2026-09-14 affinity 作为 routing hint 保留；Nexus 已退出 prompt_cache_key ownership`

### P-013 最终语义校正：OpenAI `prompt_cache_key` 与 credential affinity 必须解耦

- OpenAI 当前把 `prompt_cache_key` 定义为帮助**相似请求**提高缓存命中率的稳定分桶标识，并建议在需要时按用户/客户做缓存隔离；它不是“当前 Thread ID”的同义词。Nexus 已有独立的 provider-neutral `affinityKey` 表达 Thread/agent-family 上游 credential affinity，因此这两个概念不应继续复用同一个值。
- New API 对自定义客户端 header 的动态透传并非通用保证，但当前 CPA 入站 session-affinity 能读取 `Session-Id`；请求 body 的显式 `prompt_cache_key` 也会由 CPA Codex executor 原样作为 `cache.ID` 写入 upstream body。需要注意的是，`cacheHelper()` 先设置的 upstream `Session-Id=cache.ID` 不是最终值：后续 `applyCodexHeadersFromSources()` 的 `misc.EnsureHeader()` 会优先采用下游 source header，因此当 Nexus 的 `session-id=affinityKey` 到达 CPA 时，最终 Codex wire 是 body `prompt_cache_key=<stable-prefix>`、HTTP `Session-Id=<affinityKey>`。也就是说，Core 语义仍已拆开，但在 Codex gateway 侧两者都可能参与 cache/routing，不能再把 `session-id` 描述成“只影响 credential、与 Prompt Cache 无关”。
- **最终决策（2026-09-14 后续隔离实验再校正）**：`scopeKey` / `affinityKey` 继续保持 provider-neutral Core 语义；`affinityKey` 当前仍可由 OpenAI-compatible adapter 映射到既有 `session-id` routing hint，但 Nexus 不再把任何 Core 值或 stable-prefix hash 映射为 `prompt_cache_key`。由 CPA/provider 自己派生 cache/session identity 的 Responses 长会话已达到 warm `11/11`、约 97%~98% cached，因此显式 caller key 不再是默认策略。
- **验证结果**：两轮真实长前缀 crossover 中，per-Thread key 的后续请求 `0/8` 次复用组内独有长前缀；stable-prefix key 为 `6/8` 次，命中时达到 `8704/9726` 或 `10752/11229` cached。该结果足以推翻此前“prompt_cache_key 应直接映射 affinityKey”的实现决策；`affinityKey` contract 本身仍保留，因为 credential affinity 是独立且有效的语义。
- **2026-09-14 Codex identity bundle 对照与 A/B 决策**：当前 OpenAI Codex 的请求测试明确同时携带 `prompt_cache_key=session_id`、HTTP `session-id=session_id`、`thread-id=thread_id` 与 `x-client-request-id=thread_id`；其 Root/Subagent 语义也是 session id 在同一 agent family 内共享，而 thread id 独立。Nexus 现有 provider-neutral cache hint 已刚好表达这两个维度：`affinityKey`=family/session，`scopeKey`=当前 Root/Subagent scope，但 OpenAI-compatible adapter 目前只映射前两个 continuity 字段。为排除“缺少 Codex thread identity bundle”导致的上游路由不稳定，本轮只在 adapter 层追加 `thread-id=scopeKey` 与 `x-client-request-id=scopeKey`，Core 类型/语义不变；先以当前立即续轮 6 组第二轮 `3/6` 命中作为基线，再用同规格 6 组真实 Agent probe A/B。若无改善则撤销额外 header，不把它作为修复保留。
- **2026-09-14 Codex identity bundle A/B 实际结果**：短请求 B1（追加 `thread-id/x-client-request-id`）第二轮为 `5/6` 命中，但撤回额外 header 后 A2 为 `6/6`；同时 fresh Thread 第一轮也频繁直接出现固定 `2560 cached`。因此这批约 3.1k-token probe 实际主要测到跨 Thread 共享的稳定 system/tool 前缀已被上游热缓存，不能证明额外 identity header 有收益。额外两个 header 已撤回；后续长前缀 A/B 又进一步证明真正有收益的是把 `prompt_cache_key` 从 per-Thread identity 改为 stable-prefix 分桶，而 `session-id` 继续保留 affinity 语义。
- **2026-09-14 独有长历史与 transport 复核**：长历史结果见 P-012；L4 后续又出现 `3584,3584,0,2560`，进一步证明不是单调“等待后物化”。尝试利用 CPA v7.2.155 的 `X-CPA-TRACE-ID` 无侵入归因 selected auth，但 New API 没有把该响应头透传给 Nexus，因此没有为了观测而继续修改生产式网关配置。另对 Codex identity bundle 做 A/B：追加 `thread-id/x-client-request-id` 时短 probe 为 `5/6`，撤回后反而 `6/6`，且 fresh Thread 首轮也经常已有公共前缀 `2560 cached`，故无证据支持保留额外 header；代码已撤回。当时阶段性的 OpenAI-compatible wire contract 曾改为 `prompt_cache_key=<user-isolated stable-prefix hash>` 与 `session-id=affinityKey`；该 `prompt_cache_key` 决策随后又被 P-012 的 no-caller-key 长会话隔离实验覆盖，当前只保留 `affinityKey` routing hint。
- **2026-09-14 `Session-Id` 独立 cache-affinity 语义校正**：OpenAI Codex 2026-09-11 的受控 issue #44716 证明，在完整 body 与 JSON `prompt_cache_key` 固定时，仅改变 HTTP/WebSocket `session-id` 就能显著改变 reported cached input；同时同一 issue 也记录稳定 identity 仍会偶发完整 miss。结合 CPA 的 header 优先级，Nexus 当前 `session-id=affinityKey` 实际会进入最终 Codex upstream，而不是只停留在 CPA credential selector。为验证是否应把它改成 stable-prefix，本轮只做一个窄对照：保持 body stable-prefix key，令下游 `session-id` 也等于该 stable-prefix。12 轮仍出现 `7853/7680 -> 7874/0 -> 7895/7680`，因此对齐 `prompt_cache_key == Session-Id` 也不能消除随机 miss；没有证据支持改变当前默认 mapping。
- **状态补充**：`affinityKey` 作为 provider-neutral hint 保留；它是合理的路由优化，但不再被描述为随机 Prompt Cache miss 的根因或充分修复。最终真实 Responses A→B→A 回归中，A 首轮 `17071/0`、切到独立 B 后 `17071/0`、再回 A 为 `17071/16128`（94.48%）。后续不同长度 A/B 隔离与 5×12 压力回归中，10 个 cold 请求正确为 0，50 个 warm 请求全部非零，且 A/B cached block 始终落在各自长度区间、0 次交叉；因此当前 mapping 满足多会话 continuity/隔离要求，P-013 与 P-012 一并闭环。

## P-014 部署目录与主容器被外部清理，公网返回 502

- **发现时间**：2026-09-13
- **现象**：P-013 v2 已完成构建、部署和真实缓存验证后，源码工作树消失；随后发现 `nexus-terminal-backend`、`nexus-terminal-frontend`、`nexus-terminal-guacd` 容器也被移除，部署目录只剩备份文件与 `data.bak`，公网 `/api/v1/status` 返回 502，仅 `nexus-agent-runner` 仍在运行。
- **风险**：直接用旧 `data.bak` 恢复可能丢失 20:47 之后的聊天、Provider/Agent 配置和测试数据；同时源码/Compose 丢失会破坏后续可维护性。
- **决策**：先不覆盖任何现有备份；优先检查 Docker named volumes、残留 mount、容器层/备份时间线，寻找最新数据副本。确认数据来源后，用已验证的 `affinity-cache-v2-20260913` 镜像重建 Frontend/Backend/guacd，保留 Runner optional/profile 语义。恢复服务后再恢复源码工作树和完整文档树。
- **验证方法**：公开状态恢复 200；Backend/Frontend/guacd/Runner healthy；数据库包含最近测试 Thread/Run/Provider 数据；P-013 affinity 仍可命中；源码可重新构建同等镜像。
- **2026-09-14 从头复核**：正式 `https://ssh.honus.top/api/v1/status` 实测 200；`nexus-terminal-frontend/backend/guacd` 与 `nexus-agent-runner` 均 healthy。P-014 的 502/容器丢失故障已恢复，不再是当前问题。
- **2026-09-14 本轮再次验证**：honus 上 `nexus-terminal-frontend/backend/guacd` 与 `nexus-agent-runner` 仍全部 healthy，正式 `https://ssh.honus.top/api/v1/status` 仍为 200；缓存专项与开发 Backend 重启均未影响正式部署。
- **状态**：`已恢复并重新验证`

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
- **原始状态（历史）**：`已决策，待实施`

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
- **2026-09-14 从头复核**：该测试部署后来按 P-017 的用户决策撤销；`/home/honus/project/nexus_terminal_test` 当前不存在。保留的 `test.honus.top` NPM Proxy Host 因无后端返回 502，属于已撤销测试实例的残留入口，不代表 Nexus 正式环境故障。
- **2026-09-14 本轮再次验证**：`/home/honus/project/nexus_terminal_test` 仍为 absent，`nexus-test-*` 容器数为 0；`test.honus.top/api/v1/status` 仍为 502，而正式站同时为 200，与“历史方案已撤销但入口保留”的边界一致。
- **状态**：`历史方案；已被 P-017 撤销，不再作为当前开发环境`

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
- **2026-09-14 从头复核**：当前 `dev` 已具备主站同源 `/plugins`/`/sdk` 路由与 optional Runner/profile 语义；本轮 P-001～P-008 复核及 smoke/build 也未发现该旧边界回归。P-016 描述的是当时同步库旧基线，不再代表当前 `dev`。
- **2026-09-14 本轮再次验证**：`.env.example` 的 `NEXUS_AGENT_RUNNER_URL` 默认仍为空，Compose Runner 仍由 `profiles: ['runner']` 显式启用；Frontend Nginx/Vite 继续提供同源 `/plugins`、`/sdk`，本地与公网 `/sdk/frontend-v1.mjs` 均 200。
- **状态**：`当前 dev 已恢复并复核通过`

## P-017 撤销 test.honus.top 对应的 Project 测试部署目录

- **发现时间**：2026-09-13
- **用户决策**：删除 honus.top 上 `/home/honus/project/nexus_terminal_test` 测试部署目录，不再保留该 Project 测试实例文件。
- **边界**：不得修改正式部署 `/home/honus/product/nexus_terminal`、AgentDock Git 工作区或其它 Project；本次也不删除 Nginx Proxy Manager 中的 `test.honus.top` Proxy Host，除非用户另行要求。
- **计划**：先确认目标目录存在且路径精确匹配；删除该目录；确认目录不存在；最后验证正式 `https://ssh.honus.top/api/v1/status` 仍返回 200。
- **验证方法**：`/home/honus/project/nexus_terminal_test` 不存在；正式 Nexus 状态接口正常。
- **实施结果**：已先执行测试 Compose `down --remove-orphans`，随后删除 `/home/honus/project/nexus_terminal_test`。验证 `test_dir=absent`、`test_containers=none`，正式 `https://ssh.honus.top/api/v1/status` 返回 HTTP 200。Nginx Proxy Manager 中 `test.honus.top` Proxy Host 按本问题边界保留，未修改。
- **2026-09-14 本轮再次验证**：`test_dir=absent`、`test_containers=0`，正式状态接口 200；保留入口 `test.honus.top` 因无后端继续返回 502，未对其做任何修改。
- **状态**：`已完成并验证`

## P-018 AgentDock 本地开发环境通过显式端口映射接入公网调试，但不修改项目默认监听端口

- **发现时间**：2026-09-14
- **背景**：AgentDock 运行在 PVE Debian VM 的 Docker 容器中，Windows VM 提供真实 Chrome CDP。为了缩短 Nexus 前后端调试闭环，需要直接在 AgentDock 工作区运行开发服务，并通过 honus.top 的 Nginx Proxy Manager 暴露到公网，再由 Windows Chrome/CDP 实际验证。
- **当前开发链路**：Backend 使用项目现有开发默认端口 `3001`；Plugin/SDK 内部静态 listener 使用现有 `3002`；Frontend/Vite 在本次 AgentDock 开发会话中通过显式启动参数监听 `0.0.0.0:9998`。Debian 上 AgentDock 容器已存在 `9998:9998` 端口映射，外层 PVE/NPM 已将 `api.honus.top` 转发到该开发入口。
- **用户决策**：**仅记录开发环境的实际监听方式，不修改项目默认端口。** Frontend 的 Vite 默认端口保持原有行为；`9998` 仅属于当前 AgentDock/PVE 开发运行约定，不写入源码默认值，不改变生产 Compose 的默认端口语义。
- **开发 Origin**：公网调试时 Backend 运行环境使用 `AGENT_PUBLIC_ORIGIN=https://api.honus.top`，并对应设置 Passkey/WebAuthn Origin；Vite 仅在本地开发启动时显式监听 `9998` 并允许 `api.honus.top` Host。`/api`、`/plugins`、`/sdk` 与 WebSocket 路径继续经 Vite 同源代理到 Backend/Plugin listener。
- **验证结果**：本地 `http://127.0.0.1:3001/api/v1/status`、`http://127.0.0.1:9998/`、`http://127.0.0.1:9998/api/v1/status`、`http://127.0.0.1:9998/sdk/frontend-v1.mjs` 均返回 200；公网 `https://api.honus.top/`、`/api/v1/status`、`/sdk/frontend-v1.mjs` 均返回 200。SDK CSP 的 `frame-ancestors` 为 `https://api.honus.top`。AgentDock 通过 Windows 外部 CDP 打开 `https://api.honus.top` 后正常进入 Nexus `/setup` 页面，未出现 console/network/page error。
- **2026-09-14 本轮再次验证**：3001 Backend、9998 Vite 根路径/API/SDK、`api.honus.top` 根路径/API/SDK、正式 `ssh.honus.top` 状态接口均返回 200；排除生成的 Playwright report 后，项目源码、Compose 与 `.env.example` 中没有 `9998` 默认值，确认它仍只是当前 AgentDock/PVE 开发运行约定。
- **状态**：`已记录并验证；仅文档约定，无源码默认端口修改`

## P-019 P-009 修复未进入当前 dev：Nexus Agent 缺少只读连接发现 Tool

- **发现时间**：2026-09-14
- **真实复现环境**：`dev@6ae13e623bb5`，AgentDock 本地 Backend/Frontend，经 `https://api.honus.top` 暴露；Windows VM Chrome 通过外部 CDP 真浏览器执行。测试数据库为本地独立开发库，Runner 未配置（本问题不依赖 Runner）。
- **问题现象**：启用官方 `nexus.agent`、配置可用的 OpenAI-compatible 测试 Provider 后，在 Agent UI 输入“请查看当前可用的机器连接列表，只读取，不执行任何修改。”。Run 实际执行 3 个 step、消耗 6797 token，先读取签名 `nexus.operations` Skill，随后以 `completed_unverified` 结束；模型最终明确回答：当前可用工具中没有“列出机器连接”的只读接口，拒绝猜测 connection ID。
- **与历史记录冲突**：P-009 的实施结果写明曾新增 `machine_list_connections`，并声明 `machine.diagnostics.read` contribution 同时注册连接发现与 diagnostics；但当前 `dev` 源码中不存在 `machine_list_connections` 符号，`git log --all -S'machine_list_connections'` 也没有命中任何提交。
- **根因定位**：当前正式 Tool 注册链在 `packages/backend/src/bootstrap/agent/tool-contributions.ts` 的 `machine.diagnostics` contribution 中只注册 `createDiagnosticsTool(...)`。`packages/backend/src/modules/agent/tools/host/tools.ts` 只有 `machine_diagnostics` / file read 等 Tool，没有连接列表 Tool；`MachineCapabilityPort` / `AgentConnectionResolverPort` 也没有 list contract。因此缺失发生在 **Host Tool catalog 构建之前**：Provider 请求不可能获得 `machine_list_connections` schema，模型本轮行为与实际暴露能力一致。
- **历史原因判断**：P-014 记录过 P-013 v2 验证后源码工作树被外部清理、随后恢复源码。当前所有 Git ref 均没有 `machine_list_connections` 的提交记录，因此 P-009 当时验证过的实现很可能只存在于已丢失/未提交的工作树或镜像中，没有进入目前恢复后的 Git 历史。该判断以当前 Git 证据为准，不假定旧临时源码仍可恢复。
- **决策**：按 P-009 原有产品边界恢复最小只读连接发现能力，不通过猜测 ID、shell 探测或 Runner 绕过。Tool 只返回当前 App 被授权且未被 Agent target denylist 禁止的 SSH target 的公开字段；不得返回密码、私钥、passphrase、notes 等敏感/非必要字段。
- **计划修改**：
  1. 为 Agent machine connection 边界增加有界 list contract，复用现有 `ConnectionService`/resolver，不新增第二套连接事实源。
  2. 新增只读 `machine_list_connections` Tool，输出限定为 `id/name/host/port/username`，仅包含 SSH connection，并应用当前 Agent target denylist。
  3. 将该 Tool 与 `machine_diagnostics` 一起注册到 `machine.diagnostics.read` contribution；保持 capability/grant/policy 仍由 Host 统一控制。
  4. 增加 contract/unit 覆盖：SSH 保留、非 SSH 过滤、denylist 过滤、无凭据字段、稳定 schema；再用同一 Windows CDP 场景真实复测模型能够先调用列表 Tool。
- **验证方法**：
  - 静态/测试确认 Tool catalog 中存在 `machine_list_connections`，输入 schema 为只读无参数或严格有界参数，输出不包含凭据。
  - 本地独立数据库连接数为 0 时，真实 Agent 应调用 `machine_list_connections` 并得到空列表，而不是声称没有列举接口；新增一条测试 SSH connection 后应只返回公开元数据。
  - Windows CDP 真浏览器复跑同一句请求，Backend/Model request 中能观察到 Tool schema，Provider 返回 tool call，Nexus 执行只读 Tool 并将结果回灌，Run 最终回答与实际连接列表一致。
  - Runner 保持未配置也应通过，证明基础连接发现不依赖 Workspace Runtime。
- **2026-09-14 本轮实施**：已在 `AgentConnectionResolverPort` 增加安全 list contract，继续复用 `ConnectionService`；`MachineCapabilityAdapter.listConnections()` 仅保留 SSH，并在每次执行时读取当前 target denylist 过滤目标，只映射 `id/name/host/port/username`。新增只读 `machine_list_connections` Tool，并与 `machine_diagnostics` 一起注册到 `machine.diagnostics.read` contribution；Runner 不参与该路径。
- **2026-09-14 本轮验证**：`pnpm --filter @nexus-terminal/backend build` 通过；Backend architecture check 通过（431 files，无 forbidden layer edge/source cycle/module cycle）；开发 Backend/Frontend 均继续 200。Windows 外部 CDP 真 Chrome 用原复现语句重新执行后，真实 Tool result 为 `Found 0 authorized SSH connection(s).` / `{"connections":[]}`，最终回答“已授权 SSH 连接：0，未执行任何修改操作”，页面无 console/network/page error。当前开发库连接数为 0，因此空列表与事实一致。
- **2026-09-14 SSH 功能链追加验证**：开发库新增 loopback-only `Local SSH Functional Test`（`127.0.0.1:2222`）后，UI“测试连接”成功；真实 Agent Run 的 `machine_list_connections` 返回该连接的 `id/name/host/port/username`。随后模型调用 `machine_execute_shell`，Host 按现有 policy 请求审批；批准后真实 SSH 返回 exitCode=0，stdout 包含 `NEXUS_SSH_OK`、`Linux`、`agentdock` 与实际工作目录。数据库 Tool Call 记录状态为 `succeeded`，证明列表发现和 SSH 执行链均真实可用。
- **2026-09-14 本轮再次回归**：缓存专项清理并重启开发 Backend 后，新建 fresh Thread 输入“请列出当前可用的 SSH 机器，只读取连接列表，不执行任何命令或修改。”；Windows 外部 Chrome 中真实 Tool result 为 `Found 1 authorized SSH connection(s).`，只返回 `id=1/name=Local SSH Functional Test/host=127.0.0.1/port=2222/username=nexus-test`，最终回答同样只展示公开元数据且明确未执行命令。开发库最新 `agent_tool_calls` 进一步确认 `tool_name=machine_list_connections`、`risk=read`、`status=succeeded`，证明不是模型从页面文本猜测。
- **状态**：`已修复并完成真实 Windows CDP 验证`

## P-020 设置页信息架构过载与窄屏 UI 越界

- **发现时间**：2026-09-14
- **用户反馈**：当前设置项过多、分组不清晰，页面纵向过长且不同页面在窄窗口下存在越界/拥挤，整体界面显得杂乱。
- **真实基线**：Windows Chrome 打开开发环境 `/settings` 时，旧 Workspace 设置由一个 1022 行组件承载十余个独立表单和各自的“保存”按钮，页面总高度约 4348px；Settings 顶部 8 个 Tab 依赖横向滚动，Connections 工具栏在 `sm` 宽度以上强制不换行。CDP + Playwright 对 390px Agent Hub 做布局探针时，外框本身不溢出，但 App Switcher 内部控件存在约 109px 的不可见裁切/scroll excess。
- **设计决策**：不删除现有设置能力，也不改变设置 API/验证边界；按用户工作流重新组织信息层级，使用“语义分组 + 组级保存 + 低频项渐进披露”，并让 Settings/Connections/Agent 在窄窗口下自然换行或截断。现有关键 DOM id 与 E2E `data-testid` 尽量保持兼容。
- **2026-09-14 本轮实施**：
  1. 新增 `WorkspacePreferencesPanel.vue`，把 Workspace 设置收敛为“文件与编辑 / 终端与指令 / 首页与监控 / 布局与高级设置”四组；低频布局组默认折叠，长说明使用 `details` 渐进展开，每组只保留一个保存动作。
  2. Workspace 与 System 设置拆开加载；System 继续使用原 Preferences panel，降低一次性重构风险。并解除 Workspace 普通保存与全局 locale 切换的旧耦合，只有语言设置本身才触发 locale 更新。
  3. Settings 顶部 Tab 在窄屏使用 2 列网格，在较宽屏自动换行，不再依赖横向滚动；Connections 工具栏把强制单行阈值后移到 `lg`，平板/手机宽度允许自然换行。
  4. Agent `AgentAppSwitcher` 增加真实 `min-width:0` / `flex:1` / select truncate 约束，修复 390px 下内部 109px excess；既有 Agent container-query 侧栏抽屉与 Run 配置换行逻辑继续复用。
  5. 新增三语言 Workspace 分组文案；保留 `quick-command-collapsible-search-save`、`spreadsheet-preview-pagination-save` 等已有 E2E 钩子。
- **真实验证**：
  - Frontend 完整流水线通过：319 source files architecture check、2336 i18n keys / 3 locales / 84 fragments、`vue-tsc --noEmit`、Vite production build 与 bundle budget 全部通过；`pnpm format:check` 通过。
  - Windows 真 Chrome 新 Workspace 页面高度约 1867px，较旧页面约 4348px 明显收敛；Settings、Connections、Agent Hub 均可正常打开，未引入新的 page/network error。
  - 真实保存路径验证：快捷指令搜索组写入数据库后已恢复原值 `false`；电子表格每页行数从 500 改为 510 成功落库后又恢复 500；测试最终未留下偏好副作用，语言也恢复并持久化为 `zh-CN`。
  - 通过 Windows Chrome CDP 的临时 Playwright page 分别模拟 720×800 与 390×800：`/settings`、`/connections` 的 document horizontal excess 均为 0；Agent Hub dialog horizontal excess 均为 0。App Switcher 修复后唯一被探针识别的 excess 来自 `sr-only` 无障碍隐藏文本，不属于可见 UI 溢出。
- **状态**：`2026-09-14 已完成整体 Workspace 信息架构与主要越界修复，并通过真实 Windows Chrome/窄屏回归`

## P-021 Agent WebSocket 偶发 429 导致运行状态刷新变陈旧

- **发现时间**：2026-09-14
- **真实现象**：本轮 Windows Chrome/CDP 多次打开 Agent Hub 时，console 真实出现 `wss://api.honus.top/ws/agent` 握手返回 HTTP 429。发生时 Backend Run 可已经继续/完成，但前端状态可能停留在旧值；缓存 A/B 测试中曾因此出现一次 UI 仍显示旧 Run、随后发送请求得到 409 resource changed，需要刷新后继续。
- **根因定位**：后端从 `db61301` 起故意保留 `MAX_AGENT_SOCKETS_PER_SESSION=3` 作为同一登录 session 的物理 Agent WebSocket 安全上限；单条 `AgentProtocolSession` 本身却支持最多 16 个逻辑 subscription。修复前前端 `agentEvents.connectOnce()` 对每个 Host/Run subscription 都单独 `openWebSocket('/ws/agent')`，同时每个已登录 Nexus 标签页即使 Agent Hub 未打开也会维持一条 Host socket。Windows Chrome 调试环境当时残留 5 个同 session Nexus 标签页，Backend 运行日志持续记录 `activeForSession=3/maxSocketsPerSession=3` 并拒绝其余升级，证明 429 来自物理连接使用模型与协议 multiplex 能力不匹配，而不是 Provider 或 P-020 UI 改动。
- **安全决策**：保留 3 条 session socket 上限，不通过扩大限额掩盖问题。该上限继续用于约束异常重连、失控页面和连接泄漏；正常 Agent 业务应远低于上限。页面内 Host + Run 逻辑订阅必须复用同一物理 socket；多标签页的全局 Host stream 只允许一个同源 leader 持有物理 socket，其余标签接收变更通知并刷新 HTTP summary。
- **2026-09-14 本轮实施**：
  1. `agent-events.ts` 增加页面内 shared Agent WebSocket lease；多个 Host/Run logical subscription 共享同一 `/ws/agent`，各自仍保留独立 subscription id、unsubscribe、cursor/retry 语义；最后一个 lease 释放时才关闭物理 socket。
  2. `AgentSurfaceHost.vue` 使用 Web Locks API 的 `nexus.agent.host-stream.v1` exclusive lock 在同源标签页之间选举唯一 Host-stream leader；leader 订阅 Host events，其他标签不建立 Host socket。
  3. leader 收到 Host durable event 后通过 `BroadcastChannel('nexus.agent.host-events.v1')` 广播轻量 `host.changed` 通知；followers 使用现有 `/agent/summary` HTTP 路径刷新 launcher/badge/feature state，因此多标签场景仍保持全局状态更新语义。
  4. leader 标签关闭时浏览器自动释放 Web Lock，等待中的另一标签自动接管并建立新的唯一 Host socket。无 Web Locks 环境保留原有直连 fallback，不改变服务端协议或安全上限。
  5. Backend 429 guard 增加不含凭据的结构化诊断日志：session key、user id、active/max socket count 与总 Agent client count，便于未来区分真实上限触发与其它握手失败。
  6. E2E 新增 cross-tab leader/failover 回归；原“每 session 最多 3 条物理 socket”测试继续保留，确保本修复没有放宽安全边界。
- **真实验证**：
  - Windows Chrome 同一登录 session 同时打开 5 个 `api.honus.top` 标签页：`/ws/agent` 实际物理连接数分布为 `1/0/0/0/0`，五页均无 429/WS console error。
  - 3 标签 failover probe：初始仅第一个标签有 1 条 Host socket；关闭 leader 后，剩余标签中自动出现且仅出现 1 条接管 socket。
  - 真实 Agent Run 输入 `P021 multiplex final verification...` 并得到 `P021_FINAL_OK`；Run 前/中/后始终只有同一个 `/ws/agent` 物理 socket，`socketCount=1/openCount=1`，证明 Host + Run 已真实 multiplex，console 无 429。
  - Backend 修复后日志未出现新的 connection-limit rejection；最近一次真实 Run 正常完成并继续记录 cache diagnostics。
  - Frontend architecture/i18n/`vue-tsc`/Vite build/bundle budget 通过；Backend build 与 431-file architecture check 通过；`pnpm format:check` 通过；E2E groups 仍为 8 groups / 70 specs，`test:list` 现发现 234 tests。
- **状态**：`2026-09-14 已修复并完成多标签、failover 与真实 Agent Run 验证；3-socket 安全上限保持不变`

## P-022 Agent 设置页层级过长，复杂配置缺少聚焦式信息架构

- **发现时间**：2026-09-14
- **用户反馈**：新加入的 Agent UI 与排版仍不理想；本轮先只优化 Settings 中的 Agent 设置布局，不扩散到 Agent Hub/Conversation 等其它区域。
- **当前证据**：`AgentSettingsPanel.vue` 目前以 7 个目录项对应 7 个连续纵向 section，Overview / Models / Execution / Environments / Storage / Extensions / Safety 全部同时挂载在同一长页面；其中 Provider、Hard Limits、Subagent、Workspace Runtime、Browser/ACP、Plugin 管理等高复杂度面板继续纵向串联。左侧目录只执行 `scrollIntoView`，没有当前分区状态，也不能减少一屏同时出现的信息量。现有组件已提供明确语义边界，因此问题主要在页面级信息架构与视觉层级，而非 API 或领域模型。
- **原因**：P-020 解决了 Workspace Preferences、Settings 顶部 Tab 与窄屏越界，但 Agent 设置页仍沿用“文档目录 + 全量展开”的布局；新增 Agent 能力持续增加后，单页同时暴露过多二级/三级配置，导航与内容焦点脱节。
- **设计决策**：保留现有 Agent settings API、组件职责、DOM section id 与安全确认流程；把 Agent 设置页调整为“可选分区导航 + 单一主工作区”的聚焦式布局。桌面使用左侧分区导航，窄屏使用顶部可换行/横向安全的分区选择；同一时刻只展示当前分区的主要配置。Overview 保留状态摘要与 App/feature 控制，其它复杂配置按语义分区进入独立主面板。不得为了 UI 便利复制 authoritative Agent state，也不改变 destructive preview/confirm 语义。
- **计划修改**：
  1. `AgentSettingsPanel.vue` 增加当前分区 presentation state 与可访问导航状态；桌面侧栏显示 active 项，主区域只渲染当前分区。
  2. 顶部增加紧凑的当前分区标题/说明与关键摘要，避免每个分区重复“大标题 + 多层卡片”造成视觉噪声。
  3. 统一主内容容器、卡片间距和响应式边界；小屏改为顶部分区导航，避免左侧栏挤压内容。
  4. 尽量不修改 Provider/Workspace Runtime/Plugin 等子组件业务逻辑；确需样式调整时只做布局层最小修改。
  5. 保留现有 `agent-settings-<group>` section id 作为锚点/测试兼容，并确保切换后 URL/页面不产生横向溢出。
- **验证方式**：Frontend typecheck/i18n/Vite build/format 至少通过与本次变更相关的检查；真实 Windows Chrome 打开 `/settings` 的 Agent Tab，确认桌面与窄屏均无水平溢出，分区切换可达，Provider/Runtime/Plugin 等原交互仍可进入，控制台与网络无新增错误。
- **2026-09-14 本轮实施**：`AgentSettingsPanel.vue` 已从“7 个 section 全量纵向展开 + 目录滚动”改为聚焦式设置工作区。桌面保留 sticky 左侧分区导航并增加 active 状态、图标层级与当前功能状态；窄屏使用 sticky 的可访问分区下拉。右侧统一显示当前分区标题/说明，同一时刻只可见一个分区；各 section 使用 `v-show` 保持挂载，因此用户切换分区时 Provider/Plugin 等未保存表单草稿不会被销毁。Overview 继续保留 App/Model/Runtime/Storage 摘要与 Feature/App 控制，其余复杂面板仍复用原组件与原 API/确认流程。现有 `agent-settings-<group>` id 保留。
- **测试调整**：Agent Host / Plugin E2E 已按新信息架构改为先切换到目标分区再操作；新增 720px Agent 设置分区选择和 document horizontal excess ≤ 1 的断言，并补充 Safety 分区显隐语义。
- **验证结果**：目标文件 Prettier 通过；Frontend 完整 build 通过（319 source architecture check、2339 i18n keys / 3 locales、`vue-tsc --noEmit`、Vite production build、bundle budget）；Playwright `test:list` 仍成功发现 234 tests / 70 files；`git diff --check` 通过。专项 Agent settings Playwright 已成功启动隔离 Backend/Frontend/Provider/Plugin repo/SSH/guacd，但在测试逻辑执行前因当前 AgentDock 容器缺少 Playwright `chromium_headless_shell` 而停止，属于浏览器运行依赖缺失，不是产品断言失败。Windows CDP 真 Chrome 已确认 `external_configured` 可连接，但当前页面处于未登录 `/login`，本轮没有伪造认证态截图；对应 CDP 优先验证规则已补充到 `doc/AGENT.md`。
- **状态**：`设置页布局已完成第一轮优化并通过构建/静态/E2E 配置验证；认证态真浏览器视觉回归待可用登录会话复核`

## P-023 Backend Plugin/SDK 独立 3002 listener 增加不必要的端口复杂度

- **发现时间**：2026-09-14
- **用户决策**：将 Backend 的 Plugin/SDK 静态 listener 从独立 `3002` 合并到主 Backend `3001`，减少开发、Compose、Nginx 与故障排查中的端口分叉。
- **当前结构**：同一个 Backend 进程同时监听 `3001`（HTTP API/WebSocket）和 `3002`（`/plugins/...`、`/sdk/frontend-v1.mjs`）。浏览器侧早已通过主站同源路径访问 Plugin/SDK，`3002` 不对公网发布，因此第二 listener 不提供进程级隔离，只承担路由与安全头分流。
- **安全边界**：本次只收敛监听端口，不降低 Plugin/SDK 资源隔离。合并后必须继续保留：仅 `GET/HEAD`；匿名可访问；严格 CSP / `frame-ancestors`；不继承主页面 `X-Frame-Options: DENY`；`nosniff` / `no-referrer` / Permissions Policy；Plugin 路径 segment、package marker、realpath/symlink/path traversal 校验；静态资源 immutable cache；不存在资源返回 404 而不是 SPA fallback。
- **实施计划**：
  1. 将现有 Plugin/SDK 静态 server 抽成可挂载到主 HTTP server 的 request handler，并在 `3001` request pipeline 中仅拦截 `/plugins/` 与 `/sdk/` 路径。
  2. 删除 Backend 第二次 `listen()`、`AGENT_PLUGIN_FRONTEND_PORT` / `agentPluginFrontendPort` 等产品配置。
  3. Vite 的 `/plugins`、`/sdk` 与 `/api` 统一代理到 Backend `3001`；Frontend Nginx 删除 `backend:3002` upstream，Plugin/SDK 同样反代 `backend:3001`。
  4. Compose 不再向 Backend 注入 `AGENT_PLUGIN_FRONTEND_PORT`；相关 E2E/test-env 与文档改为单 Backend 端口模型。
  5. 增加/保留路由安全回归，确认 Plugin/SDK 响应头、404、GET/HEAD、路径校验与 API/WebSocket 无回归。
- **验证标准**：Backend 产品代码不再监听 `3002`；仓库产品配置不再要求 `AGENT_PLUGIN_FRONTEND_PORT`；Backend/Frontend build 通过；开发同源 `/api/v1/status`、`/sdk/frontend-v1.mjs` 与可用 Plugin asset 均通过同一 `3001` target；Plugin route 安全头保持原语义。
- **2026-09-14 本轮实施**：`plugin-frontend-static-server.ts` 已改为可挂载到主 HTTP server 的专用 request handler；`application.ts` 在进入 Express API middleware 前仅分流 `/plugins` / `/sdk`，因此 Plugin/SDK 不继承主 API 的 `X-Frame-Options: DENY`，原 CSP、匿名访问、GET/HEAD、realpath/symlink/path traversal、package marker 与 immutable cache 逻辑继续复用。Backend 删除第二次 `listen()` 与 `agentPluginFrontendPort`；Vite 和 Frontend Nginx 的 Plugin/SDK target 均统一为 Backend 3001；E2E 删除独立 `pluginFrontend` 端口配置。按用户后续决定，`docker-compose.yml` 同步删除失效的 `AGENT_PLUGIN_FRONTEND_PORT`，`Dockerfile` 的声明端口也收敛为 `80 3001`；Docker smoke 暂不因该决策改写，后续如容器层暴露实际问题再单独处理。
- **2026-09-14 本轮验证**：Backend build 通过；Backend architecture check 通过（431 files，无 forbidden layer edge/source cycle/module cycle）；Frontend 完整 build 通过（319 source architecture、2339 i18n keys / 3 locales、`vue-tsc --noEmit`、Vite production build、bundle budget）；E2E `test:list` 仍发现 234 tests / 70 files，groups check 为 70 specs / 8 groups；目标 diff `git diff --check` 通过。真实开发 Backend 仅监听 3001：`/api/v1/status`=200，`/sdk/frontend-v1.mjs`=200 且保留 Plugin CSP/CORS/CORP/immutable cache、没有 `X-Frame-Options: DENY`；非法 dotfile Plugin path=404，POST SDK=405 + `Allow: GET, HEAD`；`127.0.0.1:3002` 连接失败符合预期。Vite 9998 与公网 `https://api.honus.top` 的 `/api/v1/status`、`/api/v1/settings/captcha`、`/sdk/frontend-v1.mjs` 均恢复为 200。Windows CDP 真 Chrome 刷新后直接恢复到已认证 Dashboard，console/network/page error 均为空，之前 CAPTCHA 加载失败不再阻塞登录。当前 AgentDock 容器没有 Docker CLI/nginx binary，因此本轮未执行 `docker compose config` 或 Nginx 本机语法测试。
- **状态**：`已完成 Backend/开发链路单端口合并、Compose 与 Dockerfile 端口同步，并通过本地运行态与 Windows CDP 验证；容器 smoke 暂按用户决策保持不动`

## 2026-09-14 从头复核最终回归

- 已按 P-001 → P-021 重新核对/修复当前 `dev` 与真实运行状态；不再把历史“已修复”文字当作当前 Git 事实。
- Backend：`pnpm --filter @nexus-terminal/backend build` 通过；`check:architecture` 通过（431 files，无 forbidden layer edge/source cycle/module cycle）。
- Frontend：architecture / i18n / `vue-tsc --noEmit` / Vite production build / bundle budget 全部通过（319 source files；2336 i18n keys / 3 locales / 84 fragments）；`pnpm format:check` 通过。
- Agent Runner：TypeScript build 通过。
- E2E 配置：8 groups / 70 specs assignment check 通过；Playwright `test:list` 成功发现 234 tests；`docker-deployment-smoke.sh` 与 `docker-core-no-runner-smoke.sh` 均通过 `bash -n`。
- 开发运行态：本地 Backend 3001、Vite 9998、同源 `/api/v1/status`、`/sdk/frontend-v1.mjs` 均 HTTP 200；公网 `https://api.honus.top/`、`/api/v1/status`、`/sdk/frontend-v1.mjs` 均 HTTP 200。
- Windows 真 Chrome：Settings、Connections、Agent Hub 均可正常打开并完成真实交互；P-020 响应式改动未产生新的 page/network error。P-021 修复后 5 个同 session Nexus 标签页只保留 1 条 Host `/ws/agent`，leader 关闭后可自动 failover；真实 Agent Run 的 Host + Run 逻辑订阅保持在同一条物理 socket，修复后的验证窗口无新增 429。
- Agent SSH：loopback-only `Local SSH Functional Test` 仍在线；真实 Agent 已完成 `machine_list_connections → machine_execute_shell → Host approval → SSH exitCode=0`，数据库 Tool Call 证据与 stdout 均确认执行成功。
- Prompt Cache：Core/adapter 缺失项已恢复；逐 message hash 证明真实 append-only Run 不存在 Nexus 侧 prefix divergence；同一 New API/模型约 10k-token 对照中 `/responses` 与 `/chat/completions` 都可从 `0 cached` 升到第二次 `8960/10057 cached`。CPA 最终 A/B 中，临时 `session-affinity=false` 的 3 组真实两轮 Agent probe 第二轮为 `2560/0/2560 cached`（2/3 命中）；恢复原始 `true` 后既有命中，也有完整 append-only 前缀仍 `0 cached` 的反例。因此 affinity 保留为合理的路由 hint，但本轮没有证据证明它是 cache miss 的必要修复或唯一根因；CPA 已恢复测试前 `session-affinity=true`。
- 正式运行态：`https://ssh.honus.top/api/v1/status`=200；Frontend/Backend/guacd/Runner 均 healthy。P-014 已恢复；P-015 已被 P-017 撤销，`/home/honus/project/nexus_terminal_test` 不存在、18121/18122 未监听，`test.honus.top` 当前 502 属按 P-017 明确保留的历史 NPM 入口。
- **仍保留的非代码结论/验证缺口**：P-006/P-007 的完整 repository Docker smoke 仍需标准 CI（具备 Node 24/pnpm/Docker/Playwright 依赖）执行；本轮当前环境已完成 Backend/Frontend/Runner 构建、E2E 8 groups/70 specs assignment、234-test discovery、smoke 脚本语法检查、Windows 真 Chrome、真实 Agent SSH 功能链与 P-021 多标签 WebSocket 回归。

## P-024 Agent 设置与会话 UI 二次重构

- **问题**：设置侧栏占宽、分区点击强制 scrollIntoView 导致跳动；Provider 测试在页面顶部反馈；会话选中后排序变化、创建强制命名、工具 JSON 全量铺开、右栏重复状态挤压正文。
- **原因**：presentation 层导航、反馈与内容归属不一致；聊天缺少渐进披露。已检查真实开发 Chrome、现有组件与 P-020/P-022。
- **决策**：仅改 Frontend UI/交互。顶部紧凑分区导航、稳定内容工作区、模型行就地测试反馈；一键空标题新会话、稳定列表顺序、Markdown 正文、可展开工具摘要、按需任务栏、输入区内联提示；保留所有审批/预算/对账安全边界与后端事实源。
- **计划修改**：AgentSettingsPanel/ModelProviderSettings、AgentAppSurface/AgentConversation/ConversationMessage/TaskRail、三语言文案与需求文档。保留当前未提交改动，不 commit/push/deploy。
- **验证方式**：Frontend architecture/i18n/typecheck/build、Prettier/diff check；Windows CDP 开发页验证分区切换、模型反馈、空会话创建、工具折叠、响应式与控制台。
- **状态**：已完成，详见下方实施与验证结果。

### P-024 本轮实施与验证结果

- **实际修改**：顶部设置分区 + 独立滚动区；手机两级选择器；保留表单草稿和分区滚动位置；模型行独立测试反馈；新增 Provider / 发现模型写入失败保留输入；预算、上限、Subagent、Browser/ACP 按需展开；插件先展示已安装项，信任与安装配置后置。
- **Agent UI**：任务栏默认关闭、按需展开，中窄窗覆盖显示；模型/思考强度说明/环境/连接归入 Composer；Markdown 安全渲染、空 assistant turn 隐藏、工具/系统摘要可展开；任务详情的历史审批/检查点/运行环境分层；原始参数/Hash 保留在审批详情；错误和对账提示就近展示且继续保持真实 mutation lock。
- **交互**：一键无标题新建并聚焦 Composer；历史排序不再因选中改变；切换先清理旧投影，加载完成再允许发送；中文 IME Enter 不发送；窄屏隐藏未打开 drawer 的键盘焦点目标；Popover 可视边界定位与 Escape 返回焦点；详情焦点管理；Hub 打开时隐藏 Launcher，避免遮挡输入。
- **真实开发 Chrome 验证**：设置分区切换 scrollY=0→0；真实模型测试在对应行返回“连接成功 · 1211 ms”；新建无标题输入框且 Composer 获得焦点；isComposing Enter 保留原稿。720px/390px 下 Settings document 和 Agent Hub horizontal excess 都为 0；720px TaskRail 覆盖层位于 viewport 内。手机设置压缩后主 Agent 标题位于 y=132；打开 Hub 时 Launcher 数量为 0；检查过程中 page_errors=[]。已恢复桌面 viewport 与 1080×697 窗口尺寸。
- **构建/格式**：最终 Frontend architecture（320 files）、i18n（2360 keys/3 locales）、vue-tsc、Vite production build 和 bundle budget 均通过；pnpm format:check / git diff --check 通过。当前宿主 Node 22.17 会提示项目要求 Node >=24；以上检查实际成功，未声称完成标准 CI 环境全回归。
- **测试边界**：用户明确要求“先不要改测试，先完成功能”。本轮测试文件调整已逐项撤回，packages/e2e/tests 无本轮 diff；未新增测试源码或更改 Docker smoke。旧导航/创建/反馈断言后续再同步。
- **状态**：UI/前端交互已完成并经开发浏览器验证；自动命名与真实思考强度仍按 P-025/P-026 等待后端合同。本轮没有修改后端、提交、推送或部署。

## P-025 会话自动命名缺少服务端合同

- **问题/原因**：目前 createThread 支持省略 title，但没有公开的 Thread rename/自动标题生成合同；前端不能把本地标题伪装成服务端已保存标题。
- **本轮 UI 决策**：新建直接调用已有无 title 的 createThread，不再强迫填写名称。
- **后端待办**：首次有效用户输入后生成有界标题并持久化，明确手动重命名优先级、失败回退、事件与列表刷新；提供 versioned rename 合同。
- **验收**：首次消息后自动命名，刷新/跨标签/App 切换保持一致，手动标题不被覆盖，失败仍可正常对话。
- **TODO(P-025/thread-auto-title)**：后端自动命名与 versioned rename 合同仍待实现。这是明确保留的后续功能，不应因当前 UI 已可无标题创建 Thread 而删除相关设计记录。
- **状态**：后端待实现。

## P-026 会话思考强度缺少能力与 Run 冻结合同

- **问题/原因**：Provider model capability 与 Run create/model snapshot 当前没有 reasoning effort 字段，不能仅加下拉并宣称模型按该值执行。
- **本轮 UI 决策**：模型旁提供思考强度说明入口，明确当前由模型默认处理；未支持的选项不可提交。
- **后端待办**：定义厂商无关能力/允许档位/default；Run 创建验证并冻结强度；适配器按 Provider 映射；历史 Run 回显，运行中禁改；不同模型不支持时安全回退。
- **验收**：低/中/高等合法档位真实进入上游请求，非法组合拒绝；历史/恢复保留冻结值；不展示隐藏思维链。
- **2026-09-14 架构调整**：普通用户不再手工声明模型 reasoning capability。Nexus 增加 `ModelCapabilityResolver`：当前优先使用内置 Model Capability Registry，根据 canonical/已知模型 ID 派生 `reasoningEfforts/defaultReasoningEffort`；未知模型保持 Unknown，不发送 reasoning 参数并继续使用 Provider 默认。Resolver 已预留未来 `Provider live capability` 输入层，但本轮明确不解析 `/models` 的扩展 reasoning 元数据、不做 capability 缓存，待后续单独实现。
- **本轮计划**：Provider 对外视图由服务端自动装饰 reasoning capability；用户设置页只读展示已识别档位，不提供 capability 编辑；Create Run DTO/Run definition 保留可选 `reasoningEffort`，RunService 按自动解析能力校验并冻结；OpenAI-compatible Chat/Responses 分别映射为 `reasoning_effort` / `reasoning: { effort }`；Frontend Composer 按自动能力生成分段滑条并在 Run 活跃时锁定。
- **2026-09-14 验证**：Backend build 与 architecture check 通过；Frontend architecture/i18n/typecheck/Vite build/bundle budget 通过；Registry probe 确认 `gpt-5.6-luna` 与带日期的 `gpt-5.6-sol-*` 自动得到 `none/low/medium/high/xhigh/max`、默认 `medium`，Unknown 模型返回 `null`。Windows CDP 真浏览器中 `gpt-5.6-luna` 无需用户配置即可显示 `无 / 低 / 中 / 高 / 极高 / 最大` 六档滑条，默认“中”，点击“高”后触发值同步更新，再恢复“中”；console/network/page error 均为空。
- **TODO(P-026/provider-live-capability)**：Provider live capability 解析按用户决定延后。`ModelCapabilityResolver` 的 `live` 输入是有意保留的架构扩展点，后续排查/清理代码时不得按“未使用参数/死代码”删除；只有在完成并验证 Provider 权威 capability 接入或由新的等价抽象替代后才能移除。
- **状态**：`2026-09-14 内置 Model Capability Registry + Run 冻结 + OpenAI-compatible 映射已完成；Provider live capability 解析延后并显式标记 TODO。`

## P-027 Agent Composer 输入区过紧且配置摘要说明文字过多

- **用户反馈**：当前 Agent 输入框偏矮；输入框下方的 Model / 思考强度 / Environment / Targets 配置条信息密度不均，提示性文字多于用户真正需要扫读的当前值。用户希望先做细节优化，不改变现有 Composer 位置、Run 冻结语义或后端合同。
- **当前证据**：`AgentConversation.vue` 的 Composer 仅 `rows=2`、`min-h-16`；`AgentAppSurface.vue` 的配置条同时展示字段标签、图标、当前值及多个说明型 Popover，其中思考强度目前只有“默认思考 + 尚未开放”的解释，因为 P-026 的真实 reasoning effort 后端合同仍未实现。
- **设计决策**：仅优化 Frontend presentation。输入框提高默认高度并允许更多正文直接可见；配置条改为“当前值优先”，减少重复字段名和长提示。Model / Environment / Targets 保留真实当前值、锁定与可用状态。思考强度在后端合同实现前不得伪装成可生效选择，只用更紧凑的等级视觉展示，并明确当前仍由模型默认处理。
- **本轮范围**：优先调整 Composer 高度、配置条间距/标签、思考强度 Popover 与 Environment/Targets 中非必要说明；不修改 Run create、Provider capability、reasoning effort 后端合同、审批/预算/对账与冻结安全语义。
- **验证**：Frontend typecheck/build/format；Windows CDP 真浏览器验证 Composer 可用高度、配置摘要可读性、窄窗无横向溢出、Run 锁定状态与发送行为无回归。
- **2026-09-14 本轮实施与验证**：Composer 从 `rows=2/min-h-16/max-h-36` 调整为 `rows=3/min-h-24/max-h-48`，并移除发送快捷键的可见提示文字；底部配置摘要去掉重复的 Model / Environment / Targets 标签，只保留图标与真实当前值。思考强度触发器压缩为“默认”，Popover 直接展示“无 / 高 / 极高”三个等级预览和一行“当前仍使用模型默认值”；由于 P-026 后端合同尚未实现，这些等级保持不可提交，不伪装为已生效配置。Environment / Targets Popover 同步删除默认值说明、None hint、profiles/run contract 与 targets hint 等非必要说明。Frontend 完整 build 通过（320 source architecture、2365 i18n keys / 3 locales、`vue-tsc --noEmit`、Vite production build、bundle budget）；目标 Prettier 与 `git diff --check` 通过。Windows CDP 真 Chrome 中 Composer、Model、思考、Environment、Targets 均可见，实际摘要为 `gpt-5.6-luna · New API Test / 默认 / 不使用 Workspace / 0/1`，思考 Popover 为 `无 / 高 / 极高 / 当前仍使用模型默认值`，console/network/page error 均为空。
- **状态**：`第一轮 Composer 细节优化已完成并验证；reasoning effort 后端合同已由 P-026 后续实施完成。`

## P-028 Agent 会话右侧缺少可编排任务工作栏，Composer 选择控件焦点样式突兀

- **用户反馈**：Agent 会话右侧需要固定工作栏，任务进度、审批等运行态信息都集中到右侧；每个模块应是独立包裹卡片并支持拖拽排序。Composer 点击输入框、模型选择时当前焦点高亮过于方正突兀；模型/思考交互希望更接近 ChatGPT Web，模型点击直接切换，思考强度用分段滑条表达，并按模型能力显示档位。
- **当前证据**：`AgentAppSurface.vue` 已有可选 `TaskRail` 抽屉，`TaskRail.vue` 已接收 current/background/thread runs、approval batch、Plan、budget 与 targets；审批动作继续经现有 `resolveApproval`。因此无需复制运行态事实源。当前模型使用原生 `<select>`，Composer 外框使用 `focus-within:border-primary/60 + shadow-md`，在点击时容易形成明显矩形焦点框。P-026 仍确认 Provider Model/Run snapshot 没有真实 reasoning effort capability/冻结合同。
- **设计决策**：桌面把 TaskRail 默认作为第三栏显示，窄窗继续使用覆盖式抽屉；Rail 内按“运行/审批/计划/目标/历史/后台任务”拆成独立卡片，使用前端 presentation order 拖拽排序，排序仅影响展示，不改变 Run/Approval 事实。模型选择从原生 select 改为 Popover 列表，继续调用现有 `setModelSelection()`；Composer 与选择按钮使用圆角、柔和 ring，保留键盘可见焦点但去掉突兀方框。
- **思考强度边界**：先实现 capability-adaptive 的分段滑条外观与默认态。只有后端未来按 P-026 返回真实允许档位并接受 Run 冻结值时才允许提交；当前无能力字段的模型保持“默认”锁定，不能把本地 UI 状态伪装成上游已生效。
- **本轮范围**：Frontend TaskRail/AgentAppSurface/AgentConfigPopover/Composer 样式与三语言文案；不修改审批 API、Run create、预算/对账、安全策略或 Provider adapter reasoning 参数。
- **验证**：Frontend architecture/i18n/typecheck/Vite build/bundle/format；Windows CDP 真浏览器确认桌面默认右栏、卡片拖拽、审批按钮仍工作路径不变、模型点击切换、Composer/Popover 焦点样式与窄窗无横向溢出。
- **状态**：`基础右栏/拖拽/模型与 reasoning 交互已实现；后续统一任务面板与进一步 UI 降噪转 P-029 TODO。`

## P-029 Agent 弹出浮窗与对话交互 UI/UX 深度重构方案（聚焦前端视觉与交互体验）

- **发现时间**：2026-09-14
- **用户反馈**：
  1. 当前 Agent 弹出后的 UI 不够简洁，用户交互性较差，界面充斥着大量架构说明和提示性长文字。
  2. 桌面端默认呈现“三栏并排”（会话侧栏 + 对话区 + 任务栏），视觉拥挤、压迫感强，缺乏对话重心。
  3. 右侧任务栏缺少明确的顶部弹出/关闭按钮；同时右侧任务栏与顶部“Details”抽屉功能严重重叠，层级混乱。
  4. 各种底层概念（序号、JSON 日志、免责说明）直接暴露，上手门槛高。
  5. **范围与优先级明确**：本阶段**优先聚焦 UI/UX 视觉与人机交互设计**，**先不考虑设置项目（Settings）的重构**（设置项相关预设与中文化已归档，留待后续独立阶段推进）。
  6. 严格保证：**不减少任何既有必要功能**（包含执行状态监控、敏感操作审批、Checkpoints 快照、子 Agent 协同、Plan 任务树、Slash 命令等全部 100% 完整保留）。
- **环境实测基线**：
  - **CDP 浏览器连通性验证**：已通过 HTTP/WebSocket 成功接入 AgentDock 宿主 Chrome 实例（`Chrome/153.0.8010.36`，端口 `9223`），可直接检索正在运行的 Nexus 页面（`https://api.honus.top/settings`、`/workspace`）并捕获实时渲染截图，后续所有 UI 交互改造均可通过该 CDP 端口进行无头/真机双向自动化视觉回归。
  - **当前浮窗 UI 阻碍点**：
    - **三栏并排视觉压迫**：`AgentAppSurface.vue` 在桌面端默认 `taskRailVisible = true`，中间主对话区域被压缩至仅约 500px，一打开就像复杂的后台监控大屏。
    - **双重面板交互冲突**：右侧 `TaskRail`（卡片列表）与点击 Details 触发的 `TaskDetailDrawer`（抽屉浮层）在运行状态、Token 消耗、审批列表、执行历史上有 70% 以上信息重叠，两套面板互相遮挡。
    - **右侧栏缺少顶部显式控制**：目前右侧栏仅在角落有一个绝对定位的小叉号，展开与收起缺少明确的视觉反馈与平滑联动。
    - **顶部 Header 冗余堆砌**：会话标题旁同时存在 Run 状态选择器下拉框、Details 按钮、Tasks 按钮，操作入口分散重复。
    - **Composer 与配置项生硬**：底部 Model/Environment/Targets 弹出框层叠繁琐，输入框聚焦时边框突兀；消息流中依然露出 `#5`、`#6` 等底层物理序号；工具调用缺乏紧凑摘要。

---

### 一、 核心重构设计原则（零功能削减保证）

1. **以会话为绝对视觉中心（Conversation-First）**：
   - 打开 Agent 浮窗的首要任务是“与 Agent 顺畅对话与协作”。主对话区在默认状态下独占视觉主要空间（70% 以上），右侧任务工作栏改为按需展开、一键收起。
2. **单一任务面板，消除双重抽屉（Unified Task Panel）**：
   - 彻底合并 `TaskRail` 与 `TaskDetailDrawer`，所有执行态监控、Plan 计划树、审批流、检查点快照、子 Agent 消息统一由右侧这一个面板承载，层级清晰不重叠。
3. **右侧栏顶部显式控制与双向联动（Intuitive Sidebar Controls）**：
   - 在右侧边栏顶部 Header 增加显式【收起/关闭】按钮；在主对话区顶部右上角设置常驻的【任务工作栏】展开切换按钮（带动态执行态指示与待办角标），实现一键丝滑切换。
4. **渐进式披露与微文案降噪（Progressive Disclosure & De-jargonize）**：
   - 工具调用默认展示精炼的语义胶囊（如“✓ 已读取配置文件”），原始日志点击展开；去除所有底层序列号和后端架构说明文字。
5. **功能完全保留（Zero Functional Regression）**：
   - 审批决断（Approve/Deny）、预算增补、快照恢复（Checkpoints）、子 Agent 消息查看、SSH 目标切换、模型/环境选择等既有能力 100% 保留。

---

### 二、 详细 UI 设计与交互重构方案（模块级实施细则）

#### 模块 1：右侧任务工作栏（TaskRail）折叠/弹出体系与顶部显式关闭按钮

- **涉及组件**：`packages/frontend/src/features/agent/runtime/TaskRail.vue`、`packages/frontend/src/features/agent/host/AgentAppSurface.vue`
- **详细修改说明**：
  1. **右侧栏 Header 标准化操作区（顶部显式关闭）**：
     - 在 `TaskRail.vue` 顶部的 Header 区域进行重新布局：
       - **左侧**：任务工作栏图标 `<i class="fa-solid fa-list-check"></i>` 与面板标题【任务工作栏】。
       - **右侧**：设计显式、高点击热区的【收起/关闭按钮】：
         ```html
         <button
           type="button"
           class="agent-rail-toggle-close flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary hover:bg-header hover:text-foreground transition-colors"
           :title="$t(common.close)"
           @click="emit(close)"
         >
           <i class="fa-solid fa-chevron-right text-xs"></i>
         </button>
         ```
       - 彻底移除原 `AgentAppSurface.vue` 中悬浮在右上角的绝对定位小叉号，让关闭操作与面板 Header 浑然一体。
  2. **默认收起策略与按需呼出**：
     - 在 `AgentAppSurface.vue` 中，将 `taskRailVisible` 初始值统一设为 `false`（或仅在有活跃审批时自适应展开），打开浮窗时优先提供宽敞舒适的对话阅读空间。
  3. **主界面顶部 Header 双向呼出按钮**：
     - 在主对话区顶部右上角保留常驻的【任务工作栏】按钮：
       - 当任务正常空闲时：展示幽灵风格按钮 `[ 任务清单 ]`。
       - 当有 Run 正在执行时：按钮带绿色微光呼吸圆点（`● 执行中`）。
       - 当有等待审批（Pending Approvals）时：按钮高亮警示黄色，并展示数量徽标 `[ 待审批 (1) ]`。
     - 点击该按钮即可在“滑出右侧栏”与“收回右侧栏”之间无缝切换。
  4. **平滑动画与响应式自适应**：
     - 桌面端（宽屏）：右侧栏以平滑推拉动效展开，主对话区宽度自适应调整，不产生页面抖动。
     - 中窄屏（平板/手机）：右侧栏以轻量抽屉覆盖层（Overlay Drawer）滑出，背景附带半透明遮罩，点击遮罩或顶部关闭按钮即平滑回退。

#### 模块 2：TaskRail 与 TaskDetailDrawer 功能深度融合（合并为一个统一面板）

- **涉及组件**：`packages/frontend/src/features/agent/runtime/TaskRail.vue`、`packages/frontend/src/features/agent/runtime/TaskDetailDrawer.vue`、`packages/frontend/src/features/agent/host/AgentAppSurface.vue`
- **详细修改说明**：
  1. 彻底停用并废除冗余的浮层抽屉 `TaskDetailDrawer.vue`，将其内部所有能力完整收拢进 `TaskRail.vue`，形成结构清晰的单面板系统。
  2. 单一右侧面板内的六大模块卡片组织（自上而下）：
     - **卡片 1：当前执行概览（Run Overview）**：
       - 环形或线型优雅进度条、运行状态徽标、步骤数（如 `12/80 步`）、Token 消耗量、已执行用时。
       - 运行中提供【停止/取消】操作；任务完成时提供轻量【清除/归档】选项。
     - **卡片 2：待审批事项（Pending Approvals - 核心高亮）**：
       - 存在未决审批时自动置顶，以柔和黄色卡片醒目呈现；卡片直接提供【批准执行】与【拒绝】按钮，点击“查看详情”可展开查看原始命令与哈希校验码。
     - **卡片 3：任务执行计划（Plan & Steps）**：
       - 树状或步进式呈现 Agent 的执行计划，清晰展示每一步的完成状态（已完成、执行中、待执行、受阻），高亮当前焦点步骤。
     - **卡片 4：检查点快照（Checkpoints）**：
       - 折叠面板，提供一键【保存检查点】按钮，并按时间倒序列出历史检查点，支持一键恢复至历史状态。
     - **卡片 5：子 Agent 协作（Subagents & Delegations）**：
       - 折叠面板，展示当前任务派生的子 Agent 状态、分配的目标及子任务间的通信消息流。
     - **卡片 6：会话运行历史（Run History）**：
       - 折叠面板，简洁罗列该会话历史上的所有 Run，点击可回顾前序任务概况。

#### 模块 3：对话顶部 Header 极简降噪

- **涉及组件**：`packages/frontend/src/features/agent/host/AgentAppSurface.vue`、`packages/frontend/src/features/agent/host/AgentHubWindow.vue`
- **详细修改说明**：
  1. **移除冗余的 Run 状态下拉框与 Details 按钮**：
     - 删除 Header 上的 `<select class="agent-run-history">` 与单独的 `<button>详情</button>`，所有历史回溯与运行详情均已收归右侧任务工作栏，不再在顶部争抢空间。
  2. **Header 极简两端对齐结构**：
     - **左侧**：移动端会话侧栏汉堡菜单按钮 + 当前会话标题（单行截断展示，支持双击快速内联重命名）。
     - **右侧**：当前 Run 状态轻量 Badge（如 `● 运行中`、`✓ 已完成`） + 【任务工作栏】展开切换按钮（带动态呼吸角标）。
  3. **浮窗全局 Header（AgentHubWindow.vue）精简**：
     - 压缩多 App 状态条的纵向高度，缩小图标与多余间距，确保浮窗整体观感轻盈现代。

#### 4. Composer 输入区与运行配置胶囊现代化

- **涉及组件**：`packages/frontend/src/features/agent/host/AgentAppSurface.vue`、`packages/frontend/src/features/agent/ai/AgentConversation.vue`、`packages/frontend/src/features/agent/host/AgentConfigPopover.vue`
- **详细修改说明**：
  1. **一体化极简胶囊组（Capsule Group）**：
     - 将原输入框内部大块、分散的设置选择栏，重构为类似主流现代对话工具的极简状态胶囊组：
       - `[ 🧠 gpt-4o ▾ ]`：点击唤起轻量模型切换面板，展示已配置的可用模型。
       - `[ ⚡ 思考: 默认 ▾ ]`：**智能感知**——仅当选定模型真实具备思考档位能力时呈现；若当前模型不支持，则直接隐去，绝不弹出“当前不支持”的占位说明弹窗。
       - `[ 📦 环境: 无 ▾ ]`：仅展示当前选中的 Recipe 名称（如“Node.js 开发环境”），点击切换。
       - `[ 🖥️ SSH: 0/1 ▾ ]`：显示选中的远程机器数，点击勾选。
     - 去除所有重复的静态说明前缀（如 “NEXT RUN”、“Model:” 等），只保留图标与当前值，大幅减少视觉杂讯。
  2. **输入框焦点样式柔和化**：
     - 去除原有的方正矩形硬高亮边框（`focus-within:border-primary/60 + shadow-md`），改为现代化无缝圆角卡片（`rounded-2xl`），搭配浅淡柔和的 Focus Ring（`focus-within:ring-2 focus-within:ring-primary/20 border-border/70`）。
  3. **快捷指令（Slash Commands）轻量化**：
     - `/goal`、`/interrupt`、`/queue` 等指令弹窗改为输入框上方的悬浮卡片，附带简明操作动词提示（如“设定任务目标”、“打断生成”），不再大段解释底层协议。

#### 5. 消息流与执行工具（Tool Timeline）卡片优化

- **涉及组件**：`packages/frontend/src/features/agent/ai/ConversationMessage.vue`、`packages/frontend/src/features/agent/ai/AgentMessageBody.vue`
- **详细修改说明**：
  1. **彻底移除底层物理序号**：
     - 去掉消息气泡上方显示的 `#5`、`#6`、`#7` 等物理 Ledger 序号，仅保留精炼的角色标示与可读的时间提示。
  2. **工具调用（tool_result）紧凑卡片化**：
     - 正常完成的工具调用折叠为极简单行胶囊：
       - `✓ 已执行终端诊断 (查看详情 ▾)`
       - `✓ 已读取文件 packages/frontend/... (查看详情 ▾)`
     - 失败或报错的工具调用展示淡红色警告边框及错误核心行。
     - 用户点击单行胶囊后，才平滑展开等宽代码块展示原始 JSON 或终端原始输出，避免原始长日志强行刷屏。

#### 6. 文案全面去架构化与微文案降噪

- **涉及组件**：`packages/frontend/src/features/agent/i18n/zh-CN.json`、`en-US.json`、`ja-JP.json`
- **详细修改说明**：
  - 彻底清理如下直接把架构规范当成用户文案的长句：
    - 删除 Checkpoints 卡片里的 “Facts only: active leases, tokens, containers, and processes are never saved.”
    - 删除 Dev environment 卡片里的 “One Workspace keeps stable project files while each runtime generation composes Node, Python, Go...”
    - 删除 TaskRail 顶部的 “拖拽卡片以自定义顺序”
    - 删除思考强度 Popover 里的长句“当前仍使用模型默认值。根据模型支持的思考强度进行调整...”
  - 全面换用清晰直观的用户意图文案：“保存检查点”、“运行环境”、“工具链”、“思考强度”。

---

### 三、 CDP 浏览器真机 UI 验证与视觉回归流程

- **连通环境基准**：
  - 调试地址：`http://172.30.31.11:9223`
  - 运行内核：Chrome 153.0.8010.36
  - 目标页面：`https://api.honus.top/settings`、`https://api.honus.top/workspace`
- **本轮重构验收标准**：
  1. **交互验证**：
     - 桌面端打开 Agent 浮窗后，主会话区宽敞通透，右侧栏默认收起或仅展示轻量状态。
     - 点击右上角【任务工作栏】按钮，右侧面板平滑滑出；点击右侧栏顶部的【收起】按钮，面板平滑收回。
     - 触发审批时，右侧栏置顶高亮展示审批卡片，批准/拒绝按钮响应灵敏。
     - 点击输入框与配置胶囊，弹出菜单定位精准，无突兀硬矩形焦点。
  2. **多端分辨率与布局安全**：
     - 在 1920×1080 桌面、1040px 临界宽度、720px 平板、390px 移动端下分别进行 CDP 截图回归，确保全部分辨率下 `document.documentElement.scrollWidth <= window.innerWidth`，无任何横向滚动条溢出。
     - 浏览器控制台检查 `page_errors`，无任何 Vue 响应式警告或渲染错误。

---

### 四、 后续规划说明

- **关于设置项目（Settings）**：
  - 本条目严格聚焦浮窗与对话核心交互 UI。
  - 模型 Provider 预设模板（OpenAI / DeepSeek / Claude / Ollama）、预算与 HardLimits 驼峰转中文及 3 档推荐预设、ACP/Browser 运行时可视化输入等设计方案已完整归档，将在本轮 UI 交互重构验收完成后，作为独立后续任务专门立项实施。

- **TODO(P-029/agent-uiux)**：以上未落地的统一任务面板、TaskDetailDrawer 收敛、多分辨率完整视觉回归及 Settings 后续阶段均为有意保留的产品计划。后续代码清理不得仅因组件/入口暂未完全使用而删除对应设计或兼容层；应在实现完成、被等价方案替代或产品决策明确撤销后再移除。
