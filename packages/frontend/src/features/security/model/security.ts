import type {
  AuthTwoFactorSetupDto,
  CaptchaConfigDto,
  CaptchaConfigUpdateDto,
  CaptchaProviderDto,
  IpAccessPolicyDto,
  IpBlacklistEntryDto,
  PasskeySummaryDto,
  PasskeyTransportDto,
} from '@nexus-terminal/protocol/auth';

export type CaptchaProvider = CaptchaProviderDto;
export type CaptchaConfig = CaptchaConfigDto;
export type CaptchaConfigUpdate = CaptchaConfigUpdateDto;
export type TwoFactorSetup = AuthTwoFactorSetupDto;
export type PasskeyTransport = PasskeyTransportDto;
export type PasskeySummary = PasskeySummaryDto;
export type IpBlacklistEntry = IpBlacklistEntryDto;
export type IpAccessPolicy = IpAccessPolicyDto;

export interface PasskeyLoginResult {
  verified: boolean;
}
