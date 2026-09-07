export type CaptchaProvider = 'none' | 'hcaptcha' | 'recaptcha';

export interface CaptchaConfig {
  enabled: boolean;
  provider: CaptchaProvider;
  hcaptchaSiteKey?: string;
  recaptchaSiteKey?: string;
}

export interface CaptchaConfigUpdate extends CaptchaConfig {
  hcaptchaSecretKey?: string;
  recaptchaSecretKey?: string;
}

export interface TwoFactorSetup {
  secret: string;
  qrCodeUrl: string;
}

export interface PasskeySummary {
  credentialId: string;
  name?: string;
  transports?: AuthenticatorTransport[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface IpBlacklistEntry {
  ip: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil: number | null;
}

export interface IpAccessPolicy {
  whitelist: string;
  blacklistEnabled: boolean;
  maxLoginAttempts: number;
  loginBanDuration: number;
}

export interface PasskeyLoginResult {
  verified: boolean;
}
