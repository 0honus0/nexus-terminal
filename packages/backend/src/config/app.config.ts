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
    return parsed.hostname;
  } catch {
    return undefined;
  }
};

const buildPasskeyRpConfigs = (): PasskeyRpConfig[] => {
  const configuredRpIds = parseCsvEnvValue(process.env.RP_ID);
  const configuredRpOrigins = parseCsvEnvValue(process.env.RP_ORIGIN);

  const rpOrigins = configuredRpOrigins.length > 0 ? configuredRpOrigins : [DEFAULT_RP_ORIGIN];
  const fallbackRpId = configuredRpIds[0] || DEFAULT_RP_ID;

  const result = rpOrigins.map((rpOrigin, index) => {
    const rpId = configuredRpIds[index] || getHostnameFromOrigin(rpOrigin) || fallbackRpId;
    return { rpId, rpOrigin };
  });

  return result;
};

const passkeyRpConfigs = buildPasskeyRpConfigs();

export const config: AppConfig = {
  appName: process.env.APP_NAME || 'Nexus Terminal',
  rpId: passkeyRpConfigs[0]?.rpId || DEFAULT_RP_ID,
  rpOrigin: passkeyRpConfigs[0]?.rpOrigin || DEFAULT_RP_ORIGIN,
  passkeyRpConfigs,
  port: parseInt(process.env.PORT || '3000', 10),
};

// Function to get a config value, though direct access is also possible
export function getConfigValue<K extends keyof AppConfig>(key: K): AppConfig[K] {
  return config[key];
}
