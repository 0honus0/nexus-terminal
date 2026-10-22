import path from 'node:path';
import {
	WORKSPACE_FILES_MAX_SEARCH_ENTRIES,
	WORKSPACE_FILES_MAX_LIST_ENTRIES,
} from '@nexus-terminal/shared/remote/files/values';
import { RemoteFileFailure, type FileEntry, type FileResource, type FileSearchResult } from '../model/file-types.js';

/** Server-owned traversal policy, independent of wire budgets. */
const SEARCH_DIRECTORIES = 5000;
const SEARCH_CONCURRENCY = 8;

type ScannedDirectory =
	| { status: 'ok'; id: number; directory: string; entries: FileEntry[] }
	| { status: 'failed'; id: number; directory: string; error: unknown };

export async function searchFiles(
	resource: FileResource,
	root: string,
	normalizedQuery: string,
	remaining: () => number,
	abort: AbortSignal,
): Promise<FileSearchResult> {
	const queue = [root];
	const items: FileSearchResult['items'] = [];
	let scannedDirectories = 0;
	let truncated = false;
	let nextId = 0;
	const pending = new Map<number, Promise<ScannedDirectory>>();
	try {
		while ((queue.length || pending.size) && items.length < WORKSPACE_FILES_MAX_SEARCH_ENTRIES) {
			while (queue.length && pending.size < SEARCH_CONCURRENCY && scannedDirectories < SEARCH_DIRECTORIES) {
				const directory = queue.shift();
				if (directory === undefined) {
					break;
				}
				const requestId = nextId++;
				scannedDirectories += 1;
				pending.set(
					requestId,
					resource
						.scan({
							path: directory,
							timeoutMs: remaining(),
							signal: abort,
							maxEntries: WORKSPACE_FILES_MAX_LIST_ENTRIES,
						})
						.then(
							(entries) => ({ status: 'ok', id: requestId, directory, entries }),
							(error: unknown) => ({ status: 'failed', id: requestId, directory, error }),
						),
				);
			}
			if (!pending.size) {
				if (queue.length) {
					truncated = true;
				}
				break;
			}
			const result = await Promise.race(pending.values());
			pending.delete(result.id);
			if (result.status === 'failed') {
				if (
					result.directory === root ||
					!(result.error instanceof RemoteFileFailure) ||
					(result.error.code !== 'not_found' && result.error.code !== 'forbidden')
				) {
					throw result.error;
				}
				truncated = true;
				continue;
			}
			for (const entry of result.entries) {
				const fullPath = path.posix.join(result.directory, entry.name);
				const relativePath = path.posix.relative(root, fullPath) || entry.name;
				if (entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
					const item: FileSearchResult['items'][number] = {
						name: entry.name,
						info: entry.info,
						path: fullPath,
						relativePath,
					};
					if (entry.longName !== undefined) {
						item.longName = entry.longName;
					}
					items.push(item);
					if (items.length >= WORKSPACE_FILES_MAX_SEARCH_ENTRIES) {
						truncated = true;
						break;
					}
				}
				if (entry.info.kind === 'directory') {
					if (queue.length + scannedDirectories < SEARCH_DIRECTORIES) {
						queue.push(fullPath);
					} else {
						truncated = true;
					}
				}
			}
		}
	} finally {
		await Promise.allSettled(pending.values());
	}
	if (queue.length) {
		truncated = true;
	}
	return { items, truncated };
}
