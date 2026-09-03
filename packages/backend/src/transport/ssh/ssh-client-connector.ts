import { Client, type ConnectConfig } from 'ssh2';

export interface ConnectClientOptions {
  config: ConnectConfig;
  connectionId: number | null;
  connectionName: string;
  finalClient: boolean;
  signal?: AbortSignal;
}

export const connectSshClient = (client: Client, options: ConnectClientOptions): Promise<Client> => {
  const { config, connectionId, connectionName, finalClient, signal } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('SSH connection aborted before start.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const prefix = `SSH ${connectionName} (${connectionId ?? 'N/A'}, ${finalClient ? 'final' : 'intermediate'})`;

    const onReady = () => {
      client.removeListener('error', onError);
      client.removeListener('close', onCloseBeforeReady);
      signal?.removeEventListener('abort', onAbort);
      try {
        client.setNoDelay(true);
      } catch (error) {
        console.warn(`[${prefix}] unable to enable TCP no-delay:`, error);
      }
      resolve(client);
    };

    const onError = (error: Error) => {
      client.removeListener('ready', onReady);
      client.removeListener('close', onCloseBeforeReady);
      signal?.removeEventListener('abort', onAbort);
      try { client.end(); } catch { /* best effort */ }
      reject(error);
    };

    const onCloseBeforeReady = () => {
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
      reject(new Error(`[${prefix}] SSH connection closed before ready.`));
    };

    const onAbort = () => {
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      client.removeListener('close', onCloseBeforeReady);
      try { client.end(); } catch { /* best effort */ }
      reject(new DOMException('SSH connection aborted.', 'AbortError'));
    };

    client.once('ready', onReady);
    client.once('error', onError);
    client.once('close', onCloseBeforeReady);
    signal?.addEventListener('abort', onAbort, { once: true });
    client.connect(config);
  });
};

export const createConnectConfig = (
  connection: {
    host?: string;
    port?: number;
    username: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
  },
  timeoutMs: number,
): ConnectConfig => ({
  host: connection.host,
  port: connection.port,
  username: connection.username,
  password: connection.password,
  privateKey: connection.privateKey,
  passphrase: connection.passphrase,
  readyTimeout: timeoutMs,
  keepaliveInterval: 5000,
  keepaliveCountMax: 10,
});
