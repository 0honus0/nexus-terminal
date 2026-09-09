import type {
  RemoteDesktopSessionIssuer,
  RemoteDesktopProtocol,
} from '../../platform/remote-desktop/remote-desktop-session-issuer.port';
import type { ConnectionService } from '../connections/connection.service';

export interface RemoteDesktopSessionOptions {
  width?: number;
  height?: number;
  dpi?: number;
}

/** Owns the product use case for opening RDP/VNC sessions; HTTP and runtime details stay outside. */
export class RemoteDesktopSessionService {
  constructor(
    private readonly connections: ConnectionService,
    private readonly sessionIssuer: RemoteDesktopSessionIssuer,
  ) {}

  async create(
    userId: number,
    connectionId: number,
    protocol: RemoteDesktopProtocol,
    options: RemoteDesktopSessionOptions = {},
  ) {
    const stored = await this.connections.getWithCredentials(connectionId);
    if (!stored) throw new Error('连接未找到。');
    if (stored.connection.type !== protocol) throw new Error(`此连接类型不是 ${protocol}。`);
    // Preserve the historical user-visible "recent connection" semantics: opening RDP/VNC
    // counts as a connection attempt once the stored connection type is valid, even if
    // credential validation or the Guacamole runtime fails afterwards.
    await this.connections.markConnected(connectionId).catch(() => false);
    const password = stored.credentials.password;
    if (!password) throw new Error(`${protocol} 连接需要使用密码认证，或密码解密失败。`);
    this.validateDisplay(options);
    const { connection } = stored;
    const result = await this.sessionIssuer.createSession(userId, {
      protocol,
      host: connection.host,
      port: connection.port,
      username: connection.username || undefined,
      password,
      display: { width: options.width, height: options.height, dpi: options.dpi },
      ...(protocol === 'RDP'
        ? {
            rdp: {
              security: 'any' as const,
              ignoreCertificate: true,
              resizeMethod: 'display-update' as const,
              remoteApp: connection.rdpOptions?.remoteApp ?? undefined,
              remoteAppDirectory: connection.rdpOptions?.remoteAppDirectory ?? undefined,
              remoteAppArguments: connection.rdpOptions?.remoteAppArguments ?? undefined,
            },
          }
        : {}),
    });
    return result;
  }

  private validateDisplay(options: RemoteDesktopSessionOptions): void {
    const integer = (value: number | undefined, min: number, max: number, label: string) => {
      if (value !== undefined && (!Number.isInteger(value) || value < min || value > max))
        throw new Error(`${label} 参数无效。`);
    };
    integer(options.width, 200, 8192, 'width');
    integer(options.height, 200, 8192, 'height');
    integer(options.dpi, 48, 480, 'dpi');
  }
}
