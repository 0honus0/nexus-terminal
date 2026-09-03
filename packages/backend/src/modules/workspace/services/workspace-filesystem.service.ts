import path from 'node:path';
import type {
  DirectoryArchiveHandle,
  DirectoryArchivePort,
} from '../../../platform/operations/archive/directory-archive.port';
import type { ExecutionSessionManager } from '../../../platform/execution/execution-session-manager';
import {
  toRemoteFileEntry,
  type RemoteFileEntry,
  type RemoteFileSearchResult,
} from '../../../platform/filesystem/file-entry';
import type { FileRemovalService } from '../../../platform/filesystem/file-removal.service';
import type { RemoteFileSearchService } from '../../../platform/filesystem/remote-file-search.service';
import type { RemoteFileSystem } from '../../../platform/filesystem/remote-filesystem';
import type {
  RemoteTextFileReadResult,
  RemoteTextFileService,
} from '../../../platform/filesystem/remote-text-file.service';
import type { WorkspaceEventHub } from '../workspace-event-hub';
import type { WorkspaceSession } from '../workspace-session';
import type { WorkspaceSessionRegistry } from '../workspace-session-registry';

export interface WorkspaceFilesystemTarget {
  workspaceId: string;
  executionSessionId: string;
  filesystem: RemoteFileSystem;
}

/** User-facing remote filesystem use cases over an authorized active Workspace. */
export class WorkspaceFilesystemService {
  constructor(
    private readonly sessions: WorkspaceSessionRegistry,
    private readonly executions: ExecutionSessionManager,
    private readonly textFiles: RemoteTextFileService,
    private readonly searcher: RemoteFileSearchService,
    private readonly removal: FileRemovalService,
    private readonly directoryArchives: DirectoryArchivePort,
    private readonly events: WorkspaceEventHub,
  ) {}

  async initialize(workspaceId: string): Promise<void> {
    const session = this.sessions.require(workspaceId);
    try {
      const fs = await this.filesystem(session);
      await fs.resolvePath('.');
      this.events.publish(workspaceId, { type: 'filesystem-ready', connectionId: session.connectionId });
    } catch (error) {
      this.events.publish(workspaceId, {
        type: 'filesystem-error',
        connectionId: session.connectionId,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  async readDirectory(workspaceId: string, remotePath: string): Promise<RemoteFileEntry[]> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    const normalized = this.absolute(remotePath);
    const entries = await fs.readDirectory(normalized);
    return entries
      .filter((e) => e.name !== '.' && e.name !== '..')
      .map((e) => toRemoteFileEntry(path.posix.join(normalized, e.name), e.metadata, e.longName));
  }
  async search(workspaceId: string, rootPath: string, query: string): Promise<RemoteFileSearchResult> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    return this.searcher.search(fs, rootPath, query);
  }
  async stat(workspaceId: string, remotePath: string, followSymbolicLinks = false): Promise<RemoteFileEntry> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    const normalized = this.absolute(remotePath);
    return toRemoteFileEntry(normalized, await fs.metadata(normalized, { followSymbolicLinks }));
  }
  async readFile(workspaceId: string, remotePath: string, encoding?: string): Promise<RemoteTextFileReadResult> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    return this.textFiles.read(fs, this.absolute(remotePath), encoding);
  }
  async writeFile(workspaceId: string, remotePath: string, content: string, encoding = 'utf-8') {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    return this.textFiles.write(fs, this.absolute(remotePath), content, encoding);
  }
  async createDirectory(workspaceId: string, remotePath: string): Promise<void> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    await fs.createDirectory(this.absolute(remotePath));
  }
  async removeDirectory(workspaceId: string, remotePath: string, force = false): Promise<void> {
    const session = this.sessions.require(workspaceId),
      normalized = this.absolute(remotePath);
    if (force)
      return this.removal.removeDirectoryForce(this.executions.require(session.executionSessionId), normalized);
    await this.removal.remove(await this.filesystem(session), normalized);
  }
  async removeFile(workspaceId: string, remotePath: string): Promise<void> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    await fs.removeFile(this.absolute(remotePath));
  }
  async removePaths(workspaceId: string, remotePaths: readonly string[]): Promise<void> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    await this.removal.removeMany(
      fs,
      remotePaths.map((p) => this.absolute(p)),
    );
  }
  async rename(workspaceId: string, sourcePath: string, destinationPath: string): Promise<void> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    await fs.rename(this.absolute(sourcePath), this.absolute(destinationPath));
  }
  async chmod(workspaceId: string, remotePath: string, mode: number): Promise<void> {
    if (!Number.isInteger(mode) || mode < 0 || mode > 0o7777) throw new Error('Invalid chmod mode.');
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    await fs.chmod(this.absolute(remotePath), mode);
  }
  async realpath(workspaceId: string, remotePath: string) {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    const requestedPath = path.posix.normalize(remotePath.replace(/\\/g, '/'));
    if (!requestedPath) throw new Error('Remote path is required.');
    const absolutePath = await fs.resolvePath(requestedPath);
    const metadata = await fs.metadata(absolutePath, { followSymbolicLinks: true });
    return {
      requestedPath: remotePath,
      absolutePath,
      targetType: metadata.isDirectory ? 'directory' : metadata.isFile ? 'file' : 'other',
    } as const;
  }
  async createDirectoryArchive(workspaceId: string, remotePath: string): Promise<DirectoryArchiveHandle> {
    const fs = await this.filesystem(this.sessions.require(workspaceId));
    return this.directoryArchives.createZip(fs, this.absolute(remotePath));
  }

  async resolveActive(
    userId: number,
    connectionId: number,
    requestedWorkspaceId?: string,
  ): Promise<WorkspaceFilesystemTarget | null> {
    if (requestedWorkspaceId) {
      const exact = this.sessions.get(requestedWorkspaceId);
      if (this.matches(exact, userId, connectionId))
        return {
          workspaceId: exact.id,
          executionSessionId: exact.executionSessionId,
          filesystem: await this.filesystem(exact),
        };
    }
    for (const [, session] of this.sessions.entries())
      if (this.matches(session, userId, connectionId))
        return {
          workspaceId: session.id,
          executionSessionId: session.executionSessionId,
          filesystem: await this.filesystem(session),
        };
    return null;
  }
  private filesystem(session: WorkspaceSession) {
    return this.executions.require(session.executionSessionId).fileSystem('control');
  }
  private matches(
    session: WorkspaceSession | undefined,
    userId: number,
    connectionId: number,
  ): session is WorkspaceSession {
    return Boolean(
      session &&
      session.userId === userId &&
      session.connectionId === connectionId &&
      this.executions.get(session.executionSessionId)?.isReady,
    );
  }
  private absolute(value: string): string {
    const normalized = path.posix.normalize(value.replace(/\\/g, '/'));
    if (!path.posix.isAbsolute(normalized)) throw new Error(`Remote path must be absolute: ${value}`);
    return normalized;
  }
}
