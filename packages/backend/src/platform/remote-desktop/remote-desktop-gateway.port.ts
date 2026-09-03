export type RemoteDesktopProtocol = 'RDP' | 'VNC';

export interface RemoteDesktopSessionRequest {
  protocol: RemoteDesktopProtocol;
  host: string;
  port: number;
  username: string;
  password: string;
  width?: number;
  height?: number;
}

export interface RemoteDesktopGateway {
  createSession(request: RemoteDesktopSessionRequest): Promise<{ token: string }>;
}
