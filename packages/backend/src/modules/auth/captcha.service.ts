import type { SettingsService } from '../settings/settings.service';
import type { CaptchaProviderName, CaptchaVerifierPort } from './captcha-verifier.port';
export class CaptchaService {
  constructor(
    private readonly settings: SettingsService,
    private readonly verifier: CaptchaVerifierPort,
  ) {}
  async verifyToken(token: string): Promise<boolean> {
    if (!token) return false;
    const c = await this.settings.getCaptchaConfig();
    if (!c.enabled || c.provider === 'none') return true;
    const secret = c.provider === 'hcaptcha' ? c.hcaptchaSecretKey : c.recaptchaSecretKey;
    if (!secret) throw new Error(`${c.provider} 配置无效：缺少 Secret Key。`);
    return (await this.verifier.verify(c.provider, token, secret)).success;
  }
  async verifyCredentials(provider: CaptchaProviderName, siteKey: string, secretKey: string): Promise<boolean> {
    if (!siteKey || !secretKey) return false;
    try {
      return (
        await this.verifier.verify(
          provider,
          'static_test_token_for_credential_verification_NexusTerminal',
          secretKey,
          siteKey,
        )
      ).success;
    } catch {
      return false;
    }
  }
}
