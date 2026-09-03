import { Client } from 'ssh2';
import type { ResolvedSshConnection } from './ssh-connection.types';
import { connectSshClient, createConnectConfig } from './ssh-client-connector';
import { connectViaProxy } from './ssh-proxy-connector';
import { connectViaJumpChain } from './ssh-jump-connector';

export const DEFAULT_SSH_CONNECT_TIMEOUT_MS = 20_000;

export type SshConnectedHook = (connection: ResolvedSshConnection) => void | Promise<void>;

export class SshConnectionFactory {
  constructor(private readonly onConnected?: SshConnectedHook) {}

  async connect(
    connection: ResolvedSshConnection,
    timeoutMs = DEFAULT_SSH_CONNECT_TIMEOUT_MS,
    signal?: AbortSignal,
  ): Promise<Client> {
    let client: Client;
    if (connection.route === 'jump' && connection.jumpChain?.length) {
      client = await connectViaJumpChain(connection, timeoutMs, signal);
    } else if (connection.route === 'proxy' && connection.proxy) {
      client = await connectViaProxy(connection, timeoutMs, signal);
    } else {
      if (connection.route === 'jump') {
        console.warn(`[SSH ${connection.name}] jump route has no jump hosts; falling back to direct connection.`);
      } else if (connection.route === 'proxy') {
        console.warn(`[SSH ${connection.name}] proxy route has no proxy details; falling back to direct connection.`);
      }
      client = new Client();
      await connectSshClient(client, {
        config: createConnectConfig(connection, timeoutMs),
        connectionId: connection.id,
        connectionName: connection.name,
        finalClient: true,
        signal,
      });
    }

    if (connection.id > 0 && this.onConnected) {
      setImmediate(() => {
        void Promise.resolve(this.onConnected?.(connection)).catch((error) => {
          console.error(`[SSH ${connection.name}] connected hook failed:`, error);
        });
      });
    }
    return client;
  }
}

export const sshConnectionFactory = new SshConnectionFactory(async (connection) => {
  const { updateLastConnected } = await import('../../../modules/connections/connection.repository.js');
  await updateLastConnected(connection.id, Math.floor(Date.now() / 1000));
});
