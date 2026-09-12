# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
ARG DEBIAN_SUITE=bookworm-slim
ARG MISE_VERSION=2026.9.5
ARG MISE_AMD64_SHA256=d71e94e1ed59d4d0ca4ac847fa321d6d6615a8e613e9b468c9fb39f0dddd06d5
ARG MISE_ARM64_SHA256=3a52c7c7c58d21a0791516950ebf4bc915f403277b49c93d657fc585259625ec

# Runner Toolchain Catalog 的 Linux pack 以 glibc 环境生成 canonical digest。
# 独立镜像统一使用 Debian/glibc，避免 mise 和 Tool Pack 因 libc 差异产生不可执行文件。
FROM node:${NODE_VERSION}-${DEBIAN_SUITE} AS mise-downloader
ARG TARGETARCH
ARG MISE_VERSION
ARG MISE_AMD64_SHA256
ARG MISE_ARM64_SHA256
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH}" in \
      amd64) mise_arch=x64; mise_sha256="${MISE_AMD64_SHA256}" ;; \
      arm64) mise_arch=arm64; mise_sha256="${MISE_ARM64_SHA256}" ;; \
      *) echo "Unsupported Agent Runner architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && mkdir -p /build-mise/extract \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${mise_arch}.tar.gz" \
      --output /build-mise/mise.tar.gz \
    && printf '%s  %s\n' "${mise_sha256}" /build-mise/mise.tar.gz | sha256sum -c - \
    && tar -xzf /build-mise/mise.tar.gz -C /build-mise/extract \
    && install -D -m 0755 /build-mise/extract/mise/bin/mise /out/mise \
    && /out/mise --version | awk 'NR == 1 { print $1 }' | grep -Fx "${MISE_VERSION}"

FROM node:${NODE_VERSION}-${DEBIAN_SUITE} AS builder
ENV PNPM_CONFIG_STORE_DIR=/pnpm/store
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-runner/package.json ./packages/agent-runner/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY packages/e2e/package.json ./packages/e2e/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nexus-terminal/agent-runner
COPY packages/agent-runner/tsconfig.json ./packages/agent-runner/tsconfig.json
COPY packages/agent-runner/src ./packages/agent-runner/src
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @nexus-terminal/agent-runner build \
    && pnpm --filter @nexus-terminal/agent-runner --prod deploy /out/agent-runner

FROM node:${NODE_VERSION}-${DEBIAN_SUITE} AS controller
ARG MISE_VERSION
LABEL org.opencontainers.image.title="Nexus Agent Runner" \
      org.opencontainers.image.description="Standalone workspace and runtime plane for Nexus Agent"
WORKDIR /app

# script(1) 负责 Workspace Terminal 的 PTY 分配；tini 只作为容器 PID 1 转发信号并回收孤儿进程。
# 不引入自编译 native helper；curl/tar/gzip/xz/zstd 等由 mise Tool Pack materializer 解包 Node/Python/Go release 使用。
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
      bsdutils bzip2 ca-certificates curl gzip tar tini unzip xz-utils zstd \
    && rm -rf /var/lib/apt/lists/*
COPY --from=mise-downloader /out/mise /usr/local/bin/mise
RUN /usr/local/bin/mise --version | awk 'NR == 1 { print $1 }' | grep -Fx "${MISE_VERSION}" \
    && command -v script >/dev/null \
    && command -v stty >/dev/null \
    && command -v tini >/dev/null

COPY --from=builder /out/agent-runner/dist ./dist
COPY --from=builder /out/agent-runner/node_modules ./node_modules
COPY --from=builder /out/agent-runner/package.json ./package.json
COPY scripts/docker/agent-runner/catalog ./catalog

# Runner 维护持久 Workspace、共享 Tool Pack、缓存和运行状态；Workspace 不是安全沙箱边界。
RUN mkdir -p \
      /var/lib/nexus-agent-runner/state \
      /var/lib/nexus-agent-runner/packs \
      /var/lib/nexus-agent-runner/cache \
      /var/lib/nexus-agent-runner/runtime \
      /var/lib/nexus-agent-runner/quarantine \
      /var/lib/nexus-agent-runner/plugin-source \
      /opt/nexus/packs

ENV PORT=8790 \
    NEXUS_AGENT_RUNNER_HOST=0.0.0.0 \
    NEXUS_AGENT_RUNNER_ROOT=/var/lib/nexus-agent-runner \
    NEXUS_AGENT_CATALOG=/app/catalog/catalog.json \
    NEXUS_AGENT_MISE_BIN=/usr/local/bin/mise \
    NEXUS_AGENT_PLUGIN_SOURCE_ROOT=/var/lib/nexus-agent-runner/plugin-source

EXPOSE 8790

# 健康检查验证 Controller 与 native Workspace runtime 可用，不依赖 namespace/capability probe。
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:8790/v1/availability',{headers:{authorization:'Bearer '+process.env.NEXUS_AGENT_RUNNER_TOKEN,'x-nexus-agent-protocol':'2026-09-13'}}).then(async r=>{const b=await r.json();process.exit(r.ok&&b.available===true&&b.mode==='native'?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
