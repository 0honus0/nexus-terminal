import { createHash } from 'node:crypto';
import type { CryptoHashPort } from '../../../modules/agent/crypto-hash.port';

export class NodeCryptoHashAdapter implements CryptoHashPort {
  sha256Utf8(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('hex');
  }
}
