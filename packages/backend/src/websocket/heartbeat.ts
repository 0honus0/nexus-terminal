import WebSocket, { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket } from './types';
import { cleanupClientConnection } from './utils';

const HEARTBEAT_INTERVAL_MS = 15000;
const MAX_MISSED_HEARTBEATS = 2;

export function initializeHeartbeat(wss: WebSocketServer): NodeJS.Timeout {
    const missedHeartbeats = new WeakMap<WebSocket, number>();

    const heartbeatInterval = setInterval(() => {
        wss.clients.forEach((ws: WebSocket) => {
            const extWs = ws as AuthenticatedWebSocket;
            if (extWs.isAlive === false) {
                const missed = (missedHeartbeats.get(ws) ?? 0) + 1;
                missedHeartbeats.set(ws, missed);
                if (missed >= MAX_MISSED_HEARTBEATS) {
                    console.log(`WebSocket 心跳检测：用户 ${extWs.username} (会话: ${extWs.sessionId}) 连续 ${missed} 次无响应，正在终止...`);
                    cleanupClientConnection(extWs.sessionId);
                    return extWs.terminate();
                }
            } else {
                missedHeartbeats.set(ws, 0);
            }

            extWs.isAlive = false;
            extWs.ping(() => {});
        });
    }, HEARTBEAT_INTERVAL_MS);

    // 当 WebSocket 服务器关闭时，清除心跳定时器
    wss.on('close', () => {
        console.log('WebSocket 服务器正在关闭，清理心跳定时器...');
        clearInterval(heartbeatInterval);
    });

    console.log(`心跳检测已初始化，间隔: ${HEARTBEAT_INTERVAL_MS}ms`);
    return heartbeatInterval;
}