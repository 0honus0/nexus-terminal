export type RemoteDesktopProtocol = 'RDP' | 'VNC';
export interface RemoteDesktopConnection {
  id: number;
  name: string;
  type: RemoteDesktopProtocol;
}
export interface RemoteDesktopDisplay {
  width: number;
  height: number;
  dpi: number;
}
export interface RemoteDesktopSession {
  token: string;
}
export type RemoteDesktopState = 'idle' | 'connecting' | 'connected' | 'disconnecting' | 'disconnected' | 'error';
