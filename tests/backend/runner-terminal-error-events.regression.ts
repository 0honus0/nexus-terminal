import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { RunnerWorkspaceTerminalAdapter } from '../../packages/backend/src/infrastructure/agent/workspace-runtime/runner-workspace-terminal.adapter';

class FakeWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  paused = false;
  terminated = false;

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  send(_data: unknown, _options?: unknown, callback?: (error?: Error) => void): void {
    if (typeof _options === 'function') {
      (_options as (error?: Error) => void)();
      return;
    }
    callback?.();
  }

  close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }

  terminate(): void {
    this.terminated = true;
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  }
}

const open = async () => {
  const socket = new FakeWebSocket();
  const adapter = new RunnerWorkspaceTerminalAdapter({
    openTerminalWebSocket: async () => socket as unknown as WebSocket,
  });
  const session = await adapter.open({
    workspaceId: 'workspace-1',
    generation: 1,
    columns: 80,
    rows: 24,
  });
  return { socket, adapter, session };
};

const main = async (): Promise<void> => {
  {
    const { socket, session } = await open();
    assert.doesNotThrow(
      () => socket.emit('error', new Error('runner terminal socket failed')),
      'an unobserved Runner terminal socket error must not become an uncaught EventEmitter error',
    );
    await session.close();
  }

  {
    const { socket, session } = await open();
    session.onError(() => {
      throw new Error('consumer terminal error listener failed');
    });
    assert.doesNotThrow(
      () => socket.emit('error', new Error('runner terminal socket failed')),
      'a throwing terminal error subscriber must be isolated from the WebSocket event stack',
    );
    await session.close();
  }

  {
    const { socket, session } = await open();
    session.onData(() => {
      throw new Error('consumer terminal data listener failed');
    });
    assert.doesNotThrow(
      () => socket.emit('message', Buffer.from('terminal-data'), true),
      'a throwing terminal data subscriber must be isolated from the Duplex/WebSocket event stack',
    );
    await session.close();
  }

  {
    const { socket, session } = await open();
    session.onClose(() => {
      throw new Error('consumer terminal close listener failed');
    });
    assert.doesNotThrow(
      () => socket.emit('close'),
      'a throwing terminal close subscriber must be isolated from the WebSocket event stack',
    );
  }

  process.stdout.write('runner terminal error event regression: PASS\n');
};

void main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`);
  process.exitCode = 1;
});
