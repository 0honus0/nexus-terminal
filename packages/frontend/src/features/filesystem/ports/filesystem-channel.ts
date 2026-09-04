import type {
  DirectoryListing,
  FileSearchResult,
  RemoteFileEntry,
  RemoteTextFile,
  ResolvedRemotePath,
} from '../model/filesystem';
export interface FilesystemChannel {
  listDirectory(path: string): Promise<DirectoryListing>;
  search(path: string, query: string): Promise<FileSearchResult>;
  stat(path: string): Promise<RemoteFileEntry>;
  readText(path: string, encoding?: string): Promise<RemoteTextFile>;
  writeText(path: string, content: string, encoding?: string): Promise<void>;
  createDirectory(path: string): Promise<void>;
  createFile(path: string, content?: string): Promise<void>;
  remove(paths: string[]): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  chmod(path: string, mode: number): Promise<void>;
  realpath(path: string): Promise<ResolvedRemotePath>;
}

export interface TerminalDirectoryQueueState {
  path: string;
  waitingForPrompt: boolean;
}

export interface TerminalDirectoryPort {
  changeDirectory(
    path: string,
    options?: { onQueued?: (state: TerminalDirectoryQueueState) => void },
  ): Promise<{ path: string }>;
  readCurrentDirectory(): Promise<string>;
}

export interface FilesystemDownloadPort {
  createDownload(path: string, kind: 'file' | 'directory'): Promise<{ url: string }>;
}
