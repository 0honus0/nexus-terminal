import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import type { RemoteShellSession } from '../../../platform/execution/remote-execution.port';
import { emitSshEventSafely, invokeSshListenerSafely } from '../ssh-event-dispatch';

export class SshShellSessionAdapter implements RemoteShellSession {
  private readonly events = new EventEmitter();
  private open = true;

  constructor(private readonly channel: ClientChannel) {
    channel.on('data', (data: Buffer | string) =>
      emitSshEventSafely(this.events, 'data', Buffer.isBuffer(data) ? data : Buffer.from(data)),
    );
    channel.stderr.on('data', (data: Buffer | string) =>
      emitSshEventSafely(this.events, 'stderr', Buffer.isBuffer(data) ? data : Buffer.from(data)),
    );
    channel.on('error', (error: Error) => emitSshEventSafely(this.events, 'shell-error', error));
    channel.on('close', () => {
      if (!this.open) return;
      this.open = false;
      emitSshEventSafely(this.events, 'close');
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

  signal(signal: string): void {
    if (!this.isOpen) return;
    this.channel.signal(signal);
  }

  pause(): void {
    if (this.isOpen) this.channel.pause();
  }

  resume(): void {
    if (this.isOpen) this.channel.resume();
  }

  onDrain(listener: () => void): () => void {
    const wrapped = () => invokeSshListenerSafely(listener);
    this.channel.on('drain', wrapped);
    return () => this.channel.off('drain', wrapped);
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
    this.events.on('shell-error', listener);
    return () => this.events.off('shell-error', listener);
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    try {
      this.channel.close();
    } catch {
      this.channel.destroy();
    }
  }
}
