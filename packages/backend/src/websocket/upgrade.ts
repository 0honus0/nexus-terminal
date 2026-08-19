import http from 'http';
import url from 'url';
import express, { RequestHandler, Response } from 'express';
import { WebSocketServer } from 'ws';
import { AuthenticatedWebSocket, WebSocketRequest } from './types';
import ipaddr from 'ipaddr.js';
import { config } from '../config/app.config';
import { checkIpWhitelist } from '../auth/ipWhitelist.middleware';

const firstHeaderValue = (value: string | string[] | undefined): string | undefined => {
    const rawValue = Array.isArray(value) ? value[0] : value;
    return rawValue?.split(',').map(item => item.trim()).find(Boolean);
};

const isTrustedProxyAddress = (address: string | undefined): boolean => {
    if (!address) return false;
    try {
        const range = ipaddr.process(address).range();
        return ['loopback', 'private', 'linkLocal', 'uniqueLocal'].includes(range);
    } catch {
        return false;
    }
};

const resolveClientIp = (request: WebSocketRequest): string => {
    const remoteAddress = request.socket.remoteAddress;
    if (!isTrustedProxyAddress(remoteAddress)) return remoteAddress || 'unknown';
    return firstHeaderValue(request.headers['x-real-ip'])
        || firstHeaderValue(request.headers['x-forwarded-for'])
        || remoteAddress
        || 'unknown';
};

const isAllowedWebSocketOrigin = (request: WebSocketRequest): boolean => {
    const origin = firstHeaderValue(request.headers.origin);
    if (!origin) {
        return process.env.NODE_ENV !== 'production' || process.env.ALLOW_ORIGINLESS_WEBSOCKETS === 'true';
    }

    try {
        const normalizedOrigin = new URL(origin).origin;
        const configuredOrigins = new Set(config.passkeyRpConfigs.map(item => new URL(item.rpOrigin).origin));
        const host = firstHeaderValue(request.headers['x-forwarded-host']) || firstHeaderValue(request.headers.host);
        const protocol = firstHeaderValue(request.headers['x-forwarded-proto'])
            || ((request.socket as typeof request.socket & { encrypted?: boolean }).encrypted ? 'https' : 'http');
        if (host) configuredOrigins.add(new URL(`${protocol}://${host}`).origin);
        return configuredOrigins.has(normalizedOrigin);
    } catch {
        return false;
    }
};

export function initializeUpgradeHandler(
    server: http.Server,
    wss: WebSocketServer,
    sessionParser: RequestHandler
): void {
    server.on('upgrade', async (request: WebSocketRequest, socket, head) => {
        const parsedUrl = url.parse(request.url || '', true); // Parse URL and query string
        const pathname = parsedUrl.pathname;
        const allowedPaths = new Set(['/ws', '/ws/', '/ws/upload', '/ws/upload/', '/rdp-proxy', '/ws/rdp-proxy']);
        if (!pathname || !allowedPaths.has(pathname)) {
            socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
            socket.destroy();
            return;
        }

        if (!isAllowedWebSocketOrigin(request)) {
            console.warn(`WebSocket: 已拒绝来源不匹配的升级请求 (Path: ${pathname})。`);
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
            socket.destroy();
            return;
        }

        const ipAddress = resolveClientIp(request);
        const ipDecision = await checkIpWhitelist(ipAddress);
        if (!ipDecision.allowed) {
            console.warn(`WebSocket: 已拒绝来自 IP ${ipAddress} 的升级请求。`);
            socket.write(`HTTP/1.1 ${ipDecision.statusCode} Forbidden\r\n\r\n`);
            socket.destroy();
            return;
        }

        console.log(`WebSocket: 升级请求来自 IP: ${ipAddress}, Path: ${pathname}`);

        const sessionResponse: Response = Object.setPrototypeOf(new http.ServerResponse(request), express.response);
        sessionParser(request, sessionResponse, () => {
            // --- 认证检查 ---
            if (!request.session?.userId || !request.session.username || request.session.requiresTwoFactor === true) {
                console.log(`WebSocket 认证失败 (Path: ${pathname})：未找到会话或用户未登录。`);
                socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
                socket.destroy();
                return;
            }
            console.log(`WebSocket 认证成功 (Path: ${pathname})：用户 ${request.session.username} (ID: ${request.session.userId})`);

            // --- 根据路径处理升级 ---
            // 本地调试用/rdp-proxy，nginx反代用/ws/rdp-proxy
            if (pathname === '/rdp-proxy' || pathname === '/ws/rdp-proxy') {
                const { token, width, height, dpi } = parsedUrl.query;
                if (typeof token !== 'string' || typeof width !== 'string' || typeof height !== 'string' || (dpi !== undefined && typeof dpi !== 'string')) {
                    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                    socket.destroy();
                    return;
                }
                // RDP 代理路径 - 直接处理升级，连接逻辑在 'connection' 事件中处理
                console.log(`WebSocket: Handling RDP proxy upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    // 传递必要信息给 connection 事件
                    request.clientIpAddress = ipAddress;
                    request.isRdpProxy = true; // 标记为 RDP 代理连接
                    // 传递 RDP token 和其他参数
                    request.rdpToken = token;
                    request.rdpWidth = width;
                    request.rdpHeight = height;
                    request.rdpDpi = dpi;
                    wss.emit('connection', extWs, request);
                });
            } else if (pathname === '/ws/upload' || pathname === '/ws/upload/') {
                const uploadSessionId = typeof parsedUrl.query.sessionId === 'string'
                    ? parsedUrl.query.sessionId.trim()
                    : '';
                if (!/^[A-Za-z0-9_-]{8,128}$/.test(uploadSessionId)) {
                    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
                    socket.destroy();
                    return;
                }

                console.log(`WebSocket: Handling upload transport upgrade for user ${request.session.username}, session ${uploadSessionId}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    request.clientIpAddress = ipAddress;
                    request.isRdpProxy = false;
                    request.isUploadTransport = true;
                    request.uploadSessionId = uploadSessionId;
                    wss.emit('connection', extWs, request);
                });
            } else {
                // 默认路径 (SSH, SFTP, Docker etc.) - 按原逻辑处理
                console.log(`WebSocket: Handling standard upgrade for user ${request.session.username}`);
                wss.handleUpgrade(request, socket, head, (ws) => {
                    const extWs = ws as AuthenticatedWebSocket;
                    extWs.userId = request.session.userId;
                    extWs.username = request.session.username;
                    request.clientIpAddress = ipAddress;
                    request.isRdpProxy = false; // 标记为非 RDP 代理连接
                    request.isUploadTransport = false;
                    wss.emit('connection', extWs, request);
                });
            }
        });
    });
    console.log('WebSocket upgrade handler initialized.');
}
