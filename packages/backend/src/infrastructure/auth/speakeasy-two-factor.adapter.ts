import qrcode from 'qrcode';
import speakeasy from 'speakeasy';
import type { TwoFactorPort } from '../../modules/auth/two-factor.port';
export class SpeakeasyTwoFactorAdapter implements TwoFactorPort {
  async generate(label: string) {
    const secret = speakeasy.generateSecret({ length: 20, name: label });
    if (!secret.otpauth_url) throw new Error('无法生成 OTP Auth URL');
    return { secret: secret.base32, qrCodeUrl: await qrcode.toDataURL(secret.otpauth_url) };
  }
  verify(secret: string, token: string) {
    return speakeasy.totp.verify({ secret, encoding: 'base32', token, window: 1 });
  }
}
