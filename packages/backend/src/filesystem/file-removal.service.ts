import path from 'node:path';
import type { SFTPWrapper, Stats } from 'ssh2';
import type { ExecutionSession } from '../execution/execution-session';
import { executeSshCommand, SshCommandError } from '../execution/ssh-command-executor';
import { quotePosixShellArg } from '../utils/shell';

function call<T>(invoke: (callback: (error: Error | undefined | null, value: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    invoke((error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
  });
}

function callVoid(invoke: (callback: (error?: Error | null) => void) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    invoke((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function isMissing(error: unknown): boolean {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes('no such file') || message.includes('not found') || message.includes('failure') && message.includes('2');
}

function normalizeDestructivePath(remotePath: string): string {
  const normalized = path.posix.normalize(remotePath);
  if (!normalized || normalized === '/' || normalized === '.') throw new Error('拒绝删除根目录或无效路径');
  if (!normalized.startsWith('/')) throw new Error('删除路径必须是绝对路径');
  return normalized;
}

/** Shared destructive filesystem operations for Workspace and Agent callers. */
export class FileRemovalService {
  constructor(private readonly session: ExecutionSession) {}

  async removePath(remotePath: string): Promise<void> {
    const normalized = normalizeDestructivePath(remotePath);
    const sftp = await this.session.sftp.ensure('control');
    await this.removeRecursive(sftp, normalized);
  }

  async removePaths(remotePaths: string[]): Promise<void> {
    for (const remotePath of remotePaths) await this.removePath(remotePath);
  }

  /**
   * Preserve the existing FileManager force-directory behavior: first use the
   * normal remote account, then fall back to sudo when available.
   */
  async removeDirectoryForce(remotePath: string): Promise<void> {
    const normalized = normalizeDestructivePath(remotePath);
    if (!this.session.isReady) throw new Error('SSH 会话未就绪');
    const quoted = quotePosixShellArg(normalized);

    try {
      await executeSshCommand(this.session.client, { command: `rm -rf -- ${quoted}`, timeoutMs: 30_000 });
      return;
    } catch (firstError) {
      try {
        await executeSshCommand(this.session.client, { command: `sudo rm -rf -- ${quoted}`, timeoutMs: 30_000 });
        return;
      } catch (sudoError) {
        const first = firstError instanceof SshCommandError ? firstError.message : String(firstError);
        const second = sudoError instanceof SshCommandError ? sudoError.message : String(sudoError);
        throw new Error(`普通 rm -rf 和 sudo rm -rf 均失败。普通: ${first}; sudo: ${second}`);
      }
    }
  }

  private async removeRecursive(sftp: SFTPWrapper, remotePath: string): Promise<void> {
    let stats: Stats;
    try {
      stats = await call<Stats>((cb) => sftp.lstat(remotePath, cb));
    } catch (error) {
      if (isMissing(error)) return;
      throw error;
    }

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      await callVoid((cb) => sftp.unlink(remotePath, cb));
      return;
    }

    const entries = await call<Array<{ filename: string; attrs: Stats }>>((cb) => sftp.readdir(remotePath, cb));
    for (const entry of entries) {
      if (entry.filename === '.' || entry.filename === '..') continue;
      await this.removeRecursive(sftp, path.posix.join(remotePath, entry.filename));
    }
    await callVoid((cb) => sftp.rmdir(remotePath, cb));
  }
}
