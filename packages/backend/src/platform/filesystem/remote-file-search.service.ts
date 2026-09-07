import path from 'node:path';
import type { RemoteFileSystem } from './remote-filesystem';
import type { RemoteFileSearchResult } from './file-entry';

export interface RemoteFileSearchOptions {
  maxResults?: number;
  maxDirectories?: number;
  concurrency?: number;
}

export class RemoteFileSearchService {
  async search(
    filesystem: RemoteFileSystem,
    rootPath: string,
    query: string,
    options: RemoteFileSearchOptions = {},
  ): Promise<RemoteFileSearchResult> {
    const maxResults = options.maxResults ?? 500;
    const maxDirectories = options.maxDirectories ?? 5000;
    const concurrency = options.concurrency ?? 8;
    const normalizedQuery = query.trim().slice(0, 256).toLocaleLowerCase();
    const normalizedRoot = path.posix.resolve('/', rootPath || '/');
    if (!normalizedQuery) return { items: [], truncated: false };

    const queue = [normalizedRoot];
    const items: RemoteFileSearchResult['items'] = [];
    let scannedDirectories = 0;
    let truncated = false;

    while (queue.length && items.length < maxResults) {
      const remaining = maxDirectories - scannedDirectories;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      const batch = queue.splice(0, Math.min(concurrency, remaining));
      scannedDirectories += batch.length;
      const results = await Promise.all(
        batch.map(async (directory) => {
          try {
            return {
              directory,
              entries: await filesystem.readDirectory(directory),
              error: undefined as Error | undefined,
            };
          } catch (error) {
            return { directory, entries: [], error: error instanceof Error ? error : new Error(String(error)) };
          }
        }),
      );

      for (const result of results) {
        if (result.error) {
          if (result.directory === normalizedRoot) throw result.error;
          continue;
        }
        for (const entry of result.entries) {
          if (entry.name === '.' || entry.name === '..') continue;
          const fullPath = path.posix.join(result.directory, entry.name);
          const relativePath = path.posix.relative(normalizedRoot, fullPath) || entry.name;
          if (entry.name.toLocaleLowerCase().includes(normalizedQuery)) {
            items.push({
              name: entry.name,
              path: fullPath,
              relativePath,
              ...(entry.longName ? { longName: entry.longName } : {}),
              metadata: entry.metadata,
            });
            if (items.length >= maxResults) {
              truncated = true;
              break;
            }
          }
          if (entry.metadata.isDirectory && !entry.metadata.isSymbolicLink) queue.push(fullPath);
        }
        if (items.length >= maxResults) break;
      }
    }
    if (queue.length) truncated = true;
    return { items, truncated };
  }
}
