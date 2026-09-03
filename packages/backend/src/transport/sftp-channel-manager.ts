import type { Client, SFTPWrapper } from 'ssh2';

export type SftpChannelRole = 'control' | 'transfer' | 'background';

type RoleState = {
  channel?: SFTPWrapper;
  initPromise?: Promise<SFTPWrapper>;
};

/**
 * Owns multiple independent SFTP subsystem channels over one SSH transport.
 * The roles intentionally separate latency-sensitive control operations from
 * bulk transfer/background work so one workload cannot head-of-line block the
 * others.
 */
export class SftpChannelManager {
  private readonly states = new Map<SftpChannelRole, RoleState>();
  private closed = false;

  constructor(private readonly client: Client) {}

  get control(): SFTPWrapper | undefined {
    return this.states.get('control')?.channel;
  }

  get transfer(): SFTPWrapper | undefined {
    return this.states.get('transfer')?.channel;
  }

  get background(): SFTPWrapper | undefined {
    return this.states.get('background')?.channel;
  }

  async ensure(role: SftpChannelRole): Promise<SFTPWrapper> {
    if (this.closed) throw new Error('SFTP channel manager is closed.');
    const state = this.states.get(role) ?? {};
    this.states.set(role, state);
    if (state.channel) return state.channel;
    if (state.initPromise) return state.initPromise;

    const initPromise = new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        if (this.closed) {
          try {
            channel.end();
          } catch {
            // Manager closed while the remote subsystem was being created.
          }
          reject(new Error('SFTP channel manager was closed during initialization.'));
          return;
        }

        state.channel = channel;
        const detach = () => {
          if (state.channel === channel) state.channel = undefined;
        };
        channel.once('end', detach);
        channel.once('close', detach);
        channel.once('error', detach);
        resolve(channel);
      });
    });

    state.initPromise = initPromise;
    try {
      return await initPromise;
    } finally {
      if (state.initPromise === initPromise) state.initPromise = undefined;
    }
  }

  close(role: SftpChannelRole): void {
    const state = this.states.get(role);
    const channel = state?.channel;
    state && (state.channel = undefined);
    state && (state.initPromise = undefined);
    if (!channel) return;
    try {
      channel.end();
    } catch {
      // Best effort cleanup; SSH transport teardown is the final boundary.
    }
  }

  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const role of ['control', 'transfer', 'background'] as const) this.close(role);
    this.states.clear();
  }
}
