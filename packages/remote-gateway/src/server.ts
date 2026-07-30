import GuacamoleLite from 'guacamole-lite';
import express, { Request, Response } from 'express';
import http from 'http';
import crypto from 'crypto';
import cors from 'cors';

// --- 配置 ---
const REMOTE_GATEWAY_WS_PORT = Number.parseInt(process.env.REMOTE_GATEWAY_WS_PORT || '8080', 10);
const REMOTE_GATEWAY_API_PORT = Number.parseInt(process.env.REMOTE_GATEWAY_API_PORT || '9090', 10);
const GUACD_HOST = process.env.GUACD_HOST || 'localhost';
const GUACD_PORT = parseInt(process.env.GUACD_PORT || '4822', 10);
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const MAIN_BACKEND_URL = process.env.MAIN_BACKEND_URL || 'http://localhost:3000';

for (const [name, port] of [
    ['REMOTE_GATEWAY_WS_PORT', REMOTE_GATEWAY_WS_PORT],
    ['REMOTE_GATEWAY_API_PORT', REMOTE_GATEWAY_API_PORT],
    ['GUACD_PORT', GUACD_PORT],
] as const) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`${name} 必须是 1 到 65535 之间的整数。`);
    }
}

// --- 启动时生成内存加密密钥 ---
console.log("[Remote Gateway] 正在为此会话生成新的内存加密密钥...");
const ENCRYPTION_KEY_STRING = crypto.randomBytes(32).toString('hex');
const ENCRYPTION_KEY_BUFFER = Buffer.from(ENCRYPTION_KEY_STRING, 'hex');
console.log("[Remote Gateway] 内存加密密钥已生成。");

// --- Express 应用设置 ---
const app = express();
app.use(express.json()); // 用于解析请求体中的 JSON
const apiServer = http.createServer(app);

const allowedOrigins = [
    FRONTEND_URL,
    MAIN_BACKEND_URL
];
console.log(`[Remote Gateway] CORS 允许的来源: ${allowedOrigins.join(', ')}`);
app.use(cors({ origin: allowedOrigins }));


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
        cypher: 'aes-256-cbc'
    },
    // 默认连接设置将根据协议动态调整
    connectionDefaultSettings: {},
};

let guacServer: GuacamoleLite | undefined;

try {
    console.log(`[Remote Gateway] 正在使用选项初始化 GuacamoleLite: WS 端口=${websocketOptions.port}, Guacd=${guacdOptions.host}:${guacdOptions.port}`);
    guacServer = new GuacamoleLite(websocketOptions, guacdOptions, clientOptions);
    console.log(`[Remote Gateway] GuacamoleLite 初始化成功。`);

    guacServer.on('open', (client) => {
        const clientId = client.connectionId || '未知客户端ID';
        console.log(`[Remote Gateway] Guacd 连接已建立。客户端 ID: ${clientId}, Guacamole ID: ${client.guacamoleConnectionId || '未知'}`);
    });
    guacServer.on('close', (client, error) => {
        const clientId = client.connectionId || '未知客户端ID';
        console.log(`[Remote Gateway] Guacd 连接已关闭。客户端 ID: ${clientId}, 原因: ${error?.message || '正常关闭'}`);
    });
    guacServer.on('error', (client, error) => {
        console.error(`[Remote Gateway] GuacamoleLite 客户端错误。客户端 ID: ${client.connectionId || '未知客户端ID'}:`, error);
    });
} catch (error) {
   console.error(`[Remote Gateway] 初始化 GuacamoleLite 失败:`, error);
   process.exit(1);
}

const encryptToken = (data: string, keyBuffer: Buffer): string => {
    try {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', keyBuffer, iv);
        let encrypted = cipher.update(data, 'utf8', 'base64');
        encrypted += cipher.final('base64');
        const output = {
            iv: iv.toString('base64'),
            value: encrypted
        };
        const jsonString = JSON.stringify(output);
        return Buffer.from(jsonString).toString('base64');
    } catch (e) {
        console.error("[Remote Gateway] 令牌加密失败:", e);
        throw new Error("令牌加密失败。");
    }
};

app.post('/api/remote-desktop/token', (req: Request, res: Response): void => {
    const { protocol, connectionConfig } = req.body;

    if (!protocol || !connectionConfig) {
        res.status(400).json({ error: '缺少必需的参数 (protocol, connectionConfig)' });
        return;
    }

    if (protocol !== 'rdp' && protocol !== 'vnc') {
        res.status(400).json({ error: '无效的协议类型。支持 "rdp" 或 "vnc"。' });
        return;
    }

    const { hostname, port, username, password, width, height, dpi, security, ignoreCert } = connectionConfig;

    if (!hostname || !port) {
        res.status(400).json({ error: '缺少必需的连接参数 (hostname, port)' });
        return;
    }

    const settings: Record<string, string> = {
        hostname: String(hostname),
        port: String(port),
        width: String(width || '1024'),
        height: String(height || '768'),
    };

    if (protocol === 'rdp') {
        if (typeof username === 'undefined' || typeof password === 'undefined') {
            res.status(400).json({ error: 'RDP 连接缺少 username 或 password' });
            return;
        }
        settings.username = String(username);
        settings.password = String(password);
        settings.security = String(security || 'any'); // RDP 特有，使用默认值 'any'
        settings['ignore-cert'] = String(ignoreCert ?? true); // RDP 特有
        settings.dpi = String(dpi || '96'); // RDP 特有
    } else if (protocol === 'vnc') {
        if (typeof password === 'undefined') {
            res.status(400).json({ error: 'VNC 连接缺少 password' });
            return;
        }
        settings.password = String(password);
        if (username) { // VNC 可选 username
            settings.username = String(username);
        }
        // VNC 特有的其他参数可以根据需要从 connectionConfig 中获取并添加
        // 例如: settings['enable-audio'] = connectionConfig.enableAudio || 'false';
    }

    const connectionParams = {
        connection: {
            type: protocol, // 'rdp' or 'vnc'
            settings: settings
        }
    };

    try {
        const tokenData = JSON.stringify(connectionParams);
        const encryptedToken = encryptToken(tokenData, ENCRYPTION_KEY_BUFFER);
        res.json({ token: encryptedToken });
    } catch (error) {
        console.error("[Remote Gateway] /api/remote-desktop/token 接口出错:", error);
        res.status(500).json({ error: '生成令牌失败' });
    }
});

apiServer.listen(REMOTE_GATEWAY_API_PORT, () => {
    console.log(`[Remote Gateway] API 服务器正在监听端口 ${REMOTE_GATEWAY_API_PORT}`);
    console.log(`[Remote Gateway] Guacamole WebSocket 服务器应在端口 ${REMOTE_GATEWAY_WS_PORT} 上运行 (由 GuacamoleLite 管理)`);
});

const gracefulShutdown = (signal: string) => {
    console.log(`[Remote Gateway] 收到 ${signal} 信号。正在优雅地关闭...`);

  let guacClosed = false;
  let apiClosed = false;

  const tryExit = () => {
    if (guacClosed && apiClosed) {
      console.log("[Remote Gateway] 所有服务器已关闭。正在退出。");
      process.exit(0);
    }
  };

  apiServer.close((err) => {
    if (err) {
        console.error("[Remote Gateway] 关闭 API 服务器时出错:", err);
    } else {
        console.log("[Remote Gateway] API 服务器已关闭。");
    }
    apiClosed = true;
    tryExit();
  });

  if (guacServer) {
    console.log("[Remote Gateway] 正在关闭 Guacamole 服务器...");
    guacServer.close();
    console.log("[Remote Gateway] Guacamole 服务器已关闭。");
    guacClosed = true;
    tryExit();
  } else {
    console.log("[Remote Gateway] Guacamole 服务器未运行或不支持 close() 方法。");
    guacClosed = true;
    tryExit();
  }

  setTimeout(() => {
    console.error("[Remote Gateway] 关闭超时。强制退出。");
    process.exit(1);
  }, 10000); // 10 秒超时
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGUSR2', () => {
    gracefulShutdown('SIGUSR2 (nodemon restart)');
});
