import assert from 'node:assert/strict';
import http from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { RunnerWebSocketTransport } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-websocket-transport';

const listen = (server: http.Server): Promise<number> =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('listener address unavailable'));
        return;
      }
      resolve(address.port);
    });
  });

async function main(): Promise<void> {
  const wss = new WebSocketServer({ noServer: true });
  let peer: WebSocket | undefined;
  const server = http.createServer();
  server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (websocket) => {
      peer = websocket;
      wss.emit('connection', websocket, request);
    });
  });

  const port = await listen(server);
  try {
    const runner = new RunnerWebSocketTransport(new URL(`http://127.0.0.1:${port}`), 'test-token', 'test-protocol');
    const controller = new AbortController();
    const transport = await runner.openBrowserTunnel(
      {
        scope: 'external-network',
        via: 'runner',
        url: 'ws://browser.internal:9222',
        priority: 0,
        allowPlaintext: true,
        verifyTls: false,
      },
      { targetId: 'browser', targetRevision: 1 },
      controller.signal,
    );

    assert(peer, 'runner-side websocket peer must connect');

    let secondMessageListenerCalled = false;
    transport.onMessage(() => {
      throw new Error('consumer message failure');
    });
    transport.onMessage((message) => {
      secondMessageListenerCalled = message === 'hello';
    });

    assert.doesNotThrow(() => peer!.send('hello'));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(secondMessageListenerCalled, true, 'one throwing message listener must not block the next listener');

    let secondCloseListenerCalled = false;
    transport.onClose(() => {
      throw new Error('consumer close failure');
    });
    transport.onClose(() => {
      secondCloseListenerCalled = true;
    });

    assert.doesNotThrow(() => peer!.close(1000));
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(secondCloseListenerCalled, true, 'one throwing close listener must not block the next listener');

    await transport.close();
    process.stdout.write('browser transport listener isolation regression: PASS\n');
  } finally {
    for (const client of wss.clients) client.terminate();
    wss.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
