import type {
  Connection,
  CreateConnectionInput,
  RdpConnectionOptions,
  UnsavedSshConnectionInput,
  UpdateConnectionInput,
} from '../../../modules/connections/connection.types';

/**
 * TEMPORARY legacy HTTP compatibility adapter.
 *
 * This folder exists only to preserve the current frontend/API contract while the backend domain model
 * uses clean camelCase names. Delete the entire interfaces/http/legacy-api folder after the frontend
 * migrates to the new HTTP contract. Domain services must never depend on these shapes.
 */

export interface LegacyRdpOptionsDto {
  remote_app?: string | null;
  remote_app_dir?: string | null;
  remote_app_args?: string | null;
}

export interface LegacyConnectionWriteDto {
  name?: string | null;
  type?: 'SSH' | 'RDP' | 'VNC';
  host?: string;
  port?: number | string;
  username?: string;
  auth_method?: 'password' | 'key';
  password?: string;
  private_key?: string;
  passphrase?: string;
  ssh_key_id?: number | string | null;
  proxy_id?: number | string | null;
  proxy_type?: 'proxy' | 'jump' | null;
  tag_ids?: number[];
  notes?: string | null;
  jump_chain?: number[] | null;
  rdp_options?: LegacyRdpOptionsDto | null;
}

export interface LegacyConnectionDto {
  id: number;
  name: string | null;
  type: 'SSH' | 'RDP' | 'VNC';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  ssh_key_id: number | null;
  proxy_id: number | null;
  proxy_type: 'proxy' | 'jump' | null;
  tag_ids: number[];
  notes: string | null;
  jump_chain: number[] | null;
  rdp_options: LegacyRdpOptionsDto | null;
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
}

const optionalInteger = (value: number | string | null | undefined): number | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseInt(value, 10);
  return Number.isInteger(parsed) ? parsed : Number.NaN;
};

const normalizeLegacyCreateRoute = (
  dto: LegacyConnectionWriteDto,
  proxyId: number | null | undefined,
): LegacyConnectionWriteDto['proxy_type'] => {
  if (dto.proxy_type === 'proxy' && proxyId == null) return null;
  if (dto.proxy_type === 'jump' && !dto.jump_chain?.length) return null;
  return dto.proxy_type;
};

const normalizeLegacyUpdateRoute = (
  dto: LegacyConnectionWriteDto,
  proxyId: number | null | undefined,
): LegacyConnectionWriteDto['proxy_type'] => {
  if (dto.proxy_type === 'proxy' && dto.proxy_id !== undefined && proxyId == null) return null;
  if (dto.proxy_type === 'jump' && dto.jump_chain !== undefined && !dto.jump_chain?.length) return null;
  return dto.proxy_type;
};

const mapRdpOptionsFromLegacy = (
  value: LegacyRdpOptionsDto | null | undefined,
): RdpConnectionOptions | null | undefined => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return {
    remoteApp: value.remote_app,
    remoteAppDirectory: value.remote_app_dir,
    remoteAppArguments: value.remote_app_args,
  };
};

const mapRdpOptionsToLegacy = (value: RdpConnectionOptions | null): LegacyRdpOptionsDto | null =>
  value
    ? {
        remote_app: value.remoteApp ?? null,
        remote_app_dir: value.remoteAppDirectory ?? null,
        remote_app_args: value.remoteAppArguments ?? null,
      }
    : null;

export const fromLegacyConnectionCreateDto = (dto: LegacyConnectionWriteDto): CreateConnectionInput => {
  const proxyId = optionalInteger(dto.proxy_id);
  return {
    name: dto.name,
    type: dto.type as CreateConnectionInput['type'],
    host: dto.host as string,
    port: dto.port === undefined ? undefined : Number(dto.port),
    username: dto.username as string,
    authMethod: dto.auth_method,
    password: dto.password,
    privateKey: dto.private_key,
    passphrase: dto.passphrase,
    sshKeyId: optionalInteger(dto.ssh_key_id),
    proxyId,
    route: normalizeLegacyCreateRoute(dto, proxyId),
    tagIds: dto.tag_ids,
    notes: dto.notes,
    jumpChain: dto.jump_chain,
    rdpOptions: mapRdpOptionsFromLegacy(dto.rdp_options),
  };
};

export const fromLegacyConnectionUpdateDto = (dto: LegacyConnectionWriteDto): UpdateConnectionInput => {
  const result: UpdateConnectionInput = {};
  if (dto.name !== undefined) result.name = dto.name;
  if (dto.type !== undefined) result.type = dto.type;
  if (dto.host !== undefined) result.host = dto.host;
  if (dto.port !== undefined) result.port = Number(dto.port);
  if (dto.username !== undefined) result.username = dto.username;
  if (dto.auth_method !== undefined) result.authMethod = dto.auth_method;
  if (dto.password !== undefined) result.password = dto.password;
  if (dto.private_key !== undefined) result.privateKey = dto.private_key;
  if (dto.passphrase !== undefined) result.passphrase = dto.passphrase;
  if (dto.ssh_key_id !== undefined) result.sshKeyId = optionalInteger(dto.ssh_key_id) ?? null;
  if (dto.proxy_id !== undefined) result.proxyId = optionalInteger(dto.proxy_id) ?? null;
  if (dto.proxy_type !== undefined) {
    const proxyId = optionalInteger(dto.proxy_id);
    result.route = normalizeLegacyUpdateRoute(dto, proxyId);
  }
  if (dto.tag_ids !== undefined) result.tagIds = dto.tag_ids;
  if (dto.notes !== undefined) result.notes = dto.notes;
  if (dto.jump_chain !== undefined) result.jumpChain = dto.jump_chain;
  if (dto.rdp_options !== undefined) result.rdpOptions = mapRdpOptionsFromLegacy(dto.rdp_options) ?? null;
  return result;
};

export const fromLegacyUnsavedSshConnectionDto = (dto: LegacyConnectionWriteDto): UnsavedSshConnectionInput => ({
  host: dto.host as string,
  port: Number(dto.port),
  username: dto.username as string,
  authMethod: dto.auth_method as UnsavedSshConnectionInput['authMethod'],
  password: dto.password,
  privateKey: dto.ssh_key_id ? undefined : dto.private_key,
  passphrase: dto.ssh_key_id ? undefined : dto.passphrase,
  sshKeyId: optionalInteger(dto.ssh_key_id) ?? null,
  proxyId: optionalInteger(dto.proxy_id) ?? null,
});

export const toLegacyConnectionDto = (connection: Connection): LegacyConnectionDto => ({
  id: connection.id,
  name: connection.name,
  type: connection.type,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  auth_method: connection.authMethod,
  ssh_key_id: connection.sshKeyId,
  proxy_id: connection.proxyId,
  proxy_type: connection.route,
  tag_ids: [...connection.tagIds],
  notes: connection.notes,
  jump_chain: connection.jumpChain ? [...connection.jumpChain] : null,
  rdp_options: mapRdpOptionsToLegacy(connection.rdpOptions),
  created_at: connection.createdAt,
  updated_at: connection.updatedAt,
  last_connected_at: connection.lastConnectedAt,
});
