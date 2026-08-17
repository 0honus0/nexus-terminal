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
COPY packages/backend/html-presets ./html-presets
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
COPY packages/frontend/index.html packages/frontend/tsconfig.json packages/frontend/vite.config.ts ./
RUN npm run build

FROM node:${NODE_VERSION}-alpine AS remote-gateway-builder
WORKDIR /build/remote-gateway
COPY packages/remote-gateway/package.json packages/remote-gateway/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/remote-gateway/src ./src
COPY packages/remote-gateway/tsconfig.json packages/remote-gateway/guacamole-lite.d.ts ./
RUN npm run build \
    && npm prune --omit=dev \
    && npm cache clean --force

FROM alpine:${ALPINE_VERSION} AS runtime
LABEL org.opencontainers.image.title="Nexus Terminal" \
      org.opencontainers.image.description="Unified runtime image for the frontend, backend, and remote gateway"

RUN apk add --no-cache nodejs nginx tini \
    && rm -rf /usr/share/nginx/html/* /var/cache/apk/*

WORKDIR /app

COPY --from=backend-builder /build/backend/dist ./dist
COPY --from=backend-builder /build/backend/html-presets ./html-presets
COPY --from=backend-builder /build/backend/node_modules ./node_modules
COPY --from=backend-builder /build/backend/package.json ./package.json

COPY --from=remote-gateway-builder /build/remote-gateway/dist ./remote-gateway/dist
COPY --from=remote-gateway-builder /build/remote-gateway/node_modules ./remote-gateway/node_modules
COPY --from=remote-gateway-builder /build/remote-gateway/package.json ./remote-gateway/package.json

COPY --from=frontend-builder /build/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/http.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/nexus-terminal

RUN chmod 0755 /usr/local/bin/nexus-terminal \
    && mkdir -p /app/data /run/nginx

EXPOSE 80 3001 8080 9090

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nexus-terminal"]
CMD ["frontend"]
