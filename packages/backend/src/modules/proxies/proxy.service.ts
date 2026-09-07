import type { SecretCipher } from '../../shared/security/crypto.port';
import type { ProxyRepository, StoredProxyRecord, UpdateStoredProxyRecord } from './proxy.repository.port';
import type { DecryptedProxy, Proxy, ProxyAuthMethod, ProxyInput } from './proxy.types';

const publicProxy = (record: StoredProxyRecord): Proxy => ({
  id: record.id,
  name: record.name,
  type: record.type,
  host: record.host,
  port: record.port,
  username: record.username,
  authMethod: record.authMethod,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
});

const validateBase = (input: Pick<ProxyInput, 'name' | 'type' | 'host' | 'port'>): void => {
  if (!input.name?.trim() || !input.host?.trim()) throw new Error('缺少必要的代理信息 (name, host)。');
  if (!['SOCKS5', 'HTTP'].includes(input.type)) throw new Error('无效的代理类型。');
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65535)
    throw new Error('代理端口必须是 1-65535。');
};

/** Owns proxy validation and credential protection; SQL never escapes this boundary. */
export class ProxyService {
  constructor(
    private readonly repository: ProxyRepository,
    private readonly cipher: SecretCipher,
  ) {}

  async list(): Promise<Proxy[]> {
    return (await this.repository.list()).map(publicProxy);
  }

  async get(id: number): Promise<Proxy | null> {
    const record = await this.repository.get(id);
    return record ? publicProxy(record) : null;
  }

  async getDecrypted(id: number): Promise<DecryptedProxy | null> {
    const record = await this.repository.get(id);
    if (!record) return null;
    return {
      ...publicProxy(record),
      password: record.encryptedPassword ? this.cipher.decrypt(record.encryptedPassword) : undefined,
      privateKey: record.encryptedPrivateKey ? this.cipher.decrypt(record.encryptedPrivateKey) : undefined,
      passphrase: record.encryptedPassphrase ? this.cipher.decrypt(record.encryptedPassphrase) : undefined,
    };
  }

  async create(input: ProxyInput): Promise<Proxy> {
    validateBase(input);
    const authMethod = input.authMethod ?? 'none';
    this.validateCredentials(authMethod, input, true);
    const duplicate = await this.repository.findDuplicate(input.name.trim(), input.type, input.host.trim(), input.port);
    if (duplicate) throw new Error('相同名称、类型、主机和端口的代理已存在。');
    const credentials = this.protectCredentials(authMethod, input);
    const id = await this.repository.create({
      name: input.name.trim(),
      type: input.type,
      host: input.host.trim(),
      port: input.port,
      username: input.username?.trim() || null,
      authMethod,
      ...credentials,
    });
    const created = await this.get(id);
    if (!created) throw new Error('创建代理后无法检索到该代理。');
    return created;
  }

  async update(id: number, input: Partial<ProxyInput>): Promise<Proxy | null> {
    const current = await this.repository.get(id);
    if (!current) return null;
    const target = {
      name: input.name ?? current.name,
      type: input.type ?? current.type,
      host: input.host ?? current.host,
      port: input.port ?? current.port,
    };
    validateBase(target);
    const nextAuth = input.authMethod ?? current.authMethod;
    const update: UpdateStoredProxyRecord = {
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.host !== undefined ? { host: input.host.trim() } : {}),
      ...(input.port !== undefined ? { port: input.port } : {}),
      ...(input.username !== undefined ? { username: input.username?.trim() || null } : {}),
    };

    if (input.authMethod !== undefined && input.authMethod !== current.authMethod) {
      this.validateCredentials(nextAuth, input, true);
      Object.assign(update, { authMethod: nextAuth }, this.protectCredentials(nextAuth, input));
    } else {
      this.applyCredentialPatch(update, nextAuth, input);
    }
    if (Object.keys(update).length > 0 && !(await this.repository.update(id, update)))
      throw new Error('更新代理记录失败。');
    return this.get(id);
  }

  delete(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }

  private validateCredentials(authMethod: ProxyAuthMethod, input: Partial<ProxyInput>, switching: boolean): void {
    if (authMethod === 'password' && switching && !input.password)
      throw new Error('代理密码认证方式需要提供 password。');
    if (authMethod === 'key' && switching && !input.privateKey)
      throw new Error('代理密钥认证方式需要提供 private_key。');
  }

  private protectCredentials(authMethod: ProxyAuthMethod, input: Partial<ProxyInput>) {
    return {
      encryptedPassword: authMethod === 'password' && input.password ? this.cipher.encrypt(input.password) : null,
      encryptedPrivateKey: authMethod === 'key' && input.privateKey ? this.cipher.encrypt(input.privateKey) : null,
      encryptedPassphrase: authMethod === 'key' && input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
    };
  }

  private applyCredentialPatch(
    update: UpdateStoredProxyRecord,
    authMethod: ProxyAuthMethod,
    input: Partial<ProxyInput>,
  ): void {
    if (authMethod === 'password' && input.password !== undefined) {
      update.encryptedPassword = input.password ? this.cipher.encrypt(input.password) : null;
    }
    if (authMethod === 'key') {
      if (input.privateKey !== undefined) {
        update.encryptedPrivateKey = input.privateKey ? this.cipher.encrypt(input.privateKey) : null;
        update.encryptedPassphrase = input.passphrase ? this.cipher.encrypt(input.passphrase) : null;
      } else if (input.passphrase !== undefined) {
        update.encryptedPassphrase = input.passphrase ? this.cipher.encrypt(input.passphrase) : null;
      }
    }
  }
}
