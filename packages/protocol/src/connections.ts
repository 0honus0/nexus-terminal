import type { MessageResponseDto } from './common.js';

export type ConnectionTypeDto = 'SSH' | 'RDP' | 'VNC';
export type ConnectionAuthMethodDto = 'password' | 'key';
export type ConnectionRouteDto = 'proxy' | 'jump' | null;

export interface RdpConnectionOptionsDto {
  remoteApp?: string | null;
  remoteAppDirectory?: string | null;
  remoteAppArguments?: string | null;
}

export interface ConnectionDto {
  id: number;
  name: string | null;
  type: ConnectionTypeDto;
  host: string;
  port: number;
  username: string;
  authMethod: ConnectionAuthMethodDto;
  sshKeyId: number | null;
  proxyId: number | null;
  route: ConnectionRouteDto;
  tagIds: number[];
  notes: string | null;
  jumpChain: number[] | null;
  rdpOptions: RdpConnectionOptionsDto | null;
  createdAt: number;
  updatedAt: number;
  lastConnectedAt: number | null;
}

export interface ConnectionCreateRequestDto {
  name?: string | null;
  type: ConnectionTypeDto;
  host: string;
  port?: number;
  username: string;
  authMethod?: ConnectionAuthMethodDto;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  sshKeyId?: number | null;
  proxyId?: number | null;
  route?: ConnectionRouteDto;
  tagIds?: number[];
  notes?: string | null;
  jumpChain?: number[] | null;
  rdpOptions?: RdpConnectionOptionsDto | null;
}

export type ConnectionUpdateRequestDto = Partial<ConnectionCreateRequestDto>;

export interface ConnectionMutationResponseDto extends MessageResponseDto {
  connection: ConnectionDto;
}

export interface ConnectionCloneRequestDto {
  name: string;
}

export interface ConnectionAddTagRequestDto {
  connectionIds: number[];
  tagId: number;
}

export interface ConnectionTestResponseDto {
  success: boolean;
  message: string;
  latency?: number;
}

export type RemoteDesktopProtocolDto = 'RDP' | 'VNC';

export interface RemoteDesktopDisplayDto {
  width: number;
  height: number;
  dpi: number;
}

export interface RemoteDesktopSessionDto {
  ticket: string;
  lastConnectedAt: number;
}

export type ProxyTypeDto = 'SOCKS5' | 'HTTP';
export type ProxyAuthMethodDto = 'none' | 'password' | 'key';

export interface ProxyDto {
  id: number;
  name: string;
  type: ProxyTypeDto;
  host: string;
  port: number;
  username: string | null;
  authMethod: ProxyAuthMethodDto;
  createdAt: number;
  updatedAt: number;
}

export interface ProxyCreateRequestDto {
  name: string;
  type: ProxyTypeDto;
  host: string;
  port: number;
  username?: string | null;
  authMethod?: ProxyAuthMethodDto;
  password?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
}

export type ProxyUpdateRequestDto = Partial<ProxyCreateRequestDto>;

export interface ProxyMutationResponseDto extends MessageResponseDto {
  proxy: ProxyDto;
}

export interface ConnectionTagDto {
  id: number;
  name: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface TagNameRequestDto {
  name: string;
}

export interface TagConnectionsRequestDto {
  connectionIds: number[];
}

export interface TagMutationResponseDto extends MessageResponseDto {
  tag: ConnectionTagDto;
}

export interface SshKeySummaryDto {
  id: number;
  name: string;
}

export interface SshKeyCreateRequestDto {
  name: string;
  privateKey: string;
  passphrase?: string | null;
}

export interface SshKeyUpdateRequestDto {
  name?: string;
  privateKey?: string;
  passphrase?: string | null;
}

export interface SshKeyMutationResponseDto extends MessageResponseDto {
  key: SshKeySummaryDto;
}
