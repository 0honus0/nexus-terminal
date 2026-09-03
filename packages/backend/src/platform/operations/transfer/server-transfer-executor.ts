import { randomBytes, randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import type { ResolvedSshConnection } from '../../connection/ssh-connection';
import type { ExecutionSession } from '../../execution/execution-session';
import type { RemoteExecutionTransport, RemoteExecutionTransportFactory } from '../../execution/remote-execution.port';
import { quotePosixShellArg } from '../../execution/posix-shell';
import {
  RsyncServerTransferStrategy,
  ScpServerTransferStrategy,
  type ServerTransferCommandInput,
  type ServerTransferStrategy,
} from './server-transfer-strategy';

const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;

export interface ServerTransferSourceItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface ServerTransferProgressEvent {
  progress?: number;
  message?: string;
  method?: 'rsync' | 'scp';
}

export interface ServerTransferRequest {
  sourceSession: ExecutionSession;
  sourceItem: ServerTransferSourceItem;
  targetConnection: ResolvedSshConnection;
  remoteTargetPath: string;
  methodPreference: 'auto' | 'rsync' | 'scp';
  signal: AbortSignal;
  onProgress?: (event: ServerTransferProgressEvent) => void;
}

export class ServerTransferExecutor {
  private readonly strategies: Record<'rsync' | 'scp', ServerTransferStrategy> = {
    rsync: new RsyncServerTransferStrategy(),
    scp: new ScpServerTransferStrategy(),
  };

  constructor(private readonly transports: RemoteExecutionTransportFactory) {}

  async execute(request: ServerTransferRequest): Promise<'rsync' | 'scp'> {
    this.throwIfAborted(request.signal);
    const source = request.sourceSession;
    const sourceFs = await source.fileSystem('transfer');
    const sshpass = await this.commandPath(source, 'sshpass');
    const sourceRsync = await this.commandPath(source, 'rsync');
    const sourceScp = await this.commandPath(source, 'scp');
    const selected = await this.selectStrategy(request, sourceRsync, sourceScp);
    const strategy = this.strategies[selected.method];
    request.onProgress?.({ progress: 5, method: selected.method, message: `Using ${selected.method}.` });

    const targetPort = Number(request.targetConnection.port);
    if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
      throw new Error(`Invalid target SSH port: ${request.targetConnection.port}`);
    }
    await this.withTarget(request.targetConnection, request.signal, async (target) => {
      await target.execute({
        command: `mkdir -p -- ${quotePosixShellArg(request.remoteTargetPath)}`,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
        signal: request.signal,
      });
    });

    let temporaryKeyPath: string | undefined;
    try {
      let identityFile: string | undefined;
      let sshPassCommand: string | undefined;
      const target = request.targetConnection;
      if (target.authMethod === 'key') {
        if (!target.privateKey) throw new Error(`Target connection ${target.displayName} has no private key.`);
        temporaryKeyPath = `/tmp/nexus_target_key_${randomBytes(6).toString('hex')}`;
        const stream = await sourceFs.openWrite(temporaryKeyPath, { mode: 0o600 });
        stream.end(target.privateKey.endsWith('\n') ? target.privateKey : `${target.privateKey}\n`);
        await finished(stream);
        await sourceFs.chmod(temporaryKeyPath, 0o600);
        identityFile = temporaryKeyPath;
        if (target.passphrase) {
          if (!sshpass)
            throw new Error(`Target key uses a passphrase but sshpass is unavailable for ${request.sourceItem.name}.`);
          sshPassCommand = `${quotePosixShellArg(sshpass)} -p ${quotePosixShellArg(target.passphrase)}`;
        }
      } else if (target.password) {
        if (!sshpass)
          throw new Error(
            `Target uses password authentication but sshpass is unavailable for ${request.sourceItem.name}.`,
          );
        sshPassCommand = `${quotePosixShellArg(sshpass)} -p ${quotePosixShellArg(target.password)}`;
      } else {
        throw new Error(`Target connection ${target.displayName} has no password.`);
      }

      const input: ServerTransferCommandInput = {
        sourcePath: request.sourceItem.path,
        isDirectory: request.sourceItem.type === 'directory',
        targetPath: request.remoteTargetPath,
        executable: selected.executable,
        targetUserAndHost: `${target.username}@${target.host}`,
        targetPort,
        ...(identityFile ? { identityFile } : {}),
        ...(sshPassCommand ? { sshPassCommand } : {}),
      };
      const command = strategy.build(input);
      await this.runCommand(source, strategy, input, command, request);
      request.onProgress?.({ progress: 100, method: selected.method, message: `${selected.method} successful.` });
      return selected.method;
    } finally {
      if (temporaryKeyPath) await sourceFs.removeFile(temporaryKeyPath, { ignoreMissing: true }).catch(() => undefined);
    }
  }

  private async selectStrategy(
    request: ServerTransferRequest,
    sourceRsync: string | null,
    sourceScp: string | null,
  ): Promise<{ method: 'rsync' | 'scp'; executable: string }> {
    if (request.methodPreference === 'scp') {
      if (!sourceScp) throw new Error(`SCP is not available on the source for ${request.sourceItem.name}.`);
      return { method: 'scp', executable: sourceScp };
    }
    if (request.methodPreference === 'rsync') {
      if (!sourceRsync) throw new Error(`Rsync is not available on the source for ${request.sourceItem.name}.`);
      if (!(await this.targetHasCommand(request.targetConnection, 'rsync', request.signal))) {
        throw new Error(`Rsync is not available on the target for ${request.sourceItem.name}.`);
      }
      return { method: 'rsync', executable: sourceRsync };
    }
    if (sourceRsync && (await this.targetHasCommand(request.targetConnection, 'rsync', request.signal))) {
      return { method: 'rsync', executable: sourceRsync };
    }
    if (sourceScp) return { method: 'scp', executable: sourceScp };
    throw new Error(`Neither rsync nor scp is available on the source for ${request.sourceItem.name}.`);
  }

  private async runCommand(
    source: ExecutionSession,
    strategy: ServerTransferStrategy,
    input: ServerTransferCommandInput,
    command: string,
    request: ServerTransferRequest,
  ): Promise<void> {
    const session = await source.startCommand({
      command,
      pty: strategy.requiresPty(input),
      maxOutputBytes: 256 * 1024,
    });
    let stderr = '';
    const offOut = session.onStdout((data) => {
      const progress = strategy.parseProgress(Buffer.from(data).toString());
      if (progress !== undefined) request.onProgress?.({ progress, method: strategy.method });
    });
    const offErr = session.onStderr((data) => {
      stderr += Buffer.from(data).toString();
    });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const abort = () => void session.terminate().catch(() => undefined);
    request.signal.addEventListener('abort', abort, { once: true });
    try {
      const close = await new Promise<{ exitCode: number | null }>((resolve, reject) => {
        timeout = setTimeout(() => {
          void session
            .terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 })
            .finally(() => reject(new Error(`${strategy.method} timed out for ${request.sourceItem.name}.`)));
        }, COMMAND_TIMEOUT_MS);
        timeout.unref?.();
        const offClose = session.onClose((event) => {
          offClose();
          offError();
          resolve(event);
        });
        const offError = session.onError((error) => {
          offClose();
          offError();
          reject(error);
        });
      });
      if (request.signal.aborted) throw new DOMException('Transfer cancelled.', 'AbortError');
      if (close.exitCode !== 0) throw new Error(`${strategy.method} failed (${close.exitCode}): ${stderr.trim()}`);
    } finally {
      if (timeout) clearTimeout(timeout);
      request.signal.removeEventListener('abort', abort);
      offOut();
      offErr();
    }
  }

  private async commandPath(source: ExecutionSession, command: string): Promise<string | null> {
    try {
      const result = await source.execute({
        command: `command -v ${quotePosixShellArg(command)} 2>/dev/null`,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async targetHasCommand(
    connection: ResolvedSshConnection,
    command: string,
    signal: AbortSignal,
  ): Promise<boolean> {
    try {
      return await this.withTarget(connection, signal, async (target) => {
        const result = await target.execute({
          command: `command -v ${quotePosixShellArg(command)} >/dev/null 2>&1`,
          timeoutMs: 10_000,
          maxOutputBytes: 1024,
          signal,
        });
        return result.exitCode === 0;
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return false;
    }
  }

  private async withTarget<T>(
    connection: ResolvedSshConnection,
    signal: AbortSignal,
    operation: (transport: RemoteExecutionTransport) => Promise<T>,
  ): Promise<T> {
    this.throwIfAborted(signal);
    const target = await this.transports.connect(connection, { signal });
    try {
      return await operation(target);
    } finally {
      await target.close();
    }
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Transfer cancelled.', 'AbortError');
  }
}
