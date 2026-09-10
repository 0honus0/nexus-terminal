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

const WORKSPACE_BINARY_MAGIC = 0x4e585731;
const WORKSPACE_BINARY_PROTOCOL_VERSION = 1;
const WORKSPACE_BINARY_HEADER_BYTES = 16;
const WORKSPACE_BINARY_TERMINAL = 1;
const WORKSPACE_BINARY_RESPONSE = 2;
const WORKSPACE_BINARY_FINAL = 1;

export const decodeWorkspaceBinaryFrame = (data: Buffer) => {
  if (data.byteLength < WORKSPACE_BINARY_HEADER_BYTES) throw new Error('Workspace binary frame is truncated');
  if (
    data.readUInt32BE(0) !== WORKSPACE_BINARY_MAGIC ||
    data.readUInt8(4) !== WORKSPACE_BINARY_PROTOCOL_VERSION ||
    data.readUInt8(7) !== 0 ||
    data.readUInt16BE(10) !== 0
  ) {
    throw new Error('Workspace binary protocol mismatch');
  }
  const type = data.readUInt8(5);
  const flags = data.readUInt8(6);
  const requestIdBytes = data.readUInt16BE(8);
  const payloadBytes = data.readUInt32BE(12);
  if (data.byteLength !== WORKSPACE_BINARY_HEADER_BYTES + requestIdBytes + payloadBytes) {
    throw new Error('Workspace binary frame length mismatch');
  }
  const requestId = data
    .subarray(WORKSPACE_BINARY_HEADER_BYTES, WORKSPACE_BINARY_HEADER_BYTES + requestIdBytes)
    .toString('utf8');
  const payload = data.subarray(WORKSPACE_BINARY_HEADER_BYTES + requestIdBytes);
  return { type, flags, requestId, payload };
};

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
      const frame = decodeWorkspaceBinaryFrame(Buffer.from(data));
      if (frame.type !== WORKSPACE_BINARY_TERMINAL) return;
      chunks.push(frame.payload);
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

export function requestWorkspaceBinary<T = unknown>(
  socket: E2eWebSocket,
  type: string,
  payload: Record<string, unknown> = {},
  requestId = crypto.randomUUID(),
  timeoutMs = 20_000,
): Promise<{ data: T; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let response: JsonWsMessage | undefined;
    let binaryDone = false;
    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const settle = () => {
      if (!response || !binaryDone) return;
      cleanup();
      if (!response.payload?.ok) {
        reject(new Error(`${type} failed: ${String(response.payload?.error ?? 'unknown error')}`));
        return;
      }
      resolve({ data: response.payload.data as T, bytes: Buffer.concat(chunks) });
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for Workspace binary response: ${type}`));
    }, timeoutMs);
    const onMessage = (raw: Buffer, isBinary: boolean) => {
      if (isBinary) {
        const frame = decodeWorkspaceBinaryFrame(Buffer.from(raw));
        if (frame.type !== WORKSPACE_BINARY_RESPONSE || frame.requestId !== requestId) return;
        if (frame.payload.byteLength) chunks.push(frame.payload);
        if ((frame.flags & WORKSPACE_BINARY_FINAL) !== 0) binaryDone = true;
        settle();
        return;
      }
      let parsed: JsonWsMessage;
      try {
        parsed = JSON.parse(Buffer.from(raw).toString('utf8')) as JsonWsMessage;
      } catch {
        return;
      }
      if (parsed.type !== 'response' || parsed.requestId !== requestId) return;
      response = parsed;
      if (!parsed.payload?.ok) binaryDone = true;
      settle();
    };
    const onClose = () => {
      cleanup();
      reject(new Error(`WebSocket closed before Workspace binary response: ${type}`));
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    socket.on('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
    sendJson(socket, { type, payload, requestId });
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
  const connected = await requestWorkspace<{ workspaceId: string; binaryProtocolVersion: number }>(
    socket,
    'workspace.connect',
    {
      connectionId,
      workspaceId,
      viewport: { columns: 100, rows: 30 },
    },
  );
  if (connected.binaryProtocolVersion !== WORKSPACE_BINARY_PROTOCOL_VERSION) {
    throw new Error(`Unexpected Workspace binary protocol: ${connected.binaryProtocolVersion}`);
  }
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
