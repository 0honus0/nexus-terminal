import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import { httpClient } from '@/client/http';
import type {
  CaptchaConfig,
  CaptchaConfigUpdate,
  IpAccessPolicy,
  IpBlacklistEntry,
  PasskeySummary,
  TwoFactorSetup,
} from '../model/security';

interface IpAccessSettingsResponse {
  ipWhitelist?: string;
  ipBlacklistEnabled?: boolean;
  maxLoginAttempts?: number;
  loginBanDuration?: number;
}

export const securityApi = {
  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    await httpClient.put('/auth/password', { currentPassword, newPassword });
  },

  async beginTwoFactorSetup(): Promise<TwoFactorSetup> {
    const response = await httpClient.post<TwoFactorSetup>('/auth/2fa/setup');
    return response.data;
  },

  async activateTwoFactor(token: string): Promise<void> {
    await httpClient.post('/auth/2fa/verify', { token });
  },

  async disableTwoFactor(password: string): Promise<void> {
    await httpClient.delete('/auth/2fa', { data: { password } });
  },

  async getCaptchaConfig(): Promise<CaptchaConfig> {
    const response = await httpClient.get<CaptchaConfig>('/settings/captcha');
    return response.data;
  },

  async updateCaptchaConfig(config: CaptchaConfigUpdate): Promise<void> {
    await httpClient.put('/settings/captcha', config);
  },

  async hasPasskeys(username?: string): Promise<boolean> {
    const response = await httpClient.get<{ hasPasskeys: boolean }>('/auth/passkey/has-configured', {
      params: username ? { username } : undefined,
    });
    return response.data.hasPasskeys;
  },

  async getPasskeyAuthenticationOptions(username?: string) {
    const response = await httpClient.post('/auth/passkey/authentication-options', username ? { username } : {});
    return response.data;
  },

  async authenticatePasskey(
    username: string | undefined,
    assertionResponse: AuthenticationResponseJSON,
  ): Promise<void> {
    await httpClient.post('/auth/passkey/authenticate', {
      ...(username ? { username } : {}),
      assertionResponse,
    });
  },

  async getPasskeyRegistrationOptions(): Promise<PublicKeyCredentialCreationOptionsJSON> {
    const response = await httpClient.post<PublicKeyCredentialCreationOptionsJSON>(
      '/auth/passkey/registration-options',
    );
    return response.data;
  },

  async registerPasskey(registrationResponse: RegistrationResponseJSON): Promise<void> {
    await httpClient.post('/auth/passkey/register', { registrationResponse });
  },

  async listPasskeys(): Promise<PasskeySummary[]> {
    return (await httpClient.get<PasskeySummary[]>('/auth/user/passkeys')).data;
  },

  async deletePasskey(credentialId: string): Promise<void> {
    await httpClient.delete(`/auth/user/passkeys/${encodeURIComponent(credentialId)}`);
  },

  async renamePasskey(credentialId: string, name: string): Promise<void> {
    await httpClient.put(`/auth/user/passkeys/${encodeURIComponent(credentialId)}/name`, { name });
  },

  async getIpAccessPolicy(): Promise<IpAccessPolicy> {
    const settings = (await httpClient.get<IpAccessSettingsResponse>('/settings')).data;
    return {
      whitelist: settings.ipWhitelist ?? '',
      blacklistEnabled: settings.ipBlacklistEnabled ?? true,
      maxLoginAttempts: settings.maxLoginAttempts ?? 5,
      loginBanDuration: settings.loginBanDuration ?? 300,
    };
  },

  async updateIpAccessPolicy(policy: Partial<IpAccessPolicy>): Promise<void> {
    const body: Record<string, string | boolean | number> = {};
    if (policy.whitelist !== undefined) body.ipWhitelist = policy.whitelist;
    if (policy.blacklistEnabled !== undefined) body.ipBlacklistEnabled = policy.blacklistEnabled;
    if (policy.maxLoginAttempts !== undefined) body.maxLoginAttempts = policy.maxLoginAttempts;
    if (policy.loginBanDuration !== undefined) body.loginBanDuration = policy.loginBanDuration;
    await httpClient.put('/settings', body);
  },

  async listBlockedIps(limit: number, offset: number): Promise<{ entries: IpBlacklistEntry[]; total: number }> {
    const response = await httpClient.get<{ entries: IpBlacklistEntry[]; total: number }>('/settings/ip-blacklist', {
      params: { limit, offset },
    });
    return response.data;
  },

  async removeBlockedIp(ip: string): Promise<void> {
    await httpClient.delete(`/settings/ip-blacklist/${encodeURIComponent(ip)}`);
  },
};
