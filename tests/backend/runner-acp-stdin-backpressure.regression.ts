import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { AcpProcessRuntime } from '../../packages/agent-runner/src/controller/acp-process-runtime';
import { initializeManagedProcessRegistry } from '../../packages/agent-runner/src/managed-process';

class FakeWebSocket extends EventEmitter {
  readyState = WebSocket.OPEN;
  bufferedAmount = 0;
  pauseCount = 0;
  resumeCount = 0;

  pause(): void {
    this.pauseCount += 1;
  }

  resume(): void {
    this.resumeCount += 1;
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSED || this.readyState === WebSocket.CLOSING) return;
    this.readyState = WebSocket.CLOSING;
    queueMicrotask(() => {
      this.readyState = WebSocket.CLOSED;
      this.emit('close');
    });
  }

  send(): void {}
}

const waitUntil = async (predicate: () => boolean, timeoutMs = 2_000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('TEST_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const main = async (): Promise<void> => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-acp-backpressure-'));
  try {
    initializeManagedProcessRegistry(root);
    const runtime = new AcpProcessRuntime({} as never, {} as never);
    const socket = new FakeWebSocket();
    let released = 0;
    const internal = runtime as unknown as {
      attach(
        websocket: WebSocket,
        execution: { file: string; argv: string[]; cwd: string; env: NodeJS.ProcessEnv },
        workspaceId: string,
        generation: number,
        releaseWriter: () => void,
      ): void;
    };

    internal.attach(
      socket as unknown as WebSocket,
      {
        file: process.execPath,
        argv: [
          '-e',
          "setTimeout(() => { process.stdin.on('data', () => undefined); process.stdin.resume(); }, 250); setInterval(() => undefined, 1000);",
        ],
        cwd: process.cwd(),
        env: { ...process.env },
      },
      'workspace-backpressure',
      1,
      () => {
        released += 1;
      },
    );

    socket.emit('message', Buffer.alloc(256 * 1024, 0x61), true);
    await waitUntil(() => socket.pauseCount > 0);
    assert.equal(socket.pauseCount, 1, 'stdin highWaterMark pressure must pause ACP WebSocket input');

    await waitUntil(() => socket.resumeCount > 0);
    assert.equal(socket.resumeCount, 1, 'stdin drain must resume a still-open ACP WebSocket');

    await runtime.closeWorkspace('workspace-backpressure', 1);
    const resumesAfterClose = socket.resumeCount;
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(socket.resumeCount, resumesAfterClose, 'closed ACP sessions must not be resumed by late drain events');
    assert.equal(released, 1, 'workspace writer ownership must still be released exactly once');

    process.stdout.write('runner ACP stdin backpressure regression: PASS\n');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
