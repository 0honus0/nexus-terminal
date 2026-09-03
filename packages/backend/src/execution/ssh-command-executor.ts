import type { Client, ClientChannel } from 'ssh2';

export interface SshCommandRequest {
  command: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
  signal?: AbortSignal;
}

export interface SshCommandResult {
  exitCode: number;
  signal?: string;
  stdout: string;
  stderr: string;
  truncated: boolean;
}

export class SshCommandError extends Error {
  constructor(
    message: string,
    public readonly result?: SshCommandResult,
  ) {
    super(message);
    this.name = 'SshCommandError';
  }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

/**
 * Shared bounded SSH exec primitive for workspace features, background services,
 * and future Agent tools. It never writes to the interactive terminal channel.
 */
export async function executeSshCommand(client: Client, request: SshCommandRequest): Promise<SshCommandResult> {
  const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const abortSignal = request.signal;

  if (!request.command || typeof request.command !== 'string') throw new Error('SSH command must be a non-empty string.');
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) throw new Error('timeoutMs must be a positive integer.');
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error('maxOutputBytes must be a positive integer.');
  }

  if (abortSignal?.aborted) throw new DOMException('SSH command aborted before execution.', 'AbortError');

  return new Promise<SshCommandResult>((resolve, reject) => {
    let stream: ClientChannel | undefined;
    let settled = false;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;

    const appendBounded = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      const remaining = maxOutputBytes - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };

    const finish = (error?: Error, exitCode = 0, signal?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener('abort', onAbort);
      const result: SshCommandResult = {
        exitCode,
        signal,
        stdout: stdout.toString('utf8'),
        stderr: stderr.toString('utf8'),
        truncated,
      };
      if (error?.name === 'AbortError') reject(error);
      else if (error) reject(error instanceof SshCommandError ? error : new SshCommandError(error.message, result));
      else resolve(result);
    };

    const terminateStream = () => {
      if (!stream || stream.destroyed) return;
      try {
        stream.signal('TERM');
      } catch {
        // Signal support varies by remote server.
      }
      try {
        stream.close();
      } catch {
        stream.destroy();
      }
    };

    const onAbort = () => {
      finish(new DOMException('SSH command aborted.', 'AbortError'), -1);
      terminateStream();
    };
    abortSignal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      finish(new Error(`SSH command timed out after ${timeoutMs}ms`), -1);
      terminateStream();
    }, timeoutMs);
    timeout.unref?.();

    client.exec(request.command, (error, channel) => {
      if (settled) {
        try { channel?.close(); } catch { channel?.destroy(); }
        return;
      }
      if (error) {
        finish(error, -1);
        return;
      }
      stream = channel;
      channel.on('data', (chunk: Buffer | string) => {
        stdout = appendBounded(stdout, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      channel.stderr.on('data', (chunk: Buffer | string) => {
        stderr = appendBounded(stderr, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      channel.once('error', (channelError: Error) => finish(channelError, -1));
      channel.once('close', (code: number | undefined, signal: string | undefined) => {
        const exitCode = typeof code === 'number' ? code : 0;
        if (exitCode !== 0) {
          const message = stderr.toString('utf8').trim() || `SSH command exited with code ${exitCode}`;
          finish(new SshCommandError(message, {
            exitCode,
            signal,
            stdout: stdout.toString('utf8'),
            stderr: stderr.toString('utf8'),
            truncated,
          }), exitCode, signal);
          return;
        }
        finish(undefined, exitCode, signal);
      });
    });
  });
}
