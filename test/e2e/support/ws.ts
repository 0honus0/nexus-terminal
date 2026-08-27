import path from 'node:path';
import { createRequire } from 'node:module';
import type { APIRequestContext } from '@playwright/test';

const repoRoot = path.resolve(process.cwd(), '../..');
const requireFromBackend = createRequire(path.join(repoRoot, 'packages', 'backend', 'package.json'));
const WebSocket = requireFromBackend('ws') as any;

export interface JsonWsMessage {
  type?: string;
  requestId?: string;
  payload?: any;
  [key: string]: any;
}

export type E2eWebSocket = any;

export async function openAuthenticatedWebSocket(
  request: APIRequestContext,
  url = 'ws://127.0.0.1:4173/ws',
  options: { autoAcknowledgeTerminalFrames?: boolean } = {},
): Promise<E2eWebSocket> {
  const state = await request.storageState();
  const cookies = state.cookies
    .filter((cookie) => cookie.domain === '127.0.0.1' || cookie.domain === 'localhost')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const socket = new WebSocket(url, { headers: { Cookie: cookies } });
  // Mirror the real frontend transport contract: every NXTM terminal frame is
  // acknowledged after receipt. Resume commits intentionally wait for cached
  // terminal-frame ACKs before sending ssh:connected / RESUMED notifications.
  socket.on('message', (data: Buffer, isBinary: boolean) => {
    if (
      options.autoAcknowledgeTerminalFrames === false
      || !isBinary
      || data.length < 16
      || data.subarray(0, 4).toString('ascii') !== 'NXTM'
    ) return;
    const sequence = data.readUInt32BE(12);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'ssh:output:ack', payload: { sequence } }));
    }
  });
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`WebSocket open timeout: ${url}`)), 10_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', (error: Error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  return socket;
}

export function sendJson(socket: E2eWebSocket, message: JsonWsMessage): void {
  socket.send(JSON.stringify(message));
}

export function waitForJson(
  socket: E2eWebSocket,
  predicate: (message: JsonWsMessage) => boolean,
  timeoutMs = 15_000,
): Promise<JsonWsMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      reject(new Error('Timed out waiting for WebSocket JSON message'));
    }, timeoutMs);

    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) return;
      let parsed: JsonWsMessage;
      try {
        parsed = JSON.parse(data.toString('utf8'));
      } catch {
        return;
      }
      if (!predicate(parsed)) return;
      clearTimeout(timeout);
      socket.off('message', onMessage);
      resolve(parsed);
    };
    socket.on('message', onMessage);
  });
}

export async function openSshSession(
  request: APIRequestContext,
  connectionId: number,
  clientSessionId = `e2e-${crypto.randomUUID()}`,
): Promise<{ socket: E2eWebSocket; sessionId: string }> {
  const socket = await openAuthenticatedWebSocket(request);
  const connectedPromise = waitForJson(socket, (message) => message.type === 'ssh:connected', 20_000);
  sendJson(socket, {
    type: 'ssh:connect',
    payload: { connectionId: String(connectionId), clientSessionId },
  });
  const connected = await connectedPromise;
  return { socket, sessionId: String(connected.payload?.sessionId) };
}

export async function requestJson(
  socket: E2eWebSocket,
  type: string,
  payload: unknown,
  successType: string,
  errorType: string,
  requestId = crypto.randomUUID(),
  timeoutMs = 20_000,
): Promise<JsonWsMessage> {
  const responsePromise = waitForJson(
    socket,
    (message) => message.requestId === requestId
      && (message.type === successType || message.type === errorType),
    timeoutMs,
  );
  sendJson(socket, { type, payload, requestId });
  const response = await responsePromise;
  if (response.type === errorType) {
    throw new Error(`${type} failed: ${JSON.stringify(response.payload)}`);
  }
  return response;
}

export async function waitForSftpReady(socket: E2eWebSocket): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const requestId = `sftp-ready-${attempt}-${crypto.randomUUID()}`;
    const responsePromise = waitForJson(
      socket,
      (message) => message.requestId === requestId
        && (message.type === 'sftp:readdir:success' || message.type === 'sftp:readdir:error'),
      2_000,
    );
    sendJson(socket, { type: 'sftp:readdir', payload: { path: '/' }, requestId });
    const response = await responsePromise;
    if (response.type === 'sftp:readdir:success') return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('SFTP did not become ready');
}

export async function closeWebSocket(socket: E2eWebSocket): Promise<void> {
  if (!socket || socket.readyState >= WebSocket.CLOSING) return;
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, 2_000);
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.close();
  });
}
