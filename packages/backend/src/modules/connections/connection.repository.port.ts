import type {
  Connection,
  ConnectionAuthMethod,
  ConnectionRoute,
  ConnectionType,
  RdpConnectionOptions,
} from './connection.types';

export interface StoredConnectionRecord extends Omit<Connection, 'tagIds'> {
  encryptedPassword: string | null;
  encryptedPrivateKey: string | null;
  encryptedPassphrase: string | null;
}

export type CreateStoredConnection = Omit<StoredConnectionRecord, 'id' | 'createdAt' | 'updatedAt' | 'lastConnectedAt'>;
export type UpdateStoredConnection = Partial<
  Pick<
    StoredConnectionRecord,
    | 'name'
    | 'type'
    | 'host'
    | 'port'
    | 'username'
    | 'authMethod'
    | 'encryptedPassword'
    | 'encryptedPrivateKey'
    | 'encryptedPassphrase'
    | 'sshKeyId'
    | 'proxyId'
    | 'route'
    | 'notes'
    | 'jumpChain'
    | 'rdpOptions'
  >
>;

export interface ConnectionRepository {
  list(): Promise<Connection[]>;
  get(id: number): Promise<Connection | null>;
  getStored(id: number): Promise<StoredConnectionRecord | null>;
  findByName(name: string): Promise<Connection | null>;
  create(data: CreateStoredConnection, tagIds: readonly number[]): Promise<number>;
  update(id: number, data: UpdateStoredConnection, tagIds?: readonly number[]): Promise<boolean>;
  delete(id: number): Promise<boolean>;
  setTags(id: number, tagIds: readonly number[]): Promise<boolean>;
  addTagToMany(connectionIds: readonly number[], tagId: number): Promise<void>;
  updateLastConnected(id: number, timestamp: number): Promise<boolean>;
}

// Keep these imports anchored in the port so DB adapters never invent parallel domain enums.
export type StoredConnectionType = ConnectionType;
export type StoredConnectionAuthMethod = ConnectionAuthMethod;
export type StoredConnectionRoute = ConnectionRoute;
export type StoredRdpConnectionOptions = RdpConnectionOptions;
