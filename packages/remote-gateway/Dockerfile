# 内嵌 guacd + Node.js 远程网关
# 将 guacd 与 remote-gateway 合并到单个容器，简化部署

# --- Stage 1: 构建 remote-gateway TypeScript ---
FROM node:20-alpine AS builder

WORKDIR /app

COPY packages/remote-gateway/package.json packages/remote-gateway/package-lock.json* ./
RUN npm install

COPY packages/remote-gateway/src ./src
COPY packages/remote-gateway/tsconfig.json ./tsconfig.json
COPY packages/remote-gateway/guacamole-lite.d.ts ./guacamole-lite.d.ts

RUN npm run build
RUN npm prune --production

# --- Stage 2: 基于 guacd 镜像构建最终镜像 ---
FROM guacamole/guacd:latest

# 安装 Node.js 20.x（Alpine-based guacd 镜像）
# guacd 镜像默认以非 root 运行，安装/构建阶段需要 root
USER root
RUN apk add --no-cache nodejs npm curl ca-certificates bash netcat-openbsd

WORKDIR /app

# 从 builder 阶段复制编译产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# 复制并应用补丁
COPY patches ./patches
RUN npm install patch-package --no-save && \
    npx patch-package --error-on-fail && \
    npm uninstall patch-package && \
    rm -rf patches

# 复制启动脚本
COPY packages/remote-gateway/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# 设置目录权限并切回 guacamole 用户（entrypoint 中启动 guacd 需要该用户）
RUN chown -R guacamole:guacamole /app
USER guacamole

# 暴露端口：9090=API, 8080=WebSocket, 4822=guacd（可选，供外部调试）
EXPOSE 9090 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:9090/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
