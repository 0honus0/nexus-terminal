export interface PasskeyRelyingPartyConfig {
  rpId: string;
  origin: string;
}

export interface RuntimeConfig {
  appName: string;
  host: string;
  trustProxy: string;
  port: number;
  nodeEnv: string;
  dataDirectory: string;
  encryptionKeyHex: string;
  sessionSecret: string;
  sessionCookieName: string;
  remoteGatewaySharedSecret: string;
  remoteGatewayApiBase: string;
  remoteGatewayWsBaseUrl: string;
  allowOriginlessWebSockets: boolean;
  guacdHost: string;
  guacdPort: number;
  passkeyRelyingParties: readonly PasskeyRelyingPartyConfig[];
  e2eResetEnabled: boolean;
  e2eSeedDatabase?: string;
}

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_RP_ORIGIN = 'http://localhost:5173';

const requireValue = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required after environment initialization.`);
  return value;
};

const parsePositiveInteger = (value: string | undefined, fallback: number, name: string): number => {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid ${name}: ${value}`);
  return parsed;
};

const parseCsv = (value: string | undefined): string[] =>
  value
    ?.split(',')
    .map((item) => item.trim())
    .filter(Boolean) ?? [];

const normalizeOrigin = (value: string): string | null => {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
};

const buildPasskeyRelyingParties = (env: NodeJS.ProcessEnv): PasskeyRelyingPartyConfig[] => {
  const configuredIds = parseCsv(env.RP_ID);
  const configuredOrigins = parseCsv(env.RP_ORIGIN);
  const origins = configuredOrigins.length ? configuredOrigins : [DEFAULT_RP_ORIGIN];
  const fallbackId = configuredIds[0] || DEFAULT_RP_ID;
  const shareSingleId = configuredIds.length === 1;
  const result: PasskeyRelyingPartyConfig[] = [];

  origins.forEach((rawOrigin, index) => {
    const origin = normalizeOrigin(rawOrigin);
    if (!origin) {
      console.warn(`[Passkey Config] Ignoring invalid RP_ORIGIN value: ${rawOrigin}`);
      return;
    }
    const hostname = new URL(origin).hostname.toLowerCase();
    const rpId = (shareSingleId ? fallbackId : configuredIds[index] || hostname || fallbackId).toLowerCase();
    result.push({ rpId, origin });
  });

  return result.length ? result : [{ rpId: DEFAULT_RP_ID, origin: DEFAULT_RP_ORIGIN }];
};

export const loadRuntimeConfig = (dataDirectory: string, env: NodeJS.ProcessEnv = process.env): RuntimeConfig => ({
  appName: env.APP_NAME?.trim() || 'Nexus Terminal',
  host: env.HOST?.trim() || '0.0.0.0',
  trustProxy: env.TRUST_PROXY?.trim() || 'loopback, linklocal, uniquelocal',
  port: parsePositiveInteger(env.PORT, 3001, 'PORT'),
  nodeEnv: env.NODE_ENV?.trim() || 'development',
  dataDirectory,
  encryptionKeyHex: requireValue(env, 'ENCRYPTION_KEY'),
  sessionSecret: requireValue(env, 'SESSION_SECRET'),
  sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'nexus.sid',
  remoteGatewaySharedSecret: requireValue(env, 'REMOTE_GATEWAY_SHARED_SECRET'),
  remoteGatewayApiBase:
    env.REMOTE_GATEWAY_API_BASE?.trim() ||
    (env.DEPLOYMENT_MODE === 'local'
      ? env.REMOTE_GATEWAY_API_BASE_LOCAL?.trim() || 'http://localhost:9090'
      : env.REMOTE_GATEWAY_API_BASE_DOCKER?.trim() || 'http://remote-gateway:9090'),
  remoteGatewayWsBaseUrl:
    env.REMOTE_GATEWAY_WS_URL?.trim() ||
    (env.DEPLOYMENT_MODE === 'local'
      ? env.REMOTE_GATEWAY_WS_URL_LOCAL?.trim() || 'ws://localhost:8080'
      : env.REMOTE_GATEWAY_WS_URL_DOCKER?.trim() || 'ws://remote-gateway:8080'),
  allowOriginlessWebSockets:
    (env.NODE_ENV?.trim() || 'development') !== 'production' || env.ALLOW_ORIGINLESS_WEBSOCKETS === 'true',
  guacdHost: env.GUACD_HOST?.trim() || 'localhost',
  guacdPort: parsePositiveInteger(env.GUACD_PORT, 4822, 'GUACD_PORT'),
  passkeyRelyingParties: buildPasskeyRelyingParties(env),
  e2eResetEnabled: env.NEXUS_E2E_RESET_ENABLED === '1',
  e2eSeedDatabase: env.NEXUS_E2E_SEED_DB?.trim() || undefined,
});
