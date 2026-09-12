import { Duplex } from 'node:stream';
import WebSocket from 'ws';

const MAX_FRAME_BYTES = 256 * 1024;
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;

/** Byte-preserving duplex bridge for an authenticated native Runner PTY WebSocket. */
export class RunnerWebSocketDuplex extends Duplex {
  private ended = false;

  constructor(private readonly socket: WebSocket) {
    super({ allowHalfOpen: false, readableHighWaterMark: 1024 * 1024, writableHighWaterMark: 1024 * 1024 });
    socket.on('message', (data, isBinary) => {
      if (!isBinary) {
        this.destroy(new Error('WORKSPACE_TERMINAL_PROTOCOL_INVALID'));
        return;
      }
      const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (!this.push(bytes)) socket.pause();
    });
    socket.once('close', () => {
      this.ended = true;
      this.push(null);
    });
    socket.once('error', (error) => this.destroy(error));
  }

  override _read(): void {
    this.socket.resume();
  }

  override _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    if (this.ended || this.socket.readyState !== WebSocket.OPEN) {
      callback(new Error('WORKSPACE_TERMINAL_TUNNEL_CLOSED'));
      return;
    }
    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      callback(new Error('WORKSPACE_TERMINAL_TUNNEL_BACKPRESSURE'));
      return;
    }
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    let offset = 0;
    const sendNext = (): void => {
      if (offset >= bytes.byteLength) {
        callback();
        return;
      }
      const frame = bytes.subarray(offset, Math.min(offset + MAX_FRAME_BYTES, bytes.byteLength));
      offset += frame.byteLength;
      this.socket.send(frame, { binary: true }, (error) => {
        if (error) callback(error);
        else sendNext();
      });
    };
    sendNext();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.close(1000);
    callback();
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    this.ended = true;
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.terminate();
    }
    callback(error);
  }
}
