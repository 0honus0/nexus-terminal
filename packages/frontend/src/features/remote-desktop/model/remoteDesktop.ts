import type {
  RemoteDesktopDisplayDto,
  RemoteDesktopProtocolDto,
  RemoteDesktopSessionDto,
} from '@nexus-terminal/protocol/connections';

export type RemoteDesktopProtocol = RemoteDesktopProtocolDto;
export interface RemoteDesktopConnection {
  id: number;
  name: string;
  type: RemoteDesktopProtocol;
}
export type RemoteDesktopDisplay = RemoteDesktopDisplayDto;
export type RemoteDesktopSession = RemoteDesktopSessionDto;
export type RemoteDesktopState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
