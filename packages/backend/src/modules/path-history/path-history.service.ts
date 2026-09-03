export interface PathHistoryEntry {
  id: number;
  path: string;
  usedAt: number;
}

export interface PathHistoryService {
  list(): Promise<PathHistoryEntry[]>;
}
