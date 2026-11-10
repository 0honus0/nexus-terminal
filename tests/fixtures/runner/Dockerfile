ARG NODE_VERSION=26.13.0
FROM node:${NODE_VERSION}-bookworm-slim

ARG E2E_RUNNER_FINGERPRINT
ARG E2E_RUNNER_REFRESH_WEEK
ARG PLAYWRIGHT_VERSION
ARG PNPM_VERSION

ENV DEBIAN_FRONTEND=noninteractive \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    PNPM_HOME=/opt/pnpm \
    PNPM_CONFIG_STORE_DIR=/opt/pnpm/store \
    PNPM_CONFIG_SIDE_EFFECTS_CACHE=true \
    XDG_CACHE_HOME=/opt/pnpm/cache \
    npm_config_nodedir=/usr/local \
    E2E_RUNNER_FINGERPRINT=${E2E_RUNNER_FINGERPRINT} \
    E2E_RUNNER_REFRESH_WEEK=${E2E_RUNNER_REFRESH_WEEK} \
    PATH=/opt/pnpm:${PATH}

RUN npm install --global --allow-scripts=pnpm "pnpm@${PNPM_VERSION}" \
  && pnpm dlx "playwright@${PLAYWRIGHT_VERSION}" install --with-deps --only-shell chromium \
  && apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends time bzip2 ca-certificates git openssh-client openssh-server rsync sshpass unzip zip xrdp tigervnc-standalone-server tigervnc-tools xterm xdotool xclip fonts-dejavu-core openssl \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /root/.cache

# The backend shard exercises real Docker commands over its isolated OpenSSH fixture.
COPY --from=docker:29.9.2-cli /usr/local/bin/docker /usr/local/bin/docker

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY scripts/patches ./scripts/patches
COPY packages/frontend/vendor ./packages/frontend/vendor
COPY packages/backend/package.json packages/backend/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/frontend/package.json packages/frontend/package.json
COPY tests/package.json tests/package.json
RUN apt-get update \
  && apt-get install -y --no-install-recommends g++ make python3 \
  && CI_CHECK_FAIL=ssh2 pnpm install --frozen-lockfile \
  && rm -rf node_modules packages/*/node_modules tests/node_modules \
  && apt-get purge -y --auto-remove g++ make python3 \
  && apt-get clean \
  && rm -rf /var/lib/apt/lists/* /root/.cache /tmp/*
