// Basic application configuration
// In a real application, consider using a more robust config library like 'dotenv' or 'convict'

export interface PasskeyRpConfig {
  rpId: string;
  rpOrigin: string;
}

interface AppConfig {
  appName: string;
  rpId: string; // Primary Relying Party ID for WebAuthn
  rpOrigin: string; // Primary Relying Party Origin for WebAuthn
  passkeyRpConfigs: PasskeyRpConfig[];
  port: number;
  // Add other application-wide configurations here
}

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_RP_ORIGIN = 'http://localhost:5173';

const parseCsvEnvValue = (value: string | undefined): string[] =>
  value
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const normalizeOrigin = (origin: string): string | undefined => {
  try {
    return new URL(origin).origin;
  } catch {
    return undefined;
  }
};

const getHostnameFromOrigin = (origin: string): string | undefined => {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const buildPasskeyRpConfigs = (): PasskeyRpConfig[] => {
  const configuredRpIds = parseCsvEnvValue(process.env.RP_ID);
  const configuredOrigins = parseCsvEnvValue(process.env.RP_ORIGIN);
  const origins = configuredOrigins.length > 0 ? configuredOrigins : [DEFAULT_RP_ORIGIN];
  const fallbackRpId = configuredRpIds[0] || DEFAULT_RP_ID;
  const shareSingleRpId = configuredRpIds.length === 1;

  const configs = origins.flatMap((origin, index) => {
    const normalizedOrigin = normalizeOrigin(origin);
    if (!normalizedOrigin) {
      console.warn(`[Passkey Config] Ignoring invalid RP_ORIGIN value: ${origin}`);
      return [];
    }

    const rpId = shareSingleRpId
      ? fallbackRpId
      : configuredRpIds[index] || getHostnameFromOrigin(normalizedOrigin) || fallbackRpId;
    return [{ rpId: rpId.toLowerCase(), rpOrigin: normalizedOrigin }];
  });

  return configs.length > 0 ? configs : [{ rpId: DEFAULT_RP_ID, rpOrigin: DEFAULT_RP_ORIGIN }];
};

const passkeyRpConfigs = buildPasskeyRpConfigs();

export const config: AppConfig = {
  appName: process.env.APP_NAME || 'Nexus Terminal',
  rpId: passkeyRpConfigs[0].rpId,
  rpOrigin: passkeyRpConfigs[0].rpOrigin,
  passkeyRpConfigs,
  port: parseInt(process.env.PORT || '3000', 10),
};

export const getPasskeyRelatedOriginsForRpId = (rpId: string): string[] => {
  const normalizedRpId = rpId.toLowerCase();
  const origins = new Set<string>();

  config.passkeyRpConfigs.forEach((item) => {
    if (item.rpId.toLowerCase() !== normalizedRpId) return;
    const hostname = getHostnameFromOrigin(item.rpOrigin);
    if (!hostname || hostname === normalizedRpId || hostname.endsWith(`.${normalizedRpId}`)) return;
    origins.add(item.rpOrigin);
  });

  return Array.from(origins);
};

// Function to get a config value, though direct access is also possible
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}
