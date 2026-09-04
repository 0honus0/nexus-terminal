export type ConnectionType = 'SSH' | 'RDP' | 'VNC';
export type ConnectionAuthMethod = 'password' | 'key';
export type ConnectionRoute = 'proxy' | 'jump' | null;
export interface RdpOptions {
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
  rdpOptions: RdpOptions | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}
export interface ConnectionInput {
  name?: string | null;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  authMethod: ConnectionAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sshKeyId?: number | null;
  proxyId?: number | null;
  route?: ConnectionRoute;
  tagIds?: number[];
  notes?: string | null;
  jumpChain?: number[] | null;
  rdpOptions?: RdpOptions | null;
}
export type ConnectionUpdate = Partial<ConnectionInput>;
export interface ConnectionTestResult {
  success: boolean;
  message: string;
  latency?: number;
}
