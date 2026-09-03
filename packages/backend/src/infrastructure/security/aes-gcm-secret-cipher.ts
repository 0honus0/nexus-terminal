import crypto from 'node:crypto';
import type { SecretCipher } from '../../shared/security/crypto.port';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

/** Preserves the historical iv + ciphertext + authTag Base64 storage format. */
export class AesGcmSecretCipher implements SecretCipher {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    const key = Buffer.from(keyHex, 'hex');
    if (key.length !== 32) throw new Error('Invalid ENCRYPTION_KEY length. Expected 32 bytes encoded as hex.');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString('base64');
  }

  decrypt(ciphertext: string): string {
    try {
      const data = Buffer.from(ciphertext, 'base64');
      if (data.length < IV_LENGTH + TAG_LENGTH) throw new Error('Invalid encrypted payload.');
      const iv = data.subarray(0, IV_LENGTH);
      const encrypted = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);
      const tag = data.subarray(data.length - TAG_LENGTH);
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new Error('Unable to decrypt secret.');
    }
  }
}
