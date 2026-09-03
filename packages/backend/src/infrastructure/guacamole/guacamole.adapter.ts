import type {
  RemoteDesktopGateway,
  RemoteDesktopSessionRequest,
} from '../../platform/remote-desktop/remote-desktop-gateway.port';

/** Remote Gateway HTTP implementation is migrated here after the skeleton gate. */
export class GuacamoleAdapter implements RemoteDesktopGateway {
  createSession(_request: RemoteDesktopSessionRequest): Promise<{ token: string }> {
    return Promise.reject(new Error('Guacamole adapter has not been migrated yet.'));
  }
}
