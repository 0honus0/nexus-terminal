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

    const pending = new Map<
      number,
      Promise<{
        id: number;
        directory: string;
        entries: Awaited<ReturnType<RemoteFileSystem['readDirectory']>>;
        error?: Error;
      }>
    >();
    let nextId = 0;
    try {
      while ((queue.length || pending.size) && items.length < maxResults) {
        while (queue.length && pending.size < concurrency && scannedDirectories < maxDirectories) {
          const directory = queue.shift()!;
          const id = nextId++;
          scannedDirectories++;
          pending.set(
            id,
            (async () => {
              try {
                return {
                  id,
                  directory,
                  entries: await filesystem.readDirectory(directory),
                  error: undefined as Error | undefined,
                };
              } catch (error) {
                return { id, directory, entries: [], error: error instanceof Error ? error : new Error(String(error)) };
              }
            })(),
          );
        }
        if (!pending.size) {
          if (queue.length) truncated = true;
          break;
        }
        const result = await Promise.race(pending.values());
        pending.delete(result.id);
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
      }
    } finally {
      // No speculative directory work survives success, truncation or a root error.
      await Promise.all(pending.values());
    }
    if (queue.length) truncated = true;
    return { items, truncated };
  }
}
