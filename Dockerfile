# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24
FROM node:${NODE_VERSION}-alpine AS workspace-base
ENV PNPM_CONFIG_STORE_DIR=/pnpm/store
WORKDIR /build
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/protocol/package.json ./packages/protocol/package.json

FROM workspace-base AS backend-builder
RUN apk add --no-cache python3 py3-setuptools make g++
COPY packages/backend/package.json ./packages/backend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nexus-terminal/backend
COPY packages/protocol/src ./packages/protocol/src
COPY packages/protocol/tsconfig.runtime.json ./packages/protocol/tsconfig.runtime.json
COPY packages/backend/src ./packages/backend/src
COPY packages/backend/tsconfig.json ./packages/backend/tsconfig.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm --filter @nexus-terminal/backend build \
    && pnpm --filter @nexus-terminal/backend exec tsc -p ../protocol/tsconfig.runtime.json \
    && node -e "const fs=require('node:fs'); const path='packages/protocol/package.json'; const manifest=JSON.parse(fs.readFileSync(path,'utf8')); for (const target of Object.values(manifest.exports ?? {})) { if (target && typeof target === 'object' && typeof target.default?.startsWith('./src/') && target.default.endsWith('.ts')) target.default='./dist/'+target.default.slice(6,-3)+'.js'; } fs.writeFileSync(path, JSON.stringify(manifest, null, 2)+'\\n');" \
    && pnpm --filter @nexus-terminal/backend --prod deploy /out/backend

FROM workspace-base AS frontend-builder
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
COPY packages/frontend/package.json ./packages/frontend/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @nexus-terminal/frontend
COPY packages/protocol/src ./packages/protocol/src
COPY packages/frontend/src ./packages/frontend/src
COPY packages/frontend/public ./packages/frontend/public
COPY packages/frontend/index.html packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./packages/frontend/
RUN pnpm --filter @nexus-terminal/frontend build

FROM alpine:${ALPINE_VERSION} AS runtime
LABEL org.opencontainers.image.title="Nexus Terminal" \
      org.opencontainers.image.description="Unified runtime image for the frontend and backend"

RUN apk add --no-cache nodejs nginx tini \
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
