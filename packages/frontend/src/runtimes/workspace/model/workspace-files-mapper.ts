import type {
	WorkspaceFileEntry,
	WorkspaceFileListResponse,
	WorkspaceFileSearchResponse,
} from '@nexus-terminal/shared/remote/files/workspace';
import type {
	RemoteFileEntry,
	RemoteFileSearchEntry,
	DirectoryListing,
	FileSearchResult,
} from '@/features/filesystem/public';

export function toFileEntry(value: WorkspaceFileEntry): RemoteFileEntry {
	const result: RemoteFileEntry = {
		name: value.name,
		path: value.path,
		metadata: {
			size: value.metadata.size,
			uid: value.metadata.uid,
			gid: value.metadata.gid,
			mode: value.metadata.mode,
			accessedAt: value.metadata.accessedAt,
			modifiedAt: value.metadata.modifiedAt,
			isFile: value.metadata.isFile,
			isDirectory: value.metadata.isDirectory,
			isSymbolicLink: value.metadata.isSymbolicLink,
		},
	};
	if (value.longName !== undefined) {
		result.longName = value.longName;
	}
	return result;
}

export function toDirectoryListing(value: WorkspaceFileListResponse): DirectoryListing {
	return { path: value.path, entries: value.entries.map(toFileEntry) };
}

export function toFileSearchResult(value: WorkspaceFileSearchResponse): FileSearchResult {
	return {
		entries: value.entries.map((entry) => {
			const result = toFileEntry(entry);
			const projected: RemoteFileSearchEntry = {
				name: result.name,
				path: result.path,
				metadata: result.metadata,
				relativePath: entry.relativePath,
			};
			if (result.longName !== undefined) {
				projected.longName = result.longName;
			}
			return projected;
		}),
		truncated: value.truncated,
	};
}

/** POSIX lexical normalization mirrors the producer; it does not resolve symlinks. */
export function normalizeFilePath(value: string): string {
	if (!value.startsWith('/') || value.includes('\0')) {
		throw new Error('invalid_path');
	}
	const parts: string[] = [];
	for (const part of value.split('/')) {
		if (part === '..') {
			parts.pop();
		} else if (part && part !== '.') {
			parts.push(part);
		}
	}
	return '/' + parts.join('/');
}
