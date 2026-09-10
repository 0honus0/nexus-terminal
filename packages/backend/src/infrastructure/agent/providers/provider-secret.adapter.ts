import type { ProviderSecretPort } from '../../../modules/agent/ai/provider-secret.port';
import type { RelationalDatabase } from '../../../platform/storage/relational-database.port';
import type { SecretCipher } from '../../../shared/security/crypto.port';

export class ProviderSecretAdapter implements ProviderSecretPort {
  constructor(
    private readonly db: RelationalDatabase,
    private readonly cipher: SecretCipher,
  ) {}

  async withCredential<T>(
    userId: number,
    providerId: string,
    credentialRevision: number,
    use: (credential: string | null) => Promise<T>,
  ): Promise<T> {
    const row = await this.db.queryOne<{ protected_credential: string | null; credential_revision: number }>(
      `SELECT protected_credential, credential_revision
       FROM ai_providers WHERE user_id = ? AND id = ? AND deleted_at IS NULL`,
      [userId, providerId],
    );
    if (!row) throw new Error('PROVIDER_NOT_FOUND');
    if (row.credential_revision !== credentialRevision) throw new Error('PROVIDER_CREDENTIAL_STALE');
    const credential = row.protected_credential ? this.cipher.decrypt(row.protected_credential) : null;
    return use(credential);
  }
}
