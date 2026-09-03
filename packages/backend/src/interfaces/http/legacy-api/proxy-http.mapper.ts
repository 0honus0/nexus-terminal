import type { Proxy, ProxyInput } from '../../../modules/proxies/proxy.types';

/** Temporary legacy frontend contract. Delete with interfaces/http/legacy-api. */
export interface LegacyProxyWriteDto {
  name?: string;
  type?: 'SOCKS5' | 'HTTP';
  host?: string;
  port?: number | string;
  username?: string | null;
  auth_method?: 'none' | 'password' | 'key';
  password?: string | null;
  private_key?: string | null;
  passphrase?: string | null;
}

const inferAuthMethod = (dto: LegacyProxyWriteDto): ProxyInput['authMethod'] | undefined => {
  if (dto.auth_method !== undefined) return dto.auth_method;
  if (dto.private_key) return 'key';
  if (dto.password !== undefined && dto.password !== null && dto.password !== '') return 'password';
  return undefined;
};

export const fromLegacyProxyCreateDto = (dto: LegacyProxyWriteDto): ProxyInput => ({
  name: dto.name ?? '',
  type: dto.type as ProxyInput['type'],
  host: dto.host ?? '',
  port: Number(dto.port),
  username: dto.username,
  authMethod: inferAuthMethod(dto),
  password: dto.password,
  privateKey: dto.private_key,
  passphrase: dto.passphrase,
});

export const fromLegacyProxyUpdateDto = (dto: LegacyProxyWriteDto): Partial<ProxyInput> => {
  const result: Partial<ProxyInput> = {};
  if (dto.name !== undefined) result.name = dto.name;
  if (dto.type !== undefined) result.type = dto.type;
  if (dto.host !== undefined) result.host = dto.host;
  if (dto.port !== undefined) result.port = Number(dto.port);
  if (dto.username !== undefined) result.username = dto.username;
  const authMethod = inferAuthMethod(dto);
  if (authMethod !== undefined) result.authMethod = authMethod;
  if (dto.password !== undefined) result.password = dto.password;
  if (dto.private_key !== undefined) result.privateKey = dto.private_key;
  if (dto.passphrase !== undefined) result.passphrase = dto.passphrase;
  return result;
};

export const toLegacyProxyDto = (proxy: Proxy) => ({
  id: proxy.id,
  name: proxy.name,
  type: proxy.type,
  host: proxy.host,
  port: proxy.port,
  username: proxy.username,
  auth_method: proxy.authMethod,
  created_at: proxy.createdAt,
  updated_at: proxy.updatedAt,
});
