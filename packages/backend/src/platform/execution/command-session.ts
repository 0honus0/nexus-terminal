import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';

export type CommandSessionStatus = 'running' | 'completed' | 'failed' | 'terminated';

export interface CommandSessionCloseEvent {
  exitCode: number | null;
  signal?: string | null;
}

export interface CommandSessionSnapshot {
  id: string;
  command: string;
  status: CommandSessionStatus;
  startedAt: number;
  exitCode?: number | null;
  signal?: string | null;
  stdout: string;
  stderr: string;
  outputTruncated: boolean;
}

export interface CommandSessionEvents {
  stdout: [Buffer];
  stderr: [Buffer];
  close: [CommandSessionCloseEvent];
  error: [Error];
}

/**
 * Lifecycle wrapper around one SSH exec channel.
 *
 * The raw ClientChannel is intentionally kept private so command consumers use
 * one shared lifecycle API. This is the primitive future Agent long-running
 * tools will observe/write/terminate rather than opening ad-hoc SSH exec
 * channels themselves.
 */
export class CommandSession extends EventEmitter<CommandSessionEvents> {
  public readonly id: string;
  public readonly command: string;
  public readonly startedAt = Date.now();

  private readonly channel: ClientChannel;
  private _status: CommandSessionStatus = 'running';
  private _exitCode: number | null | undefined;
  private _signal: string | null | undefined;
  private settled = false;
  private stdoutBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private stderrBuffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private outputTruncated = false;

  constructor(
    id: string,
    command: string,
    channel: ClientChannel,
    private readonly maxOutputBytes = 1024 * 1024,
  ) {
    super();
    this.id = id;
    this.command = command;
    this.channel = channel;
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      throw new Error('maxOutputBytes must be a positive integer.');
    }

    // Keep channel errors observable without triggering EventEmitter's
    // unhandled-error throw before the caller has attached its listener.
    this.on('error', () => undefined);

    channel.on('data', (data: Buffer) => {
      this.stdoutBuffer = this.appendBounded(this.stdoutBuffer, data);
      this.emit('stdout', data);
    });
    channel.stderr.on('data', (data: Buffer) => {
      this.stderrBuffer = this.appendBounded(this.stderrBuffer, data);
      this.emit('stderr', data);
    });
    channel.on('error', (error: Error) => {
      if (!this.settled) this._status = 'failed';
      this.emit('error', error);
    });
    channel.on('close', (exitCode: number | null, signal?: string | null) => {
      if (this.settled) return;
      this.settled = true;
      this._exitCode = exitCode;
      this._signal = signal;
      if (this._status === 'running') this._status = exitCode === 0 ? 'completed' : 'failed';
      this.emit('close', { exitCode, signal });
    });
  }

  get status(): CommandSessionStatus {
    return this._status;
  }

  get exitCode(): number | null | undefined {
    return this._exitCode;
  }

  get signal(): string | null | undefined {
    return this._signal;
  }

  get isRunning(): boolean {
    return this._status === 'running';
  }

  get stdout(): string {
    return this.stdoutBuffer.toString('utf8');
  }

  get stderr(): string {
    return this.stderrBuffer.toString('utf8');
  }

  snapshot(): CommandSessionSnapshot {
    return {
      id: this.id,
      command: this.command,
      status: this.status,
      startedAt: this.startedAt,
      exitCode: this.exitCode,
      signal: this.signal,
      stdout: this.stdout,
      stderr: this.stderr,
      outputTruncated: this.outputTruncated,
    };
  }

  private appendBounded(
    current: Buffer<ArrayBufferLike>,
    chunk: Buffer<ArrayBufferLike>,
  ): Buffer<ArrayBufferLike> {
    if (current.length >= this.maxOutputBytes) {
      this.outputTruncated = true;
      return current;
    }
    const remaining = this.maxOutputBytes - current.length;
    if (chunk.length > remaining) this.outputTruncated = true;
    return Buffer.concat([current, chunk.subarray(0, remaining)]);
  }

  write(data: string | Buffer): boolean {
    if (!this.isRunning || this.channel.destroyed) return false;
    return this.channel.write(data);
  }

  signalProcess(signal: string): void {
    if (!this.isRunning || this.channel.destroyed) return;
    this.channel.signal(signal);
  }

  close(): void {
    if (!this.isRunning) return;
    this._status = 'terminated';
    try {
      this.channel.close();
    } catch {
      this.channel.destroy();
    }
  }

  destroy(): void {
    if (!this.settled) this._status = 'terminated';
    if (!this.channel.destroyed) this.channel.destroy();
  }

  async terminate(options?: { signal?: string; graceMs?: number; forceMs?: number }): Promise<void> {
    if (!this.isRunning) return;
    const signal = options?.signal ?? 'TERM';
    const graceMs = options?.graceMs ?? 1500;
    const forceMs = options?.forceMs ?? 4000;

    await new Promise<void>((resolve) => {
      let done = false;
      let closeTimer: ReturnType<typeof setTimeout> | undefined;
      let forceTimer: ReturnType<typeof setTimeout> | undefined;

      const finish = () => {
        if (done) return;
        done = true;
        if (closeTimer) clearTimeout(closeTimer);
        if (forceTimer) clearTimeout(forceTimer);
        this.off('close', onClose);
        this.off('error', onError);
        resolve();
      };
      const onClose = () => finish();
      const onError = () => finish();

      this.once('close', onClose);
      this.once('error', onError);

      try {
        this.signalProcess(signal);
      } catch {
        // The channel may already be closing; timers below still settle.
      }

      closeTimer = setTimeout(() => {
        if (done) return;
        this.close();
      }, graceMs);
      closeTimer.unref?.();

      forceTimer = setTimeout(() => {
        if (done) return;
        this.destroy();
        finish();
      }, forceMs);
      forceTimer.unref?.();
    });
  }
}
