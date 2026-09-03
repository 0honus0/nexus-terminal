import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import type { RemoteShellSession } from '../../../platform/execution/remote-execution.port';

export class SshShellSessionAdapter implements RemoteShellSession {
  private readonly events = new EventEmitter();
  private open = true;

  constructor(private readonly channel: ClientChannel) {
    channel.on('data', (data: Buffer | string) => this.events.emit('data', Buffer.isBuffer(data) ? data : Buffer.from(data)));
    channel.stderr.on('data', (data: Buffer | string) => this.events.emit('stderr', Buffer.isBuffer(data) ? data : Buffer.from(data)));
    channel.on('error', (error: Error) => this.events.emit('error', error));
    channel.on('close', () => {
      if (!this.open) return;
      this.open = false;
      this.events.emit('close');
    });
  }

  get isOpen(): boolean {
    return this.open && !this.channel.destroyed;
  }

  write(data: string | Uint8Array): boolean {
    if (!this.isOpen) return false;
    return this.channel.write(typeof data === 'string' ? data : Buffer.from(data));
  }

  resize(columns: number, rows: number): void {
    if (!this.isOpen) return;
    if (!Number.isInteger(columns) || columns <= 0 || !Number.isInteger(rows) || rows <= 0) {
      throw new Error('Shell columns and rows must be positive integers.');
    }
    this.channel.setWindow(rows, columns, 0, 0);
  }

  onData(listener: (data: Uint8Array) => void): () => void {
    this.events.on('data', listener);
    return () => this.events.off('data', listener);
  }

  onStderr(listener: (data: Uint8Array) => void): () => void {
    this.events.on('stderr', listener);
    return () => this.events.off('stderr', listener);
  }

  onClose(listener: () => void): () => void {
    this.events.on('close', listener);
    return () => this.events.off('close', listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('error', listener);
    return () => this.events.off('error', listener);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    try { this.channel.close(); } catch { this.channel.destroy(); }
  }
}
