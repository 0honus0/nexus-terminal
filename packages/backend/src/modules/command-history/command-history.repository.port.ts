export interface CommandHistoryEntry {
  id: number;
  command: string;
  timestamp: number;
}
export interface CommandHistoryRepository {
  upsert(command: string): Promise<number>;
  list(): Promise<CommandHistoryEntry[]>;
  delete(id: number): Promise<boolean>;
  clear(): Promise<number>;
}
