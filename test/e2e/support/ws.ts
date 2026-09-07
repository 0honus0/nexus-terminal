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
  url = 'ws://127.0.0.1:4173/ws/workspace',
): Promise<E2eWebSocket> {
  const state = await request.storageState();
  const cookies = state.cookies
    .filter((cookie) => cookie.domain === '127.0.0.1' || cookie.domain === 'localhost')
    .map((cookie) => `${cookie.name}=${cookie.value}`)
    .join('; ');

  const socket = new WebSocket(url, { headers: { Cookie: cookies } });
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

export function waitForBinaryText(socket: E2eWebSocket, expectedText: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WebSocket binary text: ${expectedText}`));
    }, timeoutMs);
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (!isBinary) return;
      chunks.push(Buffer.from(data));
      const output = Buffer.concat(chunks).toString('utf8');
      if (!output.includes(expectedText)) return;
      cleanup();
      resolve(output);
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed before binary text was received: ${expectedText}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

export async function requestWorkspace<T = unknown>(
  socket: E2eWebSocket,
  type: string,
  payload: Record<string, unknown> = {},
  requestId = crypto.randomUUID(),
  timeoutMs = 20_000,
): Promise<T> {
  const responsePromise = waitForJson(
    socket,
    (message) => message.type === 'response' && message.requestId === requestId,
    timeoutMs,
  );
  sendJson(socket, { type, payload, requestId });
  const response = await responsePromise;
  if (!response.payload?.ok) throw new Error(`${type} failed: ${String(response.payload?.error ?? 'unknown error')}`);
  return response.payload.data as T;
}

export async function openWorkspaceSession(
  request: APIRequestContext,
  connectionId: number,
  workspaceId = `e2e-${crypto.randomUUID()}`,
): Promise<{ socket: E2eWebSocket; workspaceId: string }> {
  const socket = await openAuthenticatedWebSocket(request);
  const connected = await requestWorkspace<{ workspaceId: string }>(socket, 'workspace.connect', {
    connectionId,
    workspaceId,
    viewport: { columns: 100, rows: 30 },
  });
  return { socket, workspaceId: connected.workspaceId };
}

export async function waitForFilesystemReady(socket: E2eWebSocket): Promise<void> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await requestWorkspace(
        socket,
        'filesystem.list',
        { path: '/' },
        `filesystem-ready-${attempt}-${crypto.randomUUID()}`,
        2_000,
      );
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error('Filesystem did not become ready');
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
