import type {
  RemoteDesktopDisplayDto,
  RemoteDesktopProtocolDto,
  RemoteDesktopSessionDto,
} from '@nexus-terminal/protocol/connections';
export type { RemoteDesktopDisplayDto, RemoteDesktopProtocolDto, RemoteDesktopSessionDto };

export interface RemoteDesktopConnection {
  id: number;
  name: string;
  type: RemoteDesktopProtocolDto;
}
export type RemoteDesktopState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
