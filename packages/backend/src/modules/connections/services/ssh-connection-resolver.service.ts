import { createHash } from 'node:crypto';
import type { ResolvedJumpHost, ResolvedSshConnection } from '../../../platform/connection/ssh-connection';
import type { ProxyService } from '../../proxies/proxy.service';
import type { ConnectionCredentialService } from '../connection-credential.service';
import type { ConnectionRepository } from '../connection.repository.port';
import type { UnsavedSshConnectionInput } from '../connection.types';

/** Converts product connection configuration into the technology-neutral Platform SSH model. */
export class SshConnectionResolver {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly credentials: ConnectionCredentialService,
    private readonly proxies: ProxyService,
  ) {}

  resolveStored(connectionId: number): Promise<ResolvedSshConnection> {
    return this.resolveStoredInternal(connectionId, []);
  }

  async fingerprintStored(connectionId: number): Promise<string> {
    const dependency = await this.dependencySnapshot(connectionId, []);
    return createHash('sha256').update(JSON.stringify(dependency), 'utf8').digest('hex');
  }

  async resolveUnsaved(input: UnsavedSshConnectionInput): Promise<ResolvedSshConnection> {
    const credentials = await this.credentials.resolveUnsaved(input);
    const proxy = input.proxyId ? await this.proxies.getDecrypted(input.proxyId) : null;
    if (input.proxyId && !proxy) throw new Error(`代理 ID ${input.proxyId} 未找到。`);
    return {
      connectionId: -1,
      displayName: `Test-${input.host}`,
      host: input.host,
      port: input.port,
      username: input.username,
      authMethod: input.authMethod,
      ...credentials,
      route: proxy ? 'proxy' : null,
      ...(proxy
        ? {
            proxy: {
              type: proxy.type,
              host: proxy.host,
              port: proxy.port,
              username: proxy.username ?? undefined,
              password: proxy.password,
            },
          }
        : {}),
    };
  }

  private async dependencySnapshot(connectionId: number, chain: number[]): Promise<Record<string, unknown>> {
    if (chain.includes(connectionId)) throw new Error(`检测到跳板机循环: ${[...chain, connectionId].join(' -> ')}`);
    const record = await this.repository.getStored(connectionId);
    if (!record) throw new Error(`连接配置 ID ${connectionId} 未找到。`);
    if (record.type !== 'SSH') throw new Error(`连接配置 ID ${connectionId} 不是 SSH 类型。`);

    const credentialRevision = await this.credentials.opaqueCredentialRevision(record);
    let proxyFingerprint: string | null = null;
    let jumpDependencies: Record<string, unknown>[] = [];

    if (record.route === 'proxy') {
      if (!record.proxyId) throw new Error(`连接 ${connectionId} 配置为 proxy 路由但没有 proxyId。`);
      proxyFingerprint = await this.proxies.dependencyFingerprint(record.proxyId);
      if (!proxyFingerprint) throw new Error(`代理 ID ${record.proxyId} 未找到。`);
    }
    if (record.route === 'jump') {
      if (!record.jumpChain?.length) throw new Error('跳板机路由缺少 jumpChain。');
      jumpDependencies = [];
      for (const id of record.jumpChain) {
        jumpDependencies.push(await this.dependencySnapshot(id, [...chain, connectionId]));
      }
    }

    return {
      id: record.id,
      type: record.type,
      host: record.host.trim().toLowerCase(),
      port: record.port,
      username: record.username,
      authMethod: record.authMethod,
      sshKeyId: record.sshKeyId,
      proxyId: record.proxyId,
      route: record.route,
      jumpChain: record.jumpChain ?? [],
      updatedAt: record.updatedAt,
      credentialRevision,
      proxyFingerprint,
      jumpDependencies,
    };
  }

  private async resolveStoredInternal(connectionId: number, chain: number[]): Promise<ResolvedSshConnection> {
    if (chain.includes(connectionId)) throw new Error(`检测到跳板机循环: ${[...chain, connectionId].join(' -> ')}`);
    const record = await this.repository.getStored(connectionId);
    if (!record) throw new Error(`连接配置 ID ${connectionId} 未找到。`);
    if (record.type !== 'SSH') throw new Error(`连接配置 ID ${connectionId} 不是 SSH 类型。`);
    const credentials = await this.credentials.decrypt(record);
    const resolved: ResolvedSshConnection = {
      connectionId: record.id,
      displayName: record.name || `Connection ${record.id}`,
      host: record.host,
      port: record.port,
      username: record.username,
      authMethod: record.authMethod,
      ...credentials,
      route: record.route,
    };
    if (record.route === 'proxy') {
      if (!record.proxyId) throw new Error(`连接 ${connectionId} 配置为 proxy 路由但没有 proxyId。`);
      const proxy = await this.proxies.getDecrypted(record.proxyId);
      if (!proxy) throw new Error(`代理 ID ${record.proxyId} 未找到。`);
      resolved.proxy = {
        type: proxy.type,
        host: proxy.host,
        port: proxy.port,
        username: proxy.username ?? undefined,
        password: proxy.password,
      };
    }
    if (record.route === 'jump')
      resolved.jumpChain = await this.resolveJumpChain(record.jumpChain, [...chain, connectionId]);
    return resolved;
  }

  private async resolveJumpChain(ids: readonly number[] | null, chain: number[]): Promise<ResolvedJumpHost[]> {
    if (!ids?.length) throw new Error('跳板机路由缺少 jumpChain。');
    const result: ResolvedJumpHost[] = [];
    for (const id of ids) {
      const hop = await this.resolveStoredInternal(id, chain);
      result.push({
        host: hop.host,
        port: hop.port,
        username: hop.username,
        authMethod: hop.authMethod,
        password: hop.password,
        privateKey: hop.privateKey,
        passphrase: hop.passphrase,
      });
    }
    return result;
  }
}
