import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs'; // fs is needed for early env loading if data/.env is checked

import express = require('express');
import { Request, Response, RequestHandler } from 'express';
import http from 'http';

import crypto from 'crypto';

import session from 'express-session';
import sessionFileStore from 'session-file-store';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import cors from 'cors';
import { settingsService } from './settings/settings.service';
import {
  installConsoleLogging,
  setLogLevel as setRuntimeLogLevel,
  type LogLevel,
} from './logging/logger';
import { logger, setLogLevel as setPinoLogLevel } from './utils/logger';
import { getDbInstance } from './database/connection';
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
import sshKeysRouter from './ssh-keys/ssh-keys.routes';
import quickCommandTagRoutes from './quick-command-tags/quick-command-tag.routes';
import sshSuspendRouter from './ssh-suspend/ssh-suspend.routes';
import { transfersRoutes } from './transfers/transfers.routes';
import pathHistoryRoutes from './path-history/path-history.routes';
import favoritePathsRouter from './favorite-paths/favorite-paths.routes';
import batchRoutes from './batch/batch.routes';
import aiRoutes from './ai-ops/ai.routes';
import dashboardRoutes from './services/dashboard.routes';
import metricsRoutes from './metrics/metrics.routes';
import { metricsMiddleware } from './metrics/metrics.middleware';
import { initializeWebSocket } from './websocket';
import { ipWhitelistMiddleware } from './auth/ipWhitelist.middleware';
import { errorHandler, notFoundHandler } from './middleware/error.middleware';
import {
  validateEnvironment,
  printEnvironmentConfig,
  EnvironmentValidationError,
} from './config/env.validator';
import { config, getPasskeyRelatedOriginsForRpId } from './config/app.config';
import { getHostnameFromHostHeader, getSingleHeaderToken, normalizeOrigin } from './utils/url';

import './services/event.service';
import './notifications/notification.processor.service';
import './notifications/notification.dispatcher.service';

type SwaggerConfigModule = typeof import('./config/swagger.config');

// 统一安装 console 时间戳前缀 + 日志等级过滤（尽量早执行）
installConsoleLogging();

// --- 开始环境变量的早期加载 ---
// 1. 加载根目录的 .env 文件 (定义部署模式等)
// 注意: __dirname 在 dist/src 中，所以需要回退三级到项目根目录
const projectRootEnvPath = path.resolve(__dirname, '../../../.env');
const rootConfigResult = dotenv.config({ path: projectRootEnvPath });

if (rootConfigResult.error && (rootConfigResult.error as NodeJS.ErrnoException).code !== 'ENOENT') {
  logger.warn(
    `[ENV Init Early] Warning: Could not load root .env file from ${projectRootEnvPath}. Error: ${rootConfigResult.error.message}`
  );
} else if (!rootConfigResult.error) {
  logger.debug(
    `[ENV Init Early] Loaded environment variables from root .env file: ${projectRootEnvPath}`
  );
} else {
  logger.debug(
    `[ENV Init Early] Root .env file not found at ${projectRootEnvPath}, proceeding without it.`
  );
}

// 2. 加载 data/.env 文件 (定义密钥等)
// 注意: 这个路径是相对于编译后的 dist/src/index.js
const dataEnvPathGlobal = path.resolve(__dirname, '../data/.env'); // Renamed to avoid conflict if 'dataEnvPath' is used later
const dataConfigResultGlobal = dotenv.config({ path: dataEnvPathGlobal }); // Renamed

if (
  dataConfigResultGlobal.error &&
  (dataConfigResultGlobal.error as NodeJS.ErrnoException).code !== 'ENOENT'
) {
  logger.warn(
    `[ENV Init Early] Warning: Could not load data .env file from ${dataEnvPathGlobal}. Error: ${dataConfigResultGlobal.error.message}`
  );
} else if (!dataConfigResultGlobal.error) {
  logger.debug(
    `[ENV Init Early] Loaded environment variables from data .env file: ${dataEnvPathGlobal}`
  );
}

// --- 全局错误处理 ---
// 捕获未处理的 Promise Rejection
process.on('unhandledRejection', (reason: unknown, _promise: Promise<unknown>) => {
  logger.error('---未处理的 Promise Rejection---');
  logger.error({ err: reason as Error }, '原因:');
});

// 捕获未捕获的同步异常
process.on('uncaughtException', (error: Error) => {
  logger.error('---未捕获的异常---');
  logger.error(error, '错误:');
});

const initializeEnvironment = async () => {
  const dataEnvPath = dataEnvPathGlobal;
  let keysGenerated = false;
  let keysToAppend = '';

  // 检查 ENCRYPTION_KEY (process.env should be populated by early loading)
  if (!process.env.ENCRYPTION_KEY) {
    logger.info('[ENV Init] ENCRYPTION_KEY 未设置，正在生成...');
    const newEncryptionKey = crypto.randomBytes(32).toString('hex');
    process.env.ENCRYPTION_KEY = newEncryptionKey; // 更新当前进程环境
    keysToAppend += `\nENCRYPTION_KEY=${newEncryptionKey}`;
    keysGenerated = true;
  }

  // 3. 检查 SESSION_SECRET
  if (!process.env.SESSION_SECRET) {
    logger.info('[ENV Init] SESSION_SECRET 未设置，正在生成...');
    const newSessionSecret = crypto.randomBytes(64).toString('hex');
    process.env.SESSION_SECRET = newSessionSecret; // 更新当前进程环境
    keysToAppend += `\nSESSION_SECRET=${newSessionSecret}`;
    keysGenerated = true;
  }

  // 4. 检查 GUACD_HOST 和 GUACD_PORT
  if (!process.env.GUACD_HOST) {
    logger.warn('[ENV Init] GUACD_HOST 未设置，将使用默认值 "localhost"');
    process.env.GUACD_HOST = 'localhost';
  }
  if (!process.env.GUACD_PORT) {
    logger.warn('[ENV Init] GUACD_PORT 未设置，将使用默认值 "4822"');
    process.env.GUACD_PORT = '4822';
  }

  // 5. 如果生成了新密钥或添加了默认值，则追加到 .env 文件
  if (keysGenerated) {
    try {
      // 确保追加前有换行符 (如果文件非空) - Use dataEnvPath here
      let prefix = '';
      if (fs.existsSync(dataEnvPath)) {
        // Use dataEnvPath
        const content = fs.readFileSync(dataEnvPath, 'utf-8'); // Use dataEnvPath
        if (content.trim().length > 0 && !content.endsWith('\n')) {
          prefix = '\n';
        }
      }
      fs.appendFileSync(dataEnvPath, prefix + keysToAppend.trim()); // Use dataEnvPath, trim() 移除开头的换行符
      logger.warn(`[ENV Init] 已自动生成密钥并保存到 ${dataEnvPath}`); // Use dataEnvPath
      logger.warn('[ENV Init] !!! 重要：请务必备份此 data/.env 文件，并在生产环境中妥善保管 !!!');
    } catch (error) {
      logger.error({ err: error as Error }, `[ENV Init] 无法写入密钥到 ${dataEnvPath}`); // Use dataEnvPath
      logger.error('[ENV Init] 请检查文件权限或手动创建 data/.env 文件并添加生成的密钥。');
      // 即使写入失败，密钥已在 process.env 中，程序可以继续运行本次
    }
  }

  // 5. 生产环境最终检查 (虽然理论上已被覆盖，但作为保险)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      logger.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      logger.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
  }

  // 6. 最终检查 (包括 Guacamole 相关)
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.ENCRYPTION_KEY) {
      logger.error('错误：生产环境中 ENCRYPTION_KEY 最终未能设置！');
      process.exit(1);
    }
    if (!process.env.SESSION_SECRET) {
      logger.error('错误：生产环境中 SESSION_SECRET 最终未能设置！');
      process.exit(1);
    }
    // Guacd host/port are less critical to halt on, defaults might work
  }
};
// --- 结束环境变量和密钥初始化 ---

// 基础 Express 应用设置
const app = express();
const server = http.createServer(app);

// --- 信任代理设置 ---
// 仅在生产环境启用（通常在反向代理如 Nginx 后运行）
// 使用明确的 hop 数而非 boolean true，以限制可信代理层级
// 默认不信任任何代理，避免在未显式配置时信任 X-Forwarded-* 头
// 可通过 TRUST_PROXY / TRUST_PROXY_HOPS 环境变量显式启用
const trustProxyEnv = process.env.TRUST_PROXY;
let trustProxyValue: number | boolean | string = false;

if (trustProxyEnv) {
  if (trustProxyEnv.toLowerCase() === 'true') trustProxyValue = true;
  else if (trustProxyEnv.toLowerCase() === 'false') trustProxyValue = false;
  else {
    const parsed = parseInt(trustProxyEnv, 10);
    trustProxyValue = Number.isNaN(parsed) ? trustProxyEnv : parsed;
  }
} else if (process.env.TRUST_PROXY_HOPS) {
  const parsedHops = parseInt(process.env.TRUST_PROXY_HOPS, 10);
  if (!Number.isNaN(parsedHops)) {
    trustProxyValue = parsedHops;
  }
}

app.set('trust proxy', trustProxyValue);

// --- 安全中间件 ---
// 1. Helmet - 设置 HTTP 安全头
app.use(
  helmet({
    contentSecurityPolicy: false, // 由前端处理 CSP
    crossOriginEmbedderPolicy: false, // 允许跨域资源
  })
);

// 2. CORS - 跨域资源共享配置
const baseAllowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
      .map((o) => o.trim())
      .filter(Boolean)
  : ['http://localhost:5173', 'http://localhost:18111'];

const rpConfiguredOrigins = process.env.RP_ORIGIN
  ? process.env.RP_ORIGIN.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  : [];

const allowedOrigins = Array.from(
  new Set(
    [...baseAllowedOrigins, ...rpConfiguredOrigins]
      .map((origin) => normalizeOrigin(origin) || origin)
      .filter(Boolean)
  )
);

app.use(
  cors({
    origin: (origin, callback) => {
      // 允许没有 origin 的请求（如 Postman、curl）
      if (!origin) return callback(null, true);
      const normalizedOrigin = normalizeOrigin(origin) || origin;
      if (allowedOrigins.includes(normalizedOrigin)) {
        return callback(null, true);
      }
      // 返回 false 触发 CORS 错误（403），而非 Error（500）
      return callback(null, false);
    },
    credentials: true, // 允许携带 Cookie
  })
);

// 3. Rate Limiting - 限流配置
// 认证相关端点的精细化限流已在 auth.routes.ts 中配置（见 src/config/rate-limit.config.ts）

const parsePositiveIntEnv = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const getRateLimitKey = (req: Request) => {
  // 优先按登录用户限流，避免在 Cloudflare/Nginx 等代理场景下多个用户共享同一出口 IP 造成误伤。
  if (req.session?.userId) return `uid:${req.session.userId}`;
  // 使用 express-rate-limit 内置的 IP key 生成器，自动处理 IPv6 归一化，避免绕过限流。
  // 注意：ipKeyGenerator 的入参是 IP 字符串（推荐传 req.ip）。
  return ipKeyGenerator(req.ip || 'unknown');
};

// 一般 API 宽松限流
const apiLimiterWindowMs = parsePositiveIntEnv(
  process.env.API_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const apiLimiterMax = parsePositiveIntEnv(process.env.API_RATE_LIMIT_MAX, 300);
const apiLimiter = rateLimit({
  windowMs: apiLimiterWindowMs,
  max: apiLimiterMax,
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

// 设置相关接口限流（相对更宽松，避免设置页初始化触发多接口请求导致 429）
const settingsLimiterWindowMs = parsePositiveIntEnv(
  process.env.SETTINGS_RATE_LIMIT_WINDOW_MS,
  15 * 60 * 1000
);
const settingsLimiterMax = parsePositiveIntEnv(process.env.SETTINGS_RATE_LIMIT_MAX, 500);
const settingsLimiter = rateLimit({
  windowMs: settingsLimiterWindowMs,
  max: settingsLimiterMax,
  message: '请求过于频繁，请稍后再试',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: getRateLimitKey,
});

// --- 其他中间件 ---
app.use(ipWhitelistMiddleware as RequestHandler);
app.use(express.json({ limit: '1mb' }));

// --- Prometheus 指标采集中间件（在路由之前，采集所有 HTTP 请求延迟） ---
app.use(metricsMiddleware as RequestHandler);

// --- 安全响应头中间件（在路由之前设置） ---
app.use((_req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; font-src 'self' data:"
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// --- 静态文件服务 ---
const uploadsPath = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsPath)) {
  // 确保 uploads 目录存在
  fs.mkdirSync(uploadsPath, { recursive: true });
}
// app.use('/uploads', express.static(uploadsPath)); // 不再需要，文件通过 API 提供

// 扩展 Express Request 类型
declare module 'express-session' {
  interface SessionData {
    userId?: number;
    username?: string;
  }
}

const port = process.env.PORT || 3001;

const resolvePasskeyRpIdFromHost = (host: string): string | undefined => {
  const normalizedHost = getHostnameFromHostHeader(host);
  if (!normalizedHost) {
    return undefined;
  }

  const directRpIdMatch = config.passkeyRpConfigs.find((item) => item.rpId === normalizedHost);
  if (directRpIdMatch) {
    return directRpIdMatch.rpId;
  }

  const originHostMatch = config.passkeyRpConfigs.find(
    (item) => item.rpOriginHostname === normalizedHost
  );

  return originHostMatch?.rpId;
};

// 初始化数据库
const initializeDatabase = async () => {
  try {
    const db = await getDbInstance();
    logger.debug('[Index] 正在检查用户数量...');
    const userCount = await new Promise<number>((resolve, reject) => {
      db.get('SELECT COUNT(*) as count FROM users', (err: Error | null, row: { count: number }) => {
        if (err) {
          logger.error(err, '检查 users 表时出错');
          return reject(err);
        }
        resolve(row.count);
      });
    });
    logger.debug(`[Index] 用户数量检查完成。找到 ${userCount} 个用户。`);
  } catch (error) {
    logger.error(error as Error, '数据库初始化或检查失败');
    process.exit(1);
  }
};

// 尝试从数据库设置中加载日志等级（用于重启后保持一致）
const initializeRuntimeLogLevel = async () => {
  try {
    const level = await settingsService.getLogLevel();
    setRuntimeLogLevel(level as LogLevel);
    setPinoLogLevel(level);
  } catch (error) {
    logger.warn(error as Error, '[Index] 初始化日志等级失败，将使用默认日志等级。');
  }
};

// 启动服务器
const startServer = () => {
  // --- 会话中间件配置 ---
  const FileStore = sessionFileStore(session);
  // 修改路径以匹配 Docker volume 挂载点 /app/data
  const sessionsPath = path.join('/app/data', 'sessions');
  if (!fs.existsSync(sessionsPath)) {
    fs.mkdirSync(sessionsPath, { recursive: true });
  }

  const isProd = process.env.NODE_ENV === 'production';
  const thirtyDaysInSeconds = 30 * 24 * 60 * 60; // 30 天（秒）
  const thirtyDaysInMs = thirtyDaysInSeconds * 1000; // 30 天（毫秒）

  const sessionMiddleware = session({
    store: new FileStore({
      path: sessionsPath,
      ttl: thirtyDaysInSeconds, // 30 天
      // logFn: console.log // 可选：启用详细日志
    }),
    // 直接从 process.env 读取，initializeEnvironment 已确保其存在
    secret: process.env.SESSION_SECRET as string,
    resave: false,
    saveUninitialized: false,
    proxy: true, // 信任反向代理设置的 X-Forwarded-Proto 头
    cookie: {
      httpOnly: true,
      secure: isProd, // 生产环境强制 HTTPS
      sameSite: 'lax', // 防止 CSRF 攻击
      maxAge: thirtyDaysInMs, // 30 天有效期
    },
  });
  app.use(sessionMiddleware);
  // --- 结束会话中间件配置 ---

  // --- WebAuthn Related Origins (.well-known/webauthn) ---
  app.get('/.well-known/webauthn', (req: Request, res: Response) => {
    const host = getSingleHeaderToken(req.get('host'));

    if (!host) {
      res.status(400).json({ origins: [] });
      return;
    }

    const rpId = resolvePasskeyRpIdFromHost(host);
    if (!rpId) {
      res.status(404).json({ origins: [] });
      return;
    }

    const origins = getPasskeyRelatedOriginsForRpId(rpId);

    res.setHeader('Cache-Control', 'public, max-age=300');
    res.status(200).json({ origins });
  });

  // --- OpenAPI/Swagger 文档路由（工具链：API 文档） ---
  // 仅在非生产环境启用 Swagger 文档，避免暴露 API 结构
  if (!isProd) {
    try {
      // eslint-disable-next-line global-require, import/no-extraneous-dependencies
      const swaggerUi = require('swagger-ui-express') as typeof import('swagger-ui-express');
      // eslint-disable-next-line global-require
      const swaggerConfig = require('./config/swagger.config') as SwaggerConfigModule;
      const { buildSwaggerSpec } = swaggerConfig;
      const swaggerSpec = buildSwaggerSpec();

      app.use('/api-docs', swaggerUi.serve);
      app.get(
        '/api-docs',
        swaggerUi.setup(swaggerSpec, {
          customCss: '.swagger-ui .topbar { display: none }',
          customSiteTitle: '星枢终端 API 文档',
        })
      );
      logger.info(`[Swagger] API 文档已启用: http://localhost:${port}/api-docs`);
    } catch (error) {
      logger.warn(error as Error, '[Swagger] 文档依赖未安装，已跳过 /api-docs 挂载。');
    }
  } else {
    logger.info('[Swagger] 生产环境已禁用 API 文档');
  }
  // --- 结束 Swagger 文档路由 ---

  // --- 应用 API 路由 ---
  // 认证路由（限流策略已在 auth.routes.ts 中精细化配置）
  app.use('/api/v1/auth', authRouter);

  // 一般 API 路由（宽松限流）
  app.use('/api/v1/connections', apiLimiter, connectionsRouter);
  app.use('/api/v1/sftp', apiLimiter, sftpRouter);
  app.use('/api/v1/proxies', apiLimiter, proxyRoutes);
  app.use('/api/v1/tags', apiLimiter, tagsRouter);
  app.use('/api/v1/settings', settingsLimiter, settingsRoutes);
  app.use('/api/v1/notifications', apiLimiter, notificationRoutes);
  app.use('/api/v1/audit-logs', apiLimiter, auditRoutes);
  app.use('/api/v1/command-history', apiLimiter, commandHistoryRoutes);
  app.use('/api/v1/quick-commands', apiLimiter, quickCommandsRoutes);
  app.use('/api/v1/terminal-themes', apiLimiter, terminalThemeRoutes);
  app.use('/api/v1/appearance', apiLimiter, appearanceRoutes);
  app.use('/api/v1/ssh-keys', apiLimiter, sshKeysRouter);
  app.use('/api/v1/quick-command-tags', apiLimiter, quickCommandTagRoutes);
  app.use('/api/v1/ssh-suspend', apiLimiter, sshSuspendRouter);
  app.use('/api/v1/transfers', apiLimiter, transfersRoutes());
  app.use('/api/v1/path-history', apiLimiter, pathHistoryRoutes);
  app.use('/api/v1/favorite-paths', apiLimiter, favoritePathsRouter);
  app.use('/api/v1/batch', apiLimiter, batchRoutes);
  app.use('/api/v1/ai', apiLimiter, aiRoutes);
  app.use('/api/v1/dashboard', apiLimiter, dashboardRoutes);

  // Prometheus 指标端点（受 ENABLE_METRICS 环境变量控制，默认关闭，避免公网暴露）
  if (process.env.ENABLE_METRICS === 'true') {
    app.use('/api/v1/metrics', metricsRoutes);
  }

  // 健康检查接口（供 Docker healthcheck 与负载均衡器使用）
  app.get('/api/v1/health', async (_req: Request, res: Response) => {
    const startTime = Date.now();
    const checks: {
      database: 'ok' | 'fail';
      uptime: number;
      memory: { used: number; total: number };
    } = {
      database: 'fail',
      uptime: process.uptime(),
      memory: {
        used: process.memoryUsage().heapUsed,
        total: process.memoryUsage().heapTotal,
      },
    };

    // 检测 SQLite 连接可用性
    try {
      const db = await getDbInstance();
      await new Promise<void>((resolve, reject) => {
        db.get('SELECT 1', (err: Error | null) => {
          if (err) reject(err);
          else resolve();
        });
      });
      checks.database = 'ok';
    } catch {
      checks.database = 'fail';
    }

    const isHealthy = checks.database === 'ok';
    const status = isHealthy ? 'healthy' : 'unhealthy';

    res.status(isHealthy ? 200 : 503).json({
      status,
      checks,
      timestamp: new Date().toISOString(),
      responseTime: Date.now() - startTime,
    });
  });
  // --- 结束 API 路由 ---

  // --- P1-6: 全局错误处理中间件（必须在所有路由之后） ---
  app.use(notFoundHandler); // 404 处理
  app.use(errorHandler); // 错误处理
  // --- 结束错误处理中间件 ---

  server.listen(port, () => {
    logger.info(`后端服务器正在监听 http://localhost:${port}`);
    initializeWebSocket(server, sessionMiddleware as RequestHandler); // Initialize existing WebSocket
  });
};

// --- 主程序启动流程 ---
const main = async () => {
  await initializeEnvironment(); // 首先初始化环境和密钥

  // 验证环境变量
  try {
    const envConfig = validateEnvironment();
    printEnvironmentConfig(envConfig);
  } catch (error) {
    if (error instanceof EnvironmentValidationError) {
      logger.error('[ENV Validator] 环境变量验证失败:');
      error.errors.forEach((err) => logger.error(`  - ${err}`));
      process.exit(1);
    }
    throw error;
  }

  await initializeDatabase(); // 然后初始化数据库
  await initializeRuntimeLogLevel(); // 再从设置中初始化运行时日志等级
  startServer(); // 最后启动服务器
};

main().catch((error) => {
  logger.error(error, '启动过程中发生未处理的错误');
  process.exit(1);
});
