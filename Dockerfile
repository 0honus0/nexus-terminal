# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24
ARG BWRAP_VERSION=0.12.0
ARG BWRAP_SHA256=9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314

# Alpine 3.24 carries bubblewrap 0.11.2; build the current upstream stable release
# from its release archive instead so plugin/runner sandboxes meet the >=0.12.0 security baseline.

FROM alpine:${ALPINE_VERSION} AS bwrap-builder
ARG BWRAP_VERSION
ARG BWRAP_SHA256
RUN apk add --no-cache build-base curl libcap-dev meson ninja xz \
    && mkdir -p /build \
    && curl --fail --location --proto '=https' --tlsv1.2 \
      "https://github.com/containers/bubblewrap/releases/download/v${BWRAP_VERSION}/bubblewrap-${BWRAP_VERSION}.tar.xz" \
      --output /build/bubblewrap.tar.xz \
    && printf '%s  %s\n' "${BWRAP_SHA256}" /build/bubblewrap.tar.xz | sha256sum -c - \
    && tar -xJf /build/bubblewrap.tar.xz -C /build \
    && meson setup /build/output "/build/bubblewrap-${BWRAP_VERSION}" \
      -Dselinux=disabled -Dman=disabled -Dtests=false \
      -Dbash_completion=disabled -Dzsh_completion=disabled \
    && meson compile -C /build/output \
    && install -D -m 0755 /build/output/bwrap /out/bwrap \
    && /out/bwrap --version | grep -Fx "bubblewrap ${BWRAP_VERSION}"

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
ARG BWRAP_VERSION
LABEL org.opencontainers.image.title="Nexus Terminal" \
      org.opencontainers.image.description="Unified runtime image for the frontend and backend"

RUN apk add --no-cache nodejs nginx tini libcap \
    && rm -rf /usr/share/nginx/html/* /var/cache/apk/*
COPY --from=bwrap-builder /out/bwrap /usr/local/bin/bwrap
RUN /usr/local/bin/bwrap --version | grep -Fx "bubblewrap ${BWRAP_VERSION}"

WORKDIR /app
ENV NEXUS_HTML_THEME_ASSET_DIR=/app/assets/html-themes/local

COPY --from=backend-builder /build/backend/dist ./dist
COPY assets/html-themes/local ./assets/html-themes/local
COPY --from=backend-builder /build/backend/node_modules ./node_modules
COPY --from=backend-builder /build/backend/package.json ./package.json


COPY --from=frontend-builder /build/frontend/dist /usr/share/nginx/html
COPY packages/frontend/nginx.conf /etc/nginx/http.d/default.conf
COPY scripts/docker/entrypoint.sh /usr/local/bin/nexus-terminal

RUN chmod 0755 /usr/local/bin/nexus-terminal \
    && mkdir -p /app/data /run/nginx

EXPOSE 80 3001 3002

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/nexus-terminal"]
CMD ["frontend"]
