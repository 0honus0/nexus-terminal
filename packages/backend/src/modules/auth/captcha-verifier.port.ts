export type CaptchaProviderName = 'hcaptcha' | 'recaptcha';
export interface CaptchaVerifierPort {
  verify(
    provider: CaptchaProviderName,
    token: string,
    secretKey: string,
    siteKey?: string,
  ): Promise<{ success: boolean; errorCodes: readonly string[] }>;
}
