import WebSocket, { RawData } from 'ws';
import { AuthenticatedWebSocket, WebSocketRequest } from '../types';

export function handleRdpProxyConnection(
    ws: AuthenticatedWebSocket,
    request: WebSocketRequest
): void {
    const clientIp = request.clientIpAddress || 'unknown';
    console.log(`WebSocket：RDP 代理客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}) 已连接。`);

    ws.on('pong', () => { ws.isAlive = true; });

    // Retrieve all necessary parameters passed from the upgrade handler
    const rdpToken = request.rdpToken;
    const rdpWidthStr = request.rdpWidth;
    const rdpHeightStr = request.rdpHeight;

    // --- 参数验证和 DPI 计算 ---
    if (!rdpToken || !rdpWidthStr || !rdpHeightStr) { // Check string presence
        console.error(`WebSocket: RDP Proxy connection for ${ws.username} missing required parameters (token, width, height).`);
        ws.send(JSON.stringify({ type: 'rdp:error', payload: 'Missing RDP connection parameters (token, width, height).' }));
        ws.close(1008, 'Missing RDP parameters');
        return;
    }

    const rdpWidth = parseInt(rdpWidthStr, 10);
    const rdpHeight = parseInt(rdpHeightStr, 10);

    if (isNaN(rdpWidth) || isNaN(rdpHeight) || rdpWidth <= 0 || rdpHeight <= 0) {
         console.error(`WebSocket: RDP Proxy connection for ${ws.username} has invalid width or height parameters.`);
         ws.send(JSON.stringify({ type: 'rdp:error', payload: 'Invalid width or height parameters.' }));
         ws.close(1008, 'Invalid RDP dimensions');
         return;
    }

    // 根据宽高的简单 DPI 计算逻辑 (如果宽度 > 1920，则 DPI=120，否则 DPI=96)
    const calculatedDpi = rdpWidth > 1920 ? 120 : 96;
    console.log(`WebSocket: RDP Proxy calculated DPI for ${ws.username} based on width ${rdpWidth}: ${calculatedDpi}`);

    // Determine RDP target URL based on deployment mode
    const deploymentMode = process.env.DEPLOYMENT_MODE;
    let remoteGatewayWsBaseUrl: string;
    if (deploymentMode === 'local') {
        remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_LOCAL || 'ws://localhost:8080';
        console.log(`[WebSocket Remote Desktop Proxy] Using LOCAL deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`);
    } else if (deploymentMode === 'docker') {
        remoteGatewayWsBaseUrl = process.env.REMOTE_GATEWAY_WS_URL_DOCKER || 'ws://remote-gateway:8080';
        console.log(`[WebSocket Remote Desktop Proxy] Using DOCKER deployment mode. Target Base: ${remoteGatewayWsBaseUrl}`);
    } else {
        remoteGatewayWsBaseUrl = 'ws://localhost:8080';
        console.warn(`[WebSocket Remote Desktop Proxy] Unknown deployment mode '${deploymentMode}'. Defaulting to safe fallback Target Base: ${remoteGatewayWsBaseUrl}`);
    }

    const cleanRemoteGatewayWsBaseUrl = remoteGatewayWsBaseUrl.endsWith('/') ? remoteGatewayWsBaseUrl.slice(0, -1) : remoteGatewayWsBaseUrl;

    const remoteDesktopTargetUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=${encodeURIComponent(rdpToken)}&width=${encodeURIComponent(rdpWidth)}&height=${encodeURIComponent(rdpHeight)}&dpi=${encodeURIComponent(calculatedDpi)}&GUAC_AUDIO=${encodeURIComponent('audio/L16')}`;
    const safeRemoteDesktopTargetUrl = `${cleanRemoteGatewayWsBaseUrl}/?token=[REDACTED]&width=${rdpWidth}&height=${rdpHeight}&dpi=${calculatedDpi}&GUAC_AUDIO=audio%2FL16`;

    console.log(`WebSocket: Remote Desktop Proxy for ${ws.username} attempting to connect to ${safeRemoteDesktopTargetUrl}`);

    const rdpWs = new WebSocket(remoteDesktopTargetUrl);
    let clientWsClosed = false;
    let rdpWsClosed = false;
    const pendingClientMessages: Array<{ message: RawData; isBinary: boolean; size: number }> = [];
    let pendingClientBytes = 0;
    const maxPendingClientBytes = 1024 * 1024;

    const connectTimeout = setTimeout(() => {
        if (rdpWs.readyState !== WebSocket.CONNECTING) return;
        console.error(`[RDP 代理] 连接 remote-gateway 超时: ${safeRemoteDesktopTargetUrl}`);
        rdpWs.terminate();
        rdpWsClosed = true;
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1013, 'Remote desktop gateway timeout');
            clientWsClosed = true;
        }
    }, 15000);

    // --- 消息转发: Client -> RDP ---
    ws.on('message', (message: RawData, isBinary: boolean) => {
        const messageText = isBinary ? null : message.toString();
        // guacamole-lite uses the encrypted URL token to perform its own guacd
        // handshake. Forwarding the browser tunnel's connect instruction starts
        // a second handshake and leaves the client stuck in WAITING.
        if (messageText && /^(?:\d+\.)?connect[,;]/.test(messageText)) {
            console.log(`[RDP 代理 C->S] 已过滤浏览器重复 connect 指令。用户: ${ws.username}`);
            return;
        }

        if (rdpWs.readyState === WebSocket.OPEN) {
            rdpWs.send(message, { binary: isBinary });
        } else if (rdpWs.readyState === WebSocket.CONNECTING) {
            const size = Array.isArray(message)
                ? message.reduce((total, chunk) => total + chunk.byteLength, 0)
                : message.byteLength;
            if (pendingClientBytes + size > maxPendingClientBytes) {
                console.error(`[RDP 代理 C->S] 等待队列超过 ${maxPendingClientBytes} 字节，关闭连接。用户: ${ws.username}`);
                ws.close(1009, 'Remote desktop pending queue exceeded');
                clientWsClosed = true;
                return;
            }
            pendingClientMessages.push({ message, isBinary, size });
            pendingClientBytes += size;
        }
    });

    // --- 消息转发: RDP -> Client ---
    rdpWs.on('message', (message: RawData, isBinary: boolean) => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(message, { binary: isBinary });
        } else {
             console.warn(`[RDP 代理 S->C] 用户: ${ws.username}, 会话: ${ws.sessionId}, 客户端 WS 未打开，丢弃消息。`);
        }
    });

    // --- 错误处理 ---
    ws.on('error', (error) => {
        console.error(`[RDP 代理 客户端 WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 错误:`, error);
        if (!rdpWsClosed && rdpWs.readyState !== WebSocket.CLOSED && rdpWs.readyState !== WebSocket.CLOSING) {
            console.log(`[RDP 代理] 因客户端 WS 错误关闭 RDP WS。会话: ${ws.sessionId}`);
            rdpWs.close(1011, 'Client WS Error');
            rdpWsClosed = true;
        }
        clientWsClosed = true;
    });
    rdpWs.on('error', (error) => {
         clearTimeout(connectTimeout);
         console.error(`[RDP 代理 RDP WS 错误] 用户: ${ws.username}, 会话: ${ws.sessionId}, 连接到 ${safeRemoteDesktopTargetUrl} 时出错:`, error);
         if (!clientWsClosed && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
            console.log(`[RDP 代理] 因 RDP WS 错误关闭客户端 WS。会话: ${ws.sessionId}`);
            ws.close(1011, `RDP WS Error: ${error.message}`);
            clientWsClosed = true;
        }
        rdpWsClosed = true;
    });

    // --- 关闭处理 ---
    ws.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        clientWsClosed = true;
        console.log(`[RDP 代理 客户端 WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 代码: ${code}, 原因: ${reason.toString()}`);
        if (!rdpWsClosed && rdpWs.readyState !== WebSocket.CLOSED && rdpWs.readyState !== WebSocket.CLOSING) {
            console.log(`[RDP 代理] 因客户端 WS 关闭而关闭 RDP WS。会话: ${ws.sessionId}`);
            rdpWs.close(1000, 'Client WS Closed');
            rdpWsClosed = true;
        }
    });
    rdpWs.on('close', (code, reason) => {
        clearTimeout(connectTimeout);
        rdpWsClosed = true;
         console.log(`[RDP 代理 RDP WS 关闭] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${safeRemoteDesktopTargetUrl} 的连接已关闭。代码: ${code}, 原因: ${reason.toString()}`);
        if (!clientWsClosed && ws.readyState !== WebSocket.CLOSED && ws.readyState !== WebSocket.CLOSING) {
            console.log(`[RDP 代理] 因 RDP WS 关闭而关闭客户端 WS。会话: ${ws.sessionId}`);
            ws.close(1000, 'RDP WS Closed');
            clientWsClosed = true;
        }
    });

    rdpWs.on('open', () => {
         clearTimeout(connectTimeout);
         console.log(`[RDP 代理 RDP WS 打开] 用户: ${ws.username}, 会话: ${ws.sessionId}, 到 ${safeRemoteDesktopTargetUrl} 的连接已建立。开始转发消息。`);
         for (const pending of pendingClientMessages.splice(0)) {
             if (rdpWs.readyState !== WebSocket.OPEN) break;
             rdpWs.send(pending.message, { binary: pending.isBinary });
             pendingClientBytes -= pending.size;
         }
    });
}
