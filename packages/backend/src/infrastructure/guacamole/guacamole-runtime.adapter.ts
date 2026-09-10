import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type WebSocket from 'ws';
import GuacamoleLite from 'guacamole-lite';
import { logger } from '../../shared/logging/logger';
import type {
  RemoteDesktopSessionIssuer,
  RemoteDesktopSessionRequest,
} from '../../platform/remote-desktop/remote-desktop-session-issuer.port';

const DEFAULT_TICKET_TTL_MS = 30_000;
const MAX_PENDING_TICKETS = 1024;
const BRIDGE_SETTING = 'nexus-bridge-id';

interface RemoteDesktopTicketRecord {
  userId: number;
  request: RemoteDesktopSessionRequest;
  expiresAt: number;
}

interface GuacamoleConnectionSettings {
  connection?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface GuacamoleRuntimeAdapterOptions {
  guacdHost: string;
  guacdPort: number;
  ticketTtlMs?: number;
}

/**
 * In-process Guacamole runtime. Public browser sessions use opaque, single-use tickets;
 * guacamole-lite's encrypted token is retained only as an internal compatibility shim
 * carrying a one-time bridge id and never contains Nexus connection credentials.
 */
export class GuacamoleRuntimeAdapter implements RemoteDesktopSessionIssuer {
  private readonly tickets = new Map<string, RemoteDesktopTicketRecord>();
  private readonly pendingBridgeSettings = new Map<string, Record<string, string>>();
  private readonly internalEncryptionKey = crypto.randomBytes(32);
  private readonly ticketTtlMs: number;
  private readonly server: GuacamoleLite;
  private closed = false;

  constructor(private readonly options: GuacamoleRuntimeAdapterOptions) {
    this.ticketTtlMs = options.ticketTtlMs ?? DEFAULT_TICKET_TTL_MS;
    this.server = new GuacamoleLite(
      { server: undefined, noServer: true },
      { host: options.guacdHost, port: options.guacdPort },
      {
        crypt: { key: this.internalEncryptionKey, cypher: 'aes-256-cbc' },
        connectionDefaultSettings: {},
      },
      {
        processConnectionSettings: (settings, callback) => this.resolveBridgeSettings(settings, callback),
      },
    );
    this.server.on('error', (client, error) => {
      logger.error({ err: error, connectionId: client?.connectionId ?? 'unknown' }, 'Guacamole client error');
    });
  }

  async createSession(userId: number, request: RemoteDesktopSessionRequest): Promise<{ ticket: string }> {
    this.pruneExpiredTickets();
    if (this.tickets.size >= MAX_PENDING_TICKETS) throw new Error('远程桌面会话请求过多，请稍后重试。');
    const ticket = crypto.randomBytes(32).toString('base64url');
    this.tickets.set(ticket, {
      userId,
      request,
      expiresAt: Date.now() + this.ticketTtlMs,
    });
    return { ticket };
  }

  acceptSession(ticket: string, userId: number, socket: WebSocket, request: IncomingMessage): boolean {
    const record = this.consumeTicket(ticket, userId);
    if (!record) return false;

    const bridgeId = crypto.randomBytes(18).toString('base64url');
    this.pendingBridgeSettings.set(bridgeId, this.toGuacamoleSettings(record.request));
    const token = this.createInternalBridgeToken(record.request.protocol.toLowerCase() as 'rdp' | 'vnc', bridgeId);
    const requestWithInternalToken = Object.create(request) as IncomingMessage;
    requestWithInternalToken.url = `/?token=${encodeURIComponent(token)}`;

    void this.server.newConnection(socket, requestWithInternalToken).catch((error) => {
      this.pendingBridgeSettings.delete(bridgeId);
      logger.error({ err: error }, 'Failed to accept remote desktop session');
      if (socket.readyState === socket.OPEN) socket.close(1011, 'Remote desktop connection failed');
    });
    return true;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.tickets.clear();
    this.pendingBridgeSettings.clear();
    this.server.close();
  }

  private consumeTicket(ticket: string, userId: number): RemoteDesktopTicketRecord | null {
    this.pruneExpiredTickets();
    const record = this.tickets.get(ticket);
    if (!record || record.userId !== userId || record.expiresAt <= Date.now()) return null;
    this.tickets.delete(ticket);
    return record;
  }

  private pruneExpiredTickets(): void {
    const now = Date.now();
    for (const [ticket, record] of this.tickets) {
      if (record.expiresAt <= now) this.tickets.delete(ticket);
    }
  }

  private resolveBridgeSettings(
    settings: GuacamoleConnectionSettings,
    callback: (error?: Error, settings?: GuacamoleConnectionSettings) => void,
  ): void {
    const bridgeId = settings.connection?.[BRIDGE_SETTING];
    if (typeof bridgeId !== 'string') {
      callback(new Error('远程桌面内部连接配置已失效。'));
      return;
    }
    const resolved = this.pendingBridgeSettings.get(bridgeId);
    if (!resolved) {
      callback(new Error('远程桌面内部连接配置已失效。'));
      return;
    }
    this.pendingBridgeSettings.delete(bridgeId);
    callback(undefined, { ...settings, connection: resolved });
  }

  private createInternalBridgeToken(protocol: 'rdp' | 'vnc', bridgeId: string): string {
    const payload = JSON.stringify({ connection: { type: protocol, settings: { [BRIDGE_SETTING]: bridgeId } } });
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', this.internalEncryptionKey, iv);
    const value = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]).toString('base64');
    return Buffer.from(JSON.stringify({ iv: iv.toString('base64'), value })).toString('base64');
  }

  private toGuacamoleSettings(request: RemoteDesktopSessionRequest): Record<string, string> {
    const protocol = request.protocol.toLowerCase() as 'rdp' | 'vnc';
    const settings: Record<string, string> = {
      hostname: request.host,
      port: String(request.port),
      width: String(request.display?.width ?? 1024),
      height: String(request.display?.height ?? 768),
      password: request.password,
    };
    if (request.username !== undefined) settings.username = request.username;

    if (protocol === 'rdp') {
      settings.dpi = String(request.display?.dpi ?? 96);
      settings.security = request.rdp?.security ?? 'any';
      settings['ignore-cert'] = String(request.rdp?.ignoreCertificate ?? true);
      settings['resize-method'] = request.rdp?.resizeMethod ?? 'display-update';
      if (request.rdp?.remoteApp) settings['remote-app'] = `||${request.rdp.remoteApp.replace(/^\|\|/, '')}`;
      if (request.rdp?.remoteAppDirectory) settings['remote-app-dir'] = request.rdp.remoteAppDirectory;
      if (request.rdp?.remoteAppArguments) settings['remote-app-args'] = request.rdp.remoteAppArguments;
    }
    return settings;
  }
}
