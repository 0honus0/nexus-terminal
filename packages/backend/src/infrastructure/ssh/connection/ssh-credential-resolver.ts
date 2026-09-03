import * as ConnectionRepository from '../../../modules/connections/connection.repository';
import * as ProxyRepository from '../../../modules/proxies/proxy.repository';
import * as SshKeyService from '../../../modules/ssh-keys/ssh_key.service';
import { decrypt } from '../../../shared/security/crypto';
import type {
  ResolvedJumpHost,
  ResolvedSshConnection,
  ResolvedSshProxy,
  UnsavedSshConnectionInput,
} from './ssh-connection.types';

const requireValue = <T>(value: T | null | undefined, message: string): T => {
  if (value === null || value === undefined) throw new Error(message);
  return value;
};

export class SshCredentialResolver {
  async resolveStored(connectionId: number): Promise<ResolvedSshConnection> {
    return this.resolveStoredInternal(connectionId, []);
  }

  async resolveUnsaved(input: UnsavedSshConnectionInput): Promise<ResolvedSshConnection> {
    const resolved: ResolvedSshConnection = {
      id: -1,
      name: `Test-${input.host}`,
      host: input.host,
      port: input.port,
      username: input.username,
      authMethod: input.auth_method,
      route: input.proxy_id ? 'proxy' : null,
      proxy: null,
    };

    if (input.auth_method === 'password') {
      resolved.password = input.password;
    } else if (input.ssh_key_id) {
      const storedKey = await SshKeyService.getDecryptedSshKeyById(input.ssh_key_id);
      if (!storedKey) throw new Error(`选择的 SSH 密钥 (ID: ${input.ssh_key_id}) 未找到。`);
      resolved.privateKey = storedKey.privateKey;
      resolved.passphrase = storedKey.passphrase;
    } else {
      resolved.privateKey = input.private_key;
      resolved.passphrase = input.passphrase;
    }

    if (input.proxy_id) resolved.proxy = await this.resolveProxyById(input.proxy_id);
    return resolved;
  }

  private async resolveStoredInternal(connectionId: number, chain: number[]): Promise<ResolvedSshConnection> {
    if (chain.includes(connectionId)) {
      throw new Error(`检测到跳板机循环: ${[...chain, connectionId].join(' -> ')}`);
    }

    const raw = await ConnectionRepository.findFullConnectionById(connectionId);
    if (!raw) throw new Error(`连接配置 ID ${connectionId} 未找到。`);

    const typed = raw as typeof raw & {
      jump_chain?: string | null;
      proxy_type?: 'proxy' | 'jump' | null;
    };

    try {
      const resolved: ResolvedSshConnection = {
        id: typed.id,
        name: requireValue(typed.name, `Connection ID ${connectionId} has null name.`),
        host: requireValue(typed.host, `Connection ID ${connectionId} has null host.`),
        port: requireValue(typed.port, `Connection ID ${connectionId} has null port.`),
        username: requireValue(typed.username, `Connection ID ${connectionId} has null username.`),
        authMethod: requireValue(typed.auth_method, `Connection ID ${connectionId} has null auth_method.`),
        route: typed.proxy_type ?? null,
        proxy: null,
      };

      await this.resolveConnectionAuthentication(resolved, typed);
      resolved.proxy = this.resolveJoinedProxy(connectionId, typed);
      resolved.jumpChain = await this.resolveJumpChain(connectionId, typed.jump_chain, [...chain, connectionId]);
      return resolved;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`处理凭证或配置失败: ${message}`);
    }
  }

  private async resolveConnectionAuthentication(
    resolved: ResolvedSshConnection,
    raw: Awaited<ReturnType<typeof ConnectionRepository.findFullConnectionById>> & Record<string, any>,
  ): Promise<void> {
    if (resolved.authMethod === 'password') {
      if (raw.encrypted_password) resolved.password = decrypt(raw.encrypted_password);
      return;
    }

    if (raw.ssh_key_id) {
      const storedKey = await SshKeyService.getDecryptedSshKeyById(raw.ssh_key_id);
      if (!storedKey) throw new Error(`关联的 SSH 密钥 (ID: ${raw.ssh_key_id}) 未找到。`);
      resolved.privateKey = storedKey.privateKey;
      resolved.passphrase = storedKey.passphrase;
      return;
    }

    if (raw.encrypted_private_key) {
      resolved.privateKey = decrypt(raw.encrypted_private_key);
      if (raw.encrypted_passphrase) resolved.passphrase = decrypt(raw.encrypted_passphrase);
    }
  }

  private resolveJoinedProxy(connectionId: number, raw: Record<string, any>): ResolvedSshProxy | null {
    if (!raw.proxy_db_id) return null;

    const type = requireValue(raw.actual_proxy_server_type, `Proxy for Connection ID ${connectionId} has null type.`);
    if (type !== 'SOCKS5' && type !== 'HTTP') {
      throw new Error(`Proxy for Connection ID ${connectionId} has invalid type: ${type}`);
    }

    return {
      id: raw.proxy_db_id,
      name: requireValue(raw.proxy_name, `Proxy for Connection ID ${connectionId} has null name.`),
      type,
      host: requireValue(raw.proxy_host, `Proxy for Connection ID ${connectionId} has null host.`),
      port: requireValue(raw.proxy_port, `Proxy for Connection ID ${connectionId} has null port.`),
      username: raw.proxy_username || undefined,
      password: raw.proxy_encrypted_password ? decrypt(raw.proxy_encrypted_password) : undefined,
    };
  }

  private async resolveJumpChain(
    connectionId: number,
    rawJumpChain: string | null | undefined,
    chain: number[],
  ): Promise<ResolvedJumpHost[] | undefined> {
    if (!rawJumpChain) return undefined;

    let ids: unknown;
    try {
      ids = JSON.parse(rawJumpChain);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`解析跳板机配置失败 (连接ID ${connectionId}): ${message}`);
    }

    if (!Array.isArray(ids) || ids.length === 0) return undefined;

    return Promise.all(
      ids.map(async (value, index): Promise<ResolvedJumpHost> => {
        if (typeof value !== 'number') {
          throw new Error(`Jump host ID at index ${index} for connection ${connectionId} is not a number: ${value}`);
        }
        const hop = await this.resolveStoredInternal(value, chain);
        return {
          id: `hop-${connectionId}-via-${value}-idx-${index}`,
          name: hop.name || `Jump Host ${index + 1} (Conn ID ${value})`,
          host: hop.host,
          port: hop.port,
          username: hop.username,
          authMethod: hop.authMethod,
          password: hop.password,
          privateKey: hop.privateKey,
          passphrase: hop.passphrase,
        };
      }),
    );
  }

  private async resolveProxyById(proxyId: number): Promise<ResolvedSshProxy> {
    const raw = await ProxyRepository.findProxyById(proxyId);
    if (!raw) throw new Error(`代理 ID ${proxyId} 未找到。`);

    const type = requireValue(raw.type, `Proxy ID ${proxyId} has null type.`);
    if (type !== 'SOCKS5' && type !== 'HTTP') throw new Error(`Proxy ID ${proxyId} has invalid type: ${type}`);

    return {
      id: raw.id,
      name: requireValue(raw.name, `Proxy ID ${proxyId} has null name.`),
      type,
      host: requireValue(raw.host, `Proxy ID ${proxyId} has null host.`),
      port: requireValue(raw.port, `Proxy ID ${proxyId} has null port.`),
      username: raw.username || undefined,
      password: raw.encrypted_password ? decrypt(raw.encrypted_password) : undefined,
    };
  }
}

export const sshCredentialResolver = new SshCredentialResolver();
