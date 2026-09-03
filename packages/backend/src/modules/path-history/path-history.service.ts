import type { PathHistoryEntry, PathHistoryRepository } from './path-history.repository.port';
export class PathHistoryService {
  constructor(private readonly repository: PathHistoryRepository) {}
  add(path: string): Promise<number> {
    return this.repository.upsert(path);
  }
  list(): Promise<PathHistoryEntry[]> {
    return this.repository.list();
  }
  delete(id: number): Promise<boolean> {
    return this.repository.delete(id);
  }
  clear(): Promise<number> {
    return this.repository.clear();
  }
}
