# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.13.0
FROM node:${NODE_VERSION}-alpine AS node-base

FROM node-base AS workspace-base
RUN apk upgrade --no-cache
ENV PNPM_CONFIG_STORE_DIR=/pnpm/store
WORKDIR /build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY scripts/patches ./scripts/patches
COPY packages/frontend/vendor ./packages/frontend/vendor
COPY packages/shared/package.json ./packages/shared/package.json
RUN PNPM_VERSION="$(node -p "require('./package.json').packageManager.replace(/^pnpm@/, '')")" \
    && npm install --global --allow-scripts=pnpm "pnpm@${PNPM_VERSION}"

FROM workspace-base AS frontend-builder
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY packages/frontend/package.json ./packages/frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nexus-terminal/frontend...
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/frontend/src ./packages/frontend/src
COPY packages/frontend/public ./packages/frontend/public
COPY packages/frontend/build ./packages/frontend/build
COPY packages/frontend/index.html packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./packages/frontend/
RUN pnpm --filter @nexus-terminal/frontend build

FROM workspace-base AS backend-builder
RUN apk add --no-cache python3 py3-setuptools make g++
COPY packages/backend/package.json ./packages/backend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    CI_CHECK_FAIL=ssh2 pnpm install --frozen-lockfile --filter @nexus-terminal/backend...
COPY packages/shared/src ./packages/shared/src
COPY packages/shared/tsconfig.json ./packages/shared/tsconfig.json
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/tsconfig.json ./packages/backend/tsconfig.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @nexus-terminal/backend build \
    && pnpm --filter @nexus-terminal/backend --prod deploy /out/backend

FROM node-base AS runtime
LABEL org.opencontainers.image.title="Nexus Terminal" \
      org.opencontainers.image.description="Unified runtime image for the frontend and backend"

RUN apk upgrade --no-cache \
    && apk add --no-cache nginx tini \
    && rm -rf /usr/share/nginx/html/* /var/cache/apk/*
WORKDIR /app
ENV NEXUS_HTML_THEME_ASSET_DIR=/app/assets/html-themes/local
COPY --from=backend-builder /out/backend/dist ./dist
COPY assets/html-themes/local ./assets/html-themes/local
COPY --from=backend-builder /out/backend/node_modules ./node_modules
COPY --from=backend-builder /out/backend/package.json ./package.json

COPY --from=frontend-builder /build/packages/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/http.d/default.conf
COPY scripts/docker/entrypoint.sh /usr/local/bin/nexus-terminal

RUN chmod 0755 /usr/local/bin/nexus-terminal \
    && mkdir -p /app/data /run/nginx

EXPOSE 80 3001

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nexus-terminal"]
CMD ["frontend"]
