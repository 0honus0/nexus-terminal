import http from 'node:http';
import net from 'node:net';
import { Client, type ConnectConfig } from 'ssh2';
import { SocksClient, type SocksClientOptions } from 'socks';
import type { ResolvedSshConnection, ResolvedSshProxy } from './ssh-connection.types';
import { connectSshClient, createConnectConfig } from './ssh-client-connector';

const openSocksTunnel = async (
  destinationHost: string,
  destinationPort: number,
  proxy: ResolvedSshProxy,
  timeoutMs: number,
): Promise<net.Socket> => {
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
  const { socket } = await SocksClient.createConnection(options);
  return socket;
};

const openHttpTunnel = (
  destinationHost: string,
  destinationPort: number,
  proxy: ResolvedSshProxy,
  timeoutMs: number,
): Promise<net.Socket> => new Promise((resolve, reject) => {
  const options: http.RequestOptions = {
    method: 'CONNECT',
    host: proxy.host,
    port: proxy.port,
    path: `${destinationHost}:${destinationPort}`,
    timeout: timeoutMs,
    agent: false,
  };

  if (proxy.username) {
    const auth = Buffer.from(`${proxy.username}:${proxy.password || ''}`).toString('base64');
    options.headers = {
      'Proxy-Authorization': `Basic ${auth}`,
      'Proxy-Connection': 'Keep-Alive',
      Host: `${destinationHost}:${destinationPort}`,
    };
  }

  const request = http.request(options);
  request.once('connect', (response, socket) => {
    if (response.statusCode === 200) resolve(socket);
    else {
      socket.destroy();
      reject(new Error(`HTTP proxy ${proxy.host}:${proxy.port} connection failed (status: ${response.statusCode})`));
    }
  });
  request.once('error', reject);
  request.once('timeout', () => {
    request.destroy();
    reject(new Error(`HTTP proxy ${proxy.host}:${proxy.port} connection timed out`));
  });
  request.end();
});

export const connectViaProxy = async (
  connection: ResolvedSshConnection,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Client> => {
  if (signal?.aborted) throw new DOMException('SSH proxy connection aborted before start.', 'AbortError');
  const proxy = connection.proxy;
  if (!proxy) throw new Error(`Connection ${connection.name} is configured for proxy routing without proxy details.`);

  const socket = proxy.type === 'SOCKS5'
    ? await openSocksTunnel(connection.host, connection.port, proxy, timeoutMs)
    : await openHttpTunnel(connection.host, connection.port, proxy, timeoutMs);

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
      connectionId: connection.id,
      connectionName: connection.name,
      finalClient: true,
      signal,
    });
  } catch (error) {
    socket.destroy();
    throw error;
  }
};
