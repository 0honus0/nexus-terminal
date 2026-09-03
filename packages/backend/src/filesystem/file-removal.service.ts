import path from 'node:path';
import type { ExecutionSession } from '../execution/execution-session';
import { executeSshCommand, SshCommandError } from '../execution/ssh-command-executor';
import { quotePosixShellArg } from '../utils/shell';
import { SftpChannelFileSystem } from './sftp-channel-file-system';

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
    const filesystem = new SftpChannelFileSystem(await this.session.sftp.ensure('control'));
    await this.removeRecursive(filesystem, normalized);
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

  private async removeRecursive(filesystem: SftpChannelFileSystem, remotePath: string): Promise<void> {
    let stats;
    try {
      stats = await filesystem.lstat(remotePath);
    } catch (error) {
      if (SftpChannelFileSystem.isMissing(error)) return;
      throw error;
    }

    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      await filesystem.unlink(remotePath);
      return;
    }

    for (const entry of await filesystem.list(remotePath)) {
      if (entry.filename === '.' || entry.filename === '..') continue;
      await this.removeRecursive(filesystem, path.posix.join(remotePath, entry.filename));
    }
    await filesystem.rmdir(remotePath);
  }
}
