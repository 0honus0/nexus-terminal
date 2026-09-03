export type ConnectionType = 'SSH' | 'RDP' | 'VNC';
export type ConnectionAuthMethod = 'password' | 'key';
export type ConnectionRoute = 'proxy' | 'jump' | null;

export interface RdpConnectionOptions {
  remoteApp?: string | null;
  remoteAppDirectory?: string | null;
  remoteAppArguments?: string | null;
}

export interface Connection {
  id: number;
  name: string | null;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  authMethod: ConnectionAuthMethod;
  sshKeyId: number | null;
  proxyId: number | null;
  route: ConnectionRoute;
  tagIds: number[];
  notes: string | null;
  jumpChain: number[] | null;
  rdpOptions: RdpConnectionOptions | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}

export interface CreateConnectionInput {
  name?: string | null;
  type: ConnectionType;
  host: string;
  port?: number;
  username: string;
  authMethod?: ConnectionAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sshKeyId?: number | null;
  proxyId?: number | null;
  route?: ConnectionRoute;
  tagIds?: number[];
  notes?: string | null;
  jumpChain?: number[] | null;
  rdpOptions?: RdpConnectionOptions | null;
}

export type UpdateConnectionInput = Partial<CreateConnectionInput>;

export interface ConnectionCredentials {
  password?: string;
  privateKey?: string;
  passphrase?: string;
}

export interface ConnectionWithCredentials {
  connection: Connection;
  credentials: ConnectionCredentials;
}

export interface UnsavedSshConnectionInput {
  host: string;
  port: number;
  username: string;
  authMethod: ConnectionAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sshKeyId?: number | null;
  proxyId?: number | null;
}
