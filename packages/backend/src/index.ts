import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // fs is needed for early env loading if data/.env is checked

// --- 开始环境变量的早期加载 ---
// 1. 加载根目录的 .env 文件 (定义部署模式等)
// 注意: __dirname 在 dist/src 中，所以需要回退三级到项目根目录
const projectRootEnvPath = path.resolve(__dirname, '../../../.env');
const rootConfigResult = dotenv.config({ path: projectRootEnvPath });

if (rootConfigResult.error && (rootConfigResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  console.warn(
    `[ENV Init Early] Warning: Could not load root .env file from ${projectRootEnvPath}. Error: ${rootConfigResult.error.message}`,
  );
} else if (!rootConfigResult.error) {
  console.log(`[ENV Init Early] Loaded environment variables from root .env file: ${projectRootEnvPath}`);
} else {
  console.log(`[ENV Init Early] Root .env file not found at ${projectRootEnvPath}, proceeding without it.`);
}

// 2. 加载 data/.env 文件 (定义密钥等)
// 注意: 这个路径是相对于编译后的 dist/src/index.js
const dataDirGlobal = process.env.NEXUS_DATA_DIR
  ? path.resolve(process.env.NEXUS_DATA_DIR)
  : path.resolve(__dirname, '../data');
const dataEnvPathGlobal = path.join(dataDirGlobal, '.env');
const dataConfigResultGlobal = dotenv.config({ path: dataEnvPathGlobal }); // Renamed

if (dataConfigResultGlobal.error && (dataConfigResultGlobal.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  console.warn(
    `[ENV Init Early] Warning: Could not load data .env file from ${dataEnvPathGlobal}. Error: ${dataConfigResultGlobal.error.message}`,
  );
} else if (!dataConfigResultGlobal.error) {
  console.log(`[ENV Init Early] Loaded environment variables from data .env file: ${dataEnvPathGlobal}`);
}

import express = require('express');
import { Request, Response, NextFunction, RequestHandler } from 'express';
import http from 'http';

import crypto from 'crypto';

import session from 'express-session';
import sessionFileStore from 'session-file-store';
import { getDb, getDbInstance, resetDatabaseForE2E, type E2EDatabaseResetMode } from './database/connection';
import authRouter from './auth/auth.routes';
import connectionsRouter from './connections/connections.routes';
import sftpRouter from './sftp/sftp.routes';
import proxyRoutes from './proxies/proxies.routes';
import tagsRouter from './tags/tags.routes';
import settingsRoutes from './settings/settings.routes';
import notificationRoutes from './notifications/notification.routes';
import auditRoutes from './audit/audit.routes';
import commandHistoryRoutes from './command-history/command-history.routes';
import quickCommandsRoutes from './quick-commands/quick-commands.routes';
import terminalThemeRoutes from './terminal-themes/terminal-theme.routes';
import appearanceRoutes from './appearance/appearance.routes';
import sshKeysRouter from './ssh_keys/ssh_keys.routes';
import quickCommandTagRoutes from './quick-command-tags/quick-command-tag.routes';
import sshSuspendRouter from './ssh-suspend/ssh-suspend.routes';
import { transfersRoutes } from './transfers/transfers.routes';
import pathHistoryRoutes from './path-history/path-history.routes';
import favoritePathsRouter from './favorite-paths/favorite-paths.routes';
import systemRouter from './system/system.routes';
import { initializeWebSocket } from './websocket';
import { ipWhitelistMiddleware } from './auth/ipWhitelist.middleware';
import { config, getPasskeyRelatedOriginsForRpId } from './config/app.config';

import './services/event.service';
import './notifications/notification.processor.service';
import './notifications/notification.dispatcher.service';

// --- 全局错误处理 ---
// 捕获未处理的 Promise Rejection
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('---未处理的 Promise Rejection---');
  console.error('原因:', reason);
});

// 捕获未捕获的同步异常
process.on('uncaughtException', (error: Error) => {
  console.error('---未捕获的异常---');
  console.error('错误:', error);
});

const initializeEnvironment = async () => {
  const dataEnvPath = dataEnvPathGlobal;
  fs.mkdirSync(dataDirGlobal, { recursive: true });
  let keysGenerated = false;
  let keysToAppend = '';

  // 检查 ENCRYPTION_KEY (process.env should be populated by early loading)
  if (!process.env.ENCRYPTION_KEY) {
    console.log('[ENV Init] ENCRYPTION_KEY 未设置，正在生成...');
    const newEncryptionKey = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = newEncryptionKey; // 更新当前进程环境
    keysToAppend += `\nENCRYPTION_KEY=${newEncryptionKey}`;
    keysGenerated = true;
  }

  // 3. 检查 SESSION_SECRET
  if (!process.env.SESSION_SECRET) {
    console.log('[ENV Init] SESSION_SECRET 未设置，正在生成...');
    const newSessionSecret = crypto.randomBytes(64).toString('hex');
    process.env.SESSION_SECRET = newSessionSecret; // 更新当前进程环境
    keysToAppend += `\nSESSION_SECRET=${newSessionSecret}`;
    keysGenerated = true;
  }

  if (!process.env.REMOTE_GATEWAY_SHARED_SECRET) {
    console.log('[ENV Init] REMOTE_GATEWAY_SHARED_SECRET 未设置，正在生成...');
    const newGatewaySecret = crypto.randomBytes(48).toString('hex');
    process.env.REMOTE_GATEWAY_SHARED_SECRET = newGatewaySecret;
    keysToAppend += `\nREMOTE_GATEWAY_SHARED_SECRET=${newGatewaySecret}`;
    keysGenerated = true;
  }

  // 4. 检查 GUACD_HOST 和 GUACD_PORT
  if (!process.env.GUACD_HOST) {
    console.warn('[ENV Init] GUACD_HOST 未设置，将使用默认值 "localhost"');
    process.env.GUACD_HOST = 'localhost';
  }
  if (!process.env.GUACD_PORT) {
    console.warn('[ENV Init] GUACD_PORT 未设置，将使用默认值 "4822"');
    process.env.GUACD_PORT = '4822';
  }

  // 5. 如果生成了新密钥或添加了默认值，则追加到 .env 文件
  if (keysGenerated) {
    try {
      fs.mkdirSync(path.dirname(dataEnvPath), { recursive: true, mode: 0o700 });
      // 确保追加前有换行符 (如果文件非空) - Use dataEnvPath here
      let prefix = '';
      if (fs.existsSync(dataEnvPath)) {
        // Use dataEnvPath
        const content = fs.readFileSync(dataEnvPath, 'utf-8'); // Use dataEnvPath
        if (content.trim().length > 0 && !content.endsWith('\n')) {
          prefix = '\n';
        }
      }
      fs.appendFileSync(dataEnvPath, prefix + keysToAppend.trim(), { mode: 0o600 }); // Use dataEnvPath, trim() 移除开头的换行符
      fs.chmodSync(dataEnvPath, 0o600);
      console.warn(`[ENV Init] 已自动生成密钥并保存到 ${dataEnvPath}`); // Use dataEnvPath
      console.warn('[ENV Init] !!! 重要：请务必备份此 data/.env 文件，并在生产环境中妥善保管 !!!');
    } catch (error) {
      console.error(`[ENV Init] 无法写入密钥到 ${dataEnvPath}:`, error); // Use dataEnvPath
      console.error('[ENV Init] 请检查文件权限或手动创建 data/.env 文件并添加生成的密钥。');
      // 即使写入失败，密钥已在 process.env 中，程序可以继续运行本次
    }
  }

  // 5. 生产环境最终检查 (虽然理论上已被覆盖，但作为保险)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      console.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      console.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.REMOTE_GATEWAY_SHARED_SECRET) {
      console.error('错误：生产环境中 REMOTE_GATEWAY_SHARED_SECRET 最终未能设置！');
      process.exit(1);
    }
  }

  // 6. 最终检查 (包括 Guacamole 相关)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      console.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      console.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
    // Guacd host/port are less critical to halt on, defaults might work
  }
};
// --- 结束环境变量和密钥初始化 ---

// 基础 Express 应用设置
const app = express();
const server = http.createServer(app);
server.requestTimeout = 30_000;
server.headersTimeout = 15_000;
server.keepAliveTimeout = 5_000;
server.maxHeadersCount = 100;

// 仅信任本机和私有网络中的反向代理；可通过 TRUST_PROXY 显式覆盖。
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
app.disable('x-powered-by');

// --- 中间件 ---
app.use(ipWhitelistMiddleware as RequestHandler);
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  next();
});
app.use(express.json({ limit: '1mb' }));

// --- 静态文件服务 ---
const uploadsPath = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsPath)) {
  // 确保 uploads 目录存在
  fs.mkdirSync(uploadsPath, { recursive: true });
}
// app.use('/uploads', express.static(uploadsPath)); // 不再需要，文件通过 API 提供

const port = process.env.PORT || 3001;

const getFirstHeaderValue = (value?: string | string[]): string | undefined => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return rawValue
    ?.split(',')
    .map((item) => item.trim())
    .find(Boolean);
};

const getHostname = (host: string): string | undefined => {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const resolvePasskeyRpIdFromHost = (host: string): string | undefined => {
  const hostname = getHostname(host);
  if (!hostname) return undefined;

  const directMatch = config.passkeyRpConfigs.find((item) => item.rpId === hostname);
  if (directMatch) return directMatch.rpId;

  return config.passkeyRpConfigs.find((item) => {
    try {
      return new URL(item.rpOrigin).hostname.toLowerCase() === hostname;
    } catch {
      return false;
    }
  })?.rpId;
};

// 初始化数据库
const initializeDatabase = async () => {
  try {
    const db = await getDbInstance();
    console.log('[Index] 正在检查用户数量...');
    const row = await getDb<{ count: number }>(db, 'SELECT COUNT(*) as count FROM users');
    const userCount = row?.count ?? 0;
    console.log(`[Index] 用户数量检查完成。找到 ${userCount} 个用户。`);
  } catch (error) {
    console.error('数据库初始化或检查失败:', error);
    process.exit(1);
  }
};

// 启动服务器
const startServer = () => {
  // --- 会话中间件配置 ---
  const FileStore = sessionFileStore(session);
  // dist/index.js 在容器中位于 /app/dist，本地位于 packages/backend/dist。
  // 使用相对运行目录可同时解析到 /app/data 和 packages/backend/data。
  const sessionsPath = path.join(dataDirGlobal, 'sessions');
  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
  }
  const sessionStore = new FileStore({
    path: sessionsPath,
    ttl: 30 * 24 * 60 * 60,
    // logFn: console.log // 可选：启用详细日志
  });
  const sessionMiddleware = session({
    store: sessionStore,
    // 直接从 process.env 读取，initializeEnvironment 已确保其存在
    name: process.env.SESSION_COOKIE_NAME || 'nexus.sid',
    secret: process.env.SESSION_SECRET as string,
    resave: false,
    saveUninitialized: false,
    proxy: true, // 信任反向代理设置的 X-Forwarded-Proto 头
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: 'auto',
    },
  });

  if (process.env.NODE_ENV === 'test' && process.env.NEXUS_E2E_RESET_ENABLED === '1') {
    app.post('/api/v1/__e2e/reset', async (req: Request, res: Response) => {
      const mode = req.body?.mode as E2EDatabaseResetMode | undefined;
      if (mode !== 'seed' && mode !== 'empty') {
        res.status(400).json({ message: 'mode must be "seed" or "empty".' });
        return;
      }

      try {
        await resetDatabaseForE2E(mode);
        if (!sessionStore.clear) {
          throw new Error('Session store does not support clear().');
        }
        const clearSessions = sessionStore.clear.bind(sessionStore);
        await new Promise<void>((resolve, reject) => {
          clearSessions((error?: unknown) => {
            if (error) reject(error);
            else resolve();
          });
        });
        res.status(204).end();
      } catch (error: any) {
        console.error('[E2E Reset] Failed to reset isolated test state:', error);
        res.status(500).json({ message: error?.message || 'E2E reset failed.' });
      }
    });
  }

  app.use(sessionMiddleware);
  // --- 结束会话中间件配置 ---

  // WebAuthn Related Origins：允许单个 RP_ID 在配置的多个域名间共享 Passkey。
  app.get('/.well-known/webauthn', (req: Request, res: Response) => {
    const host = getFirstHeaderValue(req.headers['x-forwarded-host']) || getFirstHeaderValue(req.headers.host);
    const rpId = host ? resolvePasskeyRpIdFromHost(host) : undefined;
    if (!rpId) {
      res.status(404).json({ origins: [] });
      return;
    }

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.json({ origins: getPasskeyRelatedOriginsForRpId(rpId) });
  });

  // --- 应用 API 路由 ---
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/connections', connectionsRouter);
  app.use('/api/v1/sftp', sftpRouter);
  app.use('/api/v1/proxies', proxyRoutes);
  app.use('/api/v1/tags', tagsRouter);
  app.use('/api/v1/settings', settingsRoutes);
  app.use('/api/v1/notifications', notificationRoutes);
  app.use('/api/v1/audit-logs', auditRoutes);
  app.use('/api/v1/command-history', commandHistoryRoutes);
  app.use('/api/v1/quick-commands', quickCommandsRoutes);
  app.use('/api/v1/terminal-themes', terminalThemeRoutes);
  app.use('/api/v1/appearance', appearanceRoutes);
  app.use('/api/v1/ssh-keys', sshKeysRouter);
  app.use('/api/v1/quick-command-tags', quickCommandTagRoutes);
  app.use('/api/v1/ssh-suspend', sshSuspendRouter);
  app.use('/api/v1/transfers', transfersRoutes());
  app.use('/api/v1/path-history', pathHistoryRoutes);
  app.use('/api/v1/favorite-paths', favoritePathsRouter);
  app.use('/api/v1/system', systemRouter);

  // 状态检查接口
  app.get('/api/v1/status', (req: Request, res: Response) => {
    res.json({ status: '后端服务运行中！' });
  });
  // --- 结束 API 路由 ---

  server.listen(port, () => {
    console.log(`后端服务器正在监听 http://localhost:${port}`);
    initializeWebSocket(server, sessionMiddleware as RequestHandler); // Initialize existing WebSocket
  });
};

// --- 主程序启动流程 ---
const main = async () => {
  await initializeEnvironment(); // 首先初始化环境和密钥
  await initializeDatabase(); // 然后初始化数据库
  startServer(); // 最后启动服务器
};

main().catch((error) => {
  console.error('启动过程中发生未处理的错误:', error);
  process.exit(1);
});
