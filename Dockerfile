# syntax=docker/dockerfile:1
FROM node:26.13.1-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/format ./scripts/format
RUN npm install --global "$(node -p "require('./package.json').packageManager")" \
    && pnpm config set store-dir /pnpm/store

FROM dependencies AS frontend
COPY src ./src
COPY tsconfig.json vite.config.ts ./
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --frozen-lockfile \
    && pnpm build:frontend

FROM dependencies AS backend
RUN --mount=type=cache,target=/pnpm/store \
    pnpm install --prod --frozen-lockfile

FROM node:26.13.1-bookworm-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends bash nginx tini \
    && find /var/lib/apt/lists -mindepth 1 -delete \
    && install -d -o node -g node /app/data
WORKDIR /app
ENV NODE_ENV=production DATA_DIRECTORY=/app/data
COPY --from=frontend --chown=node:node /app/dist/frontend ./frontend
COPY --from=backend /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY scripts/docker/nginx.conf /etc/nexus-nginx.conf
COPY --chmod=755 scripts/docker/entrypoint.sh /usr/local/bin/nexus-terminal
USER node
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s CMD node -e "fetch('http://127.0.0.1:8080/api/auth/state').then(r => { if (!r.ok) process.exitCode = 1 }).catch(() => { process.exitCode = 1 })"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/nexus-terminal"]
