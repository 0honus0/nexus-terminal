import WebSocket from 'ws';
import type { WorkspaceTerminalService } from '../../modules/workspace/services/workspace-terminal.service';
import { logger } from '../../shared/logging/logger';
import { runtimePerformanceMetrics } from '../../shared/observability/runtime-performance';

const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;
const MAX_QUEUED_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_BYTES = 256 * 1024;
const MIN_BACKPRESSURE_POLL_MS = 5;
const MAX_BACKPRESSURE_POLL_MS = 40;

type Waiter = () => void;

/**
 * Clean terminal transport: every binary server frame on the Workspace socket is raw terminal bytes.
 * Framing, sequence numbers and application ACKs are deliberately absent; WebSocket ordering plus
 * bufferedAmount-driven backpressure is the permanent transport contract.
 */
export class TerminalStreamTransport {
  private workspaceId?: string;
  private readonly queue: Buffer[] = [];
  private queueHead = 0;
  private queuedBytes = 0;
  private timer?: NodeJS.Timeout;
  private pollDelayMs = MIN_BACKPRESSURE_POLL_MS;
  private backpressured = false;
  private backpressureStartedAt = 0n;
  private disposed = false;
  private readonly capacityWaiters = new Set<Waiter>();
  private readonly drainWaiters = new Set<Waiter>();

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
      runtimePerformanceMetrics.recordTerminalEnqueue(chunk.byteLength, this.queuedBytes, this.socket.bufferedAmount);
      if (this.queuedBytes > MAX_QUEUED_BYTES) {
        logger.warn(
          {
            workspaceId: this.workspaceId,
            queuedBytes: this.queuedBytes,
            socketBufferedBytes: this.socket.bufferedAmount,
            queueLimitBytes: MAX_QUEUED_BYTES,
          },
          'Terminal output queue limit exceeded',
        );
        this.socket.close(1013, 'Terminal consumer is too slow');
        this.dispose();
        return;
      }
    }
    this.flush();
  }

  async sendStream(
    stream: AsyncIterable<Uint8Array | Buffer | string>,
    filter: (chunk: Uint8Array) => Uint8Array,
  ): Promise<void> {
    for await (const chunk of stream) {
      const bytes =
        typeof chunk === 'string'
          ? Buffer.from(chunk, 'utf8')
          : Buffer.isBuffer(chunk)
            ? chunk
            : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
      const filterStartedAt = runtimePerformanceMetrics.operationStarted();
      const visible = filter(bytes);
      if (filterStartedAt !== 0n) {
        runtimePerformanceMetrics.recordTerminalMarkerFilter(process.hrtime.bigint() - filterStartedAt);
      }
      if (!visible.byteLength) continue;
      this.enqueue(visible);
      await this.waitForCapacity();
    }
    await this.waitForDrain();
  }

  unbind(): void {
    this.clearQueue();
    this.clearTimer();
    this.resolveAllWaiters();
    this.pollDelayMs = MIN_BACKPRESSURE_POLL_MS;
    this.setBackpressured(false);
    this.workspaceId = undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearTimer();
    this.clearQueue();
    this.resolveAllWaiters();
    this.setBackpressured(false);
    this.workspaceId = undefined;
  }

  private flush(scheduleNext = true): number {
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN) {
      this.resolveAllWaiters();
      return 0;
    }
    runtimePerformanceMetrics.recordTerminalFlush();
    let sentBytes = 0;
    while (this.hasQueuedChunks() && this.socket.bufferedAmount < HIGH_WATER_BYTES) {
      const chunk = this.dequeue()!;
      this.queuedBytes -= chunk.byteLength;
      this.socket.send(chunk, { binary: true });
      sentBytes += chunk.byteLength;
      runtimePerformanceMetrics.recordTerminalSent(chunk.byteLength, this.queuedBytes, this.socket.bufferedAmount);
      runtimePerformanceMetrics.recordWebSocketOutbound(chunk.byteLength);
    }
    this.recordBuffers();

    if (this.socket.bufferedAmount < HIGH_WATER_BYTES) this.resolveWaiters(this.capacityWaiters);

    const needsPolling = this.hasQueuedChunks() || this.socket.bufferedAmount > LOW_WATER_BYTES;
    if (needsPolling) {
      if (this.hasQueuedChunks() || this.socket.bufferedAmount >= HIGH_WATER_BYTES) this.setBackpressured(true);
      if (scheduleNext) this.scheduleFlush();
    } else {
      this.pollDelayMs = MIN_BACKPRESSURE_POLL_MS;
      this.setBackpressured(false);
      this.resolveWaiters(this.drainWaiters);
    }
    return sentBytes;
  }

  private scheduleFlush(): void {
    if (this.timer || this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
    const delay = this.pollDelayMs;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      runtimePerformanceMetrics.recordTerminalBackpressurePoll();
      const pressureBefore = this.pressureBytes();
      const sentBytes = this.flush(false);
      const pressureAfter = this.pressureBytes();

      if (this.needsPolling()) {
        const madeProgress = sentBytes > 0 || pressureAfter < pressureBefore;
        this.pollDelayMs = madeProgress
          ? MIN_BACKPRESSURE_POLL_MS
          : Math.min(MAX_BACKPRESSURE_POLL_MS, Math.max(MIN_BACKPRESSURE_POLL_MS, delay * 2));
        this.scheduleFlush();
      } else {
        this.pollDelayMs = MIN_BACKPRESSURE_POLL_MS;
      }
    }, delay);
    this.timer.unref?.();
  }

  private waitForCapacity(): Promise<void> {
    this.flush();
    if (this.disposed || this.socket.readyState !== WebSocket.OPEN || this.socket.bufferedAmount < HIGH_WATER_BYTES) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.capacityWaiters.add(resolve);
      this.scheduleFlush();
    });
  }

  private waitForDrain(): Promise<void> {
    this.flush();
    if (
      this.disposed ||
      this.socket.readyState !== WebSocket.OPEN ||
      (!this.hasQueuedChunks() && this.socket.bufferedAmount <= LOW_WATER_BYTES)
    ) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.drainWaiters.add(resolve);
      this.scheduleFlush();
    });
  }

  private hasQueuedChunks(): boolean {
    return this.queueHead < this.queue.length;
  }

  private dequeue(): Buffer | undefined {
    if (!this.hasQueuedChunks()) return undefined;
    const value = this.queue[this.queueHead++];
    if (this.queueHead === this.queue.length) {
      // Only compact storage here. queuedBytes is decremented by flush() after
      // the chunk has actually been handed to WebSocket.
      this.queue.length = 0;
      this.queueHead = 0;
    } else if (this.queueHead >= 1024 && this.queueHead * 2 >= this.queue.length) {
      this.queue.splice(0, this.queueHead);
      this.queueHead = 0;
    }
    return value;
  }

  private clearQueue(): void {
    this.queue.length = 0;
    this.queueHead = 0;
    this.queuedBytes = 0;
  }

  private needsPolling(): boolean {
    return (
      !this.disposed &&
      this.socket.readyState === WebSocket.OPEN &&
      (this.hasQueuedChunks() || this.socket.bufferedAmount > LOW_WATER_BYTES)
    );
  }

  private pressureBytes(): number {
    return this.queuedBytes + this.socket.bufferedAmount;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private resolveWaiters(waiters: Set<Waiter>): void {
    if (!waiters.size) return;
    const callbacks = [...waiters];
    waiters.clear();
    for (const resolve of callbacks) resolve();
  }

  private resolveAllWaiters(): void {
    this.resolveWaiters(this.capacityWaiters);
    this.resolveWaiters(this.drainWaiters);
  }

  private setBackpressured(active: boolean): void {
    if (this.backpressured === active) return;
    this.backpressured = active;
    if (active) this.backpressureStartedAt = runtimePerformanceMetrics.operationStarted();
    else if (this.backpressureStartedAt !== 0n) {
      runtimePerformanceMetrics.recordTerminalBackpressureDuration(this.backpressureStartedAt);
      this.backpressureStartedAt = 0n;
    }
    runtimePerformanceMetrics.terminalBackpressureChanged(active);
    logger.debug(
      {
        workspaceId: this.workspaceId,
        active,
        queuedBytes: this.queuedBytes,
        socketBufferedBytes: this.socket.bufferedAmount,
      },
      'Terminal output backpressure changed',
    );
    this.reconcileBackpressure();
  }

  private recordBuffers(): void {
    runtimePerformanceMetrics.recordTerminalBuffers(this.queuedBytes, this.socket.bufferedAmount);
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
