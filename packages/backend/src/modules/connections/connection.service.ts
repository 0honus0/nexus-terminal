import type { AuditLogService } from '../audit/audit.service';
import type { ConnectionCredentialService } from './connection-credential.service';
import type {
  ConnectionRepository,
  CreateStoredConnection,
  UpdateStoredConnection,
} from './connection.repository.port';
import type {
  Connection,
  ConnectionRoute,
  ConnectionType,
  CreateConnectionInput,
  RdpConnectionOptions,
  UpdateConnectionInput,
} from './connection.types';

const defaultPort = (type: ConnectionType): number => (type === 'SSH' ? 22 : type === 'RDP' ? 3389 : 5900);
const validTagIds = (tagIds: readonly number[] | undefined): number[] => [
  ...new Set((tagIds ?? []).filter((id) => Number.isInteger(id) && id > 0)),
];

const normalizeRdpOptions = (options: RdpConnectionOptions | null | undefined): RdpConnectionOptions | null => {
  if (!options) return null;
  const remoteApp = options.remoteApp?.trim().replace(/^\|\|/, '').trim() ?? '';
  if (!remoteApp) return null;
  if (remoteApp.length > 256 || /[\0\r\n]/.test(remoteApp)) throw new Error('RemoteApp 别名格式无效。');
  const optional = (value: string | null | undefined, maxLength: number, label: string): string | null => {
    if (!value?.trim()) return null;
    const normalized = value.trim();
    if (normalized.length > maxLength || /[\0\r\n]/.test(normalized)) throw new Error(`${label} 格式无效。`);
    return normalized;
  };
  return {
    remoteApp,
    remoteAppDirectory: optional(options.remoteAppDirectory, 1024, 'RemoteApp 工作目录'),
    remoteAppArguments: optional(options.remoteAppArguments, 4096, 'RemoteApp 参数'),
  };
};

/** Owns connection aggregate CRUD, tag membership, clone and audit use cases. */
export class ConnectionService {
  constructor(
    private readonly repository: ConnectionRepository,
    private readonly credentials: ConnectionCredentialService,
    private readonly audit: AuditLogService,
  ) {}

  list(): Promise<Connection[]> {
    return this.repository.list();
  }
  get(id: number): Promise<Connection | null> {
    return this.repository.get(id);
  }

  async create(input: CreateConnectionInput): Promise<Connection> {
    this.validateBase(input.type, input.host, input.username, input.port ?? defaultPort(input.type));
    const route = this.normalizeRoute(input.route ?? null, input.proxyId ?? null, input.jumpChain ?? null);
    const jumpChain = await this.validateJumpChain(input.jumpChain, undefined);
    const protectedCredentials = await this.credentials.prepareCreate(input.type, input);
    const data: CreateStoredConnection = {
      name: input.name?.trim() || '',
      type: input.type,
      host: input.host.trim(),
      port: input.port ?? defaultPort(input.type),
      username: input.username.trim(),
      proxyId: input.proxyId ?? null,
      route,
      notes: input.notes ?? null,
      jumpChain,
      rdpOptions: input.type === 'RDP' ? normalizeRdpOptions(input.rdpOptions) : null,
      ...protectedCredentials,
    };
    const id = await this.repository.create(data, validTagIds(input.tagIds));
    const created = await this.repository.get(id);
    if (!created) throw new Error('创建连接后无法检索到该连接。');
    await this.audit.logAction('CONNECTION_CREATED', {
      connectionId: id,
      type: created.type,
      name: created.name,
      host: created.host,
    });
    return created;
  }

  async update(id: number, input: UpdateConnectionInput): Promise<Connection | null> {
    const current = await this.repository.getStored(id);
    if (!current) return null;
    const targetType = input.type ?? current.type;
    const host = input.host ?? current.host;
    const username = input.username ?? current.username;
    const port = input.port ?? current.port;
    this.validateBase(targetType, host, username, port);

    const update: UpdateStoredConnection = {};
    if (input.name !== undefined) update.name = input.name?.trim() || '';
    if (input.type !== undefined) update.type = targetType;
    if (input.host !== undefined) update.host = input.host.trim();
    if (input.port !== undefined) update.port = input.port;
    if (input.username !== undefined) update.username = input.username.trim();
    if (input.notes !== undefined) update.notes = input.notes ?? null;
    if (input.rdpOptions !== undefined || (current.type === 'RDP' && targetType !== 'RDP')) {
      update.rdpOptions = targetType === 'RDP' ? normalizeRdpOptions(input.rdpOptions ?? current.rdpOptions) : null;
    }

    const route = input.route !== undefined ? input.route : current.route;
    const proxyId = input.proxyId !== undefined ? input.proxyId : current.proxyId;
    const jumpSource = input.jumpChain !== undefined ? input.jumpChain : current.jumpChain;
    if (input.route !== undefined || input.proxyId !== undefined || input.jumpChain !== undefined) {
      update.route = this.normalizeRoute(route, proxyId, jumpSource);
      update.proxyId = proxyId ?? null;
      update.jumpChain = await this.validateJumpChain(jumpSource, id);
    }

    const credentialKeys: Array<keyof UpdateConnectionInput> = [
      'type',
      'authMethod',
      'password',
      'privateKey',
      'passphrase',
      'sshKeyId',
    ];
    if (credentialKeys.some((key) => input[key] !== undefined)) {
      Object.assign(update, await this.credentials.prepareUpdate(current, targetType, input));
    }

    const tagIds = input.tagIds === undefined ? undefined : validTagIds(input.tagIds);
    if (!Object.keys(update).length && tagIds === undefined) return this.repository.get(id);
    if (!(await this.repository.update(id, update, tagIds))) throw new Error('更新连接记录失败。');
    await this.audit.logAction('CONNECTION_UPDATED', {
      connectionId: id,
      updatedFields: [...Object.keys(update), ...(tagIds !== undefined ? ['tagIds'] : [])],
      ...(update.type ? { newType: update.type } : {}),
    });
    return this.repository.get(id);
  }

  async delete(id: number): Promise<boolean> {
    const deleted = await this.repository.delete(id);
    if (deleted) await this.audit.logAction('CONNECTION_DELETED', { connectionId: id });
    return deleted;
  }

  async getWithCredentials(id: number) {
    const stored = await this.repository.getStored(id);
    if (!stored) return null;
    const connection = await this.repository.get(id);
    if (!connection) return null;
    return { connection, credentials: await this.credentials.decrypt(stored) };
  }

  async clone(originalId: number, newName: string): Promise<Connection> {
    const name = newName?.trim();
    if (!name) throw new Error('新连接名称不能为空。');
    if (await this.repository.findByName(name)) throw new Error(`名称为 "${name}" 的连接已存在。`);
    const original = await this.repository.getStored(originalId);
    const publicOriginal = await this.repository.get(originalId);
    if (!original || !publicOriginal) throw new Error(`ID 为 ${originalId} 的原始连接未找到。`);
    const { id: _id, createdAt: _created, updatedAt: _updated, lastConnectedAt: _last, ...copy } = original;
    const id = await this.repository.create({ ...copy, name }, publicOriginal.tagIds);
    const cloned = await this.repository.get(id);
    if (!cloned) throw new Error('克隆连接后无法检索到该连接。');
    await this.audit.logAction('CONNECTION_CREATED', {
      connectionId: id,
      type: cloned.type,
      name: cloned.name,
      host: cloned.host,
      clonedFromId: originalId,
    });
    return cloned;
  }

  addTagToConnections(connectionIds: readonly number[], tagId: number): Promise<void> {
    if (!Number.isInteger(tagId) || tagId <= 0) throw new Error('tagId 必须是有效的正整数。');
    return this.repository.addTagToMany(validTagIds(connectionIds), tagId);
  }

  setTags(connectionId: number, tagIds: readonly number[]): Promise<boolean> {
    return this.repository.setTags(connectionId, validTagIds(tagIds));
  }

  markConnected(connectionId: number, timestamp = Math.floor(Date.now() / 1000)): Promise<boolean> {
    return this.repository.updateLastConnected(connectionId, timestamp);
  }

  private validateBase(type: ConnectionType, host: string, username: string, port: number): void {
    if (!['SSH', 'RDP', 'VNC'].includes(type)) throw new Error('必须提供有效的连接类型 (SSH, RDP 或 VNC)。');
    if (!host?.trim() || !username?.trim()) throw new Error('缺少必要的连接信息 (host, username)。');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('连接端口必须是 1-65535。');
  }

  private normalizeRoute(
    route: ConnectionRoute,
    proxyId: number | null,
    jumpChain: readonly number[] | null,
  ): ConnectionRoute {
    if (route === 'proxy' && !proxyId) throw new Error('代理连接方式需要选择 proxyId。');
    if (route === 'jump' && (!jumpChain || jumpChain.length === 0))
      throw new Error('跳板机连接方式需要至少一个 jumpChain。');
    return route;
  }

  private async validateJumpChain(
    jumpChain: readonly number[] | null | undefined,
    selfId?: number,
  ): Promise<number[] | null> {
    if (!jumpChain?.length) return null;
    const normalized = [...new Set(jumpChain)];
    for (const id of normalized) {
      if (!Number.isInteger(id) || id <= 0) throw new Error('jumpChain 中的 ID 必须是有效正整数。');
      if (selfId === id) throw new Error(`jumpChain 不能包含当前连接自身的 ID (${id})。`);
      const connection = await this.repository.get(id);
      if (!connection) throw new Error(`jumpChain 中的连接 ID ${id} 未找到。`);
      if (connection.type !== 'SSH')
        throw new Error(`jumpChain 中的连接 ID ${id} (${connection.name ?? ''}) 不是 SSH 类型。`);
    }
    return normalized;
  }
}
