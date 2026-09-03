import type { SecretCipher } from '../../shared/security/crypto.port';
import type { SshKeyRepository, UpdateStoredSshKeyRecord } from './ssh-key.repository.port';
import type { DecryptedSshKey, SshKeyInput, SshKeySummary } from './ssh-key.types';

export class SshKeyService {
  constructor(
    private readonly repository: SshKeyRepository,
    private readonly cipher: SecretCipher,
  ) {}
  async create(input: SshKeyInput): Promise<SshKeySummary> {
    this.validate(input.name, input.privateKey);
    try {
      const id = await this.repository.create({
        name: input.name.trim(),
        encryptedPrivateKey: this.cipher.encrypt(input.privateKey),
        encryptedPassphrase: input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
      });
      return { id, name: input.name.trim() };
    } catch (error) {
      this.translateDuplicate(error, input.name);
    }
  }
  async list(): Promise<SshKeySummary[]> {
    return (await this.repository.list()).map(({ id, name }) => ({ id, name }));
  }
  async exists(id: number): Promise<boolean> {
    return Boolean(await this.repository.get(id));
  }
  async getDecrypted(id: number): Promise<DecryptedSshKey | null> {
    const row = await this.repository.get(id);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      privateKey: this.cipher.decrypt(row.encryptedPrivateKey),
      passphrase: row.encryptedPassphrase ? this.cipher.decrypt(row.encryptedPassphrase) : undefined,
    };
  }
  async update(id: number, input: Partial<SshKeyInput>): Promise<SshKeySummary | null> {
    const existing = await this.repository.get(id);
    if (!existing) return null;
    const update: UpdateStoredSshKeyRecord = {};
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error('密钥名称不能为空。');
      update.name = input.name.trim();
    }
    if (input.privateKey !== undefined) {
      if (!input.privateKey) throw new Error('私钥内容不能为空。');
      update.encryptedPrivateKey = this.cipher.encrypt(input.privateKey);
      update.encryptedPassphrase = input.passphrase ? this.cipher.encrypt(input.passphrase) : null;
    } else if (input.passphrase !== undefined)
      update.encryptedPassphrase = input.passphrase ? this.cipher.encrypt(input.passphrase) : null;
    try {
      if (Object.keys(update).length && !(await this.repository.update(id, update)))
        throw new Error('更新 SSH 密钥记录失败。');
    } catch (error) {
      this.translateDuplicate(error, input.name ?? existing.name);
    }
    return { id, name: input.name?.trim() ?? existing.name };
  }
  delete(id: number) {
    return this.repository.delete(id);
  }
  async listDecrypted(): Promise<DecryptedSshKey[]> {
    const result: DecryptedSshKey[] = [];
    for (const row of await this.repository.list()) {
      try {
        result.push({
          id: row.id,
          name: row.name,
          privateKey: this.cipher.decrypt(row.encryptedPrivateKey),
          passphrase: row.encryptedPassphrase ? this.cipher.decrypt(row.encryptedPassphrase) : undefined,
        });
      } catch {
        /* one damaged key must not hide all keys */
      }
    }
    return result;
  }
  private validate(name: string, privateKey: string) {
    if (!name?.trim() || !privateKey) throw new Error('必须提供密钥名称和私钥内容。');
  }
  private translateDuplicate(error: unknown, name: string): never {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('UNIQUE constraint failed')) throw new Error(`SSH 密钥名称 "${name}" 已存在。`);
    throw error;
  }
}
