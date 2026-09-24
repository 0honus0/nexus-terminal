import { EventEmitter } from 'node:events';
import { Client, type ConnectConfig } from 'ssh2';
import { emitSshEventSafely, invokeSshListenerSafely } from '../ssh-event-dispatch';

const ROUTE_CLOSE_TIMEOUT_MS = 1000;

export interface ConnectClientOptions {
  config: ConnectConfig;
  label: string;
  signal?: AbortSignal;
}

export class ConnectedSshClient {
  private readonly events = new EventEmitter();
  private closed = false;
  private lastErrorValue?: Error;
  private readonly closedPromise: Promise<void>;
  private resolveClosed!: () => void;

  constructor(
    public readonly client: Client,
    public readonly label: string,
  ) {
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    client.on('error', this.onClientError);
    client.on('close', this.onClientClose);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get lastError(): Error | undefined {
    return this.lastErrorValue;
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('transport-error', listener);
    return () => this.events.off('transport-error', listener);
  }

  onClose(listener: () => void): () => void {
    this.events.on('transport-close', listener);
    return () => this.events.off('transport-close', listener);
  }

  async waitClosed(): Promise<void> {
    if (this.closed) return;
    await this.closedPromise;
  }

  end(): void {
    try {
      this.client.end();
    } catch {
      // Best effort; the permanent raw error listener remains installed until GC.
    }
  }

  private readonly onClientError = (error: Error): void => {
    this.lastErrorValue = error;
    emitSshEventSafely(this.events, 'transport-error', error);
  };

  private readonly onClientClose = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.resolveClosed();
    emitSshEventSafely(this.events, 'transport-close');
  };
}

export class SshClientRoute {
  private readonly events = new EventEmitter();
  private readonly clients: ConnectedSshClient[] = [];
  private readonly unsubscribers: Array<() => void> = [];
  private primaryValue?: ConnectedSshClient;
  private open = true;
  private failureValue?: Error;
  private closePromise?: Promise<void>;

  constructor(public readonly label: string) {}

  get client(): Client {
    if (!this.primaryValue) throw new Error(`[${this.label}] SSH route has no primary client.`);
    return this.primaryValue.client;
  }

  get isOpen(): boolean {
    return this.open;
  }

  get failure(): Error | undefined {
    return this.failureValue;
  }

  addIntermediate(client: ConnectedSshClient): void {
    this.adopt(client);
  }

  setPrimary(client: ConnectedSshClient): void {
    if (this.primaryValue) throw new Error(`[${this.label}] SSH route primary client is already set.`);
    this.primaryValue = client;
    this.adopt(client);
  }

  assertOpen(): void {
    if (this.open) return;
    throw this.failureValue ?? new Error(`[${this.label}] SSH route closed before handoff.`);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('transport-error', listener);
    if (this.failureValue) invokeSshListenerSafely(listener, this.failureValue);
    return () => this.events.off('transport-error', listener);
  }

  onClose(listener: () => void): () => void {
    this.events.on('transport-close', listener);
    if (!this.open) invokeSshListenerSafely(listener);
    return () => this.events.off('transport-close', listener);
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.beginClose();
    const clients = [...this.clients];
    this.closePromise = Promise.race([
      Promise.all(clients.map((client) => client.waitClosed())).then(() => undefined),
      new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, ROUTE_CLOSE_TIMEOUT_MS);
        timeout.unref?.();
      }),
    ]).finally(() => {
      for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe();
    });
    return this.closePromise;
  }

  private adopt(client: ConnectedSshClient): void {
    this.clients.push(client);
    this.unsubscribers.push(
      client.onError((error) => this.fail(error)),
      client.onClose(() => this.handleClientClose(client)),
    );

    if (client.lastError) {
      this.fail(client.lastError);
      return;
    }
    if (client.isClosed) this.handleClientClose(client);
  }

  private fail(error: Error): void {
    if (!this.open) return;
    if (!this.failureValue) {
      this.failureValue = error;
      emitSshEventSafely(this.events, 'transport-error', error);
    }
    this.beginClose();
  }

  private handleClientClose(client: ConnectedSshClient): void {
    if (!this.open) return;
    this.failureValue ??= new Error(`[${client.label}] SSH client closed unexpectedly.`);
    this.beginClose();
  }

  private beginClose(): void {
    if (!this.open) return;
    this.open = false;
    emitSshEventSafely(this.events, 'transport-close');
    for (const client of [...this.clients].reverse()) client.end();
  }
}

export const connectSshClient = (client: Client, options: ConnectClientOptions): Promise<ConnectedSshClient> => {
  const { config, label, signal } = options;
  if (signal?.aborted) return Promise.reject(new DOMException('SSH connection aborted before start.', 'AbortError'));

  const connected = new ConnectedSshClient(client, label);
  return new Promise((resolve, reject) => {
    let settled = false;
    let offError: () => void = () => undefined;
    let offClose: () => void = () => undefined;

    const cleanup = () => {
      client.removeListener('ready', onReady);
      offError();
      offClose();
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
      resolve(connected);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      connected.end();
      reject(error);
    };
    const onReady = () => settleResolve();
    const onAbort = () => settleReject(new DOMException('SSH connection aborted.', 'AbortError'));

    offError = connected.onError((error) => settleReject(error));
    offClose = connected.onClose(() => settleReject(new Error(`[${label}] SSH connection closed before ready.`)));
    client.once('ready', onReady);
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
