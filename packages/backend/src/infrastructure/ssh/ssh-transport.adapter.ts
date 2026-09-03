import { Client } from 'ssh2';
import type { ResolvedSshConnection, SshConnectOptions } from '../../platform/connection/ssh-connection';
import type {
  RemoteExecutionTransport,
  RemoteExecutionTransportFactory,
} from '../../platform/execution/remote-execution.port';
import { connectSshClient, createConnectConfig } from './connection/ssh-client.connector';
import { connectViaJumpChain } from './connection/ssh-jump.connector';
import { connectViaProxy } from './connection/ssh-proxy.connector';
import { SshExecutionTransportAdapter } from './execution/ssh-execution-transport.adapter';

const DEFAULT_CONNECT_TIMEOUT_MS = 20_000;

export interface SshTransportAdapterOptions {
  onConnected?: (connection: ResolvedSshConnection) => void | Promise<void>;
}

export class SshTransportAdapter implements RemoteExecutionTransportFactory {
  constructor(private readonly options: SshTransportAdapterOptions = {}) {}

  async connect(connection: ResolvedSshConnection, options: SshConnectOptions = {}): Promise<RemoteExecutionTransport> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const signal = options.signal;
    let client: Client;

    if (connection.route === 'jump' && connection.jumpChain?.length) {
      client = await connectViaJumpChain(connection, timeoutMs, signal);
    } else if (connection.route === 'proxy' && connection.proxy) {
      client = await connectViaProxy(connection, timeoutMs, signal);
    } else {
      if (connection.route === 'jump') {
        console.warn(
          `[SSH ${connection.displayName}] jump route has no jump hosts; falling back to direct connection.`,
        );
      } else if (connection.route === 'proxy') {
        console.warn(
          `[SSH ${connection.displayName}] proxy route has no proxy details; falling back to direct connection.`,
        );
      }
      client = new Client();
      await connectSshClient(client, {
        config: createConnectConfig(connection, timeoutMs),
        label: `SSH ${connection.displayName} (${connection.connectionId}, direct)`,
        signal,
      });
    }

    if (connection.connectionId > 0 && this.options.onConnected) {
      setImmediate(() => {
        void Promise.resolve(this.options.onConnected?.(connection)).catch((error) => {
          console.error(`[SSH ${connection.displayName}] onConnected hook failed:`, error);
        });
      });
    }

    return new SshExecutionTransportAdapter(connection.connectionId, client);
  }
}
