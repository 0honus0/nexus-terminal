import type { RemoteDesktopDisplay, RemoteDesktopProtocol, RemoteDesktopSession } from '../model/remoteDesktop';
export interface RemoteDesktopSessionPort {
  create(
    connectionId: number,
    protocol: RemoteDesktopProtocol,
    display: RemoteDesktopDisplay,
  ): Promise<RemoteDesktopSession>;
  tunnelUrl(session: RemoteDesktopSession, display: RemoteDesktopDisplay): string;
}
