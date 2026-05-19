#!/bin/bash
set -e

# 新建文件默认权限为 600（仅 owner 可读写）
umask 077

# 启动脚本：先启动 guacd，再启动 Node.js 远程网关
# guacd 作为前台进程管理，Node.js 作为后台进程

GUACD_HOST="${GUACD_HOST:-localhost}"
GUACD_PORT="${GUACD_PORT:-4822}"

echo "[entrypoint] 启动 guacd 守护进程..."
# guacd 默认在前台运行，改为后台运行
# 官方 guacamole/guacd 镜像中 guacd 位于 /opt/guacamole/sbin/
GUACD_BIN="/opt/guacamole/sbin/guacd"
if [ ! -x "$GUACD_BIN" ]; then
    # 回退：尝试 PATH 中的 guacd
    GUACD_BIN="guacd"
fi
"$GUACD_BIN" -b "$GUACD_HOST" -l "$GUACD_PORT" -f &
GUACD_PID=$!

# 等待 guacd 就绪
echo "[entrypoint] 等待 guacd 就绪 (port $GUACD_PORT)..."
for i in $(seq 1 30); do
    if nc -z "$GUACD_HOST" "$GUACD_PORT" 2>/dev/null; then
        echo "[entrypoint] guacd 已就绪。"
        break
    fi
    if [ "$i" -eq 30 ]; then
        echo "[entrypoint] 错误：guacd 启动超时。"
        exit 1
    fi
    sleep 1
done

# 确保 Node.js 连接 guacd 时使用 localhost（同一容器内）
export GUACD_HOST="localhost"

echo "[entrypoint] 启动 remote-gateway (Node.js)..."
node dist/server.js &
NODE_PID=$!

# 信号处理：优雅关闭两个进程
cleanup() {
    echo "[entrypoint] 收到终止信号，正在关闭..."
    kill "$NODE_PID" 2>/dev/null || true
    kill "$GUACD_PID" 2>/dev/null || true
    wait "$NODE_PID" 2>/dev/null || true
    wait "$GUACD_PID" 2>/dev/null || true
    echo "[entrypoint] 已关闭。"
    exit 0
}

trap cleanup SIGTERM SIGINT SIGQUIT

# 等待任一进程退出
wait -n "$GUACD_PID" "$NODE_PID" 2>/dev/null || true

# 如果某个进程退出，清理另一个
EXIT_CODE=$?
echo "[entrypoint] 进程异常退出 (code=$EXIT_CODE)，正在清理..."
cleanup
