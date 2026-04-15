// Basic application configuration
// In a real application, consider using a more robust config library like 'dotenv' or 'convict'

export interface PasskeyRpConfig {
  rpId: string;
  rpOrigin: string;
}

interface AppConfig {
  appName: string;
  rpId: string; // Relying Party ID for WebAuthn (primary)
  rpOrigin: string; // Relying Party Origin for WebAuthn (primary)
  passkeyRpConfigs: PasskeyRpConfig[]; // Multi-domain Passkey configurations
  port: number;
  // Add other application-wide configurations here
}

const DEFAULT_RP_ID = 'localhost';
const DEFAULT_RP_ORIGIN = 'http://localhost:5173';

const parseCsvEnvValue = (value: string | undefined): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
};

const getHostnameFromOrigin = (origin: string): string | undefined => {
  try {
    const parsed = new URL(origin);
    return parsed.hostname.toLowerCase();
  } catch {
    return undefined;
  }
};

const normalizeOrigin = (origin: string): string | undefined => {
  try {
    const parsed = new URL(origin);
    return parsed.origin;
  } catch {
    return undefined;
  }
};

const originMatchesRpId = (origin: string, rpId: string): boolean => {
  const host = getHostnameFromOrigin(origin);
  const normalizedRpId = rpId.toLowerCase();

  if (!host) {
    return false;
  }

  return host === normalizedRpId || host.endsWith(`.${normalizedRpId}`);
};

const buildPasskeyRpConfigs = (): PasskeyRpConfig[] => {
  const configuredRpIds = parseCsvEnvValue(process.env.RP_ID);
  const configuredRpOrigins = parseCsvEnvValue(process.env.RP_ORIGIN);

  const rpOrigins = configuredRpOrigins.length > 0 ? configuredRpOrigins : [DEFAULT_RP_ORIGIN];
  const fallbackRpId = configuredRpIds[0] || DEFAULT_RP_ID;

  const useSingleRpIdForAllOrigins = configuredRpIds.length === 1;

  return rpOrigins.map((rpOrigin, index) => {
    const rpId = useSingleRpIdForAllOrigins
      ? configuredRpIds[0]
      : configuredRpIds[index] || getHostnameFromOrigin(rpOrigin) || fallbackRpId;

    return {
      rpId: (rpId || fallbackRpId).toLowerCase(),
      rpOrigin,
    };
  });
};

const passkeyRpConfigs = buildPasskeyRpConfigs();

export const config: AppConfig = {
  appName: process.env.APP_NAME || 'Nexus Terminal',
  rpId: passkeyRpConfigs[0]?.rpId || DEFAULT_RP_ID,
  rpOrigin: passkeyRpConfigs[0]?.rpOrigin || DEFAULT_RP_ORIGIN,
  passkeyRpConfigs,
  port: parseInt(process.env.PORT || '3000', 10),
};

export function getPasskeyRelatedOriginsForRpId(rpId: string): string[] {
  if (!rpId) {
    return [];
  }

  const normalizedRpId = rpId.toLowerCase();
  const dedupedOrigins = new Set<string>();

  config.passkeyRpConfigs.forEach((item) => {
    if (item.rpId.toLowerCase() !== normalizedRpId) {
      return;
    }

    const normalized = normalizeOrigin(item.rpOrigin);
    if (!normalized) {
      return;
    }

    if (originMatchesRpId(normalized, normalizedRpId)) {
      return;
    }

    dedupedOrigins.add(normalized);
  });

  return Array.from(dedupedOrigins);
}

// Function to get a config value, though direct access is also possible
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}
