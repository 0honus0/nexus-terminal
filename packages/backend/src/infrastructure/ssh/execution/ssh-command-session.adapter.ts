import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import type {
  CommandSessionSnapshot,
  CommandSessionStatus,
  RemoteCommandSession,
} from '../../../platform/execution/remote-execution.port';

export class SshCommandSessionAdapter implements RemoteCommandSession {
  readonly startedAt = Date.now();
  private readonly events = new EventEmitter();
  private statusValue: CommandSessionStatus = 'running';
  private exitCodeValue: number | null | undefined;
  private signalValue: string | null | undefined;
  private stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private stderrBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private truncated = false;
  private settled = false;

  constructor(
    public readonly id: string,
    public readonly command: string,
    private readonly channel: ClientChannel,
    private readonly maxOutputBytes: number,
  ) {
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      throw new Error('maxOutputBytes must be a positive integer.');
    }
    this.events.on('error', () => undefined);
    channel.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      this.stdoutBuffer = this.appendBounded(this.stdoutBuffer, chunk);
      this.events.emit('stdout', chunk);
    });
    channel.stderr.on('data', (data: Buffer | string) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
      this.stderrBuffer = this.appendBounded(this.stderrBuffer, chunk);
      this.events.emit('stderr', chunk);
    });
    channel.on('error', (error: Error) => {
      if (!this.settled) this.statusValue = 'failed';
      this.events.emit('error', error);
    });
    channel.on('close', (exitCode: number | null, signal?: string | null) => {
      if (this.settled) return;
      this.settled = true;
      this.exitCodeValue = exitCode;
      this.signalValue = signal;
      if (this.statusValue === 'running') this.statusValue = exitCode === 0 ? 'completed' : 'failed';
      this.events.emit('close', { exitCode, signal });
    });
  }

  get isRunning(): boolean {
    return this.statusValue === 'running';
  }

  snapshot(): CommandSessionSnapshot {
    return {
      id: this.id,
      command: this.command,
      status: this.statusValue,
      startedAt: this.startedAt,
      exitCode: this.exitCodeValue,
      signal: this.signalValue,
      stdout: this.stdoutBuffer.toString('utf8'),
      stderr: this.stderrBuffer.toString('utf8'),
      outputTruncated: this.truncated,
    };
  }

  write(data: string | Uint8Array): boolean {
    if (!this.isRunning || this.channel.destroyed) return false;
    return this.channel.write(typeof data === 'string' ? data : Buffer.from(data));
  }

  signal(signal: string): void {
    if (!this.isRunning || this.channel.destroyed) return;
    this.channel.signal(signal);
  }

  onStdout(listener: (data: Uint8Array) => void): () => void {
    this.events.on('stdout', listener);
    return () => this.events.off('stdout', listener);
  }

  onStderr(listener: (data: Uint8Array) => void): () => void {
    this.events.on('stderr', listener);
    return () => this.events.off('stderr', listener);
  }

  onClose(listener: (event: { exitCode: number | null; signal?: string | null }) => void): () => void {
    this.events.on('close', listener);
    return () => this.events.off('close', listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('error', listener);
    return () => this.events.off('error', listener);
  }

  async terminate(options?: { signal?: string; graceMs?: number; forceMs?: number }): Promise<void> {
    if (!this.isRunning) return;
    const signal = options?.signal ?? 'TERM';
    const graceMs = options?.graceMs ?? 1500;
    const forceMs = options?.forceMs ?? 4000;

    await new Promise<void>((resolve) => {
      let finished = false;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (closeTimer) clearTimeout(closeTimer);
        if (forceTimer) clearTimeout(forceTimer);
        this.events.off('close', finish);
        this.events.off('error', finish);
        resolve();
      };
      this.events.once('close', finish);
      this.events.once('error', finish);
      try { this.signal(signal); } catch { /* remote may not support signals */ }
      closeTimer = setTimeout(() => {
        if (finished || !this.isRunning) return;
        this.statusValue = 'terminated';
        try { this.channel.close(); } catch { this.channel.destroy(); }
      }, graceMs);
      closeTimer.unref?.();
      forceTimer = setTimeout(() => {
        if (finished) return;
        if (!this.settled) this.statusValue = 'terminated';
        if (!this.channel.destroyed) this.channel.destroy();
        finish();
      }, forceMs);
      forceTimer.unref?.();
    });
  }

  destroy(): void {
    if (!this.settled) this.statusValue = 'terminated';
    if (!this.channel.destroyed) this.channel.destroy();
  }

  private appendBounded(current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> {
    if (current.length >= this.maxOutputBytes) {
      this.truncated = true;
      return current;
    }
    const remaining = this.maxOutputBytes - current.length;
    if (chunk.length > remaining) this.truncated = true;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
  }
}
