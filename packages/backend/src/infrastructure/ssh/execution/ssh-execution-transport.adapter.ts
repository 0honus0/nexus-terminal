import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Client, ClientChannel, ExecOptions } from 'ssh2';
import type { RemoteFileSystem, RemoteFileSystemRole } from '../../../platform/filesystem/remote-filesystem';
import {
  CommandExecutionError,
  type CommandRequest,
  type CommandResult,
  type CommandSessionRequest,
  type RemoteCommandSession,
  type RemoteExecutionTransport,
  type RemoteShellSession,
  type ShellRequest,
} from '../../../platform/execution/remote-execution.port';
import { SshCommandSessionAdapter } from './ssh-command-session.adapter';
import { SshShellSessionAdapter } from './ssh-shell-session.adapter';
import { SshSftpChannelPool } from '../filesystem/ssh-sftp-channel-pool';

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;

export class SshExecutionTransportAdapter implements RemoteExecutionTransport {
  private readonly events = new EventEmitter();
  private readonly commandSessions = new Set<SshCommandSessionAdapter>();
  private readonly shellSessions = new Set<SshShellSessionAdapter>();
  private open = true;
  private readonly sftpPool: SshSftpChannelPool;

  constructor(
    public readonly connectionId: number,
    private readonly client: Client,
  ) {
    this.sftpPool = new SshSftpChannelPool(client);
    client.on('error', (error: Error) => this.events.emit('error', error));
    client.on('close', () => {
      this.open = false;
      this.events.emit('close');
    });
  }

  get isOpen(): boolean {
    return this.open;
  }

  execute(request: CommandRequest): Promise<CommandResult> {
    this.assertOpen();
    return executeBoundedCommand(this.client, request);
  }

  startCommand(request: CommandSessionRequest): Promise<RemoteCommandSession> {
    this.assertOpen();
    const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    if (!request.command?.trim()) return Promise.reject(new Error('Command must be a non-empty string.'));
    if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
      return Promise.reject(new Error('maxOutputBytes must be a positive integer.'));
    }

    const execOptions = toExecOptions(request);
    return new Promise<RemoteCommandSession>((resolve, reject) => {
      const callback = (error: Error | undefined, channel: ClientChannel) => {
        if (error) {
          reject(error);
          return;
        }
        const session = new SshCommandSessionAdapter(randomUUID(), request.command, channel, maxOutputBytes);
        this.commandSessions.add(session);
        const remove = () => this.commandSessions.delete(session);
        session.onClose(remove);
        resolve(session);
      };
      if (execOptions) this.client.exec(request.command, execOptions, callback);
      else this.client.exec(request.command, callback);
    });
  }

  openShell(request?: ShellRequest): Promise<RemoteShellSession> {
    this.assertOpen();
    return new Promise<RemoteShellSession>((resolve, reject) => {
      const callback = (error: Error | undefined, channel: ClientChannel) => {
        if (error) {
          reject(error);
          return;
        }
        const shell = new SshShellSessionAdapter(channel);
        this.shellSessions.add(shell);
        shell.onClose(() => this.shellSessions.delete(shell));
        resolve(shell);
      };
      if (request) {
        this.client.shell({
          term: request.term ?? 'xterm-256color',
          cols: request.columns ?? 80,
          rows: request.rows ?? 24,
        }, callback);
      } else {
        this.client.shell(callback);
      }
    });
  }

  async fileSystem(role: RemoteFileSystemRole): Promise<RemoteFileSystem> {
    this.assertOpen();
    return this.sftpPool.fileSystem(role);
  }

  onClose(listener: () => void): () => void {
    this.events.on('close', listener);
    return () => this.events.off('close', listener);
  }

  onError(listener: (error: Error) => void): () => void {
    this.events.on('error', listener);
    return () => this.events.off('error', listener);
  }

  async close(): Promise<void> {
    if (!this.open) return;
    this.open = false;
    this.sftpPool.closeAll();
    for (const session of this.commandSessions) session.destroy();
    this.commandSessions.clear();
    for (const shell of this.shellSessions) shell.close();
    this.shellSessions.clear();

    await new Promise<void>((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        this.client.removeListener('close', finish);
        resolve();
      };
      const timeout = setTimeout(finish, 1000);
      timeout.unref?.();
      this.client.once('close', finish);
      try { this.client.end(); } catch { finish(); }
    });
  }

  private assertOpen(): void {
    if (!this.open) throw new Error(`SSH transport for connection ${this.connectionId} is closed.`);
  }
}

const toExecOptions = (request: CommandSessionRequest): ExecOptions | undefined => {
  if (!request.pty) return undefined;
  if (request.pty === true) return { pty: true };
  return {
    pty: {
      term: request.pty.term ?? 'xterm-256color',
      cols: request.pty.columns ?? 80,
      rows: request.pty.rows ?? 24,
    },
  };
};

const executeBoundedCommand = (client: Client, request: CommandRequest): Promise<CommandResult> => {
  const timeoutMs = request.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const signal = request.signal;

  if (!request.command?.trim()) return Promise.reject(new Error('Command must be a non-empty string.'));
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) return Promise.reject(new Error('timeoutMs must be a positive integer.'));
  if (!Number.isInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    return Promise.reject(new Error('maxOutputBytes must be a positive integer.'));
  }
  if (signal?.aborted) return Promise.reject(new DOMException('SSH command aborted before execution.', 'AbortError'));

  return new Promise<CommandResult>((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let settled = false;
    let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let truncated = false;

    const append = (current: Buffer<ArrayBufferLike>, input: Buffer<ArrayBufferLike> | string): Buffer<ArrayBufferLike> => {
      const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
      if (current.length >= maxOutputBytes) {
        truncated = true;
        return current;
      }
      const remaining = maxOutputBytes - current.length;
      if (chunk.length > remaining) truncated = true;
      return Buffer.concat([current, chunk.subarray(0, remaining)]);
    };
    const result = (exitCode: number, exitSignal?: string): CommandResult => ({
      exitCode,
      signal: exitSignal,
      stdout: stdout.toString('utf8'),
      stderr: stderr.toString('utf8'),
      truncated,
    });
    const cleanup = () => {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', onAbort);
    };
    const settleReject = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const settleResolve = (value: CommandResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const terminateChannel = () => {
      if (!channel || channel.destroyed) return;
      try { channel.signal('TERM'); } catch { /* optional remote capability */ }
      try { channel.close(); } catch { channel.destroy(); }
    };
    const onAbort = () => {
      settleReject(new DOMException('SSH command aborted.', 'AbortError'));
      terminateChannel();
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    const timeout = setTimeout(() => {
      const timedOut = result(-1);
      settleReject(new CommandExecutionError(`SSH command timed out after ${timeoutMs}ms`, timedOut));
      terminateChannel();
    }, timeoutMs);
    timeout.unref?.();

    client.exec(request.command, (error, stream) => {
      if (settled) {
        try { stream?.close(); } catch { stream?.destroy(); }
        return;
      }
      if (error) {
        settleReject(new CommandExecutionError(error.message, result(-1)));
        return;
      }
      channel = stream;
      stream.on('data', (chunk: Buffer | string) => { stdout = append(stdout, chunk); });
      stream.stderr.on('data', (chunk: Buffer | string) => { stderr = append(stderr, chunk); });
      stream.once('error', (streamError: Error) => settleReject(new CommandExecutionError(streamError.message, result(-1))));
      stream.once('close', (code: number | undefined, exitSignal: string | undefined) => {
        const exitCode = typeof code === 'number' ? code : 0;
        const finalResult = result(exitCode, exitSignal);
        if (exitCode !== 0) {
          const message = finalResult.stderr.trim() || `SSH command exited with code ${exitCode}`;
          settleReject(new CommandExecutionError(message, finalResult));
        } else {
          settleResolve(finalResult);
        }
      });
    });
  });
};
