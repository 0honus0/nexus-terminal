import { StringDecoder } from 'node:string_decoder';
import WebSocket from 'ws';
import type { WorkspaceTerminalService } from '../../../modules/workspace/services/workspace-terminal.service';

const MAGIC = Buffer.from('NXTM', 'ascii');
const VERSION = 1;
const HEADER_SIZE = 16;
const MAX_PAYLOAD_BYTES = 256 * 1024;
const BATCH_BYTES = 64 * 1024;
const BATCH_DELAY_MS = 1;
const HIGH_WATER_BYTES = 1024 * 1024;
const LOW_WATER_BYTES = 256 * 1024;
const BACKPRESSURE_POLL_MS = 10;
const ACK_TIMEOUT_MS = 120_000;

export const enum LegacyTerminalFrameType {
  Output = 1,
  CachedOutput = 2,
}
export const enum LegacyTerminalFrameFlag {
  Final = 1 << 0,
}

interface PendingAck {
  bytes: number;
  resolve?: () => void;
  reject?: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/** Current frontend NXTM transport. Delete with the legacy WebSocket protocol adapter. */
export class LegacyTerminalBinaryTransport {
  private workspaceId?: string;
  private sequence = 0;
  private chunks: Buffer[] = [];
  private queuedBytes = 0;
  private flushTimer?: NodeJS.Timeout;
  private backpressureTimer?: NodeJS.Timeout;
  private networkBackpressure = false;
  private applicationBackpressure = false;
  private readonly pendingAcks = new Map<number, PendingAck>();
  private unackedBytes = 0;
  private disposed = false;

  constructor(
    private readonly socket: WebSocket,
    private readonly terminal: WorkspaceTerminalService,
  ) {}

  bindWorkspace(workspaceId: string): void {
    if (this.workspaceId && this.workspaceId !== workspaceId) {
      throw new Error(`Terminal transport is already bound to workspace ${this.workspaceId}.`);
    }
    this.workspaceId = workspaceId;
    this.reconcileFlow();
  }

  queueOutput(payload: Uint8Array): void {
    if (this.disposed || payload.byteLength === 0 || this.socket.readyState !== WebSocket.OPEN) return;
    const buffer = Buffer.from(payload);
    for (let offset = 0; offset < buffer.length; offset += BATCH_BYTES) {
      const chunk = buffer.subarray(offset, Math.min(offset + BATCH_BYTES, buffer.length));
      if (this.queuedBytes && this.queuedBytes + chunk.length > BATCH_BYTES) this.flushOutput();
      this.chunks.push(chunk);
      this.queuedBytes += chunk.length;
      if (this.queuedBytes >= BATCH_BYTES) this.flushOutput();
    }
    if (this.queuedBytes && !this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushOutput(), BATCH_DELAY_MS);
      this.flushTimer.unref?.();
    }
  }

  flushOutput(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    if (!this.queuedBytes) return;
    const payload = this.chunks.length === 1 ? this.chunks[0]! : Buffer.concat(this.chunks, this.queuedBytes);
    this.chunks = [];
    this.queuedBytes = 0;
    this.sendFrames(LegacyTerminalFrameType.Output, payload);
  }

  acknowledge(sequence: number): boolean {
    const pending = this.pendingAcks.get(sequence);
    if (!pending) return false;
    this.pendingAcks.delete(sequence);
    clearTimeout(pending.timeout);
    this.unackedBytes = Math.max(0, this.unackedBytes - pending.bytes);
    pending.resolve?.();
    if (this.unackedBytes <= LOW_WATER_BYTES) {
      this.applicationBackpressure = false;
      this.reconcileFlow();
    }
    return true;
  }

  sendCachedAndWaitForAck(payload: Uint8Array, final = false): Promise<void> {
    const buffer = Buffer.from(payload);
    if (buffer.length > MAX_PAYLOAD_BYTES) throw new Error(`Cached terminal chunk exceeds ${MAX_PAYLOAD_BYTES} bytes.`);
    return this.sendOneAndWait(LegacyTerminalFrameType.CachedOutput, buffer, final ? LegacyTerminalFrameFlag.Final : 0);
  }

  async sendCachedStream(
    stream: AsyncIterable<Uint8Array | Buffer | string>,
    filter: (chunk: string) => string,
  ): Promise<void> {
    const decoder = new StringDecoder('utf8');
    let pending: Buffer | undefined;
    const enqueueVisible = async (visible: string): Promise<void> => {
      if (!visible) return;
      const bytes = Buffer.from(visible, 'utf8');
      for (let offset = 0; offset < bytes.length; offset += MAX_PAYLOAD_BYTES) {
        const part = bytes.subarray(offset, Math.min(offset + MAX_PAYLOAD_BYTES, bytes.length));
        if (pending) await this.sendCachedAndWaitForAck(pending);
        pending = part;
      }
    };
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk);
      await enqueueVisible(filter(decoder.write(bytes)));
    }
    await enqueueVisible(filter(decoder.end()));
    await this.sendCachedAndWaitForAck(pending ?? Buffer.alloc(0), true);
  }
  dispose(reason = 'Terminal transport disposed before ACK'): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    if (this.backpressureTimer) clearTimeout(this.backpressureTimer);
    this.flushTimer = undefined;
    this.backpressureTimer = undefined;
    this.chunks = [];
    this.queuedBytes = 0;
    for (const pending of this.pendingAcks.values()) {
      clearTimeout(pending.timeout);
      pending.reject?.(new Error(reason));
    }
    this.pendingAcks.clear();
    this.unackedBytes = 0;
    this.networkBackpressure = false;
    this.applicationBackpressure = false;
    this.reconcileFlow();
    this.workspaceId = undefined;
  }

  private sendFrames(type: LegacyTerminalFrameType, payload: Buffer, flags = 0): boolean {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    const parts: Buffer[] = [];
    if (!payload.length) parts.push(payload);
    else
      for (let offset = 0; offset < payload.length; offset += MAX_PAYLOAD_BYTES)
        parts.push(payload.subarray(offset, offset + MAX_PAYLOAD_BYTES));
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const frameFlags = index === parts.length - 1 ? flags : flags & ~LegacyTerminalFrameFlag.Final;
      const sequence = this.nextSequence();
      this.registerAck(sequence, part.length);
      try {
        this.socket.send(this.encode(type, sequence, part, frameFlags), { binary: true });
      } catch (error) {
        this.discardAck(sequence, error instanceof Error ? error : new Error(String(error)));
        return false;
      }
    }
    this.applyNetworkBackpressure();
    return true;
  }

  private sendOneAndWait(type: LegacyTerminalFrameType, payload: Buffer, flags: number): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) return Promise.reject(new Error('WebSocket is not open.'));
    const sequence = this.nextSequence();
    return new Promise<void>((resolve, reject) => {
      this.registerAck(sequence, payload.length, { resolve, reject });
      try {
        this.socket.send(this.encode(type, sequence, payload, flags), { binary: true }, (error) => {
          if (error) this.discardAck(sequence, error);
        });
        this.applyNetworkBackpressure();
      } catch (error) {
        this.discardAck(sequence, error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private encode(type: LegacyTerminalFrameType, sequence: number, payload: Buffer, flags: number): Buffer {
    const frame = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
    MAGIC.copy(frame, 0);
    frame.writeUInt8(VERSION, 4);
    frame.writeUInt8(type, 5);
    frame.writeUInt8(flags, 6);
    frame.writeUInt8(HEADER_SIZE, 7);
    frame.writeUInt32BE(payload.length, 8);
    frame.writeUInt32BE(sequence, 12);
    payload.copy(frame, HEADER_SIZE);
    return frame;
  }

  private nextSequence(): number {
    const current = this.sequence;
    this.sequence = (this.sequence + 1) >>> 0;
    return current;
  }

  private registerAck(sequence: number, bytes: number, waiter: Pick<PendingAck, 'resolve' | 'reject'> = {}): void {
    if (this.pendingAcks.has(sequence)) throw new Error(`Terminal output sequence ${sequence} is still pending.`);
    const pending: PendingAck = {
      bytes,
      ...waiter,
      timeout: setTimeout(() => {
        this.pendingAcks.delete(sequence);
        this.unackedBytes = Math.max(0, this.unackedBytes - bytes);
        const error = new Error(`Terminal output ACK timeout for sequence ${sequence}`);
        pending.reject?.(error);
        if (this.unackedBytes <= LOW_WATER_BYTES) {
          this.applicationBackpressure = false;
          this.reconcileFlow();
        }
        if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1011, 'Terminal output ACK timeout');
      }, ACK_TIMEOUT_MS),
    };
    pending.timeout.unref?.();
    this.pendingAcks.set(sequence, pending);
    this.unackedBytes += bytes;
    if (this.unackedBytes >= HIGH_WATER_BYTES) {
      this.applicationBackpressure = true;
      this.reconcileFlow();
    }
  }

  private discardAck(sequence: number, error: Error): void {
    const pending = this.pendingAcks.get(sequence);
    if (!pending) return;
    this.pendingAcks.delete(sequence);
    clearTimeout(pending.timeout);
    this.unackedBytes = Math.max(0, this.unackedBytes - pending.bytes);
    pending.reject?.(error);
    if (this.unackedBytes <= LOW_WATER_BYTES) {
      this.applicationBackpressure = false;
      this.reconcileFlow();
    }
  }

  private applyNetworkBackpressure(): void {
    if (this.socket.bufferedAmount < HIGH_WATER_BYTES) return;
    this.networkBackpressure = true;
    this.reconcileFlow();
    this.monitorNetworkBackpressure();
  }

  private monitorNetworkBackpressure(): void {
    if (this.backpressureTimer) return;
    const check = () => {
      this.backpressureTimer = undefined;
      if (this.disposed || this.socket.readyState !== WebSocket.OPEN) return;
      if (this.socket.bufferedAmount <= LOW_WATER_BYTES) {
        this.networkBackpressure = false;
        this.reconcileFlow();
        return;
      }
      this.backpressureTimer = setTimeout(check, BACKPRESSURE_POLL_MS);
      this.backpressureTimer.unref?.();
    };
    this.backpressureTimer = setTimeout(check, BACKPRESSURE_POLL_MS);
    this.backpressureTimer.unref?.();
  }

  private reconcileFlow(): void {
    if (!this.workspaceId) return;
    try {
      this.terminal.setConsumerBackpressure(this.workspaceId, this.networkBackpressure || this.applicationBackpressure);
    } catch {
      // The workspace may already be detached during disconnect/resume rollback.
    }
  }
}
