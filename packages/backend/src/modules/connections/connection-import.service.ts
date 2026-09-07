import type { ProxyInput } from '../proxies/proxy.types';
import type { ProxyService } from '../proxies/proxy.service';
import type { SecretCipher } from '../../shared/security/crypto.port';
import type { CreateConnectionInput } from './connection.types';
import type { ConnectionService } from './connection.service';

interface CurrentImportRecord extends CreateConnectionInput {
  proxy?: ProxyInput | null;
}

export interface ConnectionImportResult {
  successCount: number;
  failureCount: number;
  errors: Array<{ connectionName?: string; message: string }>;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));
const optionalString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);
const requiredString = (record: JsonRecord, key: string): string => {
  const value = optionalString(record[key]);
  if (!value) throw new Error(`缺少必要的连接字段 (${key})。`);
  return value;
};
const requiredPort = (value: unknown, label = 'port'): number => {
  if (!Number.isInteger(value) || Number(value) <= 0 || Number(value) > 65535)
    throw new Error(`缺少或无效的 ${label}。`);
  return Number(value);
};
const legacyTagIds = (value: unknown): number[] =>
  Array.isArray(value) ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item > 0))] : [];

/** Owns compatibility normalization for the legacy connection-import JSON contract. */
export class ConnectionImportService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly proxies: ProxyService,
    private readonly cipher: SecretCipher,
  ) {}

  async importRecords(values: readonly unknown[]): Promise<ConnectionImportResult> {
    let successCount = 0;
    const errors: ConnectionImportResult['errors'] = [];
    const proxyCache = new Map<string, number>();
    for (const proxy of await this.proxies.list()) proxyCache.set(this.proxyKey(proxy), proxy.id);

    for (const source of values) {
      try {
        if (!isRecord(source)) throw new Error('连接记录必须是 JSON 对象。');
        const normalized = this.isLegacy(source) ? this.normalizeLegacy(source) : this.normalizeCurrent(source);
        let proxyId = normalized.connection.proxyId ?? null;
        if (normalized.proxy) {
          const key = this.proxyKey(normalized.proxy);
          const cached = proxyCache.get(key);
          if (cached) proxyId = cached;
          else {
            const created = await this.proxies.create(normalized.proxy);
            proxyId = created.id;
            proxyCache.set(key, created.id);
          }
        }
        await this.connections.create({
          ...normalized.connection,
          proxyId,
        });
        successCount += 1;
      } catch (error) {
        errors.push({
          connectionName: isRecord(source) && typeof source.name === 'string' ? source.name : undefined,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { successCount, failureCount: errors.length, errors };
  }

  private isLegacy(source: JsonRecord): boolean {
    return (
      'auth_method' in source ||
      'tag_ids' in source ||
      'encrypted_password' in source ||
      'encrypted_private_key' in source ||
      'encrypted_passphrase' in source ||
      (isRecord(source.proxy) &&
        ('auth_method' in source.proxy ||
          'encrypted_password' in source.proxy ||
          'encrypted_private_key' in source.proxy ||
          'encrypted_passphrase' in source.proxy))
    );
  }

  private normalizeCurrent(source: JsonRecord): { connection: CreateConnectionInput; proxy?: ProxyInput | null } {
    const current = source as unknown as CurrentImportRecord;
    const { proxy, ...connection } = current;
    return { connection, proxy };
  }

  private normalizeLegacy(source: JsonRecord): { connection: CreateConnectionInput; proxy?: ProxyInput | null } {
    const type = source.type;
    if (type !== 'SSH' && type !== 'RDP' && type !== 'VNC') throw new Error('缺少或无效的连接类型 (type)。');
    const name = requiredString(source, 'name');
    const host = requiredString(source, 'host');
    const username = requiredString(source, 'username');
    const port = requiredPort(source.port);
    const authMethod = type === 'SSH' ? source.auth_method : 'password';
    if (authMethod !== 'password' && authMethod !== 'key')
      throw new Error('SSH 连接缺少有效的认证方式 (auth_method)。');

    const password = this.decryptLegacy(source.encrypted_password);
    const privateKey = this.decryptLegacy(source.encrypted_private_key);
    const passphrase = this.decryptLegacy(source.encrypted_passphrase);
    const proxy = source.proxy == null ? null : this.normalizeLegacyProxy(source.proxy);

    return {
      connection: {
        name,
        type,
        host,
        port,
        username,
        authMethod,
        ...(password !== undefined ? { password } : {}),
        ...(privateKey !== undefined ? { privateKey } : {}),
        ...(passphrase !== undefined ? { passphrase } : {}),
        tagIds: legacyTagIds(source.tag_ids),
      },
      proxy,
    };
  }

  private normalizeLegacyProxy(value: unknown): ProxyInput {
    if (!isRecord(value)) throw new Error('代理信息必须是 JSON 对象。');
    const type = value.type;
    if (type !== 'SOCKS5' && type !== 'HTTP') throw new Error('代理信息包含无效的 type。');
    const authMethod = value.auth_method ?? 'none';
    if (authMethod !== 'none' && authMethod !== 'password' && authMethod !== 'key') {
      throw new Error('代理信息包含无效的 auth_method。');
    }
    const password = this.decryptLegacy(value.encrypted_password);
    const privateKey = this.decryptLegacy(value.encrypted_private_key);
    const passphrase = this.decryptLegacy(value.encrypted_passphrase);
    return {
      name: requiredString(value, 'name'),
      type,
      host: requiredString(value, 'host'),
      port: requiredPort(value.port, 'proxy port'),
      username: optionalString(value.username) ?? null,
      authMethod,
      ...(password !== undefined ? { password } : {}),
      ...(privateKey !== undefined ? { privateKey } : {}),
      ...(passphrase !== undefined ? { passphrase } : {}),
    };
  }

  private decryptLegacy(value: unknown): string | undefined {
    if (value === null || value === undefined || value === '') return undefined;
    if (typeof value !== 'string') throw new Error('Legacy encrypted credential must be a string.');
    return this.cipher.decrypt(value);
  }

  private proxyKey(proxy: Pick<ProxyInput, 'name' | 'type' | 'host' | 'port'>): string {
    return `${proxy.name.trim()}\u0000${proxy.type}\u0000${proxy.host.trim()}\u0000${proxy.port}`;
  }
}
