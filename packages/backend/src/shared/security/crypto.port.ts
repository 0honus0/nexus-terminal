export interface SecretCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  compare(password: string, hash: string): Promise<boolean>;
}

export interface SecureTokenGenerator {
  generate(byteLength?: number): string;
}

export const bufferToBase64Url = (buffer: ArrayBuffer | Buffer): string =>
  (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)).toString('base64url');

export const base64UrlToBuffer = (value: string): Buffer => Buffer.from(value, 'base64url');
