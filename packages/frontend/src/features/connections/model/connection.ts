import type {
  ConnectionAuthMethodDto,
  ConnectionDto,
  ConnectionRouteDto,
  ConnectionTypeDto,
  RdpConnectionOptionsDto,
} from '@nexus-terminal/protocol/connections';

export type ConnectionType = ConnectionTypeDto;
export type ConnectionAuthMethod = ConnectionAuthMethodDto;
export type ConnectionRoute = ConnectionRouteDto;
export type RdpOptions = RdpConnectionOptionsDto;
export type Connection = ConnectionDto;
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
