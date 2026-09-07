export type RemoteDesktopProtocol = 'RDP' | 'VNC';

export interface RemoteDesktopDisplayOptions {
  width?: number;
  height?: number;
  dpi?: number;
}

export interface RdpSessionOptions {
  security?: 'any' | 'nla' | 'tls' | 'rdp' | 'vmconnect';
  ignoreCertificate?: boolean;
  resizeMethod?: 'display-update' | 'reconnect';
  remoteApp?: string;
  remoteAppDirectory?: string;
  remoteAppArguments?: string;
}

export interface RemoteDesktopSessionRequest {
  protocol: RemoteDesktopProtocol;
  host: string;
  port: number;
  username?: string;
  password: string;
  display?: RemoteDesktopDisplayOptions;
  rdp?: RdpSessionOptions;
}

export interface RemoteDesktopGateway {
  createSession(request: RemoteDesktopSessionRequest): Promise<{ token: string }>;
}
