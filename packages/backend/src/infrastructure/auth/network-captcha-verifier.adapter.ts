import axios from 'axios';
import type { CaptchaProviderName, CaptchaVerifierPort } from '../../modules/auth/captcha-verifier.port';
export class NetworkCaptchaVerifierAdapter implements CaptchaVerifierPort {
  async verify(provider: CaptchaProviderName, token: string, secretKey: string, siteKey?: string) {
    const params = new URLSearchParams({ secret: secretKey, response: token });
    if (provider === 'hcaptcha' && siteKey) params.set('sitekey', siteKey);
    const url =
      provider === 'hcaptcha'
        ? 'https://api.hcaptcha.com/siteverify'
        : 'https://www.google.com/recaptcha/api/siteverify';
    const response = await axios.post(url, params, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      timeout: 10_000,
    });
    return {
      success: response.data?.success === true,
      errorCodes: Array.isArray(response.data?.['error-codes']) ? response.data['error-codes'] : [],
    };
  }
}
