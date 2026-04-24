/**
 * 安全配置常量
 * 集中管理所有安全相关的超时时间和配置值
 */

// 构建 WebSocket 允许的 Origin 白名单
// 默认包含开发环境地址，支持通过环境变量添加生产域名
const buildAllowedWsOrigins = (): string[] => {
  const defaultOrigins = [
    'http://localhost:5173', // 开发环境前端
    'http://localhost:3001', // 开发环境后端
    'http://localhost:18111', // Docker 部署端口
  ];

  // 从环境变量 ALLOWED_WS_ORIGINS 读取额外域名（逗号分隔）
  // 例如: ALLOWED_WS_ORIGINS=https://ssh.cosr.eu,https://example.com
  const envOrigins = process.env.ALLOWED_WS_ORIGINS;
  if (envOrigins) {
    const additionalOrigins = envOrigins
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    defaultOrigins.push(...additionalOrigins);
  }

  // 如果设置了 RP_ORIGIN（Passkey 配置），也自动添加到白名单
  // 支持逗号分隔的多域名配置
  const rpOrigins = process.env.RP_ORIGIN
    ? process.env.RP_ORIGIN.split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

  for (const rpOrigin of rpOrigins) {
    if (!defaultOrigins.includes(rpOrigin)) {
      defaultOrigins.push(rpOrigin);
    }
  }

  return defaultOrigins;
};

/** 从环境变量解析整数，无效值回退到默认值，支持最小/最大值约束 */
const intFromEnv = (key: string, fallback: number, min?: number, max?: number): number => {
  const raw = process.env[key];
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  let result = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  if (min !== undefined && result < min) result = min;
  if (max !== undefined && result > max) result = max;
  return result;
};

export const SECURITY_CONFIG = {
  // WebAuthn Challenge 超时（默认 5 分钟，可通过 CHALLENGE_TIMEOUT_MS 环境变量覆盖）
  CHALLENGE_TIMEOUT: intFromEnv('CHALLENGE_TIMEOUT_MS', 300_000, 1000),

  // 2FA 临时认证超时（默认 5 分钟，可通过 PENDING_AUTH_TIMEOUT_MS 环境变量覆盖）
  PENDING_AUTH_TIMEOUT: intFromEnv('PENDING_AUTH_TIMEOUT_MS', 300_000, 1000),

  // 临时令牌长度 (32 字节)
  TEMP_TOKEN_LENGTH: 32,

  // Session Cookie 最大存活时间（默认 30 天，可通过 SESSION_MAX_AGE_DAYS 环境变量覆盖）
  // 与 Session Store TTL (packages/backend/src/index.ts:319) 保持一致
  SESSION_COOKIE_MAX_AGE: intFromEnv('SESSION_MAX_AGE_DAYS', 30, 1) * 24 * 60 * 60 * 1000,

  // bcrypt 盐轮次（默认 12，可通过 BCRYPT_SALT_ROUNDS 环境变量覆盖，2025年推荐值：12-14）
  BCRYPT_SALT_ROUNDS: intFromEnv('BCRYPT_SALT_ROUNDS', 12, 12, 15),

  // WebSocket 允许的 Origin 白名单 (CSWSH 防护)
  // 支持通过环境变量配置：ALLOWED_WS_ORIGINS 或 RP_ORIGIN
  ALLOWED_WS_ORIGINS: buildAllowedWsOrigins(),
} as const;

// 类型导出
export type SecurityConfig = typeof SECURITY_CONFIG;
