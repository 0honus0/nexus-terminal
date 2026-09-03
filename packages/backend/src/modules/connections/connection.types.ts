export type ConnectionType = 'SSH' | 'RDP' | 'VNC';

export interface ConnectionSummary {
  id: number;
  name: string;
  type: ConnectionType;
  host: string;
  port: number;
  username: string;
  updatedAt: number;
}

export interface ConnectionDetails extends ConnectionSummary {
  authMethod: 'password' | 'key';
  proxyId?: number;
  jumpChain?: readonly number[];
  sshKeyId?: number;
}
