import type { MessageResponseDto } from './common.js';

export interface AuthUserDto {
  id: number;
  username: string;
  twoFactorEnabled?: boolean;
}

export interface AuthNeedsSetupResponseDto {
  needsSetup: boolean;
}

export interface AuthSetupRequestDto {
  username: string;
  password: string;
  confirmPassword: string;
}

export interface AuthLoginRequestDto {
  username: string;
  password: string;
  rememberMe?: boolean;
  captchaToken?: string;
}

export interface AuthLoginResponseDto extends MessageResponseDto {
  user?: AuthUserDto;
  requiresTwoFactor?: boolean;
}

export interface AuthTwoFactorLoginRequestDto {
  token: string;
}

export interface AuthTwoFactorLoginResponseDto extends MessageResponseDto {
  user: AuthUserDto;
}

export type AuthStatusResponseDto =
  | { isAuthenticated: false }
  | { isAuthenticated: true; user: AuthUserDto };

export interface AuthPasswordChangeRequestDto {
  currentPassword: string;
  newPassword: string;
}

export interface AuthTwoFactorSetupDto {
  secret: string;
  qrCodeUrl: string;
}

export interface AuthTwoFactorTokenRequestDto {
  token: string;
}

export interface AuthTwoFactorDisableRequestDto {
  password: string;
}

export type CaptchaProviderDto = 'none' | 'hcaptcha' | 'recaptcha';

export interface CaptchaConfigDto {
  enabled: boolean;
  provider: CaptchaProviderDto;
  hcaptchaSiteKey?: string;
  recaptchaSiteKey?: string;
}

export interface CaptchaConfigUpdateDto extends CaptchaConfigDto {
  hcaptchaSecretKey?: string;
  recaptchaSecretKey?: string;
}

export type PasskeyTransportDto = 'ble' | 'cable' | 'hybrid' | 'internal' | 'nfc' | 'smart-card' | 'usb';

export interface PasskeySummaryDto {
  credentialId: string;
  name: string | null;
  transports: PasskeyTransportDto[];
  createdAt: number;
  lastUsedAt: number | null;
}

export interface PasskeyHasConfiguredResponseDto {
  hasPasskeys: boolean;
  error?: string;
}

export interface PasskeyAuthenticationOptionsRequestDto {
  username?: string;
}

export interface PasskeyAuthenticateRequestDto<TAssertion = unknown> {
  username?: string;
  assertionResponse: TAssertion;
  rememberMe?: boolean;
}

export interface PasskeyAuthenticationResponseDto extends MessageResponseDto {
  verified: boolean;
  user?: AuthUserDto;
}

export interface PasskeyRegisterRequestDto<TRegistration = unknown> {
  registrationResponse: TRegistration;
}

export interface PasskeyRegisterResponseDto extends MessageResponseDto {
  verified: boolean;
}

export interface PasskeyRenameRequestDto {
  name: string;
}

export interface IpBlacklistEntryDto {
  ip: string;
  attempts: number;
  lastAttemptAt: number;
  blockedUntil: number | null;
}

export interface IpBlacklistPageDto {
  entries: IpBlacklistEntryDto[];
  total: number;
}

export interface IpAccessSettingsDto {
  ipWhitelist?: string;
  ipBlacklistEnabled?: boolean;
  maxLoginAttempts?: number;
  loginBanDuration?: number;
}

export interface IpAccessPolicyDto {
  whitelist: string;
  blacklistEnabled: boolean;
  maxLoginAttempts: number;
  loginBanDuration: number;
}
