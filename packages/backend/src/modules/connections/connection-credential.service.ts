import type { SecretCipher } from '../../shared/security/crypto.port';
import type { SshKeyService } from '../ssh-keys/ssh-key.service';
import type { StoredConnectionRecord, UpdateStoredConnection } from './connection.repository.port';
import type {
  ConnectionAuthMethod,
  ConnectionCredentials,
  ConnectionType,
  CreateConnectionInput,
  UpdateConnectionInput,
} from './connection.types';

export interface PreparedConnectionCredentials {
  authMethod: ConnectionAuthMethod;
  encryptedPassword: string | null;
  encryptedPrivateKey: string | null;
  encryptedPassphrase: string | null;
  sshKeyId: number | null;
}

/** Owns the credential state machine for SSH/RDP/VNC connections. */
export class ConnectionCredentialService {
  constructor(
    private readonly cipher: SecretCipher,
    private readonly sshKeys: SshKeyService,
  ) {}

  async prepareCreate(type: ConnectionType, input: CreateConnectionInput): Promise<PreparedConnectionCredentials> {
    if (type !== 'SSH') {
      if (!input.password) throw new Error(`${type} 连接需要提供 password。`);
      return {
        authMethod: 'password',
        encryptedPassword: this.cipher.encrypt(input.password),
        encryptedPrivateKey: null,
        encryptedPassphrase: null,
        sshKeyId: null,
      };
    }

    const authMethod = input.authMethod ?? 'password';
    if (authMethod === 'password') {
      if (!input.password) throw new Error('SSH 密码认证方式需要提供 password。');
      return {
        authMethod,
        encryptedPassword: this.cipher.encrypt(input.password),
        encryptedPrivateKey: null,
        encryptedPassphrase: null,
        sshKeyId: null,
      };
    }

    if (input.sshKeyId && input.privateKey) throw new Error('不能同时提供 private_key 和 ssh_key_id。');
    if (input.sshKeyId) {
      if (!(await this.sshKeys.exists(input.sshKeyId)))
        throw new Error(`提供的 SSH 密钥 ID ${input.sshKeyId} 无效或不存在。`);
      return {
        authMethod,
        encryptedPassword: null,
        encryptedPrivateKey: null,
        encryptedPassphrase: null,
        sshKeyId: input.sshKeyId,
      };
    }
    if (!input.privateKey)
      throw new Error('SSH 密钥认证方式需要提供 private_key 或选择一个已保存的密钥 (ssh_key_id)。');
    return {
      authMethod,
      encryptedPassword: null,
      encryptedPrivateKey: this.cipher.encrypt(input.privateKey),
      encryptedPassphrase: input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
      sshKeyId: null,
    };
  }

  async prepareUpdate(
    current: StoredConnectionRecord,
    targetType: ConnectionType,
    input: UpdateConnectionInput,
  ): Promise<UpdateStoredConnection> {
    if (targetType !== 'SSH') return this.preparePasswordOnlyUpdate(current, targetType, input);

    const finalAuth = input.authMethod ?? current.authMethod;
    if (finalAuth === 'password') return this.prepareSshPasswordUpdate(current, input);
    return this.prepareSshKeyUpdate(current, input);
  }

  async decrypt(record: StoredConnectionRecord): Promise<ConnectionCredentials> {
    if (record.authMethod === 'password') {
      return { password: record.encryptedPassword ? this.cipher.decrypt(record.encryptedPassword) : undefined };
    }
    if (record.sshKeyId) {
      const stored = await this.sshKeys.getDecrypted(record.sshKeyId);
      if (!stored) throw new Error(`关联的 SSH 密钥 (ID: ${record.sshKeyId}) 未找到。`);
      return { privateKey: stored.privateKey, passphrase: stored.passphrase };
    }
    return {
      privateKey: record.encryptedPrivateKey ? this.cipher.decrypt(record.encryptedPrivateKey) : undefined,
      passphrase: record.encryptedPassphrase ? this.cipher.decrypt(record.encryptedPassphrase) : undefined,
    };
  }

  async resolveUnsaved(input: {
    authMethod: ConnectionAuthMethod;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    sshKeyId?: number | null;
  }): Promise<ConnectionCredentials> {
    if (input.authMethod === 'password') {
      if (!input.password) throw new Error('SSH 密码认证方式需要提供 password。');
      return { password: input.password };
    }
    if (input.sshKeyId) {
      const key = await this.sshKeys.getDecrypted(input.sshKeyId);
      if (!key) throw new Error(`选择的 SSH 密钥 (ID: ${input.sshKeyId}) 未找到。`);
      return { privateKey: key.privateKey, passphrase: key.passphrase };
    }
    if (!input.privateKey) throw new Error('SSH 密钥认证方式需要提供 private_key 或 ssh_key_id。');
    return { privateKey: input.privateKey, passphrase: input.passphrase };
  }

  private preparePasswordOnlyUpdate(
    current: StoredConnectionRecord,
    type: 'RDP' | 'VNC',
    input: UpdateConnectionInput,
  ): UpdateStoredConnection {
    const switchingFromKey = current.type === 'SSH' && current.authMethod === 'key';
    if (switchingFromKey && !input.password) throw new Error(`切换到 ${type} 连接时需要提供 password。`);
    const encryptedPassword =
      input.password !== undefined
        ? input.password
          ? this.cipher.encrypt(input.password)
          : null
        : current.encryptedPassword;
    if (!encryptedPassword) throw new Error(`${type} 连接需要有效的 password。`);
    return {
      authMethod: 'password',
      encryptedPassword,
      encryptedPrivateKey: null,
      encryptedPassphrase: null,
      sshKeyId: null,
    };
  }

  private prepareSshPasswordUpdate(
    current: StoredConnectionRecord,
    input: UpdateConnectionInput,
  ): UpdateStoredConnection {
    const switching = current.authMethod !== 'password';
    const encryptedPassword =
      input.password !== undefined
        ? input.password
          ? this.cipher.encrypt(input.password)
          : null
        : switching
          ? null
          : current.encryptedPassword;
    if (!encryptedPassword) throw new Error('切换到密码认证时需要提供 password。');
    return {
      authMethod: 'password',
      encryptedPassword,
      encryptedPrivateKey: null,
      encryptedPassphrase: null,
      sshKeyId: null,
    };
  }

  private async prepareSshKeyUpdate(
    current: StoredConnectionRecord,
    input: UpdateConnectionInput,
  ): Promise<UpdateStoredConnection> {
    if (input.sshKeyId !== undefined && input.sshKeyId !== null && input.privateKey)
      throw new Error('不能同时提供 private_key 和 ssh_key_id。');
    if (input.sshKeyId !== undefined) {
      if (input.sshKeyId !== null) {
        if (!(await this.sshKeys.exists(input.sshKeyId)))
          throw new Error(`提供的 SSH 密钥 ID ${input.sshKeyId} 无效或不存在。`);
        return {
          authMethod: 'key',
          encryptedPassword: null,
          encryptedPrivateKey: null,
          encryptedPassphrase: null,
          sshKeyId: input.sshKeyId,
        };
      }
      if (input.privateKey) {
        return {
          authMethod: 'key',
          encryptedPassword: null,
          sshKeyId: null,
          encryptedPrivateKey: this.cipher.encrypt(input.privateKey),
          encryptedPassphrase: input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
        };
      }
      if (current.authMethod !== 'key' || (!current.encryptedPrivateKey && !current.sshKeyId)) {
        throw new Error('密钥认证需要 private_key 或 ssh_key_id。');
      }
      if (current.sshKeyId) throw new Error('清除 ssh_key_id 时需要提供 private_key。');
      return { authMethod: 'key', encryptedPassword: null, sshKeyId: null };
    }

    if (input.privateKey !== undefined) {
      if (!input.privateKey) throw new Error('private_key 不能为空。');
      return {
        authMethod: 'key',
        encryptedPassword: null,
        sshKeyId: null,
        encryptedPrivateKey: this.cipher.encrypt(input.privateKey),
        encryptedPassphrase: input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
      };
    }

    if (current.authMethod !== 'key') throw new Error('切换到密钥认证时需要提供 private_key 或 ssh_key_id。');
    if (input.passphrase !== undefined) {
      if (!current.encryptedPrivateKey) throw new Error('保存的 SSH Key 引用不能直接修改 passphrase。');
      return {
        authMethod: 'key',
        encryptedPassword: null,
        encryptedPassphrase: input.passphrase ? this.cipher.encrypt(input.passphrase) : null,
      };
    }
    return { authMethod: 'key', encryptedPassword: null };
  }
}
