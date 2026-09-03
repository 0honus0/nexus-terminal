export interface RuntimeConfig {
  host: string;
  port: number;
  nodeEnv: string;
  dataDirectory: string;
  encryptionKeyHex: string;
  sessionSecret: string;
  remoteGatewaySharedSecret: string;
  guacdHost: string;
  guacdPort: number;
  e2eResetEnabled: boolean;
  e2eSeedDatabase?: string;
}

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

export const loadRuntimeConfig = (
  dataDirectory: string,
  env: NodeJS.ProcessEnv = process.env,
): RuntimeConfig => ({
  host: env.HOST?.trim() || '0.0.0.0',
  port: parsePositiveInteger(env.PORT, 3001, 'PORT'),
  nodeEnv: env.NODE_ENV?.trim() || 'development',
  dataDirectory,
  encryptionKeyHex: requireValue(env, 'ENCRYPTION_KEY'),
  sessionSecret: requireValue(env, 'SESSION_SECRET'),
  remoteGatewaySharedSecret: requireValue(env, 'REMOTE_GATEWAY_SHARED_SECRET'),
  guacdHost: env.GUACD_HOST?.trim() || 'localhost',
  guacdPort: parsePositiveInteger(env.GUACD_PORT, 4822, 'GUACD_PORT'),
  e2eResetEnabled: env.NEXUS_E2E_RESET_ENABLED === '1',
  e2eSeedDatabase: env.NEXUS_E2E_SEED_DB?.trim() || undefined,
});
