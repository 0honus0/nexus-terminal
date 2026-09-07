import axios from 'axios';
import type {
  RemoteDesktopGateway,
  RemoteDesktopSessionRequest,
} from '../../platform/remote-desktop/remote-desktop-gateway.port';

export interface GuacamoleAdapterOptions {
  apiBaseUrl: string;
  sharedSecret: string;
  timeoutMs?: number;
}

/** Remote Gateway HTTP adapter. Environment/config policy stays in Bootstrap. */
export class GuacamoleAdapter implements RemoteDesktopGateway {
  constructor(private readonly options: GuacamoleAdapterOptions) {}

  async createSession(request: RemoteDesktopSessionRequest): Promise<{ token: string }> {
    const protocol = request.protocol.toLowerCase() as 'rdp' | 'vnc';
    const connectionConfig: Record<string, unknown> = {
      hostname: request.host,
      port: String(request.port),
      width: String(request.display?.width ?? 1024),
      height: String(request.display?.height ?? 768),
      password: request.password,
    };
    if (request.username !== undefined) connectionConfig.username = request.username;
    if (protocol === 'rdp') {
      connectionConfig.dpi = String(request.display?.dpi ?? 96);
      connectionConfig.security = request.rdp?.security ?? 'any';
      connectionConfig.ignoreCert = request.rdp?.ignoreCertificate ?? true;
      connectionConfig.resizeMethod = request.rdp?.resizeMethod ?? 'display-update';
      if (request.rdp?.remoteApp) connectionConfig.remoteApp = `||${request.rdp.remoteApp.replace(/^\|\|/, '')}`;
      if (request.rdp?.remoteAppDirectory) connectionConfig.remoteAppDir = request.rdp.remoteAppDirectory;
      if (request.rdp?.remoteAppArguments) connectionConfig.remoteAppArgs = request.rdp.remoteAppArguments;
    }
    try {
      const response = await axios.post<{ token?: string }>(
        `${this.options.apiBaseUrl.replace(/\/$/, '')}/api/remote-desktop/token`,
        { protocol, connectionConfig },
        {
          timeout: this.options.timeoutMs ?? 10_000,
          headers: { 'X-Nexus-Gateway-Secret': this.options.sharedSecret },
        },
      );
      if (!response.data?.token) throw new Error('远程桌面网关返回了无效令牌。');
      return { token: response.data.token };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response) {
          const detail =
            typeof error.response.data === 'object' && error.response.data && 'error' in error.response.data
              ? String((error.response.data as { error?: unknown }).error ?? error.message)
              : error.message;
          throw new Error(`远程桌面网关请求失败 (状态: ${error.response.status}): ${detail}`);
        }
        if (error.request) throw new Error('无法连接远程桌面网关或请求超时。');
      }
      throw error;
    }
  }
}
