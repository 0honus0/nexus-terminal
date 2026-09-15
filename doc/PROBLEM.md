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

- **问题/原因**：此前 `createThread` 虽支持省略 title，但 Thread title 只是创建时字段，没有 ownership、versioned rename 与跨标签变更事件；前端因此只能长期显示 `New conversation`，也不能安全区分 placeholder、系统自动标题与用户标题。
- **当前合同（2026-09-15）**：
  1. `ai_threads.title_source` 明确为 `placeholder | auto | manual`；新建无标题 Thread 为 `placeholder`，显式标题为 `manual`。
  2. 第一次有效用户文本在 `run.create` 或活动 Run 的 `appendInput/interrupt` 原子事务中生成确定性的有界标题：折叠空白、最多 80 个 Unicode 字符，不额外调用 Provider，因此自动命名不会增加模型 Token、首轮延迟或 Provider 故障面。
  3. 一旦标题来源变成 `auto` 或 `manual`，后续用户输入不得再次自动覆盖。显式标题从创建开始就是 `manual`。
  4. 提供 `PATCH /api/v1/apps/:appId/threads/:threadId`，请求 `{ title, expectedVersion }`；成功后 `title_source=manual` 且 Thread version +1，旧 version 返回状态冲突。Frontend Agent API 与 Plugin Frontend SDK 同步暴露 rename 合同。
  5. 自动/手动标题变化都写入 durable `thread.changed` Host event；Host leader 将 payload 通过现有 BroadcastChannel 转发到其它标签页，当前已挂载的对应 App surface 只刷新 Thread 列表并更新 current Thread 引用，不重建当前 Run/Conversation。
  6. migration #21 为长期数据库补 `title_source`。历史 `New conversation` 仅在“尚无任何 Thread entry”时回填为 placeholder；已有内容的历史会话保持 manual，避免升级时突然被重新命名。
- **验收结果（2026-09-15）**：Backend build 与 Frontend `vue-tsc --noEmit` 通过；隔离 SQLite smoke 已验证 migration 20→21、首次输入自动命名、manual 不覆盖、rename version 冲突、auto/manual `thread.changed`、emoji 80 字符边界。
- **状态**：`已实施并完成隔离合同验证；当前 UI 不增加新的重命名控件，后续如需要可直接复用 versioned rename 合同`

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
  7. **浮窗模态遮罩体验改造（Windows 模态风格）**：原 Agent 只是一个普通悬浮窗，浮窗打开时下方工作区和导航栏依然能被点击操作，且周围背景未作虚化处理，缺乏焦点与防误触保障；要求改造为类似 Windows 模态窗口的遮罩层：最上层浮窗激活期间，下方页面完全禁止操作（阻止鼠标点击及滚动穿透），四周外露空白边缘呈现高质感亚克力毛玻璃模糊效果（Acrylic Backdrop Blur）。
  8. **全屏状态顶部留白过大修复**：原全屏（最大化）状态下强制写死 `top: 64px`，导致在模态遮罩下顶部露出一整片宽大的模糊背景区，视觉空旷突兀且严重压缩会话垂直空间；要求将全屏顶边距缩减并与四边保持一致（统一为 12px 均等外沿光晕留白），大幅提升对话区域的可视高度。
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

0. **Windows 模态亚克力沉浸与防误触体系（Modal Acrylic Focus & Interaction Isolation）**：
   - Agent 浮窗展开期间建立全屏 `fixed inset-0 z-40` 亚克力模糊遮罩，物理阻断对底层页面（终端、表单、顶栏导航等）的任何点击和滚动穿透。
   - 浮窗边缘空白区域应用 `backdrop-filter: blur(10px)` 搭配浅淡深色调（`rgba(15, 23, 42, 0.4)`），营造深邃、聚焦的沉浸协作氛围。
   - 用户点击外部空白区域时触发仿 Windows 模态对话框的呼吸光晕（Focus Ring Pulse），友好提示交互锁定于当前浮窗，绝不误关闭窗口导致输入状态丢失。
   - 全屏/最大化状态下四周统一留白 12px，消除顶部 64px 巨大空白槽，归还 52px 纵向对话与输入面积。
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

#### 模块 4.1：App 选项卡关闭交互与加号浮层显式关闭体系

#### 1. 问题与视觉痛点

- 移至下方的 App 一列呈现为多标签（Tab）交互模式，右侧提供了 `+` 按钮用于挑选和打开 App。
- 但缺少标签关闭能力，多 App 打开后无法关闭不需要的应用，未选中标签缺乏边框导致视觉层级模糊。
- 此外，点击 `+` 弹出的卡片浮层右上角缺少显式的关闭按钮 `×`，桌面端用户只能通过点击外部或 Esc 关闭，缺乏直接的操作靶点。

#### 2. 解决方案与实现细节

- **未选中 App 浅色精致边框**：
  - 未选中 App 标签应用 `border-border/80 bg-card/70 text-text-secondary hover:border-border hover:bg-header hover:text-foreground`，与当前激活标签的淡紫高亮形成克制明晰的对比。
- **App 标签独立关闭按钮**：
  - 在 `AgentHubWindow.vue` 中维护 `openAppIds` 动态标签集合，支持任意 App 标签的生命周期管理。
  - 每个 App 标签右侧提供专用的小关闭按钮（`fa-solid fa-xmark`），支持点击与键盘 Enter 触发；
  - 具备兜底安全机制：标签数量为 1 时隐藏关闭按钮，防止全部关闭导致主内容区空白；
  - 当关闭当前激活 App 时，自动平滑切换到相邻标签；
  - 关闭后的 App 可随时点击最右端 `+` 按钮在弹出列表中重新开启并加入标签栏。
- **加号弹出浮层显式关闭按钮**：
  - 在 `AgentAppSwitcher.vue` 的弹出面板头部右侧增加轻量关闭按钮（`fa-solid fa-xmark`），支持点击即时收起。

### 模块 6：浮窗右下角缩放把手（Resize Handle）全局规范统一

#### 1. 问题与视觉痛点

- Agent 浮窗右下角缩放手柄此前采用两道旋转 -45° 斜杠设计，尺寸（h-8 w-8）与全站其他悬浮窗口（如文件管理器 FileManager、文档预览/编辑器弹窗等）的直角折角 L 型把手（h-5 w-5 直角折角）视觉语言严重割裂。

#### 2. 解决方案与实现细节

- **对齐全局交互规范**：
  - 在 `AgentHubWindow.vue` 中将右下角 resize handle 重构为全局统一的直角折角把手。
  - 外层规格：`absolute bottom-0 right-0 z-40 h-5 w-5 touch-none select-none cursor-nwse-resize rounded-br-2xl bg-transparent opacity-70 transition hover:bg-primary/15 hover:opacity-100`；
  - 内层折角标：`pointer-events-none absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-text-secondary/70 transition-colors group-hover:border-primary`；
  - 保持平滑顺畅的拖拽缩放能力，且在最大化全屏模式下智能隐藏。

### 模块 5：第三栏分栏图标、卡片分隔拖拽与全链路 Token/缓存率指示体系

#### 1. 问题与视觉痛点

- 顶栏右侧原有的“任务”和“详情”两个文字按钮占用水平空间较多，视觉繁琐。
- 侧边栏/第三栏内部各功能（任务进度、审批、计划、历史等）原缺少清晰分隔，折叠的 Token 进度条挤在卡片底部体验较差。
- 用户无法直接在对话主视野与单条消息中感知到 Token 消耗与 Prompt 缓存命中率。

#### 2. 解决方案与实现细节

- **顶部分页/分栏统一图标按钮**：
  - 移除原“任务”和“详情”文字按钮，替换为精致的 `fa-solid fa-table-columns` 分页分栏图标按钮。
  - 支持展开/收起第三栏，在有审批或后台任务时保留微型角标提醒。
- **第三栏卡片独立分隔与自由拖拽排序**：
  - 第三栏各模块统一规范为独立 Card（`rounded-xl border border-border/70 bg-card p-3.5 shadow-xs`），间距设为 `space-y-3`。
  - 保留并优化卡片拖拽手柄（`agent-rail-drag-handle`），支持卡片上下自由拖拽排序并持久化到本地存储。
  - 聚焦展示任务进度条、当前执行步骤、执行耗时与验证状态。
- **会话输入框上方总 Token 消耗与缓存率指示条**：
  - 在会话输入框上方新增极简元信息指示条：展示会话总消耗 Token（如 `3.8k tok`）、输入/输出拆分（`入 3.1k · 出 678`）、缓存命中率徽标（`缓存率 85%`）、步骤数及预算进度条。
- **单条消息右下角 Token 消耗与缓存率**：
  - 在每条消息右下角（时间戳/状态旁）展示该条消息的 Token 消耗徽标（如 `🪙 876 tok`）与缓存命中率（如 `缓存 82%`），支持悬停查看输入/输出细分明细。
  - 后端在持久化 `assistant_message` ledger 时同步存入精准的 `usage` 字段，向前向前完全兼容。

### 模块 0：Windows 模态亚克力遮罩与全屏视口沉浸体系（Backdrop & Fullscreen Polish）

- **涉及组件**：`packages/frontend/src/features/agent/host/AgentHubWindow.vue`、`packages/frontend/src/features/agent/host/window-manager.ts`
- **详细修改说明**：
  1. **全屏亚克力毛玻璃遮罩（Backdrop Blur & Dimming）**：
     - 在 `AgentHubWindow.vue` 浮窗本体下增加独立的模态遮罩层：
       ```html
       <Transition name="agent-backdrop">
         <div
           v-if="visible"
           class="agent-hub-backdrop fixed inset-0 z-40"
           aria-hidden="true"
           @pointerdown.stop="handleBackdropPointerDown"
           @wheel.prevent
           @touchmove.prevent
         />
       </Transition>
       ```
     - 显式样式定义保证跨浏览器渲染一致性：
       ```css
       .agent-hub-backdrop {
         background-color: rgba(15, 23, 42, 0.4);
         backdrop-filter: blur(10px);
         -webkit-backdrop-filter: blur(10px);
       }
       .agent-backdrop-enter-active,
       .agent-backdrop-leave-active {
         transition: opacity 0.2s ease;
       }
       .agent-backdrop-enter-from,
       .agent-backdrop-leave-to {
         opacity: 0;
       }
       ```
  2. **事件穿透完全阻断（下面不能操作）**：
     - 遮罩层使用 `@pointerdown.stop` 截获鼠标指针事件，使底层顶栏链接（如“终端”、“设置”、“登出”）、背景工作区会话及设置面板完全无法被触发。
     - 增加 `@wheel.prevent` 与 `@touchmove.prevent`，彻底防止滚轮事件穿透引起底层页面连带滚动。
  3. **仿 Windows 模态点击聚焦反馈（Focus Pulse）**：
     - 点击遮罩外部空白处不会突兀关闭 Agent，避免打断用户的输入流与任务查看进度。
     - 触发 `flashWindow` 状态，浮窗在 400ms 内展示 `ring-2 ring-primary/60 scale-[1.002]` 的弹性光晕微反馈，明确传达“请在此窗口中完成操作”的 Windows 模态人机交互语言。
  4. **全屏（最大化）对称 12px 留白修复（顶部空白过大问题修复）**：
     - 原实现中为露出导航栏保留了 `top: 64px`，导致全屏时顶部割裂且留白过宽。
     - 将 `style` 计算属性中的最大化参数修正为：
       ```ts
       if (state.maximized) return { left: 12px, top: 12px, right: 12px, bottom: 12px };
       ```
     - 同步将 `window-manager.ts` 中的 `TOP_MARGIN` 限制由 64px 调整为 12px，全屏时窗口四周呈现规整、均等的 12px 毛玻璃光晕外沿，同时为会话内容新增 52px 纵向视野。
  5. **无障碍与层级规范化**：
     - 浮窗本体将 `aria-modal="false"` 修正为标准的 `aria-modal="true"`，角色为 `role="dialog"`。
     - 浮窗 z-index 提升至 `z-50`（遮罩为 `z-40`，底部页面导航为 `z-30`，浮窗内设置 Popover 为 `z-[60]`），形成严谨规整的层级栈。

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

#### 模块 7：输入框上方圆角线条恢复与全域紫色选中消除

- **涉及组件**：`AgentConversation.vue`、`AgentHubWindow.vue`、`AgentAppSurface.vue`、`AgentAppSwitcher.vue`、`ConversationMessage.vue`
- **详细修改说明**：
  1. **输入框上方圆角线条与 Token 状态条精致化**：
     - 会话 Token 统计与缓存率指示条重构为独立精致的圆角胶囊卡片（`rounded-xl border border-border/80 bg-card/60 shadow-2xs px-3 py-1.5`），清晰展示会话总消耗、输入/输出细分、缓存命中率及预算胶囊条。
     - 输入框外壳卡片强化为标准饱满的 `rounded-2xl border border-border bg-background shadow-sm overflow-hidden`，确保输入框本体四周及顶部的圆角线条完全饱满清晰呈现。
  2. **全面去除刺眼的紫色边框与全域紫色选中高亮**：
     - **App 标签选中**：彻底去除 `border-primary/35` 与 `bg-primary/10`，改为极简浮凸的浅色中性边框卡片（`border-border bg-card shadow-xs ring-1 ring-border/20`）。
     - **输入框 Focus 状态**：彻底去除 `focus-within:border-primary/30` 与紫色 Focus Ring，统一为高级自然的中性灰与柔和景深（`focus-within:border-border-hover focus-within:shadow-md ring-1 ring-border/40`）。
     - **左侧会话列表竖向一列选中**：去除选中会话的紫色头像方块（`bg-primary text-white`）与紫色箭头（`text-primary`），重构为高对比深黑底白字方块（`bg-foreground text-background shadow-xs`）与中性灰小箭头，整列彻底清除紫色杂讯。
     - **应用切换与模型选择下拉列表**：选中的选项整行紫色背景改为中性微浮凸浅色边框卡片（`border border-border/80 bg-card shadow-xs`），对勾图标同步转为中性黑白。
     - **发送按钮与气泡背景**：用户消息气泡背景改为干净的卡片质感，发送按钮改为 `bg-foreground text-background` 高阶对比色阶。

#### 模块 8：输入栏下方配置胶囊与弹出面板极简重构与降噪

- **涉及组件**：`AgentAppSurface.vue`、`AgentConfigPopover.vue`、`i18n/*.json`
- **详细修改说明**：
  1. **胶囊触发按钮（Trigger）信息降噪**：
     - **模型胶囊**：移除非必要的提供商副标题别名（如“New API Test”），仅展示简洁的模型 ID（如 `gpt-5.6-luna`），降低 Trigger 视觉冗余。
     - **思考强度胶囊**：智能感知，仅当模型具备思考能力（`reasoningCapabilityAvailable`）或当前 Run 锁定时才渲染胶囊，不支持时隐去，杜绝无意义占位。
     - **SSH 主机胶囊**：增加直观前缀 `SSH 0/1`，替代原本含义生硬模糊的 `0/1`。
  2. **全局 Popover 互斥关闭与外部点击优化**：
     - 在 `AgentConfigPopover.vue` 中建立模块级单例激活管理，打开任意一个 Popover 时自动关闭其它已打开面板，彻底杜绝多个弹窗重叠的视觉混乱；
     - 增加 `mousedown` 与 `pointerdown` 事件兼容支持，点击输入框或页面任意外部区域可靠收起弹窗。
  3. **弹出面板（Popover Panel）去繁就简、去除说教废话**：
     - **模型面板**：去除无意义的数字计数，卡片选中统一为浅色浮凸卡片及中性黑白对勾。
     - **思考强度面板**：彻底移除丑陋的 `<input type="range">` 滑动条以及底部的“拖动滑块或点击档位；新 Run 会冻结当前选择”说教长句；重构为现代一体化分段药丸（Segmented Control）按钮组（`[ 无 | 低 | 中 | 高 | 极高 | 最大 ]`），单行横向排布，点击即切。
     - **运行环境面板**：彻底清除混乱的底层内部术语——删除右上角“Runner 不可用/已就绪”状态大药丸、删除大写英文“SELECT RUNTIME RECIPE / 下一次 RUN 环境”、删除底部的“冻结/默认工具链 (TOOLCHAIN)”与“未选择工具版本”调试文字、删除原生丑陋 radio；重构为标准卡片单选列表（“原生环境”与各配方），点击即选并自动收起。
     - **SSH 主机面板**：重构为标准卡片勾选列表，消除原生 checkbox 错位，选中带有黑底白对勾与浅边框微浮凸。

#### 模块 9：思考等级复刻 GPT 官方胶囊滑块、单行底栏与系统字体栈统一

- **涉及组件**：`AgentConversation.vue`、`AgentAppSurface.vue`、`ArtifactPicker.vue`、`AgentConfigPopover.vue`、`tokens.css`、`global.css`、`i18n/*.json`
- **详细修改说明**：
  1. **复刻 ChatGPT 网页端官方思考等级胶囊滑块卡片**：
     - **顶部 Header**：左侧蓝紫色闪电算力图标（`fa-bolt`），中间大字档位名称（`中 >`，支持点击快切）加模型副标，右侧配备一键重置默认思考等级按钮。
     - **饱满胶囊滑块条**：内嵌各个档位刻度圆点，动态蓝紫渐变与 Ultra 星光流光填充色带，中心配备饱满白色圆形滑钮手柄，支持点击或拖拽刻度精准吸附档位。
     - **底部简短说明**：中英日多语言展示各档位特点（如“平衡速度与思考深度”、“深入推理，适合复杂问题与代码”）。
  2. **底栏单行整合与文件最左侧排列**：
     - 将文件（`ArtifactPicker`）移入配置胶囊同行最左侧，与模型、思考等级、运行环境、SSH 主机共同组成统一底栏，右侧为发送与取消按钮，节省垂直空间，视觉紧凑工整。
  3. **弹层中心点精确对齐**：
     - `AgentConfigPopover` 优化水平居中定位算法，在左右空间足够时，弹窗水平中心点严格对齐点击功能项中心点；贴近边界时自动安全贴边，杜绝溢出。
  4. **窄模式自适应响应式（优先隐文字保留图标）**：
     - 文件、模型、思考强度、环境、SSH 主机胶囊全部配置 `hidden sm:inline`，在窗口窄化或小屏时自动折叠文字标签，纯净展示图标与数字徽标，绝不换行挤爆。
  5. **全局系统字体栈统一与抗锯齿增强**：
     - 彻底修复 `--font-family-sans-serif: sans-serif` 导致的系统回退字体发虚怪异问题，重构为现代系统无衬线字体栈（PingFang SC / Microsoft YaHei / Segoe UI / Apple System），并启用 `-webkit-font-smoothing: antialiased`，使 Agent UI 字体与 Nexus 全局主题保持高度统一与细腻平滑。

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

## P-030 基础组件下拉框非原生美化、选中不高亮选项与文件库就地交互升级

- **问题现象**：
  1. 页面中（如文件库、设置页及部分基础表单）大量直接采用原生 `<select>` 标签，下拉弹出操作系统的原生黑白框，风格粗糙且与 Nexus 主题严重脱节。
  2. 原有表单基础组件（`BaseInput`、`BaseTextarea`、`BaseSelect`、`BaseListboxSelect`）及 `global.css` 强制注入了高饱和度紫色发光边框与 3px 外发光环（`--input-focus-glow` / `--input-focus-border`），用户在聚焦或点击时产生突兀的刺眼紫色轮廓。
  3. 基础组件缺少显式声明“不高亮”的参数选项，调用方无法优雅关闭焦点高亮。
  4. 文件库（ArtifactLibraryView）原本的清理垃圾确认跨距大，且筛选栏由原生下拉框拼凑，样式不统一。

- **根因分析**：
  1. `formControlClasses.ts` 写死了 `focus:border-input-focus-border focus:ring-2 focus:ring-[var(--input-focus-glow)]`。
  2. `global.css` 全局带 `!important` 匹配 `input:focus`、`textarea:focus`、`select:focus`，导致各层级样式无法覆盖紫色阴影。
  3. `BaseSelect.vue` 仅简单包裹原生 `<select>`，未隐藏浏览器原生外观与箭头；`BaseListboxSelect.vue` 缺少尺寸扩展与左对齐排版。

- **决策与实现方案**：
  1. **全局样式解除强制紫色发光并支持不高亮选择器**：
     - 在 `global.css` 中为聚焦规则添加 `:not([data-no-highlight]):not(.no-highlight)` 排除条件。
     - 为 `[data-no-highlight]:focus` 与 `.no-highlight:focus` 显式声明 `box-shadow: none !important; outline: none !important;`，保证不高亮选项生效。
  2. **基础组件提供不高亮选项与克制中性焦点样式**：
     - 重构 `formControlClasses.ts`，提供 `getFormControlClass(options?: { highlight?: boolean; invalid?: boolean })`。默认 `highlight: false`，聚焦采用中性色 `focus:border-foreground/30` 并彻底移除粗紫色环。
     - `BaseInput.vue`、`BaseTextarea.vue`：引入 `highlight?: boolean` prop（默认 `false`），模板注入 `data-no-highlight`，实现基础组件默认不高亮、可选高亮。
  3. **下拉框非原生化质感升级**：
     - **`BaseListboxSelect.vue`**：提供完全自定义的 Popover 浮层。支持 `size`（`sm`、`md`、`lg`）、`align`（`left`、`center`）及 `highlight` 属性；Trigger 配备展开时 180° 顺滑旋转微箭头；浮层使用毛玻璃圆角卡片（`rounded-xl bg-input/95 backdrop-blur-md shadow-2xl`），选中项配备微底色与 `fa-check` 勾选图标。
     - **`BaseSelect.vue`**：消除系统默认外观（`appearance-none`），定位精致 SVG 微箭头，统一支持 `size` 与 `highlight` 选项。
     - 导出 `BaseListboxOption` 统一类型。
  4. **文件库（ArtifactLibraryView）UI 整体精细化**：
     - 将 App 筛选与保留状态筛选替换为紧凑型（`size="sm"`）`BaseListboxSelect`，告别原生下拉框；
     - 搜索输入框启用 `data-no-highlight`，去除紫色高亮边框；
     - 搜索按钮优化为高度统一（`h-8`）的沉稳微质感操作键；
     - 清理垃圾二次确认条紧凑内联于原按钮右侧，操作距离极短，无需下移视线。

  5. **首页/Agent左侧历史会话侧边栏高质感美化**：
     - **舒展布局与可用宽度提升**：将原本局促的 `216px` 栅格定宽扩展为 `256px`，彻底解决会话标题被粗暴截断的问题，大幅提升可读性。
     - **去除土气单字母方块头像**：弃用老旧的大单字（“N”、“测”、“P”）高对比正方形灰底块，替换为轻巧细腻的会话气泡微图标（`fa-regular fa-message`）与圆角浅底色。
     - **前台悬浮激活卡片**：选中会话转为实体浮动微卡片（`bg-background text-foreground shadow-xs border border-border/80 ring-1 ring-border/25`），彻底消除末尾突兀生硬的 `>` 箭头。
     - **活跃任务脉冲指示灯**：针对正在执行或等待审批的会话，在微图标角标处配备呼吸微动效脉冲状态灯（绿色执行中、琥珀色待审批），一目了然。
     - **顶部与搜索栏精致化**：配备优雅的“+ 新建”圆角微按钮与会话总数微徽标，搜索输入框增加 `data-no-highlight` 并支持一键快速清空。
     - **滚动条微型化美化**：会话侧边栏定制 4px 悬浮半透明微圆角滚动条，贴合现代 AI 应用（ChatGPT / Cursor）的沉浸质感。
  6. **浮窗顶部大面积空白消除与拖拽自由度解锁**：
     - **拖拽死锁根除**：原 `window-manager.ts` 中的 `clampBounds` 使用了 `screen.height - height - MARGIN` 作为 y 坐标的上限，当浮窗高度较大时，y 的范围被死死锁紧在偏下位置，导致向上拖动被判定出界直接扯回。现重构限制算法，只要标题栏停留在视口内（`minY = 0`），允许用户将窗口无阻碍向上贴顶拖动。
     - **标题栏拖拽事件穿透**：移除了 Header 左半部信息容器的 `@pointerdown.stop`，使鼠标按住整个标题栏的任意标题、图标及空白区域均可平滑拖动窗口，仅保留具体操作按钮（视图 Nav、控制键）的独立事件。
     - **全屏模式真贴顶（0 边距）**：最大化全屏状态下由原本四周保留 12px 缝隙优化为全贴合（`top: 0; left: 0; width: 100vw; height: 100dvh; border-radius: 0;`），彻底解决全屏顶部漏底色与大空白问题。
     - **Header 各层垂直高度瘦身**：
       - 浮窗标题栏高度由 `h-14`（56px）精炼为 `h-11`（44px）；
       - App 选项卡栏高度由 `h-10`（40px）精炼为 `h-8.5`（34px）；
       - 会话区 Header 高度精炼为 `h-10`（40px）；
       - 累计释放了近 40px 垂直冗余空间，内容区视野显著提升。
  7. **彻底解决浮窗拖拽时灵时不灵与大窗口下“完全拖不动”的底层死锁**：
     - **大窗口死锁根因**：原 `clampBounds` 中 `x` 与 `y` 的最大值分别计算为 `screen.width - width - MARGIN` 和 `screen.height - height - MARGIN`。当用户在较大屏幕下将窗口拉大（如宽度 1880px、高度 870px 时），最大值与最小值仅差十几甚至几像素，导致任何向左、向右、向上拖拽的位移立即被边界钳制拉回原位，出现“完全拖不动”的假死现象。
     - **边界算法彻底解耦**：重构限制公式，左右仅保证窗口不完全移出屏幕（允许贴顶与超出边界浏览），y 轴支持 `0` 贴顶，只要标题栏停留在视口内（`screen.height - 36`）即可自由位移，无论窗口多大多高都能随心所欲拖拽。
     - **重构为全局 Window 事件捕获架构**：彻底淘汰原本在 `<header>` 元素上绑定 `@pointermove` 和依赖 `setPointerCapture` 的脆弱机制（鼠标移出 44px 高的窄标题栏容易丢失事件流），改为在 `pointerdown` 时向 `window` 动态注册 `pointermove` 与 `pointerup`，无论光标移动多快均能 100% 捕获位移，松开鼠标全局立即释放，彻底消除事件断流与状态残留。

- **验证标准**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - 聚焦表单与下拉组件时，均呈现低调克制中性微边框，无刺眼紫色光晕。

## P-031 Agent 插件与生态管理体系现代高级感重构（消除视觉冗余、统一应用生命周期与高质感市场）

- **问题现象与痛点定位**：
  1. **同一插件上中下三重重复罗列，视觉严重割裂繁琐**：在 Agent 设置“插件与安全”页面中，`Nexus Agent` 和 `Full-stack Plugin` 竟在同一屏内以三种不同且割裂的形态重复出现 3 次：
     - 最上方【Agent App】列出两个插件（仅支持停用/启用与查看权限）；
     - 中间【可安装 App 与 Skill】又出现独立的【已安装插件】白条区域，再次罗列两个插件并单独提供红色卸载按钮；
     - 最下方【插件仓库】官方 Catalog 再次罗列两个插件，不管本地是否已安装，全部傻傻地显示紫色【校验插件包】大按钮。
  2. **插件状态脱节与操作误导**：已在系统安装并稳定运行的插件，在市场仓库卡片中缺乏清晰的“已安装”徽标与状态感知，用户困惑于“为什么装好了还在催我初次安装校验”。
  3. **表单原生生硬与刺眼紫光**：仓库 Catalog URL 输入框与发布者公钥表单使用原生 HTML 控件，聚焦时产生高饱和紫色发光，且排版突兀。
  4. **能力授权缺乏直观分类统计**：展开安全策略配置时，14 项底层能力虽已卡片化，但缺少各大分类（AI 推理、宿主机操作、沙箱集成、存储产物）的授权配额统计，用户无法快速感知各维度的安全开闭比例。

- **根因分析**：
  1. `AppManagementSettings.vue`（应用管理）与 `PluginManagementSettings.vue`（插件包管理）在早期架构中职责割裂，分别独立拉取 API（`apps` 与 `pluginInstallations`），未在 UI 视图层建立统一的应用全生命周期（All-in-One）心智模型。
  2. 插件市场条目循环时，未比对本地 `activeInstallations` 与 `apps` 的实时安装/启用状态，导致按钮文案与状态无条件写死为“校验插件包”。
  3. 插件安装包物理维护、残留数据清理与公钥管理均简单粗暴平铺在页面正文中，过度拉长页面垂直高度，喧宾夺主。

- **决策与实现方案**：
  1. **All-in-One 已安装插件全生命周期微中心（AppManagementSettings.vue）**：
     - **专属视觉身份与微渐变容器**：为 `nexus.agent`（紫靛微光 + 魔法棒/机器人图标）与 `nexus.fullstack`（青绿微光 + 分层微服务图标）配置专属发光图腾容器；
     - **状态与微指标矩阵**：提供 `● 运行正常` / `○ 已停用` 动态指示胶囊，整合 `运行中: 0`、`待审批: 0`、`已授权能力: 14/14` 核心微指标；
     - **一体化内嵌抽屉与分类配额芯片**：将安全策略配置面板作为应用卡片的内嵌下沉式抽屉（Nested Drawer），展开时浑然一体；在四大分类（AI 推理与执行、宿主机操作与诊断、沙箱与外部集成、产物交付与存储）标题右侧新增实时计算的授权配额芯片（如 `2/2 项已授权`、`5/5 项已授权`），右上角提供【一键全选】与带变更检测的【保存授权】按钮。
  2. **现代 App Store 质感插件扩展市场（PluginManagementSettings.vue）**：
     - **彻底消除重复的“已安装插件”白框区域**：由于上方卡片已完整承担已安装插件的运行与状态，下方插件市场彻底摒弃冗余的简单平铺，将底层包卸载收拢至高级折叠抽屉中；
     - **状态感知智能卡片**：
       - **已安装应用**：右上角呈现清爽的绿色微徽章（`● 已安装并启用` / `● 已安装`），底部操作按钮转为沉稳中性质感的【重新校验包】（`fa-arrows-rotate`）；
       - **未安装扩展**：呈现灰色【未安装】标牌，底部提供主色渐变醒目的【获取并安装】（`fa-download`）；
       - **版本升级感知**：当仓库存在更高版本时，自动呈现【升级到新版本】高亮引导；
     - **高质感工具栏与中性无高亮表单**：
       - 顶部工具栏整合【离线安装包 (.tar)】与【刷新市场】微质感操作；
       - 添加仓库 URL 采用紧凑型 `data-no-highlight` 输入框，搭配内置 `fa-link` 图标与紧凑操作按钮，彻底消除突兀粗糙的原生边框与紫色发光；
       - 官方 Catalog 呈现精炼标牌（`Nexus 官方精选` · `固定安全 Pin`），URL 采用紧凑排版并支持一键复制到剪贴板。
  3. **安全凭据中心与数据归档收敛**：
     - **已装扩展底层管理与物理卸载**：设计为可折叠的高级维护面板，清楚解释排空（Draining）与物理卸载机制，常规操作聚焦于上层应用管理；
     - **已卸载插件保留数据清理**：仅在检测到 `removedInstallations` 有残留数据时条件展示破坏性操作确认，平时 0 空间占用；
     - **受信任发布者密钥管理**：采用圆角安全抽屉，支持快速查看公钥指纹、一键撤回与公钥导入。

- **验证标准**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 浏览器真机测试：
    - Agent 设置中“插件与安全”分区排版舒展连贯，已安装应用与下方市场卡片各司其职，无任何重复堆叠；
    - 展开安全策略配置时，四维分类授权芯片与卡片复选联动实时准确；
    - 插件市场内 Nexus Agent 与 Full-stack Plugin 精确识别已安装状态，按钮呈现【重新校验包】。

## P-032 各配置项单位大小智能解析与人类可读换算支持（支持 K/M/G 快捷输入与即时反馈）

- **问题现象与用户诉求**：
  1. **裸露大数字心智负担重**：在 Token 预算、存储配额、硬上限限制等设置项中，原有输入框均为原生 `<input type="number">`，要求用户输入数百万、数千万甚至数亿的底层裸数字（如 `10485760` 字节、`100000` Tokens），用户难以心算且极易漏填或多填 0。
  2. **原生数字输入框拦截单位字符**：用户尝试输入 `10M`、`100k`、`1G` 等友好简写时，浏览器的 `type="number"` 会直接将其判定为非法输入并置空。
  3. **缺乏换算直观性**：输入框周围缺乏人类可读的实时格式化换算，用户无法确定自己输入的字节数究竟对应多少 MiB 或 GiB。

- **根因分析**：
  1. 前端表单直接使用 `v-model.number` 绑定底层协议字段，缺乏应用层文本解析与多单位智能转换器。
  2. 提交保存与变更检测（`isDirty`）直接依赖 `Number(raw)`，无法识别带单位后缀的字符串。

- **决策与实现方案**：
  1. **通用解析与格式化引擎（quantity-format.ts）**：
     - `parseQuantity(raw, type)`：支持大小写不敏感的单位后缀（`K/k/KB/KiB`、`M/m/MB/MiB`、`G/g/GB/GiB`、`s/m/h/d` 等），精准按字节二进制（`1024`）或 Token 千进制（`1000`）解析为安全整数；支持小数换算（如 `1.5M`、`2.5k`）与逗号分隔符；
     - `formatQuantity(value, type)`：智能格式化为高可读文本（如 `10 MiB`、`128k`、`30 分钟`）；
     - `getQuantityFeedback(raw, type)`：实时返回包含解析状态、人类可读文本与精确计数（如 `= 10 MiB (10,485,760 字节)`）的结构化反馈。
  2. **数量与单位高质感输入组件（QuantityInput.vue）**：
     - 采用 `data-no-highlight` 文本输入框，告别原生紫色光晕；
     - 右侧内置快捷单位药丸：
       - 存储/文件字段：`[ K ] [ M ] [ G ]`
       - Token 预算字段：`[ k ] [ M ]`
       - 时间限制字段：`[ m ] [ h ]`
       - 点击单位药丸自动智能附加或切换当前数值的单位；
     - 输入框下方实时显示紫色加粗的换算微胶囊（`≈ 100k (100,000 Tokens)`、`≈ 20 MiB (20,971,520 字节)`）；
     - 兼容双向绑定：对外统一输出标准 `number | null`，与底层 API 和现有数据流 100% 兼容。
  3. **全系统覆盖落地点**：
     - **StorageArtifactSettings.vue**（产物存储配额）：覆盖单 Run 产物总量、单文件上限、全局总配额及临时产物 TTL；
     - **BudgetContextSettings.vue**（预算与上下文）：覆盖执行步数、总 Token 预算、上下文窗口、单次输出、执行时长、工具输出与记忆字节；
     - **HardLimitsSettings.vue**（高级实例硬限制）：覆盖全部 14 项容量与 Token 相关的系统硬限制输入，并在变更预览抽屉中呈现直观格式化单位对照；
     - **SubagentSettings.vue**（子智能体与委派限制）：覆盖子代理 `maxTokens` 与消息最大字节数限制。

- **验证标准**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 浏览器真机测试：
    - 在预算设置中输入 `150k`，实时呈现 `≈ 150k (150,000 Tokens)`，保存变更正确触发；
    - 在工具输出中输入 `20M`，实时呈现 `≈ 20 MiB (20,971,520 字节)`；
    - 点击单位药丸 `[ K ] [ M ] [ G ]` 顺畅附加单位并实时换算。

## P-033 全局字体系统与跨平台排版质感深度统一优化

- **问题现象与用户诉求**：
  1. **字体质感粗糙且风格怪异**：用户反馈 Agent 弹窗及界面字体与 Nexus 项目主题风格不一致，西文中文字形生硬、割裂，缺乏现代高级感。
  2. **等宽代码与数据排版割裂**：Token 计数（如 `150k tok`）、运行步骤（`3 / 30`）、耗时、端口与代码块在不同模块使用不同的 monospace 回退，字阶与字重不协调。
  3. **数字宽度抖动**：数据流式推进或状态数值变化时，由于缺少表格数字（tabular figures）等宽特性，数字微胶囊和状态条容易出现横向抖动。

- **深度根因分析**：
  1. **主题存储覆盖导致字体降级**：`packages/frontend/src/features/appearance/config/default-theme.ts` 中将 `--font-family-sans-serif` 默认值硬编码为简陋的 `'sans-serif'`。系统初始化或加载外观设置时，Pinia store 会将该简陋值写入 `document.documentElement` 内联样式，直接覆盖了 `tokens.css` 中原本配置的字体栈，导致所有平台均退化至浏览器底层的劣质无衬线回退。
  2. **Tailwind v4 主题断层**：项目引入 Tailwind v4，但 `@theme inline` 中未显式映射 `--font-sans` 和 `--font-mono` 到 CSS 变量，造成使用了 Tailwind `font-mono` / `font-sans` 的组件与使用原生 CSS 变量的元素字体继承割裂。
  3. **跨平台字体栈抢占问题**：部分平台（如 Linux/Chrome）若将 `system-ui` 置于最前，会被系统 fontconfig 抢先命中粗糙的位图黑体，而未优先命中高质量平滑字体。
  4. **局部组件硬编码私有字体栈**：`AgentMessageBody.vue`、`MarkdownPreview.vue`、`SuspendedSessionsPanel.vue` 及 `ProgressCenter.vue` 等处硬编码了局部 `font-family`，未接入全局统一设计变量。

- **决策与实现方案**：
  1. **现代跨平台高质感无衬线字体栈（SANS）**：
     - 构建全平台优先级梯度：
       - macOS/iOS：优先原生 San Francisco（`-apple-system, BlinkMacSystemFont`）与优雅中文字体（`PingFang SC`, `Hiragino Sans GB`）；
       - Windows：优先现代排版体系（`Segoe UI`, `Microsoft YaHei UI`, `Microsoft YaHei`）；
       - Linux/现代跨平台：优先清晰平滑字体（`Roboto`, `Helvetica Neue`, `Arial`, `Noto Sans`, `Liberation Sans`, `WenQuanYi Micro Hei`）；
       - Emoji：统一保障（`Apple Color Emoji`, `Segoe UI Emoji`, `Segoe UI Symbol`, `Noto Color Emoji`）。
  2. **现代专业级等宽字体栈（MONO）**：
     - 构建统一等宽体系：`ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace`；
     - 确保各平台下代码、Token 数量、步骤指标具有同等舒适的字间距和辨识度。
  3. **Tailwind v4 主题深度联动**：
     - 在 `tokens.css` 的 `@theme inline` 块中正式注入：
       - `--font-sans: var(--font-family-sans-serif);`
       - `--font-mono: var(--font-family-monospace);`
     - 使得所有 Tailwind 实用类与原生 CSS 变量彻底同源。
  4. **排版引擎与数字等宽特性注入（global.css）**：
     - 全局注入平滑抗锯齿：`-webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; text-rendering: optimizeLegibility;`；
     - 全局注入西文排版微调特性：`font-feature-settings: 'cv02', 'cv03', 'cv04', 'cv11';`；
     - 统一表单控件（`button, input, textarea, select`）严格继承 `font-family` 与排版特性；
     - 为所有 `code`, `kbd`, `samp`, `pre` 及 `.font-mono` 元素强制启用 `font-variant-numeric: tabular-nums;` 与 `tnum` 特性，彻底杜绝数据变化引起的界面抖动。
  5. **外观配置引擎无缝平滑升级（default-theme.ts）**：
     - 将 `defaultUiTheme` 中的默认字体定义替换为高品质常量 `DEFAULT_FONT_FAMILY_SANS` 与 `DEFAULT_FONT_FAMILY_MONO`；
     - 在 `normalizeUiTheme` 增加向下兼容迁移：若持久化存储中存在旧版本的 `'sans-serif'` 或 `'monospace'`，自动平滑升级为现代化高质量系统字体栈，无需用户手动清空缓存。
  6. **全面消除局部硬编码**：
     - 重构 `AgentMessageBody.vue`、`MarkdownPreview.vue`、`SuspendedSessionsPanel.vue`、`ProgressCenter.vue`，统一引用 `var(--font-family-monospace)` 与 `var(--font-family-sans-serif)`。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真实浏览器环境验证：
    - `document.body` 与各级标题的实际计算 `fontFamily` 均成功命中现代高品质系统字体栈；
    - Agent 浮窗顶栏、应用标签、会话抽屉、输入框及操作按钮呈现细腻现代的排版效果，完全与主系统风格融为一体；
    - 外观设置面板中界面样式与主题切换顺畅，等宽数字和 Token 微胶囊整齐对齐无抖动。

## P-034 模型 Provider 添加弹窗化、即时连通性测试与极简信息流重构

- **问题现象与用户诉求**：
  1. **添加表单生硬内联插入**：原先点击“添加 Provider”会在列表上方原地撑开一个包含 10 项输入框的大型表单，破坏整体页面排版，且添加前无法进行连通性测试，用户极易因输错 Key 或 Base URL 导致创建后调用失败。
  2. **已添加 Provider 信息杂乱臃肿**：卡片内部平铺了过多层级的原始文本（Endpoint、凭据状态、原生下拉框），且每个模型卡片内部硬生生平铺了横跨两行的 7 个思考等级单选框，若服务商拥有多个模型，页面会被严重拉长，视觉体验极差。
  3. **默认模型控制栏粗苯突兀**：默认模型选择器被一个巨大的紫色背景框包裹，与下方服务商卡片视觉脱节，缺乏现代高级感。
  4. **缺少快捷删除与预设能力**：用户添加主流模型（OpenAI, DeepSeek, Moonshot, Ollama）需手动输入重复的 Base URL 与 Model ID，且无法删除废弃的 Provider。

- **根因分析**：
  1. 表单缺乏独立的模态（Modal）生命周期，与列表共用页面流，造成视觉干扰。
  2. 前端 API 未接入后端的 `DELETE /ai/providers/:providerId` 路由，仅实现了查改，缺少完整的增删闭环。
  3. 缺乏基于用户认知负荷（Cognitive Load）的信息折叠机制，将次要/低频设置（如思考等级单选、原始 URL 复制、高级私网例外）直接全量暴露在主视图中。

- **决策与实现方案**：
  1. **高质感全能模态弹窗（BaseModal 驱动）**：
     - **磨砂遮罩与居中浮层**：点击【+ 添加 Provider】唤起现代居中弹窗，支持 Esc 与点击遮罩退出；
     - **主流服务商一键预设**：内置 OpenAI、DeepSeek、Moonshot Kimi、SiliconFlow 硅基、Ollama 本地五大预设胶囊，点击自动填充 Base URL、常用 Model ID、上下文窗口与最大输出上限；
     - **即时模型连通性测试（In-Modal Test）**：
       - 弹窗底部内置【测试连通性】按钮；
       - 点击后先校验表单，即时向后端发起建联探测并执行心跳调用；
       - 实时显示响应延迟（如 `✓ 连通性测试通过 (240ms)`）或具体错误提示（如密钥失效或连接超时），确保入库配置 100% 可用；
       - 测试通过后可一键确认保存并关闭弹窗。
  2. **极简主义 Provider 信息流设计**：
     - **品牌微徽标与状态收敛**：智能识别 OpenAI、DeepSeek、Moonshot、Ollama 品牌图标，将服务商状态整合为单行芯片：`● 已启用`、`协议 (Responses / Chat)`、`模型数量`、`已配密钥`；
     - **紧凑 Endpoint 与一键复制**：Base URL 单行等宽展示，内置一键复制小图标与动态完成反馈；
     - **操作工具条精简**：整合【发现模型】（罗盘图标）、【启停切换】、【删除 Provider】（红色危险确认模态框）及【折叠/展开】。
  3. **精炼模型条目（Compact Model Row）**：
     - 将原本笨重的大模型卡片压缩为紧凑的单行条目：
       - 左侧：模型 ID + 紫色星标 `★ 默认` 徽标 + `128k 上下文` + `4.1k 输出` + `Tools` + `思考` 徽章；
       - 右侧：【设为默认】快捷按钮 + 【测试】按钮与实时毫秒数绿色微胶囊（`✓ 2250ms`）；
       - 彻底移除冗余平铺的 7 个思考等级单选框，界面高度节省超 65%。
  4. **顶部默认模型控制微岛（Control Island）**：
     - 移除笨重的全宽紫色大框，替换为现代精巧的微岛控制条：左侧发光机器人徽标与说明，右侧高质感无高亮原生替代下拉框，全局感与层次感显著提升。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过（三语完整匹配）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真实浏览器真机核验：
    - 点击“+ 添加 Provider”成功唤起模态弹窗，点击 DeepSeek 预设秒级自动填入全部标准配置；
    - 在弹窗内点击【测试连通性】，正确拦截并展示测试状态；
    - 列表卡片精炼紧凑，单测实时反馈延迟，删除服务商带二次安全确认弹窗并正常完成清除。

## P-035 模型 Provider 交互高阶化、设置单位防抖修复与插件仓库单列紧凑排布

- **问题现象与用户诉求**：
  1. **添加模型的 UI 仍然简陋、内部下拉仍为原生**：添加服务商弹窗内的调用协议（Chat Completions / Responses）仍为原生 `<select>` 标签；服务商卡片内部更新模型抽屉里的选择框也缺乏定制美化，缺乏现代高级感。
  2. **“发现模型”文案认知模糊**：用户期望更名为直观的“**更新模型**”，并统一更新/刷新动作的图标语言。
  3. **设置单位（QuantityInput）数值错乱与步数多余单位**：
     - 用户在输入数字（例如 `100`）后点击 `[ K ]` 或 `[ M ]` 按钮时，输入框内前置基数被外部数值回流冲掉（变成换算后的巨大数字如 `102400` 或 `104857600`），重复点击会导致数值爆炸膨胀；
     - 单 Run 最大步数（`maxRunSteps`）、并发数、委派深度等纯计数项被错误附加了 `[ k ] [ M ]` 单位按钮和冗余换算小字，严重违背交互常理。
  4. **插件仓库卡片布局笨重**：原先采用 2 列高大卡片网格，单张卡片纵向高度达 160px+，卡片上下信息层叠严重，导致页面被拉得很长，不利于多插件统一排布与浏览。

- **根因分析**：
  1. **表单控件组件选型残留**：弹窗与抽屉内部仍直接采用了浏览器默认的 `<select>` 标签，未封装为分段胶囊或定制化选择器。
  2. **缺少已有服务商手动补模入口**：此前仅允许通过接口自动发现，若服务商未提供发现端点则无法直接新增模型。
  3. **QuantityInput 响应式状态回流竞争**：
     - 当用户点击单位胶囊触发 `applyUnit` 发出 `update:modelValue` 后，父组件更新了绝对数值并传回 `props.modelValue`；
     - 由于点击按钮时输入框处于非 focus 状态，`watch(props.modelValue)` 盲目将传入的绝对数值执行 `textValue.value = String(newVal)`，直接将用户输入的 `100` 冲成了绝对数值；
     - `unitPills` 在 `props.type === 'number'` 时 fallback 返回了 `['k', 'M']`，导致纯步数与计数字段被动继承了单位选项。
  4. **插件市场卡片采用了垂直瀑布流式设计**：图标、标题、版本、兼容性、描述、证书与按钮全部纵向堆叠，未根据桌面屏幕宽度进行横向行紧凑整合。

- **决策与实现方案**：
  1. **模型 Provider 交互高级化与杜绝原生下拉**：
     - **现代分段胶囊选择器（Segmented Capsule Switcher）**：弹窗内调用协议重构为双胶囊分段单选器（`Chat` 与 `Responses`），左右切换具备高亮微卡片底色与精致图标；
     - **预设芯片激活高亮**：5 大主流预设（OpenAI、DeepSeek、Moonshot、SiliconFlow、Ollama）支持当前激活选中高亮边框与微光；
     - **全方位定制 Select 外观**：更新模型抽屉和默认模型选择器包裹现代微边框、隐藏系统原生黑色箭头，并外置精巧的 `fa-solid fa-chevron-down` 指示器；
     - **可点击模型芯片组（Discovered Chips）**：更新模型返回的模型列表平铺为高质感芯片组，支持点选快速填入；
     - **新增服务商手动添加模型功能**：在每个服务商卡片上新增【+ 添加模型】按钮与专用模态框，用户可随时为已有服务商增补任意自定义微调模型。
  2. **全面文案与图标统一（更新模型）**：
     - 中、英、日全语言包统一将“发现模型”更改为“**更新模型**”（`Update models` / `モデルを更新`）；
     - 图标由指南针全部统一替换为现代旋转更新图标 `fa-solid fa-arrows-rotate`，支持旋转加载动画。
  3. **QuantityInput 单位输入组件核心修复**：
     - **数值回流防抖保护**：在 `watch(props.modelValue)` 中比对当前输入解析数值与外部传入数值，当两者等价时严禁改写 `textValue`，彻底保证前置基数纹丝不动；
     - **平滑单位替换**：在 `applyUnit` 中通过正则精确提取前置基础数字，点击 `[ K ]` 变 `100k`，再点 `[ M ]` 变 `100M`，基数永不丢失与漂移；
     - **纯数字类型单位剥离**：当 `type === 'number'` 时，`unitPills` 强制返回空数组，彻底移除胶囊区域和冗余换算提示，步数、并发数、委派深度保持纯净数字输入。
  4. **插件仓库单列（1 列）低高度紧凑行重构（Compact Row）**：
     - 容器由双列改为单列：`grid-cols-1 gap-2.5`；
     - 卡片重构成横向紧凑条目：
       - 左侧：9x9 微图标 + 第一行（应用名 + 版本芯片 + 安装/启用胶囊 + appId）+ 第二行（单行截断功能描述）；
       - 右侧：Ed25519 签名状态徽章 + 紧凑操作按钮（【重新校验包】/【下载安装】）；
     - 单张卡片高度由 160px+ 降低到 50px~58px，高度压缩超过 60%，视觉整齐划一，极度便于多插件排布与长列表浏览。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过（三语一致）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真机环境实测验证：
    - 打开添加服务商模态弹窗，分段胶囊单选器切换流畅，彻底消除原生下拉框；
    - 点击服务商上的【更新模型】（旋转图标），展开后的模型列表以可点击微芯片排布，选择框带有现代自定义外观；
    - 点击服务商上的【+ 添加模型】唤起增补弹窗，成功支持为指定 Provider 录入新模型；
    - 在“任务总 Token 预算”中输入 100，点击 `k` 变 `100k`，再点击 `M` 变 `100M`，失焦后基数稳定不变，前置数据不被覆盖；
    - 在“最大执行步数”等纯计数字段中，完全无 K/M 胶囊，无冗余换算小字；
    - 切换到“插件与安全”，插件仓库卡片呈现单列低高度紧凑排布，图标、元数据、描述与操作按钮单行横向对齐，排布美观高级。

## P-036 Agent App 卸载能力收拢、前置停用约束与底层物理卸载区剔除

- **问题现象与用户诉求**：
  1. **已装扩展包底层管理与物理卸载区域多余繁琐**：在“插件与安全”页面的插件管理区中，原先在底部单独设计了一个“已装扩展包底层管理与物理卸载”的可折叠区域，不仅视觉生硬冗余，且将同一个 App 的管理（启用/停用、能力授权）与物理卸载割裂在两个不同组件和不同板块中，增加了用户的认知与操作成本。
  2. **缺少 Agent App 直接卸载入口与安全防呆机制**：用户期望直接在顶部的【Agent App】卡片列表中完成 App 卸载，但必须遵循安全防护逻辑——**只有停用的 App 才能卸载**，如果 App 处于启用状态则不能卸载并给出操作引导，防止用户误删正在运行或正在提供服务激活中的扩展；同时官方核心内置应用（如 `nexus.agent`）必须受到永久保护，严禁提供卸载入口。

- **根因分析**：
  1. **功能归属分散**：插件代码物理卸载接口（`uninstallPlugin`）和持久化数据清理（`deletePluginData`）原先被放置在 `PluginManagementSettings.vue` 的高级维护折叠区内，与上方主管应用生命周期的 `AppManagementSettings.vue` 割裂。
  2. **状态机与操作生命周期缺少防呆联动**：原先卸载逻辑未强制要求 App 处于停用状态，若用户在应用处于活跃运行态时直接执行物理卸载，会导致运行时正在执行的任务孤立或产生未定义异常。

- **决策与实现方案**：
  1. **彻底移除已装扩展包底层物理卸载折叠区**：
     - 在 `PluginManagementSettings.vue` 中彻底删除原先生硬的“已装扩展包底层管理与物理卸载”折叠块及相关冗余状态维护；
     - 插件管理板块聚焦于插件仓库源配置、签名包校验、第三方发布者信任管理等纯生态仓库源体系，板块职责更加纯粹清晰。
  2. **Agent App 列表集成条件卸载功能与微按钮**：
     - 在 `AppManagementSettings.vue` 中，为非核心扩展应用（如 `Full-stack Plugin`）引入卸载操作按钮与状态机控制；
     - **停用状态（`!app.enabled`）**：卸载按钮激活，呈现红色危险微按钮（`fa-regular fa-trash-can`，带微红背景与渐变悬停动画），允许点击触发卸载；
     - **启用状态（`app.enabled`）**：卸载按钮自动变为浅灰禁用态（`cursor-not-allowed select-none`），并且在鼠标悬停时展示明确防呆提示文案：“请先停用该 App 后再进行卸载”；
     - **内置核心保护**：`nexus.agent` 核心系统应用永久不渲染卸载按钮，杜绝意外移除核心引擎。
  3. **高质感二次安全确认模态弹窗（BaseModal）**：
     - 点击激活态的卸载按钮后弹出居中危险确认弹窗；
     - 包含警告图标、应用名称、版本号与明确风险提示；
     - 提供可选勾选框：“同时彻底删除此插件专属的独立持久化数据空间”；
     - 卸载执行期间按钮展示 loading 动画，卸载完成后自动排空后台任务、关闭弹窗并通过 `@refresh` 刷新父级应用列表。
  4. **全语言（中/英/日）i18n 完整覆盖**：
     - 在 `zh-CN.json`、`en-US.json`、`ja-JP.json` 中补全所有卸载相关的新增文案与提示。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过（三语一致）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真实浏览器真机实测验证：
    - “插件与安全”下已彻底无“已装扩展包底层管理与物理卸载”折叠区，页面清爽聚焦；
    - 在【Agent App】卡片列表中，官方核心 `Nexus Agent` 仅展示安全策略配置与停用按钮，不暴露卸载；
    - 针对扩展插件 `Full-stack Plugin`：
      - 在【启用】状态下，卸载按钮呈现置灰禁用样式，鼠标悬停显示“请先停用该 App 后再进行卸载”；
      - 点击【停用】后，卸载按钮立即激活为红色危险样式；
      - 点击【卸载】成功唤起现代二次确认模态弹窗，取消与确认逻辑完备。

## P-037 模型同步管理策略 UI 重构：收拢添加入口、一键全选添加与取消已添加能力

- **问题现象与用户诉求**：
  1. **服务商顶栏操作入口分散冗余**：在 Provider 卡片工具栏上，“更新模型”左侧额外放置了独立的“+ 添加模型”按钮，需要触发冗长的独立表单弹窗输入参数，导致用户认知分散，入口重复。
  2. **缺少批量添加能力**：更新模型发现列表只支持逐个单选添加，面对支持数十个甚至上百个模型的大型服务商（如兼容 OpenAI 或第三方聚合平台），用户需要重复点击数十次才能全部导入，操作成本极高。
  3. **缺少取消已添加（移除模型）能力**：已添加生效的模型一旦加入服务商配置，无法直接取消或删除（或者缺少便捷的批量取消与单项移除机制），导致模型库一旦添加难以维护瘦身。
  4. **期望在更新模型内部完成闭环管理**：去掉工具栏上的“添加模型”按钮，将模型的新增、多选选择、一键全选导入、取消已添加等操作全部收拢在“更新模型”抽屉及模型管理策略 UI 中。

- **根因分析**：
  1. **操作动线未闭环**：单模型手动录入（表单弹窗）与远端模型同步发现（抽屉单选）割裂为两个完全独立的交互入口。
  2. **模型状态机单向流动**：原抽屉仅有向 `provider.models` 数组追加单个元素的能力，没有设计批量增量合并与反向移除（差集同步）的数据操作函数与批量复选状态池。
  3. **缺乏模型列表双向响应联动**：左侧未添加模型与右侧已添加模型缺少响应式的实时转移反馈，导致操作后需要反复重新刷新。

- **决策与实现方案**：
  1. **彻底移除 Provider 卡片顶栏左侧的“添加模型”按钮**：
     - Provider 卡片工具栏全面瘦身精炼，只保留核心的【更新模型】（带旋转动效图标）、【启/停】、【删除】和【折叠】按钮；
     - 移除冗余的独立手动添加模型 BaseModal 弹窗，操作聚焦于“更新模型”统一交互流。
  2. **重构更新模型抽屉策略 UI（双栏高质感智能模型库）**：
     - **顶部功能控制栏**：包含实时统计胶囊（`可添加模型: N` · `已生效模型: M`）、重新拉取按钮与一键关闭图标；
     - **左栏：可添加模型（支持多选、全选添加、一键添加所有）**：
       - 智能搜索过滤：提供实时关键字搜索框，可从海量模型中毫秒级筛选出目标模型；
       - 【全选 / 取消全选】复选框：一键切换当前过滤视图下的全选与反选状态；
       - 【添加所选 (K)】：当勾选若干模型时立即高亮浮现，支持精准批量导入；
       - 【一键添加所有模型】：显眼主操作按钮，一次性将所有支持模型全量合并导入；
       - 单项快捷【+ 添加】按钮与底部极简【手动输入模型 ID 添加】轻量输入行（保留私有定制模型手动追加能力）；
       - 全量添加完成后自动切换为绿色友好徽章与“服务商支持的所有模型均已添加”空态提示。
     - **右栏：已生效模型（支持取消已添加、多选批量取消）**：
       - 展示当前服务商已加入的模型列表；
       - 【取消所选 (J)】：勾选已生效模型后支持一键批量取消移除；
       - 单项【取消添加】：每个已添加模型右侧提供红色微按钮，点击即安全移出；
       - **防呆安全保护**：服务商唯一保留模型或当前默认模型自动禁用取消按钮，并展示明确保护提示（“服务商至少需要保留一个模型” / “默认模型不可直接取消，请先切换默认模型”）；
       - 若取消的模型包含默认模型且仍有其他模型，系统自动平滑转移默认模型至首个可用模型。
  3. **主体已配置模型列表（卡片下方展开区）全面同步【取消添加】**：
     - 在每个模型行右侧与【设为默认】、【测试】并列增加【取消添加】按钮，操作全局一致。
  4. **原子批量更新接口对接（`updateProviderModels`）**：
     - 在 `AgentSettingsPanel.vue` 中封装原子化全量模型更新函数 `updateProviderModels`，通过单一 PATCH 请求完成批量添加或批量取消。
  5. **全语言（中/英/日）i18n 完整覆盖**：
     - 新增全选、取消全选、一键添加所有、批量取消、默认模型保护等对应三语词条。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过（三语完整匹配）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真实浏览器真机实测验证：
    - Provider 顶栏已彻底移除多余的“+ 添加模型”按钮，只保留“更新模型”；
    - 点击【更新模型】成功展开双栏模型库抽屉，左侧展示 44 个可添加模型，右侧展示 1 个默认模型；
    - 勾选 2 个模型后点击【添加所选 (2)】，模型精准转移到右侧已生效列表，左侧自动减少至 42 个；
    - 点击右侧单个模型的【取消添加】，模型即时移除并回流到左侧可添加列表中；
    - 勾选【全选】并点击【一键添加所有模型】，43 个模型全量瞬时添加成功，左侧展示“支持的所有模型均已添加”完成状态；
    - 在右栏多选勾选模型后点击【取消所选 (42)】，多余模型批量安全移除，已生效模型重置为初始默认模型，抽屉关闭后主体列表状态完全同步。

## P-038 已配置模型弹窗化隔离、按需测试管理与主页面臃肿列表消除

- **问题现象与用户诉求**：
  1. **已配置模型在主页面铺陈过多、撑爆页面**：当用户通过一键全选或多选添加了服务商的数十个模型（如 45 个模型）后，Provider 卡片下方原先平铺展开的已配置模型列表纵向拉伸出数千像素，导致整个 Agent 设置页面极度冗长、滑动体验崩塌。
  2. **缺少轻量级、按需唤起的测试与模型管理容器**：用户强烈要求将已配置模型的查看、选择、单项连通性测试、设为默认及移除等功能改为**弹窗（Modal）**形式——“点击之后可以在弹窗里面选择模型进行测试，关了就没了”，使得平时主界面的服务商卡片保持极致紧凑、清爽规整。

- **根因分析**：
  1. **视觉展示策略违背高密度场景**：原有设计默认采用内联手风琴折叠（`v-show="isExpanded"`），在模型数量极少（1~2 个）时尚能接受，但一旦接入现代化模型库（包含数十个模型），内联平铺必然造成严重的页面堆叠膨胀。
  2. **模型测试动作缺乏聚焦环境**：在长列表中查找特定模型并进行心跳测试容易受到上下文滚动的干扰，缺少独立聚焦的测试反馈视窗。

- **决策与实现方案**：
  1. **彻底移除主页面卡片下方的漫长内联模型列表**：
     - 在 `ModelProviderSettings.vue` 中彻底删除原先在卡片下方内联堆叠展示所有模型卡片的区域；
     - Provider 服务商卡片高度从原先的数千像素缩减至 60px 左右的极度紧凑横栏，主页面布局恢复优雅规整。
  2. **增设独立【已配模型与连通测试】模态弹窗（BaseModal）**：
     - **触发入口**：
       - Provider 卡片操作栏配备专属【模型与测试 ({count})】按钮（图标 `fa-solid fa-vial`，带当前配置模型总数统计）；
       - 卡片身份栏上的模型数量微标签（如 `45 个模型`）同样支持点击直达弹窗。
     - **弹窗内模型选择与即时连通测试**：
       - **实时搜索过滤**：弹窗顶部提供专属搜索框，可在海量已配模型中毫秒级定位目标模型；
       - **带状态反馈的快速测试**：列表中的每个模型均配备高质感【测试】按钮，点击发送心跳探测，实时展示转圈动效并精准反馈测试延迟（如 `✓ 2420ms`）或错误信息；
       - **设为默认与移除管理**：可在弹窗内一键切换主力默认模型（实时与全局默认模型状态联动同步），或安全取消添加/移除指定模型（带默认模型与唯一模型防呆保护）；
     - **轻量启闭**：弹窗支持 ESC、遮罩点击或右上角/底部【关闭】按钮随时关闭，“关了就没了”，完全不占用主页面空间。
  3. **全语言（中/英/日）i18n 完整匹配**：
     - 在 `zh-CN.json`、`en-US.json`、`ja-JP.json` 中统一配置了 `testModalTitle`、`testModalBtn`、`testModalDesc`、`searchConfiguredModels` 等词条。

- **验证标准与测试结果**：
  - `check-architecture.mjs` 与 `check-i18n.mjs` 均 100% 通过（三语一致）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误。
  - CDP 真实浏览器真机实测验证：
    - Provider 卡片下方再无无限堆叠的长列表，卡片高度紧凑规整，页面信息层级一目了然；
    - 点击【模型与测试 (45)】秒级唤起模态弹窗，内部滚动展示 45 个已配模型；
    - 在搜索框中输入 `sonnet` 毫秒级过滤出目标模型 `claude-sonnet-4-6`；
    - 点击【测试】按钮，成功返回 `✓ 2420ms` 绿色连通性延迟徽章；
    - 点击【设为默认】，默认模型即时切换，主页面默认模型下拉框与右上角徽章实时同步更新；
    - 点击【关闭】按钮后弹窗即时消失，主界面恢复清爽干净。

## P-039 模型变更即时持久化（Auto-save）状态可视化与用户心理确认机制重构

- **问题现象与用户诉求**：
  1. **缺乏保存状态反馈与心理不安全感**：用户在“更新模型”抽屉中通过单项添加、多选导入或手动录入添加模型后，界面未提供醒目的保存状态提示与操作确认，引发困惑：“模型这个地方不需要保存吗 感觉添加之后不知道保存没”。
  2. **视线盲区导致自动保存心智脱节**：底层实现虽然已采用即时服务端持久化（Auto-save），但全局通知横幅仅挂载在整个 Agent 页面最顶端，在用户聚焦于下方抽屉或模态弹窗的局部视野时完全不可见，导致用户误以为修改未被系统记录。
  3. **缺少确定的操作闭环落点**：抽屉与测试弹窗原本仅提供简单的“×”或灰框“关闭”按钮，缺少明确的“保存并关闭”心理确认，用户离开抽屉时容易担心配置丢失。

- **根因分析**：
  1. **局部视距下的状态感知缺失**：现代 Web 体验普遍采用无感实时同步，但若在复杂的局部抽屉/弹窗中缺乏**就近的实时保存状态徽标**与**瞬时操作横幅（Flash Alert）**，用户就无法建立对系统已安全持久化的确定信任。
  2. **心智模型与无感自动同步的冲突**：对于关键的云端模型与 API 凭据配置，用户天然具有明确“提交/保存”的心理期待。缺少醒目的确认动作容易产生“未完成”的心理负担。

- **决策与实现方案**：
  1. **微岛、抽屉与测试弹窗常驻实时持久化徽标（Live Auto-save Capsule）**：
     - **默认模型微岛**：在“默认模型”标题旁常驻展示柔和精致的绿色微胶囊（`☁ 变更已实时保存`），提示每次切换默认模型均即时生效；
     - **更新模型抽屉**：抽屉顶栏在模型统计旁增加动态微胶囊：保存进行中展示旋转动画与 `正在保存到服务端...`，保存就绪展示 `☁ 变更已实时保存`；
     - **模型测试弹窗**：在弹窗头部描述旁常驻展示 `☁ 变更已实时保存` 徽标。
  2. **就近瞬时持久化通知横幅（Flash Notice Alert）**：
     - 在抽屉顶部和测试弹窗顶部，增设响应式瞬时通知横幅；
     - 当用户进行添加模型、批量导入、手动录入、设为默认或取消添加时，立刻在当前视窗正前方弹出淡绿主题的确认条：
       - `✓ 已成功添加 {count} 个模型并保存至服务端`；
       - `✓ 默认主力模型已更新并保存`；
       - `✓ 已成功移除模型并保存至服务端`；
       - 右侧标注 `已持久化至服务端`，3 秒后平滑自动淡出。
  3. **抽屉底部新增操作条与主按钮【保存并关闭】（Save & Close）**：
     - 抽屉底部增加固定分隔底栏：
       - 左侧常驻说明：`<i class="fa-solid fa-cloud-check text-emerald-500"></i> 所有模型变更均即时同步持久化至服务端，任务下一次执行直接生效。`；
       - 右侧提供高质感紫色主按钮【保存并关闭】（`fa-solid fa-check`），为用户提供清晰坚决的操作终点。
  4. **已配模型测试弹窗升级【保存并关闭】主按钮**：
     - 弹窗底部将原本不起眼的灰色普通“关闭”按钮升级为醒目的【保存并关闭】主操作按钮，同时保留即时保存持久化说明文案，完全消除心理疑虑。
  5. **全语言（中/英/日）i18n 完备覆盖**：
     - 在 `zh-CN.json`、`en-US.json`、`ja-JP.json` 中统一接入并校准 `autoSaved`、`saving`、`saveAndClose`、`saveNoticeAdded`、`saveNoticeRemoved`、`saveNoticeDefault`、`autoSaveHint` 资源词条。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 静态校验 100% 通过（三语一致，架构无环依赖）。
  - `vue-tsc --noEmit` 编译类型检查 0 错误通过。
  - CDP 真实浏览器真机实测验证：
    - 主页面默认模型微岛标题旁清晰呈现 `☁ 变更已实时保存`；
    - 点击【更新模型】展开抽屉，顶栏清晰显示保存状态胶囊，底部呈现说明文案与【保存并关闭】主按钮；
    - 在抽屉中输入自定义模型添加，顶栏即时抓拍到转圈 loading `正在保存到服务端...`，保存完成后模型数即时递增；
    - 点击【保存并关闭】抽屉顺利收起，主卡片模型总数由 45 个同步为 46 个；
    - 点击【模型与测试 (46)】唤起弹窗，在搜索框检索新增模型并点击【取消添加】，弹窗顶部秒级浮现 `✓ 已成功移除模型并保存至服务端` 绿色横幅；
    - 弹窗底部点击【保存并关闭】，弹窗关闭，主卡片模型数量平滑恢复为 45 个；
    - 刷新页面重新加载，所有更改均已在服务端持久生效，无需额外手动提交，用户认知与操作动线形成完美闭环。

## P-040 添加 Provider 弹窗协议分段器（Chat / Responses）高度溢出与基准线错位修复

- **问题现象与用户诉求**：
  - 用户在点击【+ 添加 Provider】打开弹窗后反馈：“添加Provider的时候里面那个chat 和 response的框有点错位呢”。
  - 现象表现为：右侧“调用协议”分段器内部的 `Chat` 选中按钮明显偏下，按钮白底边框和阴影穿透并凸出到外层浅灰胶囊容器底边之外（下凸约 3.6px），与左侧“显示名称”输入框在高度与视觉基准线上出现突兀错位。

- **根因分析**：
  1. **盒模型高度超出与缺乏弹性约束**：
     - 外层分段器容器固定为 `h-9`（36px），内边距 `p-1`（4px），提供给子项的垂直高度净空间仅为 28px；
     - 内部 `button` 显式设置了 `py-1`（上下各 4px），加上 12px 字号及行高与 SVG 图标高度后，按内容的实际渲染高度达到 **34.93px**，远超 28px 可用空间；
     - 容器原采用 `grid grid-cols-2` 且未约束子元素高度，导致按钮下边框从底边（375.48px）延伸到 379.07px，直接溢出外层容器；
  2. **激活与未激活边框不对称引发微抖动**：
     - 激活态有 `border border-border/80`，未激活态无 border（border-width: 0），导致切换状态时产生 1px 的微错位和尺寸跳变。

- **决策与实现方案**：
  1. **容器重构为 Flex 弹性约束**：
     - 外层分段控制器改用 `flex h-9 items-center gap-1 rounded-lg border border-border/80 bg-header/60 p-1 box-border`；
  2. **子按钮强制自适应与绝对对称居中**：
     - 移除内部冗余的 `py-1`，改为 `h-full flex-1 flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold leading-none`；
     - 按钮渲染高度精准锁定在 26.67px，容器顶部与底部留白各为 4.67px，实现**0 误差绝对对称居中**；
  3. **透明边框占位防抖动**：
     - 未激活按钮设置 `border border-transparent`，与激活态的 `border border-border/80` 保持严格一致的几何盒模型，切换时 0 抖动。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 静态校验通过。
  - `vue-tsc --noEmit` 0 错误。
  - CDP 真实浏览器实测检验：
    - `input` 盒模型（top: 339.48, bottom: 375.48, height: 36）；
    - `container` 盒模型（top: 339.48, bottom: 375.48, height: 36）；
    - `chatBtn` 盒模型（top: 344.15, bottom: 370.81, height: 26.67）；
    - 垂直方向完全收拢在容器内，溢出彻底消除；
    - 点击切换至 `Responses`，高亮平滑切换且无任何位置抖动，与左侧输入框完美齐平。

## P-041 默认模型展示层级与选择器重构：优先突出模型、弱化渠道为小徽章与浮层交互升级

- **问题现象与用户诉求**：
  - 用户反馈：“默认模型 newapi test这样显示不好看 优先显示模型 渠道看怎么小一点好看一点”。
  - 现象表现为：原设计使用原生 `<select>` 渲染选项，当前值与选项文本均采用 `New API Test · gpt-5.6-luna` 格式，冗长且样式突兀的服务商/渠道名称不仅排在最前方，且与模型名称字号相同，严重抢占第一视觉落点。用户核心关注的主体是具体的模型（如 `gpt-5.6-luna`），渠道应作为辅助上下文信息小字呈现。

- **根因分析**：
  1. **信息层级倒置（Inverted Hierarchy）**：将模型所属的“服务商/渠道”作为主前缀，将真正的“核心操作实体（模型 ID）”置于句末；
  2. **原生表单控件样式受限**：原生 HTML `<select>` 无法在选中态呈现差异化排版（如主标题大字加粗、副标题微胶囊标签、品牌厂商图标等），导致展示效果简陋、质感欠缺。

- **决策与实现方案**：
  1. **视觉信息层级逆转与突出（Model-First）**：
     - **优先突出模型 ID**：排在首位，采用粗体等宽字体（`font-mono text-xs font-semibold text-foreground`），并根据服务商自动匹配官方品牌图标（OpenAI 闪电、DeepSeek 魔法杖、Moonshot 月亮等）；
     - **渠道弱化为精致小微胶囊**：渠道名称（如 `New API Test`）排在模型名称之后，以浅色圆角微徽标展示（`text-[10px] text-text-secondary bg-header/50 border border-border/60 px-1.5 py-0.5 rounded-md`），字号比模型缩小两号，颜色柔和，主次分明。
  2. **全面升级定制下拉面板（Custom Dropdown Popover）**：
     - 彻底弃用原生 `<select>`，定制高质感触发按钮（带状态旋转箭头 `fa-chevron-down`）；
     - 展开浮层（`z-40`，磨砂半透明 `backdrop-blur-md bg-card/98`，圆角柔和阴影）；
     - 浮层内部集成即时模糊搜索框（`searchConfiguredModels`），支持同时按模型 ID 或渠道名高速过滤；
     - 选项列表每项严格分列：左侧突出模型 ID，右侧附带渠道小微标；当前选中的默认模型带有淡紫色高亮背景、粗体字与对勾图标 `✓`；
     - 具备点击外部（click outside）自动收起、选择后自动关闭、即时同步持久化保存。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 校验 100% 通过。
  - `vue-tsc --noEmit` 0 错误。
  - CDP 真实浏览器实机验证：
    - 默认模型微岛内清晰展示：`[图标] gpt-5.6-luna [New API Test] v`，模型大字突出，渠道小巧自然；
    - 点击选择框秒级展开浮层，搜索 `deepseek` 即时过滤，点击切换至 `DeepSeek-V4-Flash` 后顶栏快照与当前选择器同步切换，自动保存；
    - 再次点击平滑切回 `gpt-5.6-luna`，界面清爽现代，层级舒适美观。

## P-042 模型与预算默认 K 级别格式化展示与单位药丸智能高亮联动

- **问题现象与用户诉求**：
  - 用户反馈：“模型与预算那里 默认发布按照K级别选中K 值是K级别的”。
  - 现象表现为：
    1. 在【模型与预算】（预算与上下文）设置中，输入框初始加载后端配置或套用预设时，显示的是一长串无单位的原始数字（如 `100000`、`32000`、`4096`、`65536`、`10485760` 等），认知负担重且排版显得粗糙简陋；
    2. 输入框右侧虽然提供了快捷单位药丸（`k`、`M`、`K` 等），但因为文本是纯数字未带单位后缀，药丸处于**未选中灰色状态**，缺乏直观单位指示；
    3. 用户期望进入页面、重置或切换预设时，值直接就是人类友好的 K 级别紧凑文本（如 `100k`、`32k`、`4k`），并且对应的单位药丸（如 `k`）自动处于**高亮选中态**。

- **根因分析**：
  1. **数据初值与预设同步逻辑过于原始**：`BudgetContextSettings.vue` 中的 `syncFromProps` 和 `applyPreset` 仅对数值进行了朴素的 `String(value)` 转换，直接输出了原始整数文本，未做领域语义单位适配；
  2. **药丸激活态绑定单纯依赖后缀匹配**：`QuantityInput.vue` 中的药丸高亮依据 `textValue.endsWith(pill)`，由于初始文本未附加 `k`/`M`，药丸无法激活；若用户点击药丸切换单位，因原文本已是完整整数（如 `100000`），简单追加单位会导致基数异常膨胀（变成 `100000k`）；
  3. **AI 领域 1000 与 1024 混用下的语义等价与脏状态误判**：模型上下文和输出上限中常出现 `4096`、`16384`、`2048` 等二进制阶数，若粗暴将其转为 `4k`，反向解析得到 `4000`，会导致 `isDirty`（`4096 !== 4000`）在页面初次进入时即误报“有尚未保存的预算变更”，预设卡片也会误匹配为“自定义微调”。

- **决策与实现方案**：
  1. **构建双向紧凑单位格式化工具 `toCompactQuantityString`**：
     - 在 `quantity-format.ts` 中实现紧凑字符串生成：
       - `tokens` 类型：>=1,000 转换为 `k`（对 4096、2048、8192、16384 等经典 Token 阶数精准映射为整倍数 `4k`、`2k`、`8k`、`16k`；32000 -> `32k`，100000 -> `100k`；>=1,000,000 映射为 `1M`）；
       - `bytes` 类型：以 1024 阶数转换为 `K`/`M`/`G`（如 65536 -> `64K`，10485760 -> `10M`，8192 -> `8K`）；
       - `seconds` 类型：整分整时转换为 `m`/`h`（如 1800 -> `30m`，60 -> `1m`，3600 -> `1h`）；
       - `number` 类型：纯数字保持不变（如步数 80、召回条数 5），不附带药丸与单位；
  2. **实现语义等价比对工具 `areQuantitiesEquivalent` 杜绝脏状态漂移**：
     - 比对两个数值或字符串是否实质等价，引入归一化紧凑字符串比对兜底；
     - 4096 与 4000（或 "4k"）在 tokens 语境下被判定为等价，初次加载绝对不触发 `isDirty`，完美保持预设“标准均衡”高亮选中；保存时若未作实质更改，保留后端原始值，避免细微抖动；
  3. **升级 `QuantityInput.vue` 智能感知与质感药丸**：
     - 内部 `watch(modelValue)` 智能识别纯数字或数值，自动格式化为紧凑格式；若已语义等价则严禁冲写用户当前输入；
     - 药丸增加高质感高亮状态（`bg-primary/15 text-primary font-bold ring-1 ring-primary/30 shadow-xs`）；
     - 点击药丸（如从 `k` 点击 `M`）严格提取前置基数（`100k` -> `100M`），支持多单位双向无缝切换；
  4. **全套预设与多字段联动重构**：
     - `BudgetContextSettings.vue` 初次从 props 加载、切换预设卡片（快速轻量、标准均衡、深度探索）全面采用 K 级别紧凑单位填充；
     - 微反馈同步优化：4096 显示 `≈ 4k (4,096 Tokens)`，彻底告别怪异的 `4.1k` 歧义。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 静态校验通过。
  - `vue-tsc --noEmit` 0 错误。
  - CDP 真实浏览器实测检验：
    - 全新加载或硬刷新进入【模型与预算】：
      - `任务总 Token 预算`：输入框显示 `100k`，右侧 `k` 药丸紫色高亮选中；
      - `单次上下文窗口`：输入框显示 `32k`，右侧 `k` 药丸紫色高亮选中；
      - `单次最大输出`：输入框显示 `4k`，右侧 `k` 药丸紫色高亮选中；
      - `执行超时时间`：输入框显示 `30m`，右侧 `m` 药丸高亮；
      - `单工具超时`：输入框显示 `1m`，右侧 `m` 药丸高亮；
      - `工具输出截断`：输入框显示 `64K`，右侧 `K` 药丸高亮；
      - `原始工具输出上限`：输入框显示 `10M`，右侧 `M` 药丸高亮；
      - `记忆召回字节上限`：输入框显示 `8K`，右侧 `K` 药丸高亮；
    - 页面初次进入未产生误脏，底部保存按钮正确保持禁用态，“标准均衡”预设正常勾选；
    - 点击“快速轻量”即刻联动刷新为 30k/16k/2k/10m/32K/2M/4K 且药丸同步高亮；
    - 点击“深度探索”即刻联动刷新为 300k/64k/8k/1h/2m/128K/20M/16K 且药丸同步高亮；
    - 点击药丸 `M` 即刻从 `100k` 变为 `100M`，再点击 `k` 即刻切回 `100k`，数值保存与恢复测试 100% 成功。

### P-043: Agent 设置 - 模型服务商“更新模型”抽屉重复关闭按钮消除与交互单一收敛

- **现象与用户反馈**：
  在 Agent 设置的【模型 Provider】卡片中，点击【更新模型】展开模型库同步与配置抽屉后，抽屉顶部横栏的右侧有一个【更新模型】刷新按钮及其右侧紧贴的 `X` 图标关闭按钮，而在抽屉底部操作栏右侧又有一个醒目的【保存并关闭】主操作按钮。用户反馈“更新模型右边的关闭和下边的保存并关闭重复了”，界面在同一个抽屉视图内堆叠了两个不同样式的关闭动作，造成视觉杂乱与操作路径认知冗余。

- **根本原因分析**：
  1. **历史迭代遗留重叠**：早期抽屉设计在顶部横栏右侧放置了 `[ 🔄 更新模型 ]` 和 `[ ✕ ]` 快捷关闭按钮；后续为了增强用户配置保存的确定感与心理安全感，在抽屉底部新增了操作条，并在右侧增加了醒目的主按钮 `[ ✓ 保存并关闭 ]`；
  2. **关闭操作未做收敛归一**：两个关闭动作均绑定为 `drawerOpen[provider.id] = false`，顶部横栏的 `✕` 与底部的【保存并关闭】不仅功能 100% 重叠，而且顶部横栏右侧将功能刷新按钮与关闭按钮紧贴放置，视觉体验拥挤且语义不纯粹。

- **决策与实现方案**：
  1. **移除顶部横栏冗余的关闭按钮**：
     - 在 `ModelProviderSettings.vue` 中，彻底移除顶部横栏右侧与“更新模型”相邻的 `✕` 关闭按钮；
     - 抽屉顶部横栏右侧纯粹保留【更新模型】接口刷新操作，界面呼吸感和对齐感显著提升；
  2. **收敛唯一明确的关闭主路径**：
     - 抽屉底部操作条右侧保留带有正反馈的【保存并关闭】主操作按钮（搭配底栏左侧“所有模型变更均即时同步持久化至服务端”的明确提示）；
     - 用户配置模型（多选、全选、取消添加）后视线自然从上至下流转，统一在底部点击【保存并关闭】完成抽屉收起，且卡片顶部的【更新模型】按钮亦可自然充当折叠收起开关，交互路径清晰唯一。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 校验通过，无多余未引用资源及架构违规；
  - `vue-tsc --noEmit` 静态类型检查 0 错误；
  - CDP 真实浏览器实测检验：
    - 点击服务商卡片中的【更新模型】展开抽屉；
    - 抽屉顶栏右侧仅展示干净统一的【更新模型】按钮，右侧无多余的 `X` 按钮；
    - 抽屉底栏保留【保存并关闭】主操作按钮；
    - 点击【保存并关闭】后抽屉平滑收起；再次点击卡片顶部的【更新模型】可正常展开与再次折叠收回。

### P-044: Agent 设置 - 模型服务商抽屉“一键移除”与“全选可移除”对称能力建设

- **现象与用户反馈**：
  在【更新模型】抽屉中，左栏【可添加模型】具备“全选复选框”、“添加所选”以及醒目的“一键添加所有模型”能力；而右栏【已生效模型】仅提供了多选后的“取消所选”与列表单项删除按钮，缺少与左栏完全对称的“全选”复选框与“一键移除”按钮。用户反馈“有一键添加也要有一键移除呢”，批量清理或重置已添加模型操作繁复。

- **根本原因与边界约束分析**：
  1. **左右两栏能力不对称**：前序迭代重点聚焦在服务商发现模型的快速纳管（一键添加所有），右栏的清退机制仅停留在逐个勾选的被动状态；
  2. **后端契约与系统稳定性强约束**：
     - 后端 `provider.service.ts` 明确要求 `raw.models.length >= 1`，服务商模型列表绝对不允许传空数组；
     - 系统全局默认主力模型（`defaultModelId`）必须保持可用，直接清空会导致运行调度异常；
     - 因此，“一键移除”不能无脑清空至 0 个，必须智能锁定并保留基底核心模型（优先保留系统默认主力模型，否则保留首个基础模型），一键移除其余所有可清理模型。

- **决策与实现方案**：
  1. **右栏头部工具栏对称化重构**：
     - 增加 `removableConfiguredModels(provider)`：自动识别除受保护核心模型（默认模型或首个模型）以外的所有可移除模型；
     - 增加“全选/全不选”复选框：支持一键快速勾选/取消勾选全部可移除模型；
     - 增加【一键移除】按钮（`removeAllConfigured`）：带有 `fa-solid fa-trash-can` 垃圾桶图标与红色警示质感，当存在可移除模型时展示；
  2. **智能保留核心模型与无缝数据流转**：
     - 用户点击【一键移除】时，系统自动保留主力默认模型，并一次性移除其余所有模型，持久化同步至后端；
     - 移除后的模型瞬时回流至左栏【可添加模型】列表中，左栏即刻浮现【一键添加所有模型】，实现可逆互通的完整交互闭环；
  3. **国际化与多语种覆盖**：
     - 在 `zh-CN.json`、`en-US.json`、`ja-JP.json` 中统一接入 `removeAllModels`（“一键移除”/“Remove all”/“一括解除”）与 `saveNoticeRemovedAll` 动态通知词条。

- **验证标准与测试结果**：
  - `check-i18n.mjs` 与 `check-architecture.mjs` 静态校验 100% 通过；
  - `vue-tsc --noEmit` 0 错误；
  - CDP 真实浏览器实测检验：
    - 展开【更新模型】抽屉，右栏头部清晰展示【全选】复选框与【一键移除】按钮；
    - 点击【全选】复选框，44 个可移除模型批量勾选，并出现【取消所选 (44)】，默认模型锁定不受影响；再次点击全选复选框平滑取消全部勾选；
    - 点击【一键移除】按钮，44 个模型瞬间移除，右栏仅保留默认主力模型，提示“已成功一键移除 44 个模型并保存至服务端”；
    - 移除后 44 个模型即时流转至左栏【可添加模型】；
    - 点击左栏【一键添加所有模型】，44 个模型瞬间重新添加回右栏，右栏重新展示 45 个模型及【一键移除】按钮；
    - 再次点击【保存并关闭】正常收起抽屉。

## P-045 Agent 运行策略过度参数化：改为“全局默认 + App 覆盖 + 高级策略 + 系统硬护栏”

- **发现时间**：2026-09-14
- **问题现象与用户诉求**：
  1. 当前 Agent 设置把 `maxContextTokens`、`maxOutputTokens`、`maxRunTokens`、`maxRunSteps`、执行时间、Tool 输出、Recall、Subagent 消息、Artifact 等大量底层限制同时作为一套 User 全局配置，既繁琐，又无法表达不同 App 的真实差异。
  2. 不同 App 的任务形态差异很大：普通问答可能 1~2 个 context window 即可结束；Coding/Research 可能正常就需要多个 context window、多个 Subagent、大量 Tool 输出和 Artifact；Automation 则可能更关心时间、Token 消耗与异常快速熔断。不能让所有 App 共用一套固定 Token/Step 参数。
  3. 固定 `maxContextTokens=32K`、`maxOutputTokens=4K` 一类全局默认会人为缩小模型能力。模型自身支持 128K/256K/更大 context 时，Nexus 应按模型 capability 使用，而不是要求用户再手工把 Nexus 的限制调大。
  4. 当前预算偏向“达到数值就停/申请增加”，但成熟 Agent 更应该区分：正常任务、超过正常额度但仍持续有进展的健康长任务、以及无进展/重复调用/死循环等异常任务。
  5. Tool bytes、Artifact、Mailbox 等并非都应该隐藏：其中部分是用户真实需要按 App 调整的工作负载参数；但 HTTP/WebSocket frame、解析器上限等协议安全边界不应暴露成普通产品设置。

- **现状约束**：
  - 当前 `AgentSettingsService` 是按 `userId` 存储的 User 全局设置。
  - 每个 Run 已天然拥有 `appId`，项目已有 App-scoped storage，因此可以在不复制整套 Settings 的前提下增加 App 级策略覆盖。
  - Run 创建时已经会 snapshot settings/model 等运行信息，适合进一步 snapshot “解析后的 App effective execution policy”，保证任务运行中配置变化不会让同一个 Run 的规则漂移。

- **总决策**：
  - 不再采用“普通用户只剩 3 个参数”的过度简化方案。
  - 改为四层配置模型：**System hard ceiling > User global defaults/hard limits > App overrides > Run snapshot**。
  - App 默认全部 `inherit` User 全局设置，只保存自己真正不同的字段；不为每个 App 复制一整份配置。
  - 对任务规模采用 **context-window multiplier（窗口倍数）** 表达，而不是固定 Token 数。模型切换后按该模型的 `contextWindow` 自动换算。
  - Context compaction 属于高级策略，允许按 context window 使用比例自由调节。
  - 正常额度不是硬停止点；健康任务自动进入扩展区。硬限制只作为极端保险丝。异常一旦被 runtime 确认，第一次确认即终止对应 Agent。

### 一、配置继承模型

有效配置按以下顺序解析：

```text
System hard ceiling
        ↓ cap
User global defaults / user hard limits
        ↓ inherit
App execution policy overrides
        ↓ snapshot at Run creation
Run effective policy
```

- **User 全局默认**：定义“绝大多数 App 怎么跑”，用户只需配置一次。
- **App 覆盖**：每个 App 只保存与全局不同的字段；字段支持“一键恢复继承”。
- **Run snapshot**：任务启动时把最终 effective policy 固化到 Run，运行中修改 App/全局设置仅影响下一次 Run。
- **System hard ceiling**：防 OOM、协议攻击、资源失控等，不能被 App 绕过。

UI 上每个 App 的运行设置应明确显示：

- `继承全局`；
- `已覆盖`；
- `当前有效值`；
- `恢复继承`。

避免用户进入每个 App 后重新填写几十项相同内容。

### 二、普通 App 设置：真正需要按 App 不同的核心运行参数

以下参数允许 **User 全局设置默认值，也允许 App 覆盖**。

#### 1. 当前任务最大 Agent 数

- 含主 Agent + Subagent。
- 全局建议默认：`4`（1 主 + 最多 3 子）。
- App 可覆盖，例如：
  - 简单 Chat：`1~2`；
  - Coding：`4`；
  - Deep Research：`6~8`；
  - Automation：根据资源需求配置。
- 底层 `maxConcurrentRuntimes` / `maxConcurrentModelCalls` 不再要求普通用户分别协调；它们作为 User/System 资源池上限，对所有 App 的并发做最终 cap。

#### 2. 主 Agent 正常工作量（单位：context windows）

- 不输入固定 Token，输入“允许正常消耗多少个模型上下文窗口”。
- 全局建议默认：`4× contextWindow`。
- App 可自由覆盖，例如 Chat `2×`、Coding `4×`、Research `8×`。
- 256K 模型配置 `4×` 时，正常累计模型 Token 约为 `1.0M`；切换 128K 模型后自动变为约 `512K`，无需改 App 设置。

#### 3. 主 Agent 健康扩展上限（单位：context windows）

- 超过 normal 但仍持续产生 progress 时自动进入，不弹“增加预算”。
- 全局建议默认：`12× contextWindow`。
- App 可覆盖，例如短交互 App 可以 `4×`，Research 可 `20×` 或更高。
- 必须满足 `healthyExtended >= normal`。

#### 4. Subagent 正常工作量（每个 Child，单位：context windows）

- 每个 Subagent 独立 context、独立额度。
- 全局建议默认：`2× contextWindow`。
- App 可覆盖，例如 Research worker `4×`，轻量分类 worker `1×`。

#### 5. Subagent 健康扩展上限（每个 Child，单位：context windows）

- 全局建议默认：`6× contextWindow`。
- 持续有 progress 才能进入扩展区。
- Child 的真实 Token 继续计入 Run 总 usage，不能通过多开 Subagent 绕过总量限制。

#### 6. 任务最长活跃执行时间

- 建议保留用户可设置，并允许 App 覆盖。
- Chat 可较短，Coding/Research/Automation 可较长。
- 这里计算 active execution，不应把等待用户审批、等待 Child、纯排队时间全部算成“模型失控”。

> 普通 App 设置不再展示固定 `maxContextTokens`、固定 `maxOutputTokens`、`maxRunSteps` 等容易与模型能力冲突的参数。

### 三、模型 Context / Output：直接按模型 capability，App 不再手工填写固定 Token 天花板

- **Context window**：以 Provider Model 的 `model.contextWindow` 为物理能力上限。
- **Max output**：以模型声明的 `model.maxOutputTokens` 为物理能力上限。
- Nexus 不再给所有模型统一套 `32K context / 4K output` 一类默认缩限。
- 如果未来确实需要“本 App 主动少用上下文以省钱/提速”，应通过“Context 利用率/压缩策略”表达，而不是再造一个比模型 capability 更小的绝对 Token 数。

### 四、高级 App 设置：Context 管理按模型窗口比例自由调节

Context compaction 放到“高级运行策略”，**User 有全局默认，App 可覆盖**。

建议只暴露少量有明确语义的百分比：

1. **目标上下文利用率（Target utilization）**
   - 建议默认：`70%`。
   - 表示正常情况下尽量把 prompt working set 控制在模型窗口的约多少比例以内。

2. **强制压缩阈值（Force compact）**
   - 建议默认：`85%`。
   - 预计下一次模型调用会达到/超过此比例时，必须先 compact，再发请求。

3. **紧急保留区（Reserved headroom）**
   - 不一定单独让用户填；可以由 `100% - forceCompact` 与 model max output 自动推导。
   - Runtime 必须保证 output/tool-call headroom，不允许 prompt 填满物理窗口。

建议 UI 使用滑杆/百分比，而不是 Token 输入框，并显示模型换算结果：

```text
模型 context: 256K
目标利用率 70%  → working set ≈ 179K
强制压缩 85%   → ≈ 218K 前必须 compact
模型最大输出    → 按模型 capability 自动保留
```

Compact 内容保持结构化：`goal / plan / completed work / decisions / known facts / failed attempts / open questions / artifact refs / subagent results / verification state`，并保留最近原始对话窗口与按需 Recall。

### 五、数据与工具预算：哪些应该让用户/App 设置

#### A. 建议保留为 User 全局默认 + App 可覆盖

这些参数确实随 App 工作负载变化，用户有合理调节需求：

1. **单次 Tool 可见输出上限 `maxToolOutputBytes`**
   - 模型真正直接看到的 Tool result 上限。
   - Coding/日志分析可能需要更大；简单 Chat 可以更小。
   - 超过后优先 truncate/summarize/spill artifact，而不是直接把巨大内容塞进 context。

2. **单次 Tool 原始采集上限 `maxRawToolBytes`**
   - Tool 在生成摘要/Artifact 前最多允许读取/采集多少原始数据。
   - 用户可调，但必须被 System hard ceiling cap。
   - UI 必须解释它与“模型可见 Tool 输出”不同。

3. **Tool timeout**
   - 不同 App 差异明显：普通 API/读取工具几十秒足够，构建/测试/远程诊断可能需要几分钟。
   - User 全局默认 + App override 合理。

4. **Recall 数量/容量**
   - `maxRecallItems` 与 `maxRecallBytes` 可以保留在高级 App 设置。
   - Research/知识型 App 可能需要更多 Recall；执行型 App 可以更少。

5. **每 Run Artifact 预算**
   - 建议从当前“主要是全局 storage limit”进一步区分出 App/Run 工作预算。
   - App 可设置 `maxRunArtifactBytes`、必要时 `maxSingleArtifactBytes`。
   - 例如代码分析 App 与媒体/文档处理 App 的 Artifact 规模完全不同。

6. **Subagent Mailbox 总预算**
   - 建议高级 App 可设置“每 Run 最大 Agent 消息数 / 总消息容量”。
   - Research 多 Agent 协作可能需要更高；简单 App 可低一些。
   - 这是协作工作量策略，不等于协议层单消息 frame 上限。

#### B. 建议只做 User 全局设置，不做 App override

这些属于账户/实例共享资源，按 App 分配反而容易互相绕过：

1. **全用户最大并发 Agent/runtime 数**；
2. **全用户最大并发 Model call 数**（可继续支持 `auto`）；
3. **全局 Artifact 存储配额**；
4. **全局最大 Active Workspace 数**；
5. **全局 emergency Token/Cost/Active-time ceiling**。

App 的值只能小于这些全局资源/硬上限，不能扩大它们。

#### C. 建议继续保留为 System/internal，不提供用户设置

这些属于协议/实现安全边界，暴露给用户只会增加复杂度和误配置风险：

1. HTTP request/body 最大 frame；
2. WebSocket frame / SSE frame 最大尺寸；
3. Provider parser buffer / Tool argument JSON 最大 frame；
4. Mailbox **单消息** envelope/body 的协议绝对上限；
5. 内部 lease TTL absolute maximum / renewal safety margin；
6. JSON/schema 字段长度、数组绝对 item count；
7. 防 OOM 的 assistant response absolute bytes；
8. 数据库/队列批次、安全解析器等实现级 ceiling。

这些仍可由部署环境/代码常量控制，但不进入普通 Agent 设置页面。

### 六、Hard Limits 不删除，但重新分类成“用户硬上限”和“系统硬上限”

#### 用户可以设置的 Hard Limits（高级 / 系统策略页）

保留，并要求确认：

- 全局 emergency Run Token ceiling；
- 全局 emergency Run Cost ceiling；
- 全局 emergency Active Execution ceiling；
- 全局 max concurrent Agents/runtimes；
- 全局 max concurrent Model calls；
- 全局 Artifact storage quota / single artifact ceiling；
- 全局 max Active Workspaces；
- Tool raw/output bytes 的用户级最大可配置 ceiling；
- Recall / mailbox 总预算的用户级最大 ceiling。

这些不是正常任务的“推荐预算”，而是用户自己愿意给 Nexus 的最大资源边界。正常健康任务应该远早于这些 ceiling 结束。

#### 用户不需要设置的 Hard Limits

协议 frame、parser buffer、单消息协议绝对长度、内部 lease absolute max、OOM guard 等继续只由系统控制。

### 七、正常 → 健康扩展 → 异常熔断

#### Normal

- 在 App normal window budget 内自然执行。
- 无 budget approval、无额外提示。

#### Healthy Extended

- 超过 normal，只要 runtime 仍观察到有效 progress，就自动继续到该 App 的 healthy-extended ceiling。
- Progress 建议统一推进 `progressEpoch`，包括：
  - mutation 成功提交；
  - 新 artifact/evidence/shared fact；
  - plan item 状态变化；
  - 新 Subagent completion/evidence；
  - 同一目标 Tool 返回了新的状态/result hash；
  - user input / goal revision 更新；
  - verification 有实质推进。

#### Abnormal

- 不等待 Token/step ceiling。
- 利用现有 `operationHash`，增加 `resultHash + progressEpoch`。
- 建议异常确认条件之一：同一 operation + 同一 result + 无 progress 连续 `3` 次，或同一确定性 failure 在无状态变化下重复达到阈值。
- **一旦首次确认 abnormal：立即终止当前异常 Agent。**
  - Child：cancel/failed，返回 blocker/evidence 给 parent；
  - Root：停止 Run，保存事实/checkpoint，返回 `loop_detected` / `no_progress`。
- 429/5xx/网络瞬态错误不属于 Agent loop，仍走有限 retry。

### 八、App 策略预设：降低逐项配置成本，但不限制高级用户

为了避免“支持 App override”后又变成每个 App 都要填很多字段，提供可继承的策略预设：

| 预设          | 最大 Agent | Root normal / extended | Child normal / extended | Context 策略              | Tool/Artifact 倾向 |
| ------------- | ---------: | ---------------------- | ----------------------- | ------------------------- | ------------------ |
| 轻量交互      |          2 | `2× / 4×`              | `1× / 2×`               | 较积极 compact            | 小                 |
| 标准          |          4 | `4× / 12×`             | `2× / 6×`               | `70% / 85%`               | 中                 |
| Coding        |          4 | `4× / 12×`             | `2× / 6×`               | 保留较多近期 Tool history | 中~大              |
| Deep Research |          6 | `8× / 20×`             | `4× / 10×`              | 更高 context 利用率       | 大                 |
| Automation    |          3 | `3× / 8×`              | `1× / 3×`               | 稳定/低噪声               | 严格 time/cost     |
| 自定义        |          — | 用户/App 自定          | 用户/App 自定           | 自定                      | 自定               |

预设只是一次性/继承模板，不是新的硬编码运行模式。用户修改任一字段后进入“自定义”，仍可随时恢复全局继承。

### 九、建议的数据结构方向

不要把完整 User Settings JSON 复制到每个 App。建议新增 App-scoped sparse override，例如：

```ts
interface AgentExecutionPolicyOverride {
  preset?: 'light' | 'standard' | 'coding' | 'research' | 'automation' | 'custom';
  maxAgents?: number;
  rootNormalWindows?: number;
  rootExtendedWindows?: number;
  childNormalWindows?: number;
  childExtendedWindows?: number;
  maxActiveExecutionSeconds?: number;
  context?: {
    targetUtilization?: number;
    forceCompactAt?: number;
  };
  tools?: {
    timeoutSeconds?: number;
    maxVisibleOutputBytes?: number;
    maxRawBytes?: number;
  };
  recall?: { maxItems?: number; maxBytes?: number };
  artifacts?: { maxRunBytes?: number; maxSingleBytes?: number };
  collaboration?: { maxMessages?: number; maxMessageBytes?: number };
}
```

解析后的 `EffectiveAgentExecutionPolicy` 再与 model capability、User hard limits、System ceiling 做 clamp，并 snapshot 到 Run definition/budget。

### 十、计划修改（本条仍只记录方案，暂不实施）

1. Agent Settings 拆成：
   - **全局默认策略**；
   - **App 运行策略**（稀疏 override + inherit）；
   - **高级运行策略**（context 百分比、Tool/Recall/Artifact/Mailbox）；
   - **Hard Limits**（仅用户真正需要控制的全局资源 ceiling）。
2. App 级策略使用现有 App-scoped storage 或独立 repository 存 sparse override，不复制整份 User Settings。
3. Run 创建时解析 `System → User → App → Model capability`，把 effective policy snapshot 到 Run。
4. 移除正常路径中的固定 `maxContextTokens/maxOutputTokens` 缩限；改用模型 capability + context utilization/compaction ratio。
5. Run/Subagent 工作量按 context-window multiplier 派生 Token normal/extended budget。
6. 增加 `ContextCompactionService`、compact watermark 与结构化 compact state。
7. 增加 `ProgressGuard/NoProgressGuard`，异常首次确认即停止对应 Agent。
8. Tool/Recall/Artifact/Mailbox 中适合工作负载调节的字段保留为 User default + App override；协议级 frame/parser/OOM guard 下沉为 internal hard ceiling。
9. 保留现有 usage 总账、checkpoint、lease、deadline、cost accounting、artifact safety 与 mailbox durability。

### 十一、验证标准

- User 设置一个全局默认后，新 App 无需配置即可直接继承运行。
- Coding App 可只覆盖 `maxAgents=4`、Root `4×/12×`、Tool output 等少量字段；Research App 可覆盖 `6 agents`、`8×/20×`、更高 Recall/Artifact，而不互相影响。
- App “恢复继承”后立即回到全局策略，下一次 Run 生效；已有 Run 保持启动时 snapshot，不漂移。
- 256K 模型不再被 Nexus 固定 32K context / 4K output 人为缩限；模型切换后 window-based budget 自动重新换算。
- 用户可在高级 App 设置里调 context target/force compact 百分比，并看到换算后的 Token 数。
- Tool visible/raw bytes、Recall、Run Artifact、Mailbox 总预算可按 App 调节，但不能突破 User/System hard ceiling。
- HTTP/WebSocket/Provider frame、parser buffer、单消息绝对协议大小等不出现在普通 UI，系统安全限制仍生效。
- 健康长任务超过 normal 自动进入 extended；重复无进展达到一次异常确认后立即终止，不继续烧到 emergency hard ceiling。

- **当前状态**：`方案已按“全局默认 + App 覆盖 + 高级策略 + Hard Limits 分层”修订；待确认，未实施代码修改`

### 十二、长期对话的预算边界：Thread Context 连续，User Turn / Run Budget 重新计数

普通用户连续追问时，不能把整个 Thread 生命周期的模型 Token 一直累计到同一个 `maxRunTokens` 上限，否则会出现“前面聊得越久，后面新问题越容易刚开始就触顶”的体验问题。P-045 的运行预算应明确采用 **Thread Context 与 Run Usage 分离** 的模型：

- **Thread Context 连续继承**：历史消息、结构化 compacted state、重要事实、计划状态、Artifact 引用、Subagent 结果等继续作为长期会话状态存在；新一轮用户输入不会清空上下文。
- **每次新的显式用户输入创建新的 Run execution budget**：当前 Run 的累计 `inputTokens + outputTokens`、normal quota、healthy-extended quota 从 0 重新开始计算，不继承上一轮已经消费的执行 Token。
- 新 Run 第一次模型调用仍需正常计算本次实际带入的历史 Context。例如带入 180K 历史上下文，则这 180K 计入新 Run 的 input usage，但不会再把旧 Run 过去已经调用过的数百万 Token 重复累计进来。
- **Subagent quota 同样属于当前 Run**：新的用户输入开启新的 Run 后，新的 Subagent 使用新的 normal / healthy-extended 额度；旧 Run 的 child usage 只保留在历史 usage / telemetry 中。
- **No-progress / loop guard 主要 Run-scoped**：新的显式用户输入属于新的目标修订与进展边界，应重新建立当前 Run 的 `progressEpoch` 基线，不能因为上一轮曾经进入 no-progress 状态就直接限制下一轮。
- Context 压缩仍然是 **Thread-scoped / model-window-scoped**：长期聊天是否需要压缩由当前模型 `contextWindow` 占用比例决定，而不是由上一轮 Run 消耗了多少 Token 决定。

以 256K context window、Main Agent `4× / 12×` 为例：

```text
User Turn A
  Run A usage: 0 -> normal ~1.0M -> healthy extended ~3.0M -> complete

User Turn B
  inherit Thread context / compacted state
  Run B usage: reset to 0 -> normal ~1.0M -> healthy extended ~3.0M

User Turn C
  inherit Thread context / compacted state
  Run C usage: reset to 0 -> ...
```

这里的 `~3.0M` 表示“为完成当前这一轮用户请求，Main Agent 可以累计调用模型的 Token”，**不是整个聊天会话生命周期总共只能使用 3.0M Token**。

同时仍保留跨 Run 的安全边界，但它们不作为普通任务的常规 Token 限制：

- provider rate / quota；
- 极端 emergency token / active-time circuit breaker；
- 基础设施并发与 DoS 防护。

这些跨 Run 限制只承担资源与安全保护职责，不应造成“用户正常连续追问时额度越来越少”的交互效果。

**实现语义要求：**

- `maxRunTokens` 如果继续保留该名称，必须严格定义为 **per Run**，不能等同于 Thread / Session lifetime budget。
- `RunUsage` 在新用户输入创建新 Run 时从零初始化。
- Thread 级历史 usage 可用于账单、telemetry、统计与 emergency policy，但不能直接拿来扣减新 Run 的 normal / healthy-extended quota。
- Checkpoint / resume 同一个 Run 时继续恢复该 Run 已消费 usage；只有新的显式用户 turn / 新 Run 才重置执行预算。

新增验证标准：

- 连续完成多个高 Token Run 后，用户发送一条新的正常请求，新 Run 仍获得完整 normal / healthy-extended 额度。
- 新 Run 能继承上一轮的重要上下文与 compacted state，但 `RunUsage` 不继承上一轮累计 Token。
- 同一个 Run 的断点恢复不会错误重置 Token usage。
- Thread 历史很长时，通过 Context Compression 控制单次调用输入窗口，而不是通过耗尽旧 Run 的 Token 额度阻止用户继续提问。

## P-046 挂起长任务终端恢复应优先加载最新状态，并按需向上分页历史；`reportAllChanges/startTime` 异常与 Monaco 问题分离

- **发现时间**：2026-09-14
- **用户场景**：挂起会话可能持续运行 `rclone -P`、长时间编译、下载、同步、`top/watch` 等任务。用户重新进入时首先需要看到“现在执行到哪里”，而不是先回放完整历史；只有主动向上查看时才需要加载更早输出。

### 一、当前实现已经具备的基础能力

1. **恢复时默认加载日志尾部，而不是完整日志**：
   - `WorkspaceSuspendCoordinatorService.beginResume()` 当前通过 `logs.readTail(..., 256 KiB)` 读取 retained log 的最新尾部；
   - 前端收到 tail 后恢复终端并落在最新输出附近，因此大日志不会在恢复时一次性全部传输到浏览器。
2. **历史已经支持向上懒加载**：
   - 当用户滚动到终端顶部附近时，Frontend `TerminalView.vue` 调用 `suspend.history.previous`；
   - Backend 通过 `readBefore(..., 256 KiB)` 每次向前读取一页；
   - 用户不查看历史时，不加载早期日志。
3. **查看历史期间仍保留 live output**：
   - `TerminalView.vue` 在 history browsing/rebuild 期间把新的 terminal output 暂存在 deferred buffer；
   - 用户返回最新视图后再恢复 live output，避免长任务的新输出在浏览历史时强制抢滚动位置。
4. **当前 retained raw log 上限**：本地 suspended-session log 当前保留最近约 `100 MiB` 原始 PTY byte stream，超出后保留最近内容。

### 二、现有 tail replay 对普通日志合适，但对动态重绘终端存在语义边界

- 普通 append-only 输出（逐行日志、编译日志、文件列表等）从最近 `256 KiB` 开始 replay 基本可靠。
- `rclone -P`、`top`、`watch`、某些下载器/构建工具会通过 `\r`、cursor-up、erase-line、ANSI CSI 等控制序列反复更新**已经显示的同一块内容**，而不是持续新增完整行。
- 当前 log store 保存的是完整原始 PTY byte stream，因此这些更新动作都被记录；但是从任意 byte/换行边界截取 tail 并不能保证该位置是完整的 VT terminal state 边界。
- 例如 tail 可能从一次 `cursor-up / erase-line` 的中间阶段开始，此时缺少更早的 cursor/screen state；xterm 往往仍能显示部分结果，但不能保证复杂动态 UI 能 100% 重建为挂起前的最新屏幕。
- 因此长期目标不能只依赖“截取最新 raw bytes”，而应该区分：
  - **Raw PTY history**：负责完整历史、下载日志、向上分页；
  - **Latest terminal checkpoint**：负责快速、确定地恢复当前屏幕状态。

### 三、目标设计：Latest Terminal Checkpoint + Raw History Lazy Paging

恢复挂起终端改为以下逻辑：

```text
Raw PTY log (append-only / retained)
    └── 用户向上滚动时按页读取历史

Terminal checkpoint
    ├── 当前 screen / cursor / attributes / scrollback tail
    └── checkpoint 对应 raw-log offset

恢复：latest checkpoint + checkpoint 后少量 PTY delta + live stream
```

- **打开挂起会话**：优先加载最新 terminal checkpoint，直接展示当前进度/当前屏幕；然后 replay checkpoint offset 之后的少量 delta，最后接入 live stream。
- **向上查看历史**：继续复用当前 `readBefore()` 分页，不需要把旧历史放进初始恢复请求。
- **返回底部**：切回 checkpoint/live view，并应用用户浏览历史期间积压的新输出。
- 这样即使 `rclone` 已经运行数小时并产生大量 progress redraw，恢复也不需要从任务早期重新执行全部 ANSI 控制序列才能得到当前 80%/90% 的状态。

### 四、Checkpoint 生成策略建议

- Checkpoint 属于**恢复优化状态**，不是新的完整日志副本，避免重复保存全部历史。
- 第一版建议采用双触发：
  - suspended 状态每约 `30s` 最多生成一次；
  - 或 checkpoint 后累计新增约 `1 MiB` PTY output 时刷新；
  - 两者取先达到者，并做节流，避免高频进度条导致持续序列化。
- checkpoint 应记录对应的 raw-log offset/revision，使恢复时可以严格执行：`checkpoint → delta → live`，避免重复或缺失输出。
- checkpoint 大小需要独立上限，只保留最新一个（或最新极少数），不随运行时间线性增长。
- 普通低输出 shell 不需要频繁 checkpoint；动态 redraw/高输出任务才会自然触发更多刷新。

### 五、前端行为目标

- 默认打开永远定位最新内容，不因为存在大量历史而先跳到顶部。
- 用户主动向上滚动才请求旧页；旧页加载后保持 viewport anchor，不能因 prepend 导致当前位置跳动。
- 用户正在浏览历史时，live output 不抢滚动位置；底部可显示“有新输出/返回最新”提示（若后续 UX 需要）。
- deferred live output 达到安全阈值时允许自动回到 latest，避免浏览历史过久导致浏览器内存无限增加。
- Search 只对当前已加载窗口生效；如后续需要“搜索完整挂起日志”，应走后端日志搜索，而不是为搜索一次性加载全部 100 MiB。

### 六、`rclone` 等任务的预期效果

- 对 `rclone -P` 这类原地更新 stats block 的任务，重新进入挂起会话后应直接看到**最新进度状态**，而不是看到几十万次历史百分比更新，也不需要 replay 数小时输出。
- 原始 PTY history 仍然保留，因此用户向上查看时可以看到之前真实发生过的输出；是否视觉上合并为“同一行更新”由 terminal replay 语义决定，不把动态 UI 强制转换成普通文本日志。
- 若用户真正需要审计型逐次进度记录，应由任务自身开启 file log / structured progress，而不应让 terminal UI 把每次 redraw 人为展开成一行。

### 七、本轮新出现的 `startTime` 前端异常判断

用户观察到：

```text
Uncaught TypeError: Cannot read properties of undefined (reading 'startTime')
    at et.reportAllChanges (<anonymous>:2:19429)
    at <anonymous>:2:13070
    ...
```

- 仓库源码中没有 `reportAllChanges` 实现，也没有发现 Nexus 自己引入对应的 Web Vitals reporting 代码路径。
- Stack frame 为 `<anonymous>:2`，与此前 Monaco 错误中明确位于 `MonacoEditor-*.js` / Monaco DI service 的调用链不同。
- 当前判断：该错误与此前 `UNKNOWN service actionWidgetService` **不是同一问题**；它更符合浏览器 DevTools / Live Metrics / Web Vitals 注入脚本自身异常的特征。
- 该异常目前没有证据表明会调用 Nexus `WorkspaceRuntimeSession.close()/dispose()` 或关闭 Workspace WebSocket，因此不能把它视为挂起会话断连的直接原因。
- 已在 `2a584e9 chore(observability): trace workspace disconnects` 中加入 Nexus 自己的前后端断连诊断。以后若同一时刻发生 suspend，应以 Nexus 日志中的 `runtime close/dispose / transport close / pagehide / protocol closing / suspend handoff` 为因果证据，而不是仅凭这个 console exception 推断。

### 八、计划修改（本条仅记录设计，暂不实施）

1. 为 suspended terminal 增加最新 VT/terminal checkpoint 持久化模型，并关联 raw-log offset/revision。
2. 恢复协议从“raw tail only”升级为“checkpoint + delta tail + historyAvailable”；保持兼容无 checkpoint 的旧会话，旧会话继续使用当前 256 KiB tail fallback。
3. 保留当前 `suspend.history.previous/reset` 分页接口和 256 KiB page 策略，除非实测需要再调页大小。
4. TerminalView 恢复路径优先应用 checkpoint，再严格串行写入 delta，最后接 live output；继续保留 history browsing 时的 deferred output 机制。
5. 补充动态 ANSI 输出回归用例：至少覆盖 `\r` 单行进度、cursor-up 多行 stats block、erase-line、颜色/style、宽字符，以及 checkpoint 后继续 live 输出的顺序一致性。
6. 补充大日志性能测试：raw log 接近 retained 上限时，恢复首屏传输/解析量保持有界，向上分页不一次性加载完整历史。
7. `reportAllChanges/startTime` 暂不修改 Nexus 产品代码；先作为浏览器注入异常单独观察。如果 Nexus 断连日志能证明它与 page/runtime lifecycle 有关联，再另立问题处理。

### 九、验证标准

- 挂起一个持续输出的大任务，产生远大于 256 KiB 的日志后恢复，会话首屏直接显示最新状态且首包大小有界。
- `rclone -P` 或等价 ANSI 多行 progress fixture 运行较长时间后恢复，当前 progress block/cursor/样式正确，不依赖 replay 全部历史。
- 向上滚动逐页获取更旧历史；加载前一页时 viewport 不跳动；不滚动则不产生 history page 请求。
- 浏览历史期间新 live output 不抢位置；回到 latest 后输出顺序无丢失、无重复。
- checkpoint 缺失/损坏时能安全 fallback 到现有 raw tail 恢复，不导致会话无法恢复。
- `reportAllChanges/startTime` 单独出现时，Nexus Workspace 不应仅因此被判定为自身异常；若发生实际 suspend，可从新增诊断日志明确找到 socket/lifecycle close 来源。

- **当前状态**：`方案与异常归因已记录；未实施代码修改`

## P-047 顶级导航页面重复销毁/初始化导致“连接 / 设置”等切换延迟

- **发现时间**：2026-09-14
- **问题现象**：
  用户反馈顶部主导航（例如“连接”“设置”等）点击切换响应偏慢。该问题不局限于 Agent 设置内部 Tab，而是整个顶级页面导航的共同性能问题：第一次进入页面有明显等待，已访问页面之间来回切换时也会重复初始化，导致桌面应用式操作缺少即时响应感。

- **当前实现与根因分析**：
  1. `App.vue` 当前直接使用 `<RouterView />`，顶级 route 切换会销毁旧页面并重新创建目标页面。对 `ConnectionsView`、`SettingsPage` 等包含较多 computed/watch/子组件的页面而言，反复 mount/unmount 会重复产生 DOM 与响应式初始化成本。
  2. 顶级页面均采用 route-level dynamic import，例如 `/connections`、`/settings` 首次访问需要先加载并解析对应 chunk，因此首次切换还包含 chunk fetch/parse/execute 延迟。
  3. `ConnectionsView.vue` 在 `onMounted` 中执行 `data.load(true)`，明确绕过 Pinia 已加载缓存，页面每次重建都会再次强制请求连接列表；这会让“离开连接页 → 再回来”仍然产生不必要的网络与数据替换成本。
  4. Dashboard 也存在相似的 mount-time 强制刷新行为，例如 `connections.load(true)`、挂起会话强制刷新、审计日志请求等；当前整体策略偏向“每次进入页面都重新初始化和刷新”，而不是“已有页面立即恢复、数据后台按需更新”。
  5. Settings 内部目前也存在二级重复初始化问题：顶级 `SettingsPage` 被销毁后，其当前子页状态会丢失；进入 Agent 设置后，又存在 Models / Runtime / Plugins 等重量级子组件生命周期问题。因此主导航卡顿与 Settings 内部卡顿是同一类生命周期/缓存策略问题的不同层级表现。
  6. 已确认全局 auth router guard 不是持续卡顿主因：`resolveSetupState()` / `resolveSession()` 在状态已解析后默认复用缓存，不会每次导航都强制联网；因此本问题不建议通过削弱认证检查来“优化”。

### 一、目标体验

顶级导航应采用桌面应用式切换体验：

```text
首次进入 Connections
  → 如有缓存，立即显示缓存内容
  → route chunk 若尚未加载则仅首次加载
  → 后台同步最新数据

Connections → Settings
  → 当前 Connections 页面状态保留
  → Settings 立即切换

Settings → Connections
  → 直接恢复之前页面
  → 搜索词 / 滚动位置 / 筛选 / 展开状态仍在
  → 不因为切回来而重新强制请求全部数据
```

要求“导航激活态与可见页面切换”优先于非关键网络刷新完成，不允许用户点击后长时间看不到 UI 状态变化。

### 二、P0：顶级 RouterView 采用 Selective KeepAlive

- 对普通管理页面采用首次 mount 后缓存：
  - Dashboard
  - Connections
  - Proxies
  - Notifications
  - Audit Logs
  - Settings
- 切换这些页面时不重复销毁组件实例，从而保留：
  - 搜索关键字；
  - 当前筛选/排序；
  - 滚动位置；
  - 折叠/展开状态；
  - 未提交的轻量 UI 草稿；
  - 已初始化的子组件状态。
- `Workspace` 不直接纳入普通 KeepAlive 策略。Workspace 已有独立 runtime/session/registry 生命周期与挂起逻辑，应继续使用专门生命周期管理，避免页面缓存语义与 SSH/WebSocket runtime 所有权混淆。
- Login / Setup 等认证流程页面不做常驻缓存。

建议结构方向：

```vue
<RouterView v-slot="{ Component, route }">
  <KeepAlive :include="cachedTopLevelPages">
    <component :is="Component" :key="route.name" />
  </KeepAlive>
</RouterView>
```

实际实现需要确认组件 `name` / route meta，避免仅靠字符串耦合；推荐通过 route meta 标注 `keepAlive: true`。

### 三、P0：数据读取改为“缓存立即显示 + 后台刷新”，禁止无意义 mount-force-refresh

#### Connections

当前：

```ts
onMounted(async () => {
  await data.load(true);
  await tags.load();
});
```

建议：

- 有 Pinia 缓存时立即显示：`data.load()` 不强制刷新；
- 页面首次打开或缓存过期后，后台触发 revalidate；
- 后台刷新不阻塞页面可见和导航激活态；
- 用户显式点击“刷新”时才使用 `force=true`；
- create/update/delete/clone 继续通过 store 本地 `upsert/remove` 立即更新，不需要为了保持一致性每次全表 reload。

推荐采用简单 stale-while-revalidate 语义：

```text
store 未加载
  → 首次请求并显示 skeleton

store 已加载且仍新鲜
  → 直接显示，不请求

store 已加载但过期
  → 立即显示旧数据
  → 后台刷新
  → 有变化再更新 store
```

Pinia store 可以增加 `loadedAt / refreshing / refreshPromise`，避免多个页面同时触发重复刷新。

#### Dashboard / Tags / Notifications / Audit

同样按数据特性分类：

- Connections / Tags / Preferences：共享业务数据，优先 store cache + revalidate；
- Audit / Notifications：可以进入页面后刷新，但已有数据应先显示；
- Suspended Sessions：需要较新状态，可以采用较短 TTL 或 visibility/route activate 时刷新，不应阻塞主页面切换；
- 用户显式操作后的结果直接更新本地 store，再异步校准服务端。

### 四、P1：顶级 Route Chunk Idle Preload

保留 route-level code splitting，但在用户登录成功、首屏稳定后，对高频页面做低优先级预加载，仅下载 JS chunk，不 mount 页面、不触发页面 API：

优先级建议：

1. Connections
2. Settings
3. Workspace
4. Notifications / Proxies / Audit

可使用 `requestIdleCallback`，无支持时回退到低优先级 `setTimeout`；同时需要避免低带宽/Save-Data 场景无脑预加载。

目标：首次点击高频主导航时，不再把“下载并解析 route chunk”暴露成明显交互延迟。

### 五、P1：Settings 与 Agent 内部继续使用同一套“lazy mount once”原则

顶层 `SettingsPage` 被 KeepAlive 后，内部仍不建议一次性永久 mount 所有重量级子页。

建议采用：

```text
Top-level router
  └─ SettingsPage        KeepAlive
       ├─ Workspace      lazy mount once
       ├─ System         lazy mount once
       ├─ Security       lazy mount once
       ├─ Data           lazy mount once
       ├─ Appearance     lazy mount once
       └─ Agent          lazy mount once
            ├─ Models    lazy mount once
            ├─ Runtime   lazy mount once
            └─ Plugins   lazy mount once
```

即：**第一次访问时才创建，访问过后保持实例，但未访问页面不提前承担 DOM / watch / API 初始化成本。**

重量级数据（Plugin catalog、Workspace runtime catalog、ACP integrations、Subagent profiles 等）仍由各自页面在首次激活后加载，并建立显式缓存/刷新策略。

### 六、P1：切换交互与数据加载解耦

- 点击顶部导航后，应先完成 route 激活态和页面切换；
- 非关键后台刷新不得阻塞“按钮高亮/页面出现”；
- 若页面数据仍在同步，可在页面内部显示小型 syncing 状态或 skeleton，而不是让整次导航表现为无响应；
- 避免在同步 click handler / route enter 路径执行大规模 sort、serialize、DOM 测量或批量初始化。

AppHeader 当前的 underline 更新使用 `nextTick + getBoundingClientRect`，规模较小，可以保留；若后续 profiling 发现 layout thrash，再单独优化，不应先当作主要瓶颈。

### 七、P2：大列表进一步虚拟化

当连接数达到数百/数千时，即使页面 KeepAlive，`ConnectionsView` 当前仍会对全部连接：

- filter；
- sort；
- render 全部行。

第二阶段可以增加 list virtualization，只渲染 viewport 附近行；同时保留 keyboard navigation、批量选择、context menu 与可访问性行为。

该项不是解决当前主导航重复初始化的第一优先级，应在完成 KeepAlive + cache/revalidate 后基于真实 profiling 决定是否实施。

### 八、缓存失效与一致性原则

页面缓存不能变成陈旧数据来源，需明确以下 invalidation：

- create/update/delete 后立即更新对应 store；
- 后台 revalidate 可按 TTL；
- 浏览器重新获得 focus/visibility 时，对高时效状态做可控 refresh；
- WebSocket / runtime 已经能推送的状态优先用事件更新，不要额外轮询；
- 用户显式点击“刷新”始终绕过 TTL；
- 登出时清空用户级业务 cache/KeepAlive 页面状态，避免跨用户泄漏；
- 权限/安全关键数据仍以服务端实时校验为准，UI cache 仅用于展示与响应速度。

### 九、建议实施顺序

1. **P0：顶级 RouterView selective KeepAlive**，排除 Workspace/Login/Setup。
2. **P0：Connections 去掉 mount 时 `load(true)`，加入 cached-first + background revalidate。**
3. **P0：检查 Dashboard 等页面的 mount-force-refresh，统一改成不会阻塞页面切换的刷新策略。**
4. **P1：Settings 子页和 Agent 子页改为 lazy mount once。**
5. **P1：高频顶级 route chunk idle preload。**
6. **P1：为共享 store 增加 TTL / in-flight dedupe / stale-while-revalidate 基础设施。**
7. **P2：根据真实数据规模决定 Connections 列表虚拟化。**

### 十、验证标准

- 从任意普通管理页点击“连接”或“设置”，顶部 active 状态应在同一交互帧/下一渲染帧更新，不等待业务 API 返回。
- 已访问过的 Connections ↔ Settings 往返切换时，不应重新 mount 整个页面树；页面搜索、筛选、滚动位置保持。
- 已有连接缓存时返回 Connections，不再因为 `load(true)` 显示空白/等待；缓存内容立即可见，后台刷新完成后无感更新。
- 首次进入高频 route，在 idle preload 已完成的情况下不应发生明显 chunk fetch 等待。
- Settings 再次进入时保持上次内部 Tab；Agent 再次进入时保持上次 Models/Runtime/Plugins 状态。
- 切换主导航不得关闭、重建或影响现存 Workspace runtime / SSH 会话。
- 登出后缓存页面和用户级 store 不得带到下一用户会话。
- 使用 Performance trace 对比优化前后：navigation click → first visual response、route component mount 次数、重复 API 次数均应显著下降。

- **当前状态**：`方案已记录，待实施；本条未修改产品代码`

## P-048 文件编辑器支持 `Ctrl+/` 多语言注释 / 取消注释切换

### 一、问题

当前文件管理器内置编辑器缺少常见 IDE 的快速注释能力。编辑代码、配置、脚本时，用户需要手动添加或删除注释符号，尤其在多行选区和不同语言之间切换时效率较低。

目标是在桌面端编辑器中支持与主流 IDE 一致的 `Ctrl+/`（macOS 对应 `Cmd+/`）快捷键，根据当前文件语言自动执行“注释 / 取消注释”切换，并兼容多行、混合缩进和多语言注释语法。

### 二、交互定义

- 无选区时：作用于光标所在行。
- 有单行选区时：作用于该行。
- 有多行选区时：对选中的所有有效行统一切换。
- 如果目标行都已按该语言规则注释，则执行取消注释；否则执行注释。
- 空行默认不强制插入注释符，避免制造无意义 whitespace；但不应破坏选区范围。
- 注释时尽量保持原缩进：注释符插入到每行第一个非空白字符之前，而不是固定插在第 0 列。
- 取消注释时仅移除当前语言合法的注释前缀/包裹，不应误删普通文本中的相同字符。
- 操作完成后保持合理的光标/选区位置，可连续按 `Ctrl+/` 来回切换，不出现选区漂移。
- 整个操作必须作为一次 editor undo transaction，`Ctrl+Z` 一次即可撤销整次多行注释切换。

### 三、多语言规则

优先复用编辑器/语言服务已有的 language id 与 comment metadata，不维护一套和 Monaco / CodeMirror 脱节的文件扩展名判断。只有底层编辑器缺少 comment metadata 时才进入 Nexus fallback registry。

第一阶段至少覆盖常见语言：

| 语言/类型                                                                  | 行注释                               | 块注释/备注                            |
| -------------------------------------------------------------------------- | ------------------------------------ | -------------------------------------- |
| JavaScript / TypeScript / Java / C / C++ / C# / Go / Rust / Swift / Kotlin | `//`                                 | `/* ... */`                            |
| Python / Shell / Bash / Ruby / Perl / YAML / TOML / Dockerfile             | `#`                                  | 优先行注释                             |
| SQL / Lua / Haskell                                                        | `--`                                 | 语言支持时保留块注释能力               |
| HTML / XML / SVG                                                           | 无通用行注释                         | `<!-- ... -->`                         |
| CSS / SCSS / Less                                                          | 无通用行注释                         | `/* ... */`                            |
| Vue / Svelte 等单文件组件                                                  | 根据当前位置/嵌入语言上下文决定      | template/script/style 分别遵循对应语言 |
| PowerShell                                                                 | `#`                                  | `<# ... #>`                            |
| INI / properties / conf 类文件                                             | `#` 或 `;`，按具体 language metadata | 不做模糊猜测                           |

不要简单按扩展名写死 `//` / `#`。同一文件可能存在嵌入语言或语言模式切换，尤其 Vue、HTML 内 script/style、Markdown fenced code 等，需要尽量使用当前编辑器解析出的 language/context。

### 四、行注释与块注释策略

`Ctrl+/` 的默认语义统一为 **toggle line comment**：

1. 当前语言有 line comment token：优先逐行切换。
2. 当前语言没有 line comment、但存在 block comment：对选区使用 block comment。
3. 无选区且只能块注释时，对当前语法范围或当前行文本做最小块包裹，不跨越无关内容。
4. 当前语言完全没有可靠注释元数据：不修改文件，并给出轻量提示“当前语言暂不支持快速注释”。

未来如果需要 `Shift+Alt+A` / `Option+Shift+A`，可单独提供“块注释切换”，不要让 `Ctrl+/` 的行为在同一种语言里随机变化。

### 五、两套编辑器的一致性

当前文件编辑器包含桌面 Monaco 与移动端 CodeMirror，两端行为需要共享同一个产品语义：

- Monaco：优先使用 Monaco 自身的 comment action / language configuration，避免重新实现成熟编辑器逻辑。
- CodeMirror：使用对应 language support/facet 或统一 comment command；若缺少语言元数据，再接 Nexus fallback registry。
- 共享测试用例保证相同文本、相同语言、相同选区得到等价结果。
- 不要把键盘事件绑在 FileManager 页面全局；快捷键只在代码编辑器获得焦点时生效，避免与浏览器、终端、搜索框或其他输入控件冲突。

### 六、快捷键与平台

- Windows / Linux：`Ctrl+/`
- macOS：`Cmd+/`
- 使用 `KeyboardEvent.code` / 编辑器 command/keybinding abstraction 处理不同键盘布局，不依赖 `'/'` 字符在所有布局上的同一物理位置。
- 如果浏览器或系统占用了组合键，应优先走 Monaco/CodeMirror 自身 keybinding dispatcher，而不是 document 级 `keydown` 强拦截。
- IME composition 期间不触发。
- read-only 文件、预览模式、二进制文件不可触发修改。

### 七、建议实现方向

1. 增加统一的“编辑器注释能力”接口，而不是由 FileManager 直接修改文本。
2. MonacoEditor 绑定 editor action `editor.action.commentLine` 或等价 command，并验证当前 `monaco-editor` 版本下 tree-shaking/standalone service 不会再次引入生产构建缺失问题。
3. CodeMirrorMobileEditor 使用其官方 comment command；若当前 bundle 未包含对应 package，按最小依赖方式接入。
4. 抽象 `CommentSyntaxResolver` 仅处理底层语言服务无法提供规则的 fallback 情况。
5. 对嵌入语言优先由编辑器原生语言上下文处理，Nexus 不自行解析 Vue/HTML AST 来猜当前位置。
6. 将快捷键说明加入编辑器帮助/快捷键提示；如果未来有可配置快捷键系统，再迁移为可绑定 command。

### 八、验证标准

- JS/TS/Python/Shell/YAML/SQL/CSS/HTML/Vue 至少各有注释与取消注释测试。
- 无选区、单行选区、多行选区、包含空行、混合 tab/space 缩进均正确。
- 多行操作一次 `Ctrl+Z` 完整撤销。
- 已部分注释的多行选区采用一致且可预测的 toggle 行为，不产生重复 `////`、`##`。
- Vue 等嵌入语言中，template 使用 HTML 注释，script 使用 JS/TS 注释，style 使用 CSS 注释（以编辑器实际 language context 能力为准）。
- 切换注释不改变行尾格式、文件编码和未选中文本。
- Monaco 与 CodeMirror 结果一致；移动端即使没有实体键盘，也可复用同一 comment command 给未来工具栏入口。
- 生产构建通过，并验证 `Ctrl+/` 不会影响终端、搜索框、连接表单等其他页面输入。

状态：方案已记录，待实施；本条不包含代码修改。

## P-049 Main 文档体系收口：完成长期 `AGENT.md`、吸收并退役 CURRENT/PACKAGE、代码反查补漏、Agent 新代码审计与 `doc/` 中文化

- **发现时间**：2026-09-15
- **问题现象**：当前 `doc/` 已经形成较完整的软件需求、架构、使用、部署和测试文档，但仍存在“长期规范、当前快照、临时交接、英文架构文档”混杂的问题。项目 Owner 希望在 `main` 基线上完成一轮文档收口：形成可长期维护的 `doc/AGENT.md`；审查并吸收 `doc/architecture/CURRENT_ARCHITECTURE.md` 与 `doc/architecture/PACKAGE_MANAGEMENT.md` 中仍有效的内容后删除这两份过渡文档；从当前代码反查文档缺失；同时审计近期新增 Agent 代码；最后除 `doc/README_EN.md` 外，将 `doc/` 下的人类可读文档统一整理为中文版本。

### 一、当前仓库现状

1. `doc/AGENT.md` 已存在，并且已经覆盖 App / Thread / Run / Ledger、Plan、StateCommit、Context / Provider / Budget、Tool、安全链、Artifact / Memory、Workspace Runtime / Runner、ACP / Browser、Subagent、Plugin、Checkpoint / Resume、观测性等大量 Agent 架构内容。
2. 但当前文件头仍标记“适用分支：`dev`”，且后半部分包含“2026-09-14 Agent 问题测试环境与操作交接”、本地服务、PVE / Windows / Chrome CDP、开发代理链、推荐测试顺序等强时效信息。这些内容可用于当前排障，但不应继续作为 `main` 的长期架构规范主体。
3. `doc/architecture/CURRENT_ARCHITECTURE.md` 目前同时记录 Workspace / Remote Desktop / Agent runtime owner、transport、生命周期、capability wiring 等“当前快照”，其中部分内容已经被 `BACKEND.md`、`FRONTEND.md`、`AGENT.md`、SRS / Engineering Constraints 重复表达。
4. `doc/architecture/PACKAGE_MANAGEMENT.md` 仍是英文文档，并描述 workspace ownership、依赖版本策略、安装/构建/production packaging/CI 等规则；这些规则本身仍有价值，但不应因删除旧文件而丢失。
5. README、SRS 与 software-requirements 中仍存在指向 `CURRENT_ARCHITECTURE.md` / `PACKAGE_MANAGEMENT.md` 的引用，删除前必须先迁移内容并更新所有引用，不能留下死链。
6. `doc/` 内仍有多份英文或中英混排的长期文档，例如 `architecture/BACKEND.md`、`architecture/FRONTEND.md`、`architecture/PACKAGE_MANAGEMENT.md`、`architecture/REMOTE_DESKTOP.md`、`software-requirements/engineering-constraints.md`、部分 traceability 表头以及 `testing/E2E.md`。Owner 要求除 `doc/README_EN.md` 外统一为中文可读版本；代码符号、类型名、协议名、API path、命令、配置键和标准专有名词可保留英文。

### 二、目标文档结构

本轮完成后，文档应从“多个阶段快照并存”收口为按 Owner 划分的长期入口：

```text
doc/
  AGENT.md                       # Agent 唯一长期架构规范
  DEPLOYMENT.md                  # 部署、构建、包管理中面向部署/发行的规则
  FEATURES.md
  USAGE.md
  PROBLEM.md
  README_EN.md                   # 唯一保留的英文说明入口
  architecture/
    BACKEND.md                   # Backend 长期架构与模块 owner
    FRONTEND.md                  # Frontend 长期架构与模块 owner
    REMOTE_DESKTOP.md            # Remote Desktop 长期架构
  software-requirements/         # 正式需求、工程约束、设计与追溯
  testing/
    E2E.md
```

计划退役并删除：

```text
doc/architecture/CURRENT_ARCHITECTURE.md
doc/architecture/PACKAGE_MANAGEMENT.md
```

删除前必须完成语义迁移与引用更新；不能简单删文件。

### 三、`AGENT.md` 的最终定位

`doc/AGENT.md` 应以 **`main` 当前 production code 为事实源**，而不是以旧设计稿、dev 临时实验或某次会话记录为事实源。

最终 `AGENT.md` 至少需要稳定覆盖：

- Agent 产品模型：App → Thread → Run → Runtime / Subagent → Tool / Workspace / Artifact / Integration。
- Backend / Frontend / Runner / Plugin Host 的 owner 与依赖方向。
- Thread / Run / Ledger / Goal / Plan / Step / Verification 的状态模型。
- StateCommit、幂等、事件、checkpoint / resume 与 crash recovery。
- Context assembly、compaction、Provider model capability、Run budget、每次 User Turn 新 Run 的预算边界。
- Tool execution、Approval / Policy / Lease、安全与能力隔离。
- Workspace Runtime、Agent Runner、ACP、Browser/CDP、Workspace local terminal 的边界。
- Artifact、Files Library、Memory、MCP / Integration。
- Subagent / multi-agent 调度、预算、mailbox、并行边界。
- Plugin install / frontend / backend / runner target、SDK 与隔离边界。
- Transport / protocol owner 隔离以及持久化数据 owner。
- 可观测性、测试门槛、发布门槛和不可破坏的长期架构约束。

以下内容不应继续混在长期 `AGENT.md` 主体中：

- 某一天的服务器 IP / PVE / Windows / Chrome CDP 测试拓扑；
- 本地开发端口与某次 Vite proxy 状态；
- 某次排障的推荐点击顺序；
- 临时账号、一次性测试环境状态；
- 某个历史问题的施工日志全文；
- 已经完成使命的 phase/review/交接快照。

如果这些信息仍需保留，应进入 `PROBLEM.md` 对应问题记录、测试说明或运维说明，而不是污染长期架构规范。

### 四、`CURRENT_ARCHITECTURE.md` 的吸收与删除策略

不能把 `CURRENT_ARCHITECTURE.md` 整份复制到 `AGENT.md`。应按 owner 分流：

- Agent runtime、Agent Host、Runner、Plugin、Agent transport/capability 的有效内容 → 合并进 `AGENT.md`。
- Backend composition、模块 owner、接口边界、transport owner → 合并进 `architecture/BACKEND.md`。
- Frontend capability/session owner、route / host / runtime 边界 → 合并进 `architecture/FRONTEND.md`。
- Remote Desktop 专属生命周期与 gateway → 仅在确有缺失时合并进 `architecture/REMOTE_DESKTOP.md`。
- 强制性工程约束 → 只保留在 `software-requirements/engineering-constraints.md`，架构文档引用对应 `EC-*`，不得制造第二个规范源。
- 用户可观察行为 → 进入相应 SRS requirement，而不是写成架构约束。

完成迁移并确认没有唯一信息遗失后，删除 `CURRENT_ARCHITECTURE.md`，同步修复 README、SRS、requirements、design、traceability 内所有引用。

### 五、`PACKAGE_MANAGEMENT.md` 的吸收与删除策略

`PACKAGE_MANAGEMENT.md` 的内容也不应硬塞进 `AGENT.md`。按语义整理：

- pnpm workspace ownership、package 边界、依赖来源与版本约束中的长期强制规则 → 与现有 `Engineering Constraints` 去重后，必要部分进入相应 `EC-*`。
- 安装、源码构建、production packaging、Docker / release 相关说明 → 合并进 `DEPLOYMENT.md`。
- Backend / Frontend package owner 或禁止跨层依赖的架构说明 → 分别进入 `BACKEND.md` / `FRONTEND.md`。
- CI / dependency update 的开发者操作说明 → 放入最合适的工程/测试章节，不重复形成新的规范源。

迁移后删除 `PACKAGE_MANAGEMENT.md`，并将根 `README.md` 当前“Package Management 架构”链接替换到新的权威入口。

### 六、必须从代码反查，而不是只整理旧 Markdown

本轮文档收口需要对 `main` 源码做一次系统反查，至少覆盖：

- `packages/backend/src/modules/agent/**`
- `packages/backend/src/infrastructure/agent/**`
- Agent HTTP / WebSocket / bootstrap composition 边界
- `packages/agent-runner/**`
- `packages/frontend/src/features/agent/**`
- Workspace Runtime 与 Agent capability adapter 的真实接线
- Plugin SDK / Host / install lifecycle
- 当前 Provider adapters、context assembly、budget/accounting、scheduler、subagent collaboration、artifact/memory/integration owner
- 实际 package.json / workspace / build / Docker / CI 脚本

目标不是“让代码迁就旧文档”，而是：

```text
production code
      ↓ factual audit
architecture / SRS / engineering constraints
      ↓
删除过时、重复、临时快照文档
```

代码中存在而文档未覆盖的长期行为必须补文档；文档中已不存在于代码的旧行为必须删除或标记为待实现，不得继续写成“当前事实”。

### 七、顺带审计近期新增 Agent 代码

在代码反查过程中，同时做一次 Agent implementation audit。至少检查：

1. **Owner / dependency 边界**：是否出现 Frontend/Backend/Runner 跨层直接依赖、Workspace live session 泄漏给 Agent、Plugin 绕过 Host capability 等问题。
2. **Run / Context / Budget**：Thread context 与 Run usage 是否混淆；新 User Turn 是否正确创建新 Run budget；checkpoint/resume 是否会错误重置 budget；model-declared context/output capability 是否仍被旧固定 32K/4K 等路径截断。
3. **Loop / progress**：是否已有或缺失 no-progress / repeated-operation guard；失败重试是否可能形成死循环。
4. **Subagent**：fan-out、深度、并发、child budget、mailbox、parent wait / join、usage roll-up 是否一致。
5. **StateCommit / recovery**：所有 durable mutation 是否经过唯一 authority；event/ledger/checkpoint 是否有双写或恢复不一致风险。
6. **Tool / approval / policy**：是否存在绕过 policy、approval、lease、scope-bound facade 的执行路径。
7. **Plugin**：Frontend SDK、backend target、runner target、install/upgrade/uninstall、publisher/trust 与 scope 隔离是否与架构声明一致。
8. **Workspace Runtime / Runner**：generation、cleanup、journal、认证、协议版本、artifact/workspace 生命周期是否有新的接线缺口。
9. **Frontend Agent UI**：新加入的设置、Hub、Task、Artifact、App Surface 等是否存在重复请求、组件重挂载、状态 owner 错位或明显性能问题。
10. **类型/构建/测试**：Backend build、Frontend typecheck/build、Agent 相关单元/集成/E2E、architecture guard、`git diff --check` 必须作为最终验证的一部分。

发现真实代码问题时，应另起新的 `P-xxx`，记录“问题 → 原因 → 决策 → 修改 → 验证”，不要把实际 bug 修复过程全部埋在本 P-049 文档整理项里。

### 八、`doc/` 中文化规则

除 `doc/README_EN.md` 外，`doc/` 下所有面向人的 Markdown 应以中文为主要叙述语言。

中文化不是机械替换英文关键字：

- 标题、正文、说明、表头、状态、约束解释、测试说明翻译为自然中文。
- TypeScript 类型名、类/函数名、路径、包名、环境变量、HTTP/WebSocket path、协议 magic/version、CLI 命令、配置 key 保留原文。
- `MUST/SHOULD` 等规范语义翻译后不得降低约束强度。
- `EC-*`、`SRS-*`、`FR-*`、`GREQ-*` 等稳定 ID 不改名，以免破坏追溯。
- Markdown anchor/link 在翻译标题后必须重新验证；外部引用和相对链接不得失效。
- `README_EN.md` 保持英文，不因全局中文化而改成中文；它可以继续链接中文的详细技术文档。
- 根目录英文/中文 README 不在本次“`doc/` 中文化”范围内，除非为了修复文档链接需要做最小同步。

### 九、main 分支与当前 dirty dev 的操作边界

当前工作树位于 `dev`，并且存在大量与 Agent/UI 相关的未提交修改以及持续累积的 `doc/PROBLEM.md` 修改。本 P-049 的正式实施目标是 **以 `main` 当前代码基线为最终核对对象**，因此实施时不能直接在当前 dirty `dev` 上做 branch reset / checkout 覆盖用户工作。

正式执行前应：

1. 先确认/保护当前 `dev` 未提交工作；
2. 使用安全的独立 worktree 或其他不会覆盖当前工作树的方式检出 `main`；
3. 在 `main` 基线上完成代码事实审计和文档收口；
4. 如需吸收 `dev` 中尚未进入 `main` 的 Agent 设计，只能明确标为“待合并/待实现”，不能伪装成 main 当前 production 事实；
5. 未经 Owner 明确要求，不自动 commit / push。

### 十、实施顺序

建议按以下顺序完成，避免先翻译后又大规模重写：

```text
1. 建立 main 独立工作区并冻结文档清单
2. 读取 Agent / Backend / Frontend / Runner / package/build 实际代码
3. 对照 AGENT / CURRENT / PACKAGE / SRS 做事实矩阵
4. 先完成 AGENT.md 长期版，移除 dev/交接临时态
5. 将 CURRENT_ARCHITECTURE 有效内容按 owner 迁入长期文档
6. 将 PACKAGE_MANAGEMENT 有效内容按工程/部署/架构 owner 迁入
7. 更新所有文档引用并删除 CURRENT_ARCHITECTURE / PACKAGE_MANAGEMENT
8. 补齐代码中存在但文档缺失的长期架构/需求
9. 对 Agent 新代码审计；真实 bug 另建 P 项
10. 最后统一中文化 doc/（README_EN.md 除外）
11. 做链接、规范 ID、构建/typecheck/test/architecture guard 全量验证
```

### 十一、验证标准

- `doc/AGENT.md` 不再标记为仅适用 `dev`，且不包含一次性开发环境/交接信息作为长期架构正文。
- `CURRENT_ARCHITECTURE.md` 与 `PACKAGE_MANAGEMENT.md` 被删除前，其仍有效且唯一的信息均已迁入正确 owner 文档。
- 仓库内不存在指向这两个已删除文件的死链。
- README / SRS / Requirements / Design / Traceability 中的文档关系指向新的权威入口。
- 除 `doc/README_EN.md` 外，`doc/**/*.md` 的人类说明以中文为主；稳定标识、代码/API/协议术语保持准确。
- `AGENT.md` 描述的 runtime、transport、capability、budget、plugin、subagent、Runner 等事实可逐项在 main 源码找到对应实现或明确标记“待实现”。
- Agent 新代码审计发现的问题均独立进入新的 `P-xxx`，不存在“发现了但只口头记录”的情况。
- Markdown 相对链接/anchors 检查通过；无遗失图片/文档引用。
- Backend build、Frontend typecheck/build、相关测试、architecture guard 与 `git diff --check` 通过；若有既有失败需明确记录并与本次文档变更区分。

- **状态**：`已记录，待在 main 独立工作区实施；当前仅更新 PROBLEM，未迁移/删除/翻译其他文档，未修改 Agent 产品代码`

## P-050 模型设置成功反馈位置错误：统一改为全局右上角 Toast，而不是主界面内联“已保存”

- **问题现象**：在模型 Provider / 模型配置中执行测试、添加模型、移除模型、切换默认模型等实时保存操作后，成功提示出现在 Agent 设置主内容区域或抽屉内部。用户当前焦点往往位于弹窗、抽屉或页面下方，成功反馈与动作位置脱节，容易产生“到底保存成功没有”的不确定感。
- **当前代码事实**：
  - `AgentSettingsPanel.vue` 自己维护 `notice`，`execute()` 成功后默认写入 `agent.ui.saved`，并在设置主内容顶部渲染内联提示。
  - `ModelProviderSettings.vue` 还维护 `drawerSaveNotices` / `modalSaveNotice`，形成多套局部成功提示机制。
  - 项目已有统一 `shared/feedback`：`useFeedback().notifySuccess / notifyError / notifyInfo / notifyWarning`，由全局 `NotificationHost` 呈现，其他模块已经使用。
- **决策**：模型设置中的短生命周期操作反馈统一使用项目现有全局通知系统，成功/失败均优先在右上角 Toast 呈现；不再为了“保存成功”占据主设置页面的长期布局空间。
- **计划修改**：
  1. `AgentSettingsPanel` 与 `ModelProviderSettings` 接入 `useFeedback()`；模型测试、实时保存、默认模型切换、模型添加/删除等成功反馈使用 `notifySuccess`。
  2. 请求失败使用 `notifyError`；只有需要用户继续处理的表单校验错误才保留弹窗/字段附近的 inline error。
  3. 删除与全局 Toast 重复的 `drawerSaveNotices`、`modalSaveNotice` 或主页面 `notice` 成功提示；如果某些长流程需要状态展示，保留真正的 progress/status，不把它们和瞬时 Toast 混用。
  4. Toast 文案描述具体动作，例如“模型已添加”“默认模型已更新”“连接测试成功 · 123 ms”，避免统一显示模糊的“已保存”。
  5. 保持通知可访问性与现有 NotificationHost 行为，不新造第二套 Toast 组件。
- **验证方式**：
  - 在 Provider/模型抽屉或弹窗中完成测试、添加、删除、默认模型修改后，右上角即时出现对应成功 Toast。
  - 当前操作区域不再出现重复的“已保存”条幅。
  - 请求失败时 Toast 能显示后端错误；字段缺失等本地校验错误仍靠近输入区域显示。
  - 不因 Toast 改造改变实时保存语义或增加额外 API 请求。
- **2026-09-15 当前 UI 基线**：当前实现采用“全局 Toast + 操作区域局部状态”混合反馈。Provider 测试行继续显示 loading/success/error，模型同步抽屉允许保留短生命周期的局部保存提示；跨区域成功/失败同时由全局 NotificationHost 提供明确反馈。该组合现视为产品标准，不再要求为了旧方案删除所有局部状态。
- **状态**：`当前 UI 已吸收核心问题；旧的“只能 Toast、不得局部反馈”方案由现行基线取代，后续仅修重复/错误反馈 bug`

## P-051 “保存并关闭”与实时保存语义冲突：移除无效保存动作，改为明确的完成/关闭行为

- **问题现象**：`New API Test / 已配模型与连通测试` 区域下方存在“保存并关闭”按钮，但上方模型增删、默认模型等修改已经实时生效，按钮看起来像会再次提交保存，实际却没有新的保存工作，造成“按钮没作用”的体验。
- **当前代码事实**：`ModelProviderSettings.vue` 已采用多处即时 `updateProvider` / `updateProviderModels` / `defaultModel` 更新；新增 Provider 的连通测试流程甚至可能先创建 Provider。`submitModal()` 在 `createdProviderId` 已存在时只是关闭弹窗，因此“保存并关闭”标签与真实行为不一致。
- **决策**：既然当前交互选择 Auto-save，就必须贯彻单一语义：实时修改成功即已持久化，底部按钮只负责完成/关闭，不再伪装成第二次保存。
- **计划修改**：
  1. 将已进入 Auto-save 状态的“保存并关闭”改为“完成”或“关闭”。
  2. 如果新增 Provider 尚未真正创建，则主 CTA 仍可叫“添加 Provider”/“创建并关闭”，但创建完成后必须切换成纯关闭语义。
  3. 在弹窗内使用轻量 Auto-save 状态（保存中 / 已保存 / 保存失败），但成功反馈遵循 P-050 使用全局 Toast，不堆叠重复提示。
  4. 关闭按钮不得重复提交已持久化模型，也不得因为 props 更新时序找不到 `createdProviderId` 而造成“点了没反应”。
  5. 对“连接测试会先创建 Provider”这一流程重新梳理：测试动作和持久化动作在 UI 文案上必须让用户可预期，避免“只是测试却已经保存”而没有明确反馈。
- **验证方式**：
  - 修改模型后无需点击底部按钮即能刷新页面看到已保存结果。
  - 底部“完成/关闭”始终能可靠关闭弹窗/抽屉。
  - 没有重复 POST/PATCH；按钮名称与 Network 行为一致。
  - 新增 Provider、测试 Provider、编辑已配模型三种路径分别有清晰且一致的 CTA。
- **2026-09-15 当前 UI 基线**：新增 Provider 尚未创建时主 CTA 继续承担创建语义；一旦 `createdProviderId` 已存在，底部 CTA 只显示确认/关闭语义，不再伪装成第二次保存。模型增删等 Auto-save mutation 仍在动作发生时立即持久化。
- **状态**：`当前 UI 已按实时保存语义收口；后续仅排查 CTA 无法关闭、重复请求或创建/测试时序 bug`

## P-052 Agent 功能开关出现“已保存但实际未开启”：成功状态必须以 Effective State 为准

- **问题现象**：用户点击开启 Agent 后，界面提示“已保存”，但 Agent 实际没有进入可用/开启状态。成功反馈与系统真实 Effective State 不一致。
- **当前代码事实**：
  - `AgentSettingsPanel.vue` 的通用 `execute()` 只要异步 action 没抛错，就默认写“已保存”。
  - `changeFeature(true)` 还包含推荐插件检查、安装/启用插件、patch feature、刷新 apps 等多步流程。
  - 页面展示使用 `settings.effectiveSettings.feature.enabled`，因此 Requested Settings 写成功并不等价于最终 Effective State 已开启。
- **问题本质**：这是“持久化成功”与“功能真正可用”两个状态被合并成一个成功提示。尤其 Agent 依赖插件、运行时、配置有效性时，仅 PATCH 成功不能宣布“已开启”。
- **决策**：Agent Enable/Disable 必须按后端返回的 authoritative effective state 和 availability 判定结果；只有最终 `effectiveSettings.feature.enabled === true` 且必要依赖状态满足时才提示“Agent 已开启”。
- **计划修改**：
  1. 不再让 `changeFeature()` 复用无条件“已保存”的通用成功提示。
  2. 开启流程完成后读取/使用后端返回的最新 Settings + App 状态，核对 requested/effective/availability。
  3. 若 requested=true 但 effective=false，显示具体原因（例如插件未启用、运行时不可用、配置校验失败），不得显示成功 Toast。
  4. 安装推荐插件 + feature enable 作为一个用户意图处理；中间步骤成功不应提前宣布最终成功。
  5. Disable 同样验证 effective state，避免写入成功但运行态仍未收敛。
  6. 为开启、关闭、依赖缺失、部分失败、并发 revision 冲突增加回归测试。
- **验证方式**：
  - 点击开启后，只有 UI badge 和后端 effective state 均为 enabled 才出现“Agent 已开启”。
  - 模拟插件安装失败/插件未 enabled/运行时 unavailable 时不会出现“已保存=已开启”的假成功。
  - 页面刷新后开关状态与刚才 Toast 的结果一致。
- **状态**：`已记录，待排查并修复`

## P-053 “插件与安全”分区视觉边界不清：强化子模块层级、卡片分组与危险操作边界

- **问题现象**：Agent 设置的“插件与安全”分区中，App 管理、插件仓库/安装、安全黑名单、系统 Guardrails 等多个模块连续排列，当前背景、边框和标题层级接近，模块边界不够清晰，用户不容易快速判断一组控制属于哪个安全域或插件生命周期阶段。
- **决策**：不增加无意义的大色块或厚重装饰，而是通过稳定的卡片边界、标题层级、间距、section header 和危险操作区域提升信息分组。
- **计划修改**：
  1. `AppManagementSettings`、`PluginManagementSettings`、`SafetyNetworkSettings`、`SystemGuardrails` 各自形成明确的一级 section/card 边界。
  2. 统一圆角、border、header 背景、section padding 和纵向 gap，避免“一个大面板里继续堆多个看起来同级的小块”。
  3. Capability grants、安全黑名单、签名 Publisher/仓库信任、卸载/删除数据等高风险操作使用一致的安全语义样式。
  4. 普通状态信息避免和危险区域使用同等视觉权重；警告/删除动作必须容易识别但不喧宾夺主。
  5. 保证 Light/Dark theme、窄屏和长文案下边界仍清晰，不靠固定高度。
- **验证方式**：桌面与移动宽度下均可一眼区分四个主要模块；危险操作不会和普通配置混为一组；不引入双层滚动、溢出或额外布局抖动。
- **2026-09-15 当前 UI 基线**：插件与安全现已按 App 管理、插件/仓库、安全网络、System Guardrails 分成独立卡片/section，危险操作与普通状态信息有明确边界。当前视觉层级作为产品标准，不再继续按旧草案做无目标重排。
- **状态**：`当前 UI 基线已接受；后续仅修可复现的边界、溢出、主题或危险操作语义 bug`

## P-054 模型能力元数据统一：Reasoning Registry 同时维护 Context Window / Max Output，并优先采用可靠 Provider 数据

- **问题现象**：项目已经能按模型识别思考等级，但上下文大小、最大输出等模型物理能力仍主要依赖 Provider 配置/用户输入。随着 P-045 改为“模型物理窗口作为运行预算基础”，错误的 `contextWindow` 会直接导致压缩阈值、Run budget 和最大输出策略失真。
- **当前代码事实**：
  - `packages/backend/src/modules/agent/ai/model-capability-resolver.ts` 已存在内置 Reasoning Registry，目前为 GPT-5.6 / GPT-5.1 / GPT-5 Pro 等匹配 `reasoningEfforts/defaultEffort`。
  - `ProviderModelConfig` 已包含 `contextWindow`、`maxOutputTokens`、`supportsTools`、reasoning metadata。
  - 当前 resolver 只覆盖 reasoning；`applyReasoningCapability()` 会继续沿用 Provider model 自身的 `contextWindow/maxOutputTokens`。
  - 当前模型发现 UI 也明确提示发现结果只信任 model identifier，context/output/tool capability 仍需确认。
- **决策**：将现有 reasoning-only resolver 演进为统一 **Model Capability Registry / Resolver**，同一个模型能力记录可描述 `contextWindow`、`maxOutputTokens`、tool support、reasoning efforts 及来源信息；但内置表不是最高权威，必须有明确的数据来源优先级。
- **建议来源优先级**：
  1. **Provider 返回的明确、可验证能力元数据**：若 Provider 的模型 API/扩展 endpoint 明确返回 context/output/reasoning/tool capability，优先使用，并记录 `source=provider`。
  2. **Nexus 内置版本化 Registry**：对 Provider 不暴露这些字段的主流模型，依据厂商官方模型文档维护经过审查的静态能力表，并带来源/更新时间/匹配范围；不从博客或第三方排行榜自动采信。
  3. **管理员显式配置/override**：OpenAI-compatible 私有模型、代理模型、别名模型无法可靠识别时允许配置，但 UI 要标明是 user-configured，而非 Provider authoritative。
  4. **未知能力**：宁可标记 unknown 并要求确认，也不要随便用固定 32K/4K 假定物理能力。
- **计划修改**：
  1. 将 `model-capability-resolver.ts` 的 reasoning registry 抽象为统一 capability record，例如 `contextWindow? / maxOutputTokens? / supportsTools? / reasoning? / source / verifiedAt`。
  2. Provider discovery adapter 增加可选 live capability ingestion 扩展点；只在字段来源可信且语义明确时采用。
  3. 合并顺序要逐字段处理，而不是“某来源有一项就覆盖整条记录”；例如 Provider 给 context，但未给 reasoning 时，可使用 Provider context + Registry reasoning。
  4. 模型别名/日期版本必须有明确匹配规则，不能让宽泛 regex 错套能力。
  5. Settings UI 显示能力值来源（Provider / Nexus Registry / Manual）及必要的 warning。
  6. 与 P-045 联动：Run 创建时最终 effective model capability 决定物理 context/output ceiling；普通用户预算不再反向限制模型物理值。
- **验证方式**：
  - 已知模型自动得到正确 context/output/reasoning 元数据，并能看到来源。
  - Provider live metadata 与 Registry 冲突时按定义好的优先级处理，并有测试覆盖。
  - 未知/私有模型不会被错误套用某个公开模型的窗口。
  - 日期版模型、别名模型、代理 Provider 均有回归测试。
- **状态**：`已记录，需与 P-045 一并设计/实施`

## P-055 CAPTCHA Provider 标签/控件垂直布局遮挡：修复基础表单行高与间距

- **问题现象**：设置页 CAPTCHA 区域中“CAPTCHA 提供商:”标签下沿/下一行出现被控件或布局遮住的视觉问题，文字与 Select 的垂直间距不足或行盒裁切不自然。
- **当前代码事实**：`CaptchaPanel.vue` 使用 `BaseFormField + BaseSelect`；`BaseFormField` 为 `space-y-1.5`，标签本身没有显式 line-height；`BaseSelect` 使用固定高度类。近期基础输入组件/全局字体 token 也存在未提交调整，因此需要从 shared form control 层确认，而不是只在 CAPTCHA 局部硬加 margin。
- **决策**：优先修复通用表单 label/control 的排版基线；只有确认是 CAPTCHA 特例后才做局部样式。
- **计划修改**：
  1. 检查 `BaseFormField` label 的 line-height、字体 ascent/descent、`space-y-*` 与父容器 overflow。
  2. 检查 `BaseSelect` 固定高度、padding 和新字体 token 是否造成视觉覆盖。
  3. 对 Settings 中其他 `BaseFormField + BaseSelect/Input` 做横向回归，避免只修 CAPTCHA 又让别处错位。
  4. 中文、英文、日文三语言都验证标签高度和长文案换行。
- **验证方式**：CAPTCHA Provider 标签完整可见，与下方 Select 保持稳定间距；125%/150% 浏览器缩放、窄屏、三语言和 Light/Dark 下无裁切/重叠。
- **2026-09-15 当前 UI 基线**：shared form control 已统一调整 label 行高/间距与 Select/Input 的默认 focus/border 行为，CAPTCHA 不再通过局部 margin 特判修复。当前基础表单排版作为标准，后续对其它设置项复用同一 shared control contract。
- **状态**：`已按 shared form control 基线修复；待 CDP 抽查，无需继续做 CAPTCHA 专项样式重构`

## P-056 挂起会话跨设备无法再次打开：需要显式 Takeover/Resume 所有权语义

- **问题现象**：某 SSH Workspace 被标记并进入挂起后，如果原浏览器/设备没有正常“关闭”相关会话，用户在另一台设备上无法可靠重新打开该挂起会话。对于挂起功能而言，这违背了“浏览器断开后仍可在别处恢复”的核心使用场景。
- **当前代码事实**：
  - Backend suspend coordinator 会把 SSH transport 从 Workspace detach 后交给 `SshSuspendService`，挂起记录成为该 PTY/transport 的唯一 owner。
  - 恢复使用 `prepareResume -> attach replacement Workspace -> cached tail ACK -> commitResume` 事务，而不是新建 SSH。
  - Frontend `resumeSuspended()` 支持本地 stale marked Workspace replacement，但当前跨设备并没有清晰的“某客户端仍认为自己拥有/正在恢复时，另一个客户端如何接管”的产品语义。
  - 普通 `registry.open(connection)` 会新建 SSH Workspace，它不是挂起会话的恢复入口，因此不能用“再打开同一个 Connection”冒充恢复。
- **决策**：挂起 Session 必须是 **server-owned resumable resource**。同一用户在任意设备登录后，应能从 Suspended Sessions 列表恢复原 PTY；如果旧客户端仍在线或存在 stale resume owner，需要提供安全、原子化的 takeover，而不是要求用户先回旧设备关闭。
- **计划修改**：
  1. 明确 suspended session 状态机：`hanging/available -> resuming(owner lease) -> attached`，恢复所有权使用短 lease/generation，而不是依赖某浏览器是否还保留 tab。
  2. 同一 session 同一时刻只能有一个 live terminal consumer；第二个设备请求恢复时，如果旧 owner 已失活/lease 过期，应自动接管。
  3. 如果旧 owner 仍明确活跃，可提示“此会话正在另一设备中打开，是否接管”；确认后服务端原子 revoke 旧 owner，再把同一 transport 交给新 Workspace。
  4. Takeover 不得创建第二条 SSH 登录，不得同时有两个前端向同一 PTY 写入。
  5. 旧客户端收到 revoke/close 原因后进入明确“已在其他设备接管”状态，不自动 reconnect 抢回所有权。
  6. `prepareResume/commitResume/rollbackResume` 加 generation/lease 校验，避免双恢复竞态导致 transport 丢失或被错误关闭。
  7. 保留 P-046 的日志/terminal checkpoint/history 恢复语义；跨设备恢复仍先给最新屏幕/历史，再接 live stream。
- **验证方式**：
  - 设备 A 挂起 `rclone`/shell 后不手动关闭页面，设备 B 登录同一账户可从挂起列表恢复**同一个**进程/PTY。
  - A/B 同时点击恢复只有一个成功 owner，不产生双输入或第二条 SSH。
  - B 接管后 A 有明确提示且不能自动抢回。
  - B 在 `prepareResume` 中断时可 rollback，原挂起 session 仍可再次恢复。
  - 浏览器崩溃、断网、正常关闭、跨设备接管四条路径都有 E2E/协议测试。
- **状态**：`已记录，待复现并设计跨设备 takeover`

## P-057 Windows EXE / Desktop 完整本地版规划：单一安装包交付 Frontend + Backend + Agent Runtime

- **问题背景**：当前 Nexus Terminal 交付形态以 Web + Docker/Backend 为主，仓库没有 Windows 桌面打包链。Windows 桌面版的目标不是 Remote Client，也不是仅把远程 Web 页面套一层壳，而是提供可直接安装运行的完整本地 Nexus Terminal。
- **已确认产品形态**：Windows 第一版采用 **Bundled Local Server**。用户只需要下载安装 Nexus Terminal，不需要另行部署 Nexus Server、Node.js 或 Docker；安装包内同时交付现有 Frontend、Backend、Agent Runner 和所需本地运行时。
- **推荐架构**：
  1. 桌面壳采用 **Tauri 2**，只负责应用窗口、生命周期、安装/更新和本地 Backend 进程编排，不复制任何现有业务 feature。
  2. 安装包内携官方 **Node.js 24 Windows runtime** 作为 sidecar；现有 Backend 与 Agent Runner 保持独立 Node 进程语义，不嵌入 Tauri Rust 进程，也不改写为桌面专用实现。
  3. 启动时由 Desktop shell 选择仅监听 `127.0.0.1` 的可用端口，设置 `NEXUS_DATA_DIR` 到用户数据目录，启动 Backend，等待 health ready 后再由 WebView 加载本地 Nexus UI。
  4. Frontend 继续使用现有 `/api/v1/*`、`/ws/*`、`/plugins`、`/sdk` 协议，不建立第二套 Desktop API。
  5. Windows 本地数据默认落在用户目录（例如 `%APPDATA%\Nexus Terminal\`），SQLite、session、Agent artifact/plugin 等继续沿用 Backend 现有数据目录模型。
- **为什么不优先把 Backend 直接运行在 Electron 内部**：现有 Backend 明确要求 Node >=24，并直接使用 `node:sqlite`；Agent/plugin runtime 还通过 `process.execPath` 启动子 Node worker。使用独立 Node 24 sidecar 能最大程度维持现有语义，也避免 Electron ABI/native addon rebuild 和 `process.execPath` 指向 Electron executable 的额外兼容层。
- **完整功能前置阻塞点**：
  1. **RDP/VNC runtime**：当前 Remote Desktop 路径依赖外部 `guacd`（Docker 中由 `guacamole/guacd` 提供）。若 Windows EXE 要完整支持 RDP/VNC，必须提供可随安装包交付的 Windows runtime。优先验证 Windows 原生 `guacd + FreeRDP/VNC` 打包；若无法稳定交付，再在保持 `RemoteDesktopSessionIssuer` port 不变的前提下替换 Windows 实现。
  2. **Agent Runner Windows terminal runtime**：当前 Workspace Runtime 明确依赖 POSIX `script`、`/bin/sh` 和 shell 语义。Windows 版需要增加 Windows platform adapter（优先 ConPTY + PowerShell/cmd），上层 Agent Runtime、预算、工具和协议保持不分叉。
  3. **Native Node dependencies**：`bcrypt`、`ssh2` 等依赖需要在 Windows x64 构建/打包环境验证可安装、可加载；数据库使用 Node 24 自带 `node:sqlite`，无需另引入桌面专用 SQLite 层。
- **安装与运行模型**：`Nexus-Terminal-Setup-x.y.z-win-x64.exe` 是单一对外交付安装包；安装完成后应用目录允许包含 `NexusTerminal.exe`、`node.exe`、Backend/Runner resources、native DLL/addon 和 Remote Desktop runtime。第一阶段不追求“安装后磁盘上也只有一个 PE 文件”，避免为单文件自解压破坏 native module、child process 与更新语义。
- **版本与发布规划**：
  1. Desktop 与 Nexus 产品 SemVer 对齐，Windows x64 先行，arm64 后续单独评估。
  2. Windows CI 构建 Frontend、Backend、Agent Runner 与 sidecar resources，产出 installer artifact，并验证干净 Windows 10/11 环境安装、启动、升级、卸载。
  3. Stable 安装包必须代码签名并规划 SmartScreen reputation；自动更新必须校验签名/哈希。
  4. Desktop shell 管理单实例、窗口恢复、本地 Backend 子进程启动/退出、异常重启与端口生命周期；Web 业务状态仍由现有 Frontend/Backend 管理。
- **安全与本地边界**：Backend 默认仅绑定 loopback；Desktop shell 不向 Web 内容直接暴露任意 filesystem/shell/native 权限。现有 Plugin/CSP/capability 边界继续保留，本地系统能力只能通过明确的 platform adapter 增加。
- **验证方式**：
  - 在全新 Windows 10/11 x64、未安装 Node/Docker 的环境中，仅安装 Nexus EXE 即可启动并完成首次设置。
  - SSH/SFTP、Workspace、挂起恢复、文件上传下载、Agent/Plugin、模型 Provider、通知、备份等现有能力与 Web 版一致。
  - RDP/VNC 在不依赖外部 Docker/WSL/手工安装 guacd 的条件下可用。
  - Agent Windows Workspace terminal 不依赖 `/bin/sh` 或 Unix `script`，并通过 ConPTY/Windows shell 完成等价运行。
  - 应用退出后 Backend/Runner/Remote Desktop 子进程不残留；数据库与用户数据升级/卸载语义明确且可恢复。
- **状态**：`方案已确认，暂不实施；后续实现前先验证 Windows guacd/RDP-VNC runtime 与 Agent Runner ConPTY 两个平台前置点`
