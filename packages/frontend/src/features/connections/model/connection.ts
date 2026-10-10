import type {
	ConnectionAuthMethodDto,
	ConnectionCreateRequestDto,
	ConnectionDto,
	ConnectionRouteDto,
	ConnectionTestResponseDto,
	RdpConnectionOptionsDto,
} from '@nexus-terminal/protocol/connections';
import type { ConnectionType } from '@nexus-terminal/shared/targets/connections/values';

// Same finite value set on both backends. Legacy route/auth/view shapes remain Protocol.
export type ConnectionTypeDto = ConnectionType;

export type { ConnectionAuthMethodDto, ConnectionDto, ConnectionRouteDto, RdpConnectionOptionsDto };

export type ConnectionFormInput = Omit<ConnectionCreateRequestDto, 'port' | 'authMethod'> & {
	port: number;
	authMethod: ConnectionAuthMethodDto;
};

export type ConnectionFormUpdate = Partial<ConnectionFormInput>;

export type { ConnectionTestResponseDto };
