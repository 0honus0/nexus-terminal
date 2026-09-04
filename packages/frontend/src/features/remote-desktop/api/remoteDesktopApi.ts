import { httpClient } from '@/client/http';
import { createWebSocketUrl } from '@/client/websocket';
import type { RemoteDesktopSessionPort } from '../ports/remote-desktop-session-port';
import type { RemoteDesktopDisplay, RemoteDesktopProtocol, RemoteDesktopSession } from '../model/remoteDesktop';
export const remoteDesktopApi: RemoteDesktopSessionPort = {
  async create(
    connectionId: number,
    protocol: RemoteDesktopProtocol,
    display: RemoteDesktopDisplay,
  ): Promise<RemoteDesktopSession> {
    const path = protocol === 'RDP' ? 'rdp-session' : 'vnc-session';
    return (
      await httpClient.post<RemoteDesktopSession>(`/connections/${connectionId}/${path}`, undefined, {
        params: display,
      })
    ).data;
  },
  tunnelUrl(session, display) {
    const q = new URLSearchParams({
      token: session.token,
      width: String(display.width),
      height: String(display.height),
      dpi: String(display.dpi),
    });
    return createWebSocketUrl(`/ws/remote-desktop?${q}`);
  },
};
