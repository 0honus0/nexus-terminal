# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24
ARG BWRAP_VERSION=0.12.0
ARG BWRAP_SHA256=9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314

# Alpine 3.24 carries bubblewrap 0.11.2; build the current upstream stable release
# from its release archive instead so plugin/runner sandboxes meet the >=0.12.0 security baseline.

FROM node:${NODE_VERSION}-alpine AS bwrap-builder
ARG BWRAP_VERSION
ARG BWRAP_SHA256
RUN apk add --no-cache build-base curl libcap-dev meson ninja xz \
    && mkdir -p /build-bwrap \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/containers/bubblewrap/releases/download/v${BWRAP_VERSION}/bubblewrap-${BWRAP_VERSION}.tar.xz" \
      --output /build-bwrap/bubblewrap.tar.xz \
    && printf '%s  %s\n' "${BWRAP_SHA256}" /build-bwrap/bubblewrap.tar.xz | sha256sum -c - \
    && tar -xJf /build-bwrap/bubblewrap.tar.xz -C /build-bwrap \
    && CFLAGS='-include linux/limits.h' meson setup /build-bwrap/output "/build-bwrap/bubblewrap-${BWRAP_VERSION}" \
      -Dselinux=disabled -Dman=disabled -Dtests=false \
      -Dbash_completion=disabled -Dzsh_completion=disabled \
    && meson compile -C /build-bwrap/output \
    && install -D -m 0755 /build-bwrap/output/bwrap /out/bwrap \
    && /out/bwrap --version | grep -Fx "bubblewrap ${BWRAP_VERSION}"

FROM node:${NODE_VERSION}-alpine AS builder
ENV PNPM_CONFIG_STORE_DIR=/pnpm/store
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/agent-runtime/package.json ./packages/agent-runtime/package.json
COPY packages/backend/package.json ./packages/backend/package.json
COPY packages/frontend/package.json ./packages/frontend/package.json
COPY test/e2e/package.json ./test/e2e/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nexus-terminal/agent-runtime
COPY packages/agent-runtime/tsconfig.json ./packages/agent-runtime/tsconfig.json
COPY packages/agent-runtime/src ./packages/agent-runtime/src
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @nexus-terminal/agent-runtime build \
    && pnpm --filter @nexus-terminal/agent-runtime --prod deploy /out/agent-runtime

FROM node:${NODE_VERSION}-alpine AS controller
ARG BWRAP_VERSION
LABEL org.opencontainers.image.title="Nexus Agent Runner"
WORKDIR /app
RUN apk add --no-cache libcap
COPY --from=bwrap-builder /out/bwrap /usr/local/bin/bwrap
RUN /usr/local/bin/bwrap --version | grep -Fx "bubblewrap ${BWRAP_VERSION}"
COPY --from=builder /out/agent-runtime/dist ./dist
COPY --from=builder /out/agent-runtime/node_modules ./node_modules
COPY --from=builder /out/agent-runtime/package.json ./package.json
COPY scripts/docker/agent-runtime/catalog ./catalog
RUN mkdir -p /var/lib/nexus-agent-runner/state /var/lib/nexus-agent-runner/packs /var/lib/nexus-agent-runner/cache /var/lib/nexus-agent-runner/runtime /var/lib/nexus-agent-runner/quarantine /run/nexus-agent-runner
EXPOSE 8790
CMD ["node", "dist/index.js"]
