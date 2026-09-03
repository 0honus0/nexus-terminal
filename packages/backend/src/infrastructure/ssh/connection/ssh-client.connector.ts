import { Client, type ConnectConfig } from 'ssh2';

export interface ConnectClientOptions {
  config: ConnectConfig;
  label: string;
  signal?: AbortSignal;
}

export const connectSshClient = (client: Client, options: ConnectClientOptions): Promise<Client> => {
  const { config, label, signal } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('SSH connection aborted before start.', 'AbortError'));

  return new Promise((resolve, reject) => {
    let settled = false;

    const cleanup = () => {
      client.removeListener('ready', onReady);
      client.removeListener('error', onError);
      client.removeListener('close', onCloseBeforeReady);
      signal?.removeEventListener('abort', onAbort);
    };
    const settleResolve = () => {
      if (settled) return;
      settled = true;
      cleanup();
      try {
        client.setNoDelay(true);
      } catch {
        // TCP no-delay is an optimization, not a connection requirement.
      }
      resolve(client);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      try { client.end(); } catch { /* best effort */ }
      reject(error);
    };
    const onReady = () => settleResolve();
    const onError = (error: Error) => settleReject(error);
    const onCloseBeforeReady = () => settleReject(new Error(`[${label}] SSH connection closed before ready.`));
    const onAbort = () => settleReject(new DOMException('SSH connection aborted.', 'AbortError'));

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
