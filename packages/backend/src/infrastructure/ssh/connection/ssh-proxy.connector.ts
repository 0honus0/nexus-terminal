import http from 'node:http';
import net from 'node:net';
import { Client, type ConnectConfig } from 'ssh2';
import { SocksClient, type SocksClientOptions } from 'socks';
import type { ResolvedSshConnection, ResolvedSshProxy } from '../../../platform/connection/ssh-connection';
import { connectSshClient, createConnectConfig } from './ssh-client.connector';

const abortError = (): DOMException => new DOMException('SSH proxy connection aborted.', 'AbortError');

const openSocksTunnel = async (
  destinationHost: string,
  destinationPort: number,
  proxy: ResolvedSshProxy,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<net.Socket> => {
  if (signal?.aborted) throw abortError();
  const options: SocksClientOptions = {
    proxy: {
      host: proxy.host,
      port: proxy.port,
      type: 5,
      userId: proxy.username,
      password: proxy.password,
    },
    command: 'connect',
    destination: { host: destinationHost, port: destinationPort },
    timeout: timeoutMs,
  };
  const pending = SocksClient.createConnection(options);
  if (!signal) return (await pending).socket;

  return new Promise<net.Socket>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    pending.then(({ socket }) => {
      signal.removeEventListener('abort', onAbort);
      if (settled || signal.aborted) {
        socket.destroy();
        if (!settled) reject(abortError());
        return;
      }
      settled = true;
      resolve(socket);
    }, (error) => {
      signal.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
};

const openHttpTunnel = (
  destinationHost: string,
  destinationPort: number,
  proxy: ResolvedSshProxy,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<net.Socket> => new Promise((resolve, reject) => {
  if (signal?.aborted) {
    reject(abortError());
    return;
  }

  const options: http.RequestOptions = {
    method: 'CONNECT',
    host: proxy.host,
    port: proxy.port,
    path: `${destinationHost}:${destinationPort}`,
    timeout: timeoutMs,
    agent: false,
  };
  if (proxy.username) {
    options.headers = {
      'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64')}`,
      'Proxy-Connection': 'Keep-Alive',
      Host: `${destinationHost}:${destinationPort}`,
    };
  }

  const request = http.request(options);
  let settled = false;
  const cleanup = () => signal?.removeEventListener('abort', onAbort);
  const fail = (error: Error) => {
    if (settled) return;
    settled = true;
    cleanup();
    reject(error);
  };
  const onAbort = () => {
    request.destroy();
    fail(abortError());
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  request.once('connect', (response, socket) => {
    if (settled) {
      socket.destroy();
      return;
    }
    if (response.statusCode !== 200) {
      socket.destroy();
      fail(new Error(`HTTP proxy ${proxy.host}:${proxy.port} connection failed (status: ${response.statusCode})`));
      return;
    }
    settled = true;
    cleanup();
    resolve(socket);
  });
  request.once('error', (error) => fail(error));
  request.once('timeout', () => {
    request.destroy();
    fail(new Error(`HTTP proxy ${proxy.host}:${proxy.port} connection timed out`));
  });
  request.end();
});

export const connectViaProxy = async (
  connection: ResolvedSshConnection,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Client> => {
  const proxy = connection.proxy;
  if (!proxy) throw new Error(`Connection ${connection.displayName} is configured for proxy routing without proxy details.`);

  const socket = proxy.type === 'SOCKS5'
    ? await openSocksTunnel(connection.host, connection.port, proxy, timeoutMs, signal)
    : await openHttpTunnel(connection.host, connection.port, proxy, timeoutMs, signal);

  const client = new Client();
  const config: ConnectConfig = {
    ...createConnectConfig(connection, timeoutMs),
    host: connection.host,
    port: connection.port,
    sock: socket,
  };
  try {
    return await connectSshClient(client, {
      config,
      label: `SSH ${connection.displayName} (${connection.connectionId}, proxy)`,
      signal,
    });
  } catch (error) {
    socket.destroy();
    throw error;
  }
};
