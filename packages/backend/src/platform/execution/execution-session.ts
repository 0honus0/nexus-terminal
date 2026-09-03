import type { Client } from 'ssh2';
import { SftpChannelManager } from '../../infrastructure/ssh/sftp/sftp-channel-manager';
import { CommandSessionManager } from './command-session-manager';

export type ExecutionSessionOwnerType = 'workspace' | 'agent' | 'system';
export type ExecutionSessionStatus = 'ready' | 'detached' | 'closed';

export interface ExecutionSessionOptions {
  id: string;
  connectionId: number;
  ownerType: ExecutionSessionOwnerType;
  ownerId?: string;
  client: Client;
}

/**
 * Runtime ownership boundary for one SSH transport.
 * Workspace and Agent features use the same abstraction but never share a
 * session instance unless explicitly designed to do so.
 */
export class ExecutionSession {
  public readonly id: string;
  public readonly connectionId: number;
  public readonly ownerType: ExecutionSessionOwnerType;
  public readonly ownerId?: string;
  public readonly sftp: SftpChannelManager;
  public readonly commands: CommandSessionManager;
  private _status: ExecutionSessionStatus = 'ready';
  private _client?: Client;

  constructor(options: ExecutionSessionOptions) {
    this.id = options.id;
    this.connectionId = options.connectionId;
    this.ownerType = options.ownerType;
    this.ownerId = options.ownerId;
    this._client = options.client;
    this.sftp = new SftpChannelManager(options.client);
    this.commands = new CommandSessionManager(options.client);
  }

  get status(): ExecutionSessionStatus {
    return this._status;
  }

  get client(): Client {
    if (!this._client || this._status !== 'ready') throw new Error(`Execution session ${this.id} is not attached.`);
    return this._client;
  }

  get isReady(): boolean {
    return this._status === 'ready' && Boolean(this._client);
  }

  /**
   * Transfer ownership of the underlying SSH client (used by suspend/resume).
   * All session-owned SFTP channels are closed before ownership changes.
   */
  detachClient(): Client {
    if (!this._client || this._status !== 'ready') throw new Error(`Execution session ${this.id} is not attached.`);
    const client = this._client;
    this.commands.closeAllNow();
    this.sftp.closeAll();
    this._client = undefined;
    this._status = 'detached';
    return client;
  }

  close(): void {
    if (this._status === 'closed') return;
    this.commands.closeAllNow();
    this.sftp.closeAll();
    const client = this._client;
    this._client = undefined;
    this._status = 'closed';
    if (client) {
      try {
        client.end();
      } catch {
        // Best effort; the remote transport may already be gone.
      }
    }
  }
}
