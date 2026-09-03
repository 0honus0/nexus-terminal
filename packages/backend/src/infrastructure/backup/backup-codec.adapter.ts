import crypto from 'node:crypto';
import type { BackupCodecPort } from '../../modules/backup/backup.port';
import type { BackupSnapshot } from '../../modules/backup/backup.types';
import { BackupPasswordRequiredError, InvalidBackupPasswordError } from '../../shared/errors/backup.errors';

const MAGIC = 'NEXUS_TERMINAL_BACKUP_V1\n';
const BACKUP_FORMAT = 'nexus-terminal-backup' as const;
const BACKUP_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 210_000;
interface CipherPayload {
  iv: string;
  ciphertext: string;
  tag: string;
}
interface Envelope {
  format: typeof BACKUP_FORMAT;
  version: typeof BACKUP_VERSION;
  createdAt: string;
  passwordKdf: { algorithm: 'pbkdf2-sha256'; salt: string; iterations: number };
  instanceWrappedKey: CipherPayload;
  passwordWrappedKey: CipherPayload;
  payload: CipherPayload;
}
const encrypt = (plain: Buffer, key: Buffer): CipherPayload => {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv('aes-256-gcm', key, iv),
    ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
};
const decrypt = (payload: CipherPayload, key: Buffer): Buffer => {
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(payload.iv, 'base64'));
  d.setAuthTag(Buffer.from(payload.tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(payload.ciphertext, 'base64')), d.final()]);
};
const validCipher = (v: unknown): v is CipherPayload =>
  Boolean(
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    ['iv', 'ciphertext', 'tag'].every(
      (k) =>
        typeof (v as Record<string, unknown>)[k] === 'string' && String((v as Record<string, unknown>)[k]).length > 0,
    ),
  );

/** Preserves the historical .nexus-backup V1 envelope while keeping crypto details out of Modules. */
export class NexusBackupCodecAdapter implements BackupCodecPort {
  private readonly instanceKey: Buffer;
  constructor(instanceSecret: string) {
    this.instanceKey = crypto.createHash('sha256').update(`nexus-backup-instance:${instanceSecret}`).digest();
  }
  async encode(snapshot: BackupSnapshot, password: string): Promise<Uint8Array> {
    if (!password) throw new Error('导出备份需要当前登录密码。');
    const dataKey = crypto.randomBytes(32),
      salt = crypto.randomBytes(16),
      passwordKey = crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    const envelope: Envelope = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: snapshot.createdAt,
      passwordKdf: { algorithm: 'pbkdf2-sha256', salt: salt.toString('base64'), iterations: PBKDF2_ITERATIONS },
      instanceWrappedKey: encrypt(dataKey, this.instanceKey),
      passwordWrappedKey: encrypt(dataKey, passwordKey),
      payload: encrypt(Buffer.from(JSON.stringify(snapshot), 'utf8'), dataKey),
    };
    return Buffer.from(MAGIC + JSON.stringify(envelope), 'utf8');
  }
  async decode(bytes: Uint8Array, password?: string): Promise<{ snapshot: BackupSnapshot; usedPassword: boolean }> {
    const content = Buffer.from(bytes).toString('utf8');
    if (!content.startsWith(MAGIC)) throw new Error('不是有效的 Nexus Terminal 备份文件。');
    let envelope: Envelope;
    try {
      envelope = JSON.parse(content.slice(MAGIC.length)) as Envelope;
    } catch {
      throw new Error('备份文件格式无效。');
    }
    if (
      envelope.format !== BACKUP_FORMAT ||
      envelope.version !== BACKUP_VERSION ||
      envelope.passwordKdf?.algorithm !== 'pbkdf2-sha256' ||
      envelope.passwordKdf.iterations !== PBKDF2_ITERATIONS ||
      !envelope.passwordKdf.salt ||
      !validCipher(envelope.instanceWrappedKey) ||
      !validCipher(envelope.passwordWrappedKey) ||
      !validCipher(envelope.payload)
    )
      throw new Error('备份文件加密参数无效。');
    let dataKey: Buffer,
      usedPassword = false;
    try {
      dataKey = decrypt(envelope.instanceWrappedKey, this.instanceKey);
    } catch {
      if (!password) throw new BackupPasswordRequiredError();
      try {
        const key = crypto.pbkdf2Sync(
          password,
          Buffer.from(envelope.passwordKdf.salt, 'base64'),
          envelope.passwordKdf.iterations,
          32,
          'sha256',
        );
        dataKey = decrypt(envelope.passwordWrappedKey, key);
        usedPassword = true;
      } catch {
        throw new InvalidBackupPasswordError();
      }
    }
    try {
      const snapshot = JSON.parse(decrypt(envelope.payload, dataKey).toString('utf8')) as BackupSnapshot;
      if (
        snapshot.format !== BACKUP_FORMAT ||
        snapshot.version !== BACKUP_VERSION ||
        !snapshot.tables ||
        typeof snapshot.tables !== 'object' ||
        !Array.isArray(snapshot.files)
      )
        throw new Error('备份载荷版本或结构不受支持。');
      return { snapshot, usedPassword };
    } catch (error) {
      if (usedPassword) throw new InvalidBackupPasswordError();
      throw error;
    }
  }
}
