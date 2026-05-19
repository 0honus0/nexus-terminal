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
# guacd 镜像以非 root 用户运行，需要显式切 root 安装依赖
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

# 移除构建缓存
RUN rm -rf /root/.npm /tmp/*

# 修复 /app 目录权限，确保 guacd 用户可读写
RUN chown -R guacd:guacd /app

# 切回非 root 用户（guacd 镜像自带 guacd 用户）
USER guacd

# 暴露端口：9090=API, 8080=WebSocket, 4822=guacd（可选，供外部调试）
EXPOSE 9090 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD curl -sf http://localhost:9090/health > /dev/null 2>&1 || exit 1

ENTRYPOINT ["/entrypoint.sh"]
