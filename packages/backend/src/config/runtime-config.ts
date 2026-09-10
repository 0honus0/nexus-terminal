import path from 'node:path';
import { logger } from '../shared/logging/logger';

export interface PasskeyRelyingPartyConfig {
  rpId: string;
  origin: string;
}

export interface RuntimeConfig {
  appName: string;
  appVersion: string;
  agentPublicOrigin?: string;
  agentPluginFrontendOrigin?: string;
  agentRunnerUrl?: string;
  agentRunnerToken?: string;
  host: string;
  trustProxy: string;
  port: number;
  nodeEnv: string;
  dataDirectory: string;
  htmlThemeAssetDirectory: string;
  encryptionKeyHex: string;
  sessionSecret: string;
  sessionCookieName: string;
  allowOriginlessWebSockets: boolean;
  guacdHost: string;
  guacdPort: number;
  transferPositionedChunkBytes: number;
  transferPositionedConcurrency: number;
  passkeyRelyingParties: readonly PasskeyRelyingPartyConfig[];
  e2eResetEnabled: boolean;
  e2eSeedDatabase?: string;
}

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_RP_ORIGIN = 'http://localhost:5173';
const BACKEND_PACKAGE_VERSION = (require('../../package.json') as { version?: string }).version ?? '0.0.0';

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

const parseOptionalExactOrigin = (value: string | undefined, name: string): string | undefined => {
  const raw = value?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an exact http(s) origin.`);
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    url.hash !== ''
  ) {
    throw new Error(`${name} must be an exact http(s) origin without credentials, path, query, or fragment.`);
  }
  return url.origin;
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
      logger.warn({ origin: rawOrigin }, 'Ignoring invalid passkey RP_ORIGIN value');
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
  appVersion: env.NEXUS_VERSION?.trim() || BACKEND_PACKAGE_VERSION,
  agentPublicOrigin: parseOptionalExactOrigin(env.AGENT_PUBLIC_ORIGIN, 'AGENT_PUBLIC_ORIGIN'),
  agentPluginFrontendOrigin: parseOptionalExactOrigin(env.AGENT_PLUGIN_FRONTEND_ORIGIN, 'AGENT_PLUGIN_FRONTEND_ORIGIN'),
  agentRunnerUrl: env.AGENT_RUNNER_URL?.trim() || undefined,
  agentRunnerToken: env.AGENT_RUNNER_TOKEN?.trim() || undefined,
  host: env.HOST?.trim() || '0.0.0.0',
  trustProxy: env.TRUST_PROXY?.trim() || 'loopback, linklocal, uniquelocal',
  port: parsePositiveInteger(env.PORT, 3001, 'PORT'),
  nodeEnv: env.NODE_ENV?.trim() || 'development',
  dataDirectory,
  htmlThemeAssetDirectory:
    env.NEXUS_HTML_THEME_ASSET_DIR?.trim() || path.resolve(__dirname, '../../../../assets/html-themes/local'),
  encryptionKeyHex: requireValue(env, 'ENCRYPTION_KEY'),
  sessionSecret: requireValue(env, 'SESSION_SECRET'),
  sessionCookieName: env.SESSION_COOKIE_NAME?.trim() || 'nexus.sid',
  allowOriginlessWebSockets:
    (env.NODE_ENV?.trim() || 'development') !== 'production' || env.ALLOW_ORIGINLESS_WEBSOCKETS === 'true',
  guacdHost: env.GUACD_HOST?.trim() || 'localhost',
  guacdPort: parsePositiveInteger(env.GUACD_PORT, 4822, 'GUACD_PORT'),
  transferPositionedChunkBytes: parsePositiveInteger(
    env.NEXUS_TRANSFER_POSITIONED_CHUNK_BYTES,
    32 * 1024,
    'NEXUS_TRANSFER_POSITIONED_CHUNK_BYTES',
  ),
  transferPositionedConcurrency: parsePositiveInteger(
    env.NEXUS_TRANSFER_POSITIONED_CONCURRENCY,
    32,
    'NEXUS_TRANSFER_POSITIONED_CONCURRENCY',
  ),
  passkeyRelyingParties: buildPasskeyRelyingParties(env),
  e2eResetEnabled: env.NEXUS_E2E_RESET_ENABLED === '1',
  e2eSeedDatabase: env.NEXUS_E2E_SEED_DB?.trim() || undefined,
});
