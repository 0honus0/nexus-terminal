import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type {
  AuthPasswordChangeRequestDto,
  AuthTwoFactorDisableRequestDto,
  AuthTwoFactorSetupDto,
  AuthTwoFactorTokenRequestDto,
  CaptchaConfigDto,
  CaptchaConfigUpdateDto,
  IpAccessSettingsDto,
  IpBlacklistPageDto,
  PasskeyAuthenticateRequestDto,
  PasskeyAuthenticationOptionsRequestDto,
  PasskeyAuthenticationResponseDto,
  PasskeyHasConfiguredResponseDto,
  PasskeyRegisterRequestDto,
  PasskeyRegisterResponseDto,
  PasskeyRenameRequestDto,
  PasskeySummaryDto,
} from '@nexus-terminal/protocol/auth';
import type { MessageResponseDto } from '@nexus-terminal/protocol/common';
import { httpClient } from '@/client/http';
import type { IpAccessPolicyDto, IpBlacklistEntryDto } from '../model/security';

export const securityApi = {
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const request: AuthPasswordChangeRequestDto = { currentPassword, newPassword };
    await httpClient.put<MessageResponseDto>('/auth/password', request);
  },

  async beginTwoFactorSetup(): Promise<AuthTwoFactorSetupDto> {
    const response = await httpClient.post<AuthTwoFactorSetupDto>('/auth/2fa/setup');
    return response.data;
  },

  async activateTwoFactor(token: string): Promise<void> {
    const request: AuthTwoFactorTokenRequestDto = { token };
    await httpClient.post<MessageResponseDto>('/auth/2fa/verify', request);
  },

  async disableTwoFactor(password: string): Promise<void> {
    const request: AuthTwoFactorDisableRequestDto = { password };
    await httpClient.delete<MessageResponseDto>('/auth/2fa', { data: request });
  },

  async getCaptchaConfig(): Promise<CaptchaConfigDto> {
    const response = await httpClient.get<CaptchaConfigDto>('/settings/captcha');
    return response.data;
  },

  async updateCaptchaConfig(config: CaptchaConfigUpdateDto): Promise<void> {
    const request: CaptchaConfigUpdateDto = config;
    await httpClient.put<MessageResponseDto>('/settings/captcha', request);
  },

  async hasPasskeys(username?: string): Promise<boolean> {
    const response = await httpClient.get<PasskeyHasConfiguredResponseDto>('/auth/passkey/has-configured', {
      params: username ? { username } : undefined,
    });
    return response.data.hasPasskeys;
  },

  async getPasskeyAuthenticationOptions(username?: string): Promise<PublicKeyCredentialRequestOptionsJSON> {
    const request: PasskeyAuthenticationOptionsRequestDto = username ? { username } : {};
    const response = await httpClient.post<PublicKeyCredentialRequestOptionsJSON>(
      '/auth/passkey/authentication-options',
      request,
    );
    return response.data;
  },

  async authenticatePasskey(
    username: string | undefined,
    assertionResponse: AuthenticationResponseJSON,
  ): Promise<void> {
    const request: PasskeyAuthenticateRequestDto<AuthenticationResponseJSON> = {
      ...(username ? { username } : {}),
      assertionResponse,
    };
    await httpClient.post<PasskeyAuthenticationResponseDto>('/auth/passkey/authenticate', request);
  },

  async getPasskeyRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const response = await httpClient.post<PublicKeyCredentialCreationOptionsJSON>(
      '/auth/passkey/registration-options',
    );
    return response.data;
  },

  async registerPasskey(registrationResponse: RegistrationResponseJSON): Promise<void> {
    const request: PasskeyRegisterRequestDto<RegistrationResponseJSON> = { registrationResponse };
    await httpClient.post<PasskeyRegisterResponseDto>('/auth/passkey/register', request);
  },

  async listPasskeys(): Promise<PasskeySummaryDto[]> {
    return (await httpClient.get<PasskeySummaryDto[]>('/auth/user/passkeys')).data;
  },

  async deletePasskey(credentialId: string): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/auth/user/passkeys/${encodeURIComponent(credentialId)}`);
  },

  async renamePasskey(credentialId: string, name: string): Promise<void> {
    const request: PasskeyRenameRequestDto = { name };
    await httpClient.put<MessageResponseDto>(`/auth/user/passkeys/${encodeURIComponent(credentialId)}/name`, request);
  },

  async getIpAccessPolicy(): Promise<IpAccessPolicyDto> {
    const settings = (await httpClient.get<IpAccessSettingsDto>('/settings')).data;
    return {
      whitelist: settings.ipWhitelist ?? '',
      blacklistEnabled: settings.ipBlacklistEnabled ?? true,
      maxLoginAttempts: settings.maxLoginAttempts ?? 5,
      loginBanDuration: settings.loginBanDuration ?? 300,
    };
  },

  async updateIpAccessPolicy(policy: Partial<IpAccessPolicyDto>): Promise<void> {
    const body: IpAccessSettingsDto = {};
    if (policy.whitelist !== undefined) body.ipWhitelist = policy.whitelist;
    if (policy.blacklistEnabled !== undefined) body.ipBlacklistEnabled = policy.blacklistEnabled;
    if (policy.maxLoginAttempts !== undefined) body.maxLoginAttempts = policy.maxLoginAttempts;
    if (policy.loginBanDuration !== undefined) body.loginBanDuration = policy.loginBanDuration;
    await httpClient.put<MessageResponseDto>('/settings', body);
  },

  async listBlockedIps(limit: number, offset: number): Promise<{ entries: IpBlacklistEntryDto[]; total: number }> {
    const response = await httpClient.get<IpBlacklistPageDto>('/settings/ip-blacklist', {
      params: { limit, offset },
    });
    return response.data;
  },

  async removeBlockedIp(ip: string): Promise<void> {
    await httpClient.delete<MessageResponseDto>(`/settings/ip-blacklist/${encodeURIComponent(ip)}`);
  },
};
