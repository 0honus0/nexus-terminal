import type {
  ConnectionAuthMethodDto,
  ConnectionCreateRequestDto,
  ConnectionDto,
  ConnectionRouteDto,
  ConnectionTestResponseDto,
  ConnectionTypeDto,
  RdpConnectionOptionsDto,
} from '@nexus-terminal/protocol/connections';
export type { ConnectionAuthMethodDto, ConnectionDto, ConnectionRouteDto, ConnectionTypeDto, RdpConnectionOptionsDto };

export type ConnectionFormInput = Omit<ConnectionCreateRequestDto, 'port' | 'authMethod'> & {
  port: number;
  authMethod: ConnectionAuthMethodDto;
};
export type ConnectionFormUpdate = Partial<ConnectionFormInput>;
export type { ConnectionTestResponseDto };
