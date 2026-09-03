import crypto from 'node:crypto';
import type { SecureTokenGenerator } from '../../shared/security/crypto.port';

export class NodeSecureTokenGenerator implements SecureTokenGenerator {
  generate(byteLength = 32): string {
    if (!Number.isInteger(byteLength) || byteLength <= 0) throw new Error('byteLength must be a positive integer.');
    return crypto.randomBytes(byteLength).toString('hex');
  }
}
