#!/bin/sh
# Nexus Terminal Backend - Docker Entrypoint
# 处理 volume 挂载后的目录权限问题

set -e

DATA_DIR="/app/data"
DATA_ENV_PATH="${DATA_DIR}/.env"

echo "[entrypoint] 检查数据目录..."

# 创建 paths.ts 中定义的所有数据子目录（如果不存在）
mkdir -p "${DATA_DIR}/uploads" \
         "${DATA_DIR}/sessions" \
         "${DATA_DIR}/background" \
         "${DATA_DIR}/custom_html_theme" \
         "${DATA_DIR}/temp_suspended_ssh_logs"

# 修复权限：确保 appuser 对数据目录有完全访问权限
chown -R appuser:appgroup "$DATA_DIR"
# 补充目录写权限：chown 只改属主不改 mode，确保 appuser 可写
chmod -R u+rwX "$DATA_DIR"

# 修复 .env 文件权限：密钥文件仅 owner 可读写
if [ -f "$DATA_ENV_PATH" ]; then
  chmod 600 "$DATA_ENV_PATH"
  chown appuser:appgroup "$DATA_ENV_PATH"
fi

echo "[entrypoint] 目录权限已修复"

# 执行原始命令（使用 gosu 切换到 appuser）
exec gosu appuser "$@"
