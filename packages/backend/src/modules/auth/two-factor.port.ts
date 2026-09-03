export interface TwoFactorSetup {
  secret: string;
  qrCodeUrl: string;
}
export interface TwoFactorPort {
  generate(label: string): Promise<TwoFactorSetup>;
  verify(secret: string, token: string): boolean;
}
