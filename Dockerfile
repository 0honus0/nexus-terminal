# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24

FROM node:${NODE_VERSION}-alpine AS backend-builder
RUN apk add --no-cache python3 py3-setuptools make g++
WORKDIR /build/backend
COPY packages/backend/package.json packages/backend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/backend/src ./src
COPY packages/backend/tsconfig.json ./tsconfig.json
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM node:${NODE_VERSION}-alpine AS frontend-builder
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
WORKDIR /build/frontend
COPY packages/frontend/package.json packages/frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/frontend/src ./src
COPY packages/frontend/public ./public
COPY packages/frontend/scripts ./scripts
COPY packages/frontend/index.html packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./
RUN npm run build

FROM alpine:${ALPINE_VERSION} AS runtime
LABEL org.opencontainers.image.title="Nexus Terminal" \
      org.opencontainers.image.description="Unified runtime image for the frontend and backend"

RUN apk add --no-cache nodejs nginx tini bubblewrap \
    && rm -rf /usr/share/nginx/html/* /var/cache/apk/*

WORKDIR /app
ENV NEXUS_HTML_THEME_ASSET_DIR=/app/assets/html-themes/local

COPY --from=backend-builder /build/backend/dist ./dist
COPY assets/html-themes/local ./assets/html-themes/local
COPY --from=backend-builder /build/backend/node_modules ./node_modules
COPY --from=backend-builder /build/backend/package.json ./package.json


COPY --from=frontend-builder /build/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/http.d/default.conf
COPY scripts/docker/plugin-frontend-nginx.conf.template /etc/nginx/templates/plugin-frontend.conf.template
COPY scripts/docker/entrypoint.sh /usr/local/bin/nexus-terminal

RUN chmod 0755 /usr/local/bin/nexus-terminal \
    && mkdir -p /app/data /srv/plugins /run/nginx /etc/nginx/templates

EXPOSE 80 8081 3001

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nexus-terminal"]
CMD ["frontend"]
