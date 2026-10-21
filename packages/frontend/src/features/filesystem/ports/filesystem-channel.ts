import type {
	DirectoryListing,
	FileSearchResult,
	RemoteFileEntry,
	ResolvedRemotePath,
	FilesystemInvalidation,
} from '../model/filesystem-types';
import type { TerminalDirectoryQueueState } from '../model/terminal-directory-types';

export interface FilesystemChannel {
	onInvalidate(handler: (reason: FilesystemInvalidation) => void): () => void;
	listDirectory(path: string): Promise<DirectoryListing>;
	search(path: string, query: string): Promise<FileSearchResult>;
	stat(path: string, signal?: AbortSignal): Promise<RemoteFileEntry>;
	readBinary(path: string, maxBytes: number, signal?: AbortSignal): Promise<{ path: string; bytes: Uint8Array }>;
	writeText(path: string, content: string, encoding?: string): Promise<void>;
	createDirectory(path: string): Promise<void>;
	createFile(path: string, content?: string): Promise<void>;
	remove(paths: string[], options?: { forceDirectoryPaths?: string[] }): Promise<void>;
	rename(from: string, to: string): Promise<void>;
	chmod(path: string, mode: number): Promise<void>;
	realpath(path: string): Promise<ResolvedRemotePath>;
}

export interface TerminalDirectoryPort {
	changeDirectory(
		path: string,
		options?: { onQueued?: (state: TerminalDirectoryQueueState) => void },
	): Promise<{ path: string }>;
	readCurrentDirectory(): Promise<string>;
}

export interface FilesystemDownloadPort {
	createDownload(path: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<{ url: string }>;
}
