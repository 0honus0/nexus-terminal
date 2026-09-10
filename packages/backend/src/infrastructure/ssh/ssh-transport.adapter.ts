import { Client } from 'ssh2';
import type { ResolvedSshConnection, SshConnectOptions } from '../../platform/connection/ssh-connection';
import { logger } from '../../shared/logging/logger';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';
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
    const connectStartedAt = runtimePerformanceMetrics.operationStarted();
    try {
      const timeoutMs = options.timeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
      const signal = options.signal;
      let client: Client;

      if (connection.route === 'jump' && connection.jumpChain?.length) {
        client = await connectViaJumpChain(connection, timeoutMs, signal);
      } else if (connection.route === 'proxy' && connection.proxy) {
        client = await connectViaProxy(connection, timeoutMs, signal);
      } else {
        if (connection.route === 'jump') {
          logger.warn(
            { connectionId: connection.connectionId, displayName: connection.displayName },
            'SSH jump route has no jump hosts; falling back to direct connection',
          );
        } else if (connection.route === 'proxy') {
          logger.warn(
            { connectionId: connection.connectionId, displayName: connection.displayName },
            'SSH proxy route has no proxy details; falling back to direct connection',
          );
        }
        client = new Client();
        await connectSshClient(client, {
          config: createConnectConfig(connection, timeoutMs),
          label: `SSH ${connection.displayName} (${connection.connectionId}, direct)`,
          signal,
        });
      }

      if (connectStartedAt !== 0n) {
        runtimePerformanceMetrics.recordSshConnect(connectStartedAt, true);
      }

      if (connection.connectionId > 0 && this.options.onConnected && !options.suppressConnectedHook) {
        setImmediate(() => {
          void Promise.resolve(this.options.onConnected?.(connection)).catch((error) => {
            logger.error(
              { err: error, connectionId: connection.connectionId, displayName: connection.displayName },
              'SSH onConnected hook failed',
            );
          });
        });
      }

      return new SshExecutionTransportAdapter(connection.connectionId, client);
    } catch (error) {
      if (connectStartedAt !== 0n) {
        runtimePerformanceMetrics.recordSshConnect(connectStartedAt, false);
      }
      throw error;
    }
  }
}
