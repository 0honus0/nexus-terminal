import WebSocket from 'ws';
import type { WorkspaceTerminalService } from '../../modules/workspace/services/workspace-terminal.service';

const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_BYTES = 256 * 1024;
const BACKPRESSURE_POLL_MS = 10;

/**
 * Clean terminal transport: every binary server frame on the Workspace socket is raw terminal bytes.
 * Framing, sequence numbers and application ACKs are deliberately absent; WebSocket ordering plus
 * bufferedAmount-driven backpressure is the permanent transport contract.
 */
export class TerminalStreamTransport {
  private workspaceId?: string;
  private readonly queue: Buffer[] = [];
  private queuedBytes = 0;
  private timer?: NodeJS.Timeout;
  private backpressured = false;
  private disposed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly terminal: WorkspaceTerminalService,
  ) {}

  bind(workspaceId: string): void {
    if (this.workspaceId && this.workspaceId !== workspaceId) {
      throw new Error(`Terminal transport is already bound to workspace ${this.workspaceId}.`);
    }
    this.workspaceId = workspaceId;
    this.reconcileBackpressure();
  }

  enqueue(data: Uint8Array): void {
    if (this.disposed || data.byteLength === 0 || this.socket.readyState !== WebSocket.OPEN) return;
    for (let offset = 0; offset < data.byteLength; offset += MAX_CHUNK_BYTES) {
      const chunk = Buffer.from(data.subarray(offset, Math.min(offset + MAX_CHUNK_BYTES, data.byteLength)));
      this.queue.push(chunk);
      this.queuedBytes += chunk.byteLength;
      if (this.queuedBytes > MAX_QUEUED_BYTES) {
        this.socket.close(1013, 'Terminal consumer is too slow');
        this.dispose();
        return;
      }
    }
    this.flush();
  }

  async sendStream(
    stream: AsyncIterable<Uint8Array | Buffer | string>,
    filter: (chunk: string) => string,
  ): Promise<void> {
    for await (const chunk of stream) {
      const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
      const visible = filter(text);
      if (!visible) continue;
      this.enqueue(Buffer.from(visible, 'utf8'));
      await this.waitForCapacity();
    }
    await this.waitForDrain();
  }

  unbind(): void {
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.setBackpressured(false);
    this.workspaceId = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.setBackpressured(false);
    this.workspaceId = undefined;
  }

  private flush(): void {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
    while (this.queue.length && this.socket.bufferedAmount < HIGH_WATER_BYTES) {
      const chunk = this.queue.shift()!;
      this.queuedBytes -= chunk.byteLength;
      this.socket.send(chunk, { binary: true });
    }
    if (this.queue.length || this.socket.bufferedAmount >= HIGH_WATER_BYTES) {
      this.setBackpressured(true);
      this.scheduleFlush();
    } else if (this.socket.bufferedAmount <= LOW_WATER_BYTES) {
      this.setBackpressured(false);
    }
  }

  private scheduleFlush(): void {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, BACKPRESSURE_POLL_MS);
    this.timer.unref?.();
  }

  private async waitForCapacity(): Promise<void> {
    while (
      !this.disposed &&
      this.socket.readyState === WebSocket.OPEN &&
      this.socket.bufferedAmount >= HIGH_WATER_BYTES
    ) {
      await new Promise((resolve) => setTimeout(resolve, BACKPRESSURE_POLL_MS));
    }
    this.flush();
  }

  private async waitForDrain(): Promise<void> {
    while (
      !this.disposed &&
      this.socket.readyState === WebSocket.OPEN &&
      (this.queue.length > 0 || this.socket.bufferedAmount > LOW_WATER_BYTES)
    ) {
      this.flush();
      await new Promise((resolve) => setTimeout(resolve, BACKPRESSURE_POLL_MS));
    }
  }

  private setBackpressured(active: boolean): void {
    if (this.backpressured === active) return;
    this.backpressured = active;
    this.reconcileBackpressure();
  }

  private reconcileBackpressure(): void {
    if (!this.workspaceId) return;
    try {
      this.terminal.setConsumerBackpressure(this.workspaceId, this.backpressured);
    } catch {
      // Workspace teardown may race a final bufferedAmount update.
    }
  }
}
