import GuacamoleLite from 'guacamole-lite';
import http from 'http';
import crypto from 'crypto';
import { createRemoteGatewayApiApp } from './api';

// --- 配置 ---
const REMOTE_GATEWAY_WS_PORT = process.env.REMOTE_GATEWAY_WS_PORT || 8080; // 统一端口，或按需分开
const REMOTE_GATEWAY_API_PORT = process.env.REMOTE_GATEWAY_API_PORT || 9090;
const GUACD_HOST = process.env.GUACD_HOST || 'localhost';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:3001';

// CORS 配置：支持环境变量配置额外的允许来源（逗号分隔）
const CORS_ALLOWED_ORIGINS = process.env.CORS_ALLOWED_ORIGINS || '';
const CORS_ALLOW_ALL = process.env.CORS_ALLOW_ALL === 'true'; // 开发模式可设置为 true

// Remote Gateway API 访问令牌（可选但强烈推荐）
// 若设置 REMOTE_GATEWAY_API_TOKEN，则 /api/remote-desktop/token 必须携带请求头：
//   X-Remote-Gateway-Token: <REMOTE_GATEWAY_API_TOKEN>
const REMOTE_GATEWAY_API_TOKEN = (process.env.REMOTE_GATEWAY_API_TOKEN || '').trim();

// --- 启动时生成内存加密密钥 ---
console.info('[Remote Gateway] 正在为此会话生成新的内存加密密钥...');
const ENCRYPTION_KEY_STRING = crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
console.info('[Remote Gateway] 内存加密密钥已生成。');

// 构建 CORS 允许的来源列表
const allowedOrigins: string[] = [FRONTEND_URL, MAIN_BACKEND_URL];

// 添加环境变量中配置的额外来源
if (CORS_ALLOWED_ORIGINS) {
  const additionalOrigins = CORS_ALLOWED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  allowedOrigins.push(...additionalOrigins);
}

if (CORS_ALLOW_ALL) {
  console.info(`[Remote Gateway] ⚠️ CORS 允许所有来源（开发模式）`);
} else {
  console.info(`[Remote Gateway] CORS 允许的来源: ${allowedOrigins.join(', ')}`);
}

if (process.env.NODE_ENV === 'production' && !REMOTE_GATEWAY_API_TOKEN) {
  console.warn(
    '[Remote Gateway] ⚠️ REMOTE_GATEWAY_API_TOKEN 未设置：/api/remote-desktop/token 将不会进行额外鉴权（建议在生产环境配置共享令牌）'
  );
}

const app = createRemoteGatewayApiApp({
  encryptionKeyBuffer: ENCRYPTION_KEY_BUFFER,
  allowedOrigins,
  corsAllowAll: CORS_ALLOW_ALL,
  apiToken: REMOTE_GATEWAY_API_TOKEN,
});

const apiServer = http.createServer(app);

const guacdOptions = {
  host: GUACD_HOST,
  port: GUACD_PORT,
};

const websocketOptions = {
  port: REMOTE_GATEWAY_WS_PORT,
  host: '0.0.0.0', // 监听所有接口
};

const clientOptions = {
  crypt: {
    key: ENCRYPTION_KEY_BUFFER,
    cypher: 'aes-256-cbc',
  },
  // 默认连接设置将根据协议动态调整
  connectionDefaultSettings: {},
};

type UnknownEventHandler = (...args: unknown[]) => void;

interface GuacServerLike {
  on?: (event: string, handler: UnknownEventHandler) => void;
  close?: (callback: () => void) => void;
}

interface GuacClientLike {
  id?: string;
  on?: (event: string, handler: UnknownEventHandler) => void;
}

const isGuacClientLike = (value: unknown): value is GuacClientLike =>
  typeof value === 'object' && value !== null;

let guacServer: GuacServerLike | null = null;

try {
  console.info(
    `[Remote Gateway] 正在使用选项初始化 GuacamoleLite: WS 端口=${websocketOptions.port}, Guacd=${guacdOptions.host}:${guacdOptions.port}`
  );
  const server = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions) as GuacServerLike;
  guacServer = server;
  console.info(`[Remote Gateway] GuacamoleLite 初始化成功。`);

  if (server.on) {
    server.on('error', (error: unknown) => {
      console.error(`[Remote Gateway] GuacamoleLite 服务器错误:`, error);
    });
    server.on('connection', (client: unknown) => {
      const safeClient = isGuacClientLike(client) ? client : undefined;
      const clientId = typeof safeClient?.id === 'string' ? safeClient.id : '未知客户端ID';
      console.info(`[Remote Gateway] Guacd 连接事件触发。客户端 ID: ${clientId}`);

      if (safeClient && typeof safeClient.on === 'function') {
        safeClient.on('disconnect', (reason: unknown) => {
          const reasonText = typeof reason === 'string' ? reason : '未知';
          console.info(
            `[Remote Gateway] Guacd 连接断开。客户端 ID: ${clientId}, 原因: ${reasonText}`
          );
        });
        safeClient.on('error', (err: unknown) => {
          console.error(`[Remote Gateway] Guacd 客户端错误。客户端 ID: ${clientId}, 错误:`, err);
        });
      }
    });
  }
} catch (error) {
  console.error(`[Remote Gateway] 初始化 GuacamoleLite 失败:`, error);
  process.exit(1);
}

apiServer.listen(REMOTE_GATEWAY_API_PORT, () => {
  console.info(`[Remote Gateway] API 服务器正在监听端口 ${REMOTE_GATEWAY_API_PORT}`);
  console.info(
    `[Remote Gateway] Guacamole WebSocket 服务器应在端口 ${REMOTE_GATEWAY_WS_PORT} 上运行 (由 GuacamoleLite 管理)`
  );
});

const gracefulShutdown = (signal: string) => {
  console.info(`[Remote Gateway] 收到 ${signal} 信号。正在优雅地关闭...`);

  let guacClosed = false;
  let apiClosed = false;

  const tryExit = () => {
    if (guacClosed && apiClosed) {
      console.info('[Remote Gateway] 所有服务器已关闭。正在退出。');
      process.exit(0);
    }
  };

  apiServer.close((err) => {
    if (err) {
      console.error('[Remote Gateway] 关闭 API 服务器时出错:', err);
    } else {
      console.info('[Remote Gateway] API 服务器已关闭。');
    }
    apiClosed = true;
    tryExit();
  });

  if (typeof guacServer !== 'undefined' && guacServer && typeof guacServer.close === 'function') {
    console.info('[Remote Gateway] 正在关闭 Guacamole 服务器...');
    guacServer.close(() => {
      console.info('[Remote Gateway] Guacamole 服务器已关闭。');
      guacClosed = true;
      tryExit();
    });
  } else {
    console.info('[Remote Gateway] Guacamole 服务器未运行或不支持 close() 方法。');
    guacClosed = true;
    tryExit();
  }

  setTimeout(() => {
    console.error('[Remote Gateway] 关闭超时。强制退出。');
    process.exit(1);
  }, 10000); // 10 秒超时
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => {
  gracefulShutdown('SIGUSR2 (nodemon restart)');
});
