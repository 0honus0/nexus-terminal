import type { SecretCipher } from '../../shared/security/crypto.port';
import type { RelationalDatabase } from '../../platform/storage/relational-database.port';

const PREFIX = 'nexus-protected:v1:';
export const protectOperationalSecret = (cipher: SecretCipher, value: string): string => PREFIX + cipher.encrypt(value);
export const readOperationalSecret = (cipher: SecretCipher, value: string): string =>
  value.startsWith(PREFIX) ? cipher.decrypt(value.slice(PREFIX.length)) : value;

/** Legacy plaintext compatibility is only for already-persisted values and old backups. */
export const migrateOperationalSecrets = async (db: RelationalDatabase, cipher: SecretCipher): Promise<void> => {
  await db.transaction(async (tx) => {
    for (const row of await tx.queryAll<{ id: number; two_factor_secret: string }>(
      'SELECT id,two_factor_secret FROM users WHERE two_factor_secret IS NOT NULL',
    )) {
      if (!row.two_factor_secret.startsWith(PREFIX))
        await tx.execute('UPDATE users SET two_factor_secret=? WHERE id=?', [
          protectOperationalSecret(cipher, row.two_factor_secret),
          row.id,
        ]);
      else readOperationalSecret(cipher, row.two_factor_secret);
    }
    for (const row of await tx.queryAll<{ key: string; value: string }>(
      "SELECT key,value FROM settings WHERE key='captchaConfig'",
    )) {
      if (!row.value.startsWith(PREFIX))
        await tx.execute('UPDATE settings SET value=? WHERE key=?', [
          protectOperationalSecret(cipher, row.value),
          row.key,
        ]);
      else readOperationalSecret(cipher, row.value);
    }
    for (const row of await tx.queryAll<{ id: number; config: string }>(
      'SELECT id,config FROM notification_settings',
    )) {
      if (!row.config.startsWith(PREFIX))
        await tx.execute('UPDATE notification_settings SET config=? WHERE id=?', [
          protectOperationalSecret(cipher, row.config),
          row.id,
        ]);
      else readOperationalSecret(cipher, row.config);
    }
  });
};
