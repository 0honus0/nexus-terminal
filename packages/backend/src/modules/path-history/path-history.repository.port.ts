export interface PathHistoryEntry {
  id: number;
  path: string;
  timestamp: number;
}
export interface PathHistoryRepository {
  upsert(path: string): Promise<number>;
  list(): Promise<PathHistoryEntry[]>;
  delete(id: number): Promise<boolean>;
  clear(): Promise<number>;
}
