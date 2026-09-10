# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=24
ARG ALPINE_VERSION=3.24

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /build
COPY packages/agent-runtime/package.json packages/agent-runtime/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY packages/agent-runtime/tsconfig.json ./tsconfig.json
COPY packages/agent-runtime/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:${NODE_VERSION}-alpine AS controller
LABEL org.opencontainers.image.title="Nexus Agent Runner"
WORKDIR /app
RUN apk add --no-cache bubblewrap
COPY --from=builder /build/dist ./dist
COPY --from=builder /build/node_modules ./node_modules
COPY --from=builder /build/package.json ./package.json
COPY scripts/docker/agent-runtime/catalog ./catalog
RUN mkdir -p /var/lib/nexus-agent-runner/state /var/lib/nexus-agent-runner/packs /var/lib/nexus-agent-runner/cache /var/lib/nexus-agent-runner/runtime /var/lib/nexus-agent-runner/quarantine /run/nexus-agent-runner
EXPOSE 8790
CMD ["node", "dist/index.js"]
