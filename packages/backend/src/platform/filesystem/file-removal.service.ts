import path from 'node:path';
import type { ExecutionSession } from '../execution/execution-session';
import { CommandExecutionError } from '../execution/remote-execution.port';
import { quotePosixShellArg } from '../execution/posix-shell';
import type { RemoteFileSystem } from './remote-filesystem';
import { isRemoteFileMissingError } from './remote-filesystem';

const normalizeDestructivePath = (remotePath: string): string => {
  const normalized = path.posix.normalize(remotePath);
  if (!normalized || normalized === '/' || normalized === '.') throw new Error('Refusing to remove root or invalid path.');
  if (!path.posix.isAbsolute(normalized)) throw new Error('Removal path must be absolute.');
  return normalized;
};

export class FileRemovalService {
  async remove(filesystem: RemoteFileSystem, remotePath: string): Promise<void> {
    await this.removeRecursive(filesystem, normalizeDestructivePath(remotePath), new Set());
  }

  async removeMany(filesystem: RemoteFileSystem, remotePaths: readonly string[]): Promise<void> {
    for (const remotePath of remotePaths) await this.remove(filesystem, remotePath);
  }

  async removeDirectoryForce(session: ExecutionSession, remotePath: string): Promise<void> {
    const normalized = normalizeDestructivePath(remotePath);
    const quoted = quotePosixShellArg(normalized);
    try {
      await session.execute({ command: `rm -rf -- ${quoted}`, timeoutMs: 30_000 });
      return;
    } catch (firstError) {
      try {
        await session.execute({ command: `sudo rm -rf -- ${quoted}`, timeoutMs: 30_000 });
      } catch (sudoError) {
        const first = firstError instanceof CommandExecutionError ? firstError.message : String(firstError);
        const second = sudoError instanceof CommandExecutionError ? sudoError.message : String(sudoError);
        throw new Error(`Both rm -rf and sudo rm -rf failed. normal=${first}; sudo=${second}`);
      }
    }
  }

  private async removeRecursive(
    filesystem: RemoteFileSystem,
    remotePath: string,
    ancestorRealPaths: ReadonlySet<string>,
  ): Promise<void> {
    let metadata;
    try {
      metadata = await filesystem.metadata(remotePath);
    } catch (error) {
      if (isRemoteFileMissingError(error)) return;
      throw error;
    }

    if (!metadata.isDirectory || metadata.isSymbolicLink) {
      await filesystem.removeFile(remotePath, { ignoreMissing: true });
      return;
    }

    const realPath = await filesystem.resolvePath(remotePath);
    if (ancestorRealPaths.has(realPath)) return;
    const nextAncestors = new Set(ancestorRealPaths);
    nextAncestors.add(realPath);
    for (const entry of await filesystem.readDirectory(remotePath)) {
      if (entry.name === '.' || entry.name === '..') continue;
      await this.removeRecursive(filesystem, path.posix.join(remotePath, entry.name), nextAncestors);
    }
    await filesystem.removeDirectory(remotePath);
  }
}
