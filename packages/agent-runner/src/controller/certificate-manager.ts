import fs from 'node:fs';
export class CertificateManager {
  constructor(private readonly tokenFile?: string) {}
  token(envToken?: string): string {
    const token =
      this.tokenFile && fs.existsSync(this.tokenFile)
        ? fs.readFileSync(this.tokenFile, 'utf8').trim()
        : envToken?.trim();
    if (!token || token.length < 32) throw new Error('RUNNER_TOKEN_REQUIRED');
    return token;
  }
}
