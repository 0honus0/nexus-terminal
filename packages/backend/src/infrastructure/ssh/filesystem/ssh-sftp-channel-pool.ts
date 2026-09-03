import type { Client, SFTPWrapper } from 'ssh2';
import type { RemoteFileSystem, RemoteFileSystemRole } from '../../../platform/filesystem/remote-filesystem';
import { SshRemoteFileSystemAdapter } from './ssh-remote-file-system.adapter';

type ChannelState = {
  channel?: SFTPWrapper;
  opening?: Promise<SFTPWrapper>;
  filesystem?: RemoteFileSystem;
};

/** Owns independent SFTP channels by workload role over one SSH transport. */
export class SshSftpChannelPool {
  private readonly states = new Map<RemoteFileSystemRole, ChannelState>();
  private closed = false;

  constructor(private readonly client: Client) {}

  fileSystem(role: RemoteFileSystemRole): RemoteFileSystem {
    if (this.closed) throw new Error('SFTP channel pool is closed.');
    const state = this.state(role);
    state.filesystem ??= new SshRemoteFileSystemAdapter(() => this.open(role));
    return state.filesystem;
  }

  closeAll(): void {
    if (this.closed) return;
    this.closed = true;
    for (const state of this.states.values()) {
      const channel = state.channel;
      state.channel = undefined;
      state.opening = undefined;
      state.filesystem = undefined;
      if (channel) {
        try {
          channel.end();
        } catch {
          /* SSH teardown is the final lifecycle backstop. */
        }
      }
    }
    this.states.clear();
  }

  private state(role: RemoteFileSystemRole): ChannelState {
    const existing = this.states.get(role);
    if (existing) return existing;
    const state: ChannelState = {};
    this.states.set(role, state);
    return state;
  }

  private async open(role: RemoteFileSystemRole): Promise<SFTPWrapper> {
    if (this.closed) throw new Error('SFTP channel pool is closed.');
    const state = this.state(role);
    if (state.channel) return state.channel;
    if (state.opening) return state.opening;

    const opening = new Promise<SFTPWrapper>((resolve, reject) => {
      this.client.sftp((error, channel) => {
        if (error) {
          reject(error);
          return;
        }
        if (this.closed) {
          try {
            channel.end();
          } catch {
            /* best effort */
          }
          reject(new Error('SFTP channel pool closed while opening a channel.'));
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

    state.opening = opening;
    try {
      return await opening;
    } finally {
      if (state.opening === opening) state.opening = undefined;
    }
  }
}
