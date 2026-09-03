import * as crypto from 'crypto';
import * as path from 'path';
import type { Client, SFTPWrapper } from 'ssh2';
import { executeSshCommand } from '../../execution/ssh-command-executor';
import { CommandSessionManager } from '../../execution/command-session-manager';
import { quotePosixShellArg } from '../../execution/posix-shell';
import { sshConnectionFactory } from '../../../infrastructure/ssh/connection/ssh-connection-factory';
import type { ResolvedSshConnection } from '../../../infrastructure/ssh/connection/ssh-connection.types';
import { RsyncTransferStrategy } from './strategies/rsync-transfer.strategy';
import { ScpTransferStrategy } from './strategies/scp-transfer.strategy';
import type { TransferCommandBuildInput, TransferCommandStrategy } from './strategies/transfer-command.strategy';

const TEMP_KEY_PREFIX = 'nexus_target_key_';
const COMMAND_TIMEOUT_MS = 5 * 60 * 1000;
const SFTP_UPLOAD_TIMEOUT_MS = 30_000;

export interface RemoteTransferSourceItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
}

export interface RemoteTransferProgressEvent {
  progress?: number;
  message?: string;
  method?: 'rsync' | 'scp';
}

export interface RemoteTransferRequest {
  sourceClient: Client;
  sourceItem: RemoteTransferSourceItem;
  targetConnection: ResolvedSshConnection;
  remoteTargetPath: string;
  methodPreference: 'auto' | 'rsync' | 'scp';
  signal: AbortSignal;
  onProgress?: (event: RemoteTransferProgressEvent) => void;
}

/** Executes one source-server -> target-server transfer without owning task/UI state. */
export class RemoteTransferExecutor {
  private readonly strategies: Record<'rsync' | 'scp', TransferCommandStrategy> = {
    rsync: new RsyncTransferStrategy(),
    scp: new ScpTransferStrategy(),
  };

  async execute(request: RemoteTransferRequest): Promise<'rsync' | 'scp'> {
    const { sourceClient, sourceItem, targetConnection, remoteTargetPath, signal, onProgress } = request;
    this.throwIfAborted(signal);

    let temporaryTargetKeyPath: string | undefined;
    try {
      const sshpassPath = await this.checkCommandOnSource(sourceClient, 'sshpass');
      this.throwIfAborted(signal);
      const rsyncPathOnSource = await this.checkCommandOnSource(sourceClient, 'rsync');
      this.throwIfAborted(signal);
      const scpPathOnSource = await this.checkCommandOnSource(sourceClient, 'scp');
      this.throwIfAborted(signal);

      const selected = await this.selectStrategy(
        request.methodPreference,
        sourceItem,
        targetConnection,
        rsyncPathOnSource,
        scpPathOnSource,
        signal,
      );
      const strategy = this.strategies[selected.method];
      onProgress?.({ progress: 5, message: `Using ${selected.method}.`, method: selected.method });

      const targetPort = Number(targetConnection.port);
      if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
        throw new Error(`Invalid target SSH port: ${targetConnection.port}`);
      }

      onProgress?.({
        progress: 6,
        message: `Ensuring target directory ${quotePosixShellArg(remoteTargetPath)} exists on ${targetConnection.host}.`,
        method: selected.method,
      });
      await this.ensureTargetDirectory(targetConnection, remoteTargetPath, signal);
      this.throwIfAborted(signal);
      onProgress?.({ progress: 8, message: 'Target directory ensured. Preparing transfer command.', method: selected.method });

      let identityFile: string | undefined;
      let sshPassCommand: string | undefined;
      if (targetConnection.authMethod === 'key' && targetConnection.privateKey) {
        temporaryTargetKeyPath = path.posix.join('/tmp', `${TEMP_KEY_PREFIX}${crypto.randomBytes(6).toString('hex')}`);
        await this.uploadKeyToSourceViaSftp(sourceClient, targetConnection.privateKey, temporaryTargetKeyPath);
        this.throwIfAborted(signal);
        identityFile = temporaryTargetKeyPath;
        if (targetConnection.passphrase && !sshpassPath) {
          throw new Error(`Target key has passphrase, but sshpass is not available on source for ${sourceItem.name}.`);
        }
        if (targetConnection.passphrase && sshpassPath) {
          sshPassCommand = `${quotePosixShellArg(sshpassPath)} -p ${quotePosixShellArg(targetConnection.passphrase)}`;
        }
      } else if (targetConnection.authMethod === 'password' && targetConnection.password) {
        if (!sshpassPath) {
          throw new Error(`Target uses password auth, but sshpass is not available on source for ${sourceItem.name}.`);
        }
        sshPassCommand = `${quotePosixShellArg(sshpassPath)} -p ${quotePosixShellArg(targetConnection.password)}`;
      } else if (targetConnection.authMethod === 'key' && !targetConnection.privateKey) {
        throw new Error(`Target connection ${targetConnection.name} is key-based but no private key found.`);
      }
      this.throwIfAborted(signal);

      const buildInput: TransferCommandBuildInput = {
        sourcePath: sourceItem.path,
        isDirectory: sourceItem.type === 'directory',
        targetPath: remoteTargetPath,
        executable: selected.executable,
        targetUserAndHost: `${targetConnection.username}@${targetConnection.host}`,
        targetPort,
        ...(identityFile ? { identityFile } : {}),
        ...(sshPassCommand ? { sshPassCommand } : {}),
      };
      const command = strategy.build(buildInput);
      onProgress?.({ progress: 10, message: `Executing: ${selected.method}`, method: selected.method });

      await this.executeTransferCommand(sourceClient, sourceItem, strategy, buildInput, command, signal, onProgress);
      onProgress?.({ progress: 100, message: `${selected.method} successful.`, method: selected.method });
      return selected.method;
    } finally {
      if (temporaryTargetKeyPath) {
        try {
          await this.deleteFileOnSourceViaSftp(sourceClient, temporaryTargetKeyPath);
        } catch (cleanupError) {
          console.warn(`[RemoteTransferExecutor] Failed to cleanup temporary key ${temporaryTargetKeyPath}:`, cleanupError);
        }
      }
    }
  }

  private async selectStrategy(
    preference: 'auto' | 'rsync' | 'scp',
    sourceItem: RemoteTransferSourceItem,
    targetConnection: ResolvedSshConnection,
    rsyncPathOnSource: string | null,
    scpPathOnSource: string | null,
    signal: AbortSignal,
  ): Promise<{ method: 'rsync' | 'scp'; executable: string }> {
    if (preference === 'scp') {
      if (!scpPathOnSource) throw new Error(`SCP preferred but not available on source for ${sourceItem.name}.`);
      return { method: 'scp', executable: scpPathOnSource };
    }

    if (preference === 'rsync') {
      if (!rsyncPathOnSource) throw new Error(`Rsync preferred but not available on source for ${sourceItem.name}.`);
      const rsyncPathOnTarget = await this.checkCommandOnTargetServer(targetConnection, 'rsync', signal);
      this.throwIfAborted(signal);
      if (!rsyncPathOnTarget) throw new Error(`Rsync preferred, but not available on target for ${sourceItem.name}.`);
      return { method: 'rsync', executable: rsyncPathOnSource };
    }

    if (rsyncPathOnSource) {
      const rsyncPathOnTarget = await this.checkCommandOnTargetServer(targetConnection, 'rsync', signal);
      this.throwIfAborted(signal);
      if (rsyncPathOnTarget) return { method: 'rsync', executable: rsyncPathOnSource };
    }
    if (scpPathOnSource) return { method: 'scp', executable: scpPathOnSource };
    throw new Error(`Neither Rsync nor SCP are available on source for ${sourceItem.name} (auto mode).`);
  }

  private async checkCommandOnSource(client: Client, command: string): Promise<string | null> {
    try {
      const result = await executeSshCommand(client, {
        command: `command -v ${quotePosixShellArg(command)} 2>/dev/null`,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
      });
      return result.stdout.trim() || null;
    } catch {
      return null;
    }
  }

  private async checkCommandOnTargetServer(
    targetConnection: ResolvedSshConnection,
    command: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    let targetClient: Client | undefined;
    try {
      targetClient = await sshConnectionFactory.connect(targetConnection, undefined, signal);
      const result = await executeSshCommand(targetClient, {
        command: `command -v ${quotePosixShellArg(command)} 2>/dev/null`,
        timeoutMs: 10_000,
        maxOutputBytes: 16 * 1024,
        signal,
      });
      return result.stdout.trim() || null;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      return null;
    } finally {
      targetClient?.end();
    }
  }

  private async ensureTargetDirectory(
    targetConnection: ResolvedSshConnection,
    remoteTargetPath: string,
    signal: AbortSignal,
  ): Promise<void> {
    let targetClient: Client | undefined;
    try {
      targetClient = await sshConnectionFactory.connect(targetConnection, undefined, signal);
      await executeSshCommand(targetClient, {
        command: `mkdir -p ${quotePosixShellArg(remoteTargetPath)}`,
        timeoutMs: 30_000,
        maxOutputBytes: 64 * 1024,
        signal,
      });
    } finally {
      targetClient?.end();
    }
  }

  private async executeTransferCommand(
    sourceClient: Client,
    sourceItem: RemoteTransferSourceItem,
    strategy: TransferCommandStrategy,
    buildInput: TransferCommandBuildInput,
    command: string,
    signal: AbortSignal,
    onProgress?: (event: RemoteTransferProgressEvent) => void,
  ): Promise<void> {
    const commandSessions = new CommandSessionManager(sourceClient);
    try {
      const commandSession = await commandSessions.start({
        id: `transfer:${crypto.randomUUID()}`,
        command,
        execOptions: strategy.execOptions(buildInput),
      });
      if (signal.aborted) {
        await commandSession.terminate();
        throw new DOMException('Command cancelled by user before streaming began.', 'AbortError');
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        let stderrCombined = '';
        let timeoutHandle: NodeJS.Timeout | undefined;

        const cleanup = () => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          signal.removeEventListener('abort', onAbort);
        };
        const settle = (error?: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          if (error) reject(error);
          else resolve();
        };
        const onAbort = () => {
          void commandSession
            .terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 })
            .finally(() => settle(new DOMException('Command cancelled by user.', 'AbortError')));
        };
        signal.addEventListener('abort', onAbort, { once: true });

        timeoutHandle = setTimeout(() => {
          void commandSession
            .terminate({ signal: 'TERM', graceMs: 1500, forceMs: 4000 })
            .finally(() => settle(new Error(`${strategy.method} command timed out for ${sourceItem.name}.`)));
        }, COMMAND_TIMEOUT_MS);
        timeoutHandle.unref?.();

        commandSession.on('stdout', (data: Buffer) => {
          if (signal.aborted || settled) return;
          const progress = strategy.parseProgress(data.toString());
          if (progress !== undefined) {
            onProgress?.({
              progress,
              message: strategy.method === 'scp' ? 'SCP in progress...' : undefined,
              method: strategy.method,
            });
          }
        });
        commandSession.on('stderr', (data: Buffer) => {
          if (!signal.aborted && !settled) stderrCombined += data.toString();
        });
        commandSession.once('close', ({ exitCode }) => {
          if (signal.aborted) {
            settle(new DOMException('Command cancelled by user (on close).', 'AbortError'));
          } else if (exitCode === 0) {
            settle();
          } else {
            settle(new Error(`${strategy.method} failed. Code: ${exitCode}. Stderr: ${stderrCombined.trim()}`));
          }
        });
        commandSession.once('error', (error: Error) => {
          if (signal.aborted) settle(new DOMException('Command stream error due to cancellation.', 'AbortError'));
          else settle(error);
        });
      });
    } finally {
      await commandSessions.closeAll();
    }
  }

  private async uploadKeyToSourceViaSftp(client: Client, privateKeyContent: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let timeoutHandle: NodeJS.Timeout | undefined;
      let sftpSession: SFTPWrapper | undefined;
      let settled = false;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timeoutHandle) clearTimeout(timeoutHandle);
        sftpSession?.end();
        if (error) reject(error);
        else resolve();
      };

      timeoutHandle = setTimeout(
        () => finish(new Error(`SFTP upload to ${remotePath} timed out after ${SFTP_UPLOAD_TIMEOUT_MS / 1000}s.`)),
        SFTP_UPLOAD_TIMEOUT_MS,
      );
      timeoutHandle.unref?.();

      client.sftp((error, sftp) => {
        if (error || !sftp) {
          finish(new Error(`SFTP session error for key upload: ${error?.message || 'SFTP object is null.'}`));
          return;
        }
        sftpSession = sftp;
        const stream = sftp.createWriteStream(remotePath, { mode: 0o600 });
        stream.once('error', (writeError: Error) => finish(new Error(`Failed to write key to ${remotePath} on source: ${writeError.message}`)));
        stream.once('close', () => finish());
        stream.end(privateKeyContent.endsWith('\n') ? privateKeyContent : `${privateKeyContent}\n`);
      });
    });
  }

  private async deleteFileOnSourceViaSftp(client: Client, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.sftp((error, sftp) => {
        if (error || !sftp) {
          reject(new Error(`SFTP session error for key deletion: ${error?.message || 'SFTP object is null.'}`));
          return;
        }
        sftp.unlink(remotePath, (unlinkError) => {
          sftp.end();
          if (unlinkError) reject(new Error(`Failed to delete ${remotePath} from source: ${unlinkError.message}`));
          else resolve();
        });
      });
    });
  }

  private throwIfAborted(signal: AbortSignal): void {
    if (signal.aborted) throw new DOMException('Transfer cancelled by user.', 'AbortError');
  }
}
