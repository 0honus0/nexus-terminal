import type { RemoteDesktopSessionDto } from '@nexus-terminal/protocol/connections';
import { httpClient } from '@/client/http';
import { createWebSocketUrl } from '@/client/websocket';
import type { RemoteDesktopSessionPort } from '../ports/remote-desktop-session-port';
import type { RemoteDesktopDisplayDto, RemoteDesktopProtocolDto } from '../model/remoteDesktop';

export const remoteDesktopApi: RemoteDesktopSessionPort = {
  async create(
    connectionId: number,
    protocol: RemoteDesktopProtocolDto,
    display: RemoteDesktopDisplayDto,
  ): Promise<RemoteDesktopSessionDto> {
    const path = protocol === 'RDP' ? 'rdp-session' : 'vnc-session';
    return (
      await httpClient.post<RemoteDesktopSessionDto>(`/connections/${connectionId}/${path}`, undefined, {
        params: display,
      })
    ).data;
  },
  tunnelUrl() {
    return createWebSocketUrl('/ws/remote-desktop');
  },
  tunnelData(session) {
    return new URLSearchParams({
      ticket: session.ticket,
    }).toString();
  },
};
